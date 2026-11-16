#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
REGION="$AWS_DEFAULT_REGION"
API_NAME='TeleCorpSentinelP1'
API_STAGE='prod'
ACTION="${1:-check}"

say() { printf '\n==> %s\n' "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

check_local() {
  command -v python3 >/dev/null || fail 'Falta python3'
  command -v bash >/dev/null || fail 'Falta bash'
  bash -n "$ROOT/setup_aws.sh" "$ROOT/deploy_p1.sh"
  ROOT="$ROOT" python3 - <<'PY'
import ast, os
from pathlib import Path
root = Path(os.environ['ROOT'])
for name in ['api_crud', 'ingest_telemetry', 'ingest_ticket', 'ingest_logs']:
    path = root / 'lambdas' / (name + '.py')
    ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    print('Python OK:', path.name)
sim_path = root / 'simulator' / 'storm_simulator.py'
if not sim_path.exists():
    sim_path = root / 'storm_simulator.py'
ast.parse(sim_path.read_text(encoding='utf-8'), filename=str(sim_path))
print('Python OK:', sim_path.name)
PY
  if grep -Fq 'if [[ "$ACCOUNT" != "553662839025" ]]' "$ROOT/setup_aws.sh"; then
    fail 'setup_aws.sh conserva validación fija de la cuenta anterior'
  fi
  if ! grep -Fq 'for tipo in telemetry tickets logs; do' "$ROOT/setup_aws.sh"; then
    fail 'setup_aws.sh no crea la cola telecorp-logs-q'
  fi
  say 'Validaciones locales superadas. No se ha usado AWS.'
}

check_account() {
  command -v aws >/dev/null || fail 'Falta AWS CLI'
  command -v zip >/dev/null || fail 'Falta zip'
  : "${TELECORP_ACCOUNT_ID:?Define TELECORP_ACCOUNT_ID antes del despliegue}"
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  [[ "$ACCOUNT" == "$TELECORP_ACCOUNT_ID" ]] || fail "Cuenta $ACCOUNT distinta de TELECORP_ACCOUNT_ID=$TELECORP_ACCOUNT_ID"
  ROLE_ARN="$(aws iam get-role --role-name LabRole --query Role.Arn --output text)"
  [[ -n "$ROLE_ARN" && "$ROLE_ARN" != None ]] || fail 'LabRole no disponible'
  say "Cuenta confirmada: $ACCOUNT; rol: $ROLE_ARN"
}

lambda_upsert() {
  local module="$1" fn="$2" timeout="$3"
  local zipfile="$TMP_DIR/$module.zip"
  (cd "$ROOT/lambdas" && zip -q "$zipfile" "$module.py")
  if aws lambda get-function --function-name "$fn" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$fn" --zip-file "fileb://$zipfile" >/dev/null
    aws lambda wait function-updated --function-name "$fn"
    aws lambda update-function-configuration --function-name "$fn" \
      --runtime python3.11 --handler "$module.lambda_handler" \
      --timeout "$timeout" --memory-size 256 >/dev/null
  else
    aws lambda create-function --function-name "$fn" --runtime python3.11 \
      --role "$ROLE_ARN" --handler "$module.lambda_handler" \
      --zip-file "fileb://$zipfile" --timeout "$timeout" \
      --memory-size 256 >/dev/null
  fi
  aws lambda wait function-active --function-name "$fn"
  aws lambda wait function-updated --function-name "$fn"
  echo "Lambda lista: $fn"
}

ensure_mapping() {
  local queue="$1" fn="$2" batch="$3" max_conc="$4" window_sec="$5"
  local url arn uuid
  url="$(aws sqs get-queue-url --queue-name "$queue" --query QueueUrl --output text)"
  arn="$(aws sqs get-queue-attributes --queue-url "$url" --attribute-names QueueArn --query Attributes.QueueArn --output text)"
  uuid="$(aws lambda list-event-source-mappings --function-name "$fn" --event-source-arn "$arn" \
    --query 'EventSourceMappings[0].UUID' --output text)"
  if [[ "$uuid" == None || -z "$uuid" ]]; then
    aws lambda create-event-source-mapping \
      --function-name "$fn" \
      --event-source-arn "$arn" \
      --batch-size "$batch" \
      --maximum-batching-window-in-seconds "$window_sec" \
      --scaling-config "{\"MaximumConcurrency\":$max_conc}" \
      --function-response-types ReportBatchItemFailures >/dev/null
    echo "SQS enlazada (MaxConcurrency=$max_conc, Batch=$batch): $queue -> $fn"
  else
    aws lambda update-event-source-mapping \
      --uuid "$uuid" \
      --batch-size "$batch" \
      --maximum-batching-window-in-seconds "$window_sec" \
      --scaling-config "{\"MaximumConcurrency\":$max_conc}" \
      --function-response-types ReportBatchItemFailures >/dev/null
    echo "Event source mapping actualizado (MaxConcurrency=$max_conc, Batch=$batch): $fn <- $queue ($uuid)"
  fi
}

ensure_api() {
  local api_id root_id proxy_id lambda_arn uri auth
  api_id="$(aws apigateway get-rest-apis --query "items[?name=='$API_NAME'].id | [0]" --output text)"
  if [[ "$api_id" == None || -z "$api_id" ]]; then
    api_id="$(aws apigateway create-rest-api --name "$API_NAME" \
      --endpoint-configuration types=REGIONAL --query id --output text)"
    echo "API REST creada: $API_NAME / $api_id"
  else
    echo "API REST existente: $API_NAME / $api_id"
  fi

  root_id="$(aws apigateway get-resources --rest-api-id "$api_id" \
    --query "items[?path=='/'].id | [0]" --output text)"
  proxy_id="$(aws apigateway get-resources --rest-api-id "$api_id" \
    --query "items[?path=='/{proxy+}'].id | [0]" --output text)"
  if [[ "$proxy_id" == None || -z "$proxy_id" ]]; then
    proxy_id="$(aws apigateway create-resource --rest-api-id "$api_id" \
      --parent-id "$root_id" --path-part '{proxy+}' --query id --output text)"
  fi

  auth=AWS_IAM
  if [[ "${P1_PUBLIC_DEMO:-false}" == true ]]; then
    auth=NONE
    echo 'AVISO: API SIN AUTENTICACION. Usa SOLO datos ficticios.' >&2
  fi
  if ! aws apigateway get-method --rest-api-id "$api_id" --resource-id "$proxy_id" \
      --http-method ANY >/dev/null 2>&1; then
    aws apigateway put-method --rest-api-id "$api_id" --resource-id "$proxy_id" \
      --http-method ANY --authorization-type "$auth" \
      --request-parameters 'method.request.path.proxy=true' >/dev/null
  else
    aws apigateway update-method --rest-api-id "$api_id" --resource-id "$proxy_id" \
      --http-method ANY --patch-operations "op=replace,path=/authorizationType,value=$auth" >/dev/null
  fi

  if ! aws apigateway get-method --rest-api-id "$api_id" --resource-id "$proxy_id" \
      --http-method OPTIONS >/dev/null 2>&1; then
    aws apigateway put-method --rest-api-id "$api_id" --resource-id "$proxy_id" \
      --http-method OPTIONS --authorization-type NONE >/dev/null
  fi

  lambda_arn="$(aws lambda get-function --function-name telecorp-api-crud \
    --query 'Configuration.FunctionArn' --output text)"
  uri="arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$lambda_arn/invocations"
  for method in ANY OPTIONS; do
    aws apigateway put-integration --rest-api-id "$api_id" --resource-id "$proxy_id" \
      --http-method "$method" --type AWS_PROXY --integration-http-method POST \
      --uri "$uri" >/dev/null
  done

  local statement='AllowTeleCorpApiGatewayProxy'
  if ! aws lambda get-policy --function-name telecorp-api-crud --query Policy \
      --output text 2>/dev/null | grep -Fq "\"Sid\": \"$statement\""; then
    if ! aws lambda add-permission --function-name telecorp-api-crud \
       --statement-id "$statement" --action lambda:InvokeFunction \
       --principal apigateway.amazonaws.com \
       --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$api_id/*/*/*" >/dev/null 2>"$TMP_DIR/add-permission.err"; then
      grep -q 'ResourceConflictException' "$TMP_DIR/add-permission.err" || {
        cat "$TMP_DIR/add-permission.err" >&2; return 1;
      }
    fi
  fi

  aws apigateway create-deployment --rest-api-id "$api_id" \
    --stage-name "$API_STAGE" --description 'P1 TeleCorp API' >/dev/null

  # Limitar rafagas HTTP en el stage para no superar 10 Lambdas simultaneas
  aws apigateway update-stage --rest-api-id "$api_id" --stage-name "$API_STAGE" \
    --patch-operations \
      op=replace,path=/*/*/throttling/burstLimit,value=2 \
      op=replace,path=/*/*/throttling/rateLimit,value=3 >/dev/null

  printf '\nAPI_URL=https://%s.execute-api.%s.amazonaws.com/%s\n' "$api_id" "$REGION" "$API_STAGE"
  echo "Autorizacion: $auth. Throttling stage: burst=2, rate=3 req/s."
}

case "$ACTION" in
  check)
    check_local
    ;;
  deploy)
    check_local
    check_account
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    say 'Creando/validando DynamoDB, SQS, EventBridge y SSM'
    bash "$ROOT/setup_aws.sh"
    say 'Publicando las cuatro Lambdas de P1'
    lambda_upsert ingest_telemetry telecorp-ingest-telemetry 30
    lambda_upsert ingest_ticket telecorp-ingest-ticket 30
    lambda_upsert ingest_logs telecorp-ingest-logs 30
    lambda_upsert api_crud telecorp-api-crud 30
    say 'Enlazando colas a Lambdas (MaxConcurrency=2, Batch=10)'
    ensure_mapping telecorp-telemetry-q telecorp-ingest-telemetry 10 2 3
    ensure_mapping telecorp-tickets-q telecorp-ingest-ticket 10 2 3
    ensure_mapping telecorp-logs-q telecorp-ingest-logs 10 2 5
    say 'Configurando API Gateway REST + Lambda proxy'
    ensure_api
    say 'Despliegue P1 listo y blindado <= 10 Lambdas.'
    ;;
  smoke)
    check_account
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    say 'Smoke tests de las rutas de la API (sin escrituras)'
    invoke_case() {
      local label="$1" expected="$2" payload="$3" actual
      aws lambda invoke --function-name telecorp-api-crud \
        --cli-binary-format raw-in-base64-out --payload "$payload" \
        "$TMP_DIR/response.json" >/dev/null
      actual="$(python3 - "$TMP_DIR/response.json" "$expected" <<'PYSMOKE'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
actual = data.get('statusCode')
expected = int(sys.argv[2])
assert actual == expected, f'Se esperaba {expected}, llego {data}'
assert data.get('headers', {}).get('Access-Control-Allow-Origin') == '*', 'Falta header CORS'
print(actual)
PYSMOKE
)" || return 1
      echo "OK [$actual] $label"
    }
    invoke_case 'OPTIONS /tickets' 200 '{"httpMethod":"OPTIONS","path":"/tickets"}'
    invoke_case 'POST /tickets (validacion 400)' 400 '{"httpMethod":"POST","path":"/tickets","body":"{}"}'
    invoke_case 'POST /telemetria (validacion 400)' 400 '{"httpMethod":"POST","path":"/telemetria","body":"{}"}'
    invoke_case 'POST /logs (validacion 400)' 400 '{"httpMethod":"POST","path":"/logs","body":"{}"}'
    invoke_case 'GET /tickets (sin resultados)' 200 '{"httpMethod":"GET","path":"/tickets","queryStringParameters":{"ticket_id":"TCK-NOEXISTE-SMOKE"}}'
    invoke_case 'PATCH /tickets/{id}/estado (validacion 400)' 400 '{"httpMethod":"PATCH","path":"/tickets/TCK-NOEXISTE-SMOKE/estado","body":"{\"new_status\":\"INVALIDO\"}"}'
    invoke_case 'GET /incidentes' 200 '{"httpMethod":"GET","path":"/incidentes"}'
    invoke_case 'GET /antenas' 200 '{"httpMethod":"GET","path":"/antenas"}'
    invoke_case 'GET /analytics/resumen' 200 '{"httpMethod":"GET","path":"/analytics/resumen"}'
    say 'Smoke test de rutas terminado.'
    ;;
  *)
    echo "Uso: bash infra-datos/deploy_p1.sh [check|deploy|smoke]" >&2
    exit 2
    ;;
esac
