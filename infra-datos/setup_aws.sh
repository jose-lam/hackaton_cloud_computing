#!/usr/bin/env bash
set -euo pipefail

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
EXPECTED_ACCOUNT="${TELECORP_ACCOUNT_ID:?Configura TELECORP_ACCOUNT_ID con la cuenta elegida para el despliegue}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if [[ "$ACCOUNT" != "139694589223" ]]; then
  echo "ERROR: cuenta AWS incorrecta: $ACCOUNT"
  exit 1
fi
echo "Cuenta AWS verificada: $ACCOUNT (${AWS_DEFAULT_REGION})"

ensure_table_operations() {
  if aws dynamodb describe-table --table-name TeleCorp_Operaciones >/dev/null 2>&1; then
    echo 'Tabla existente: TeleCorp_Operaciones'
  else
    aws dynamodb create-table \
      --table-name TeleCorp_Operaciones \
      --attribute-definitions \
        AttributeName=PK,AttributeType=S \
        AttributeName=SK,AttributeType=S \
        AttributeName=GSI1PK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
      --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
      --global-secondary-indexes \
        '[{"IndexName":"GSI1_ZonaEstado","KeySchema":[{"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
      --billing-mode PAY_PER_REQUEST >/dev/null
    echo 'Tabla creada: TeleCorp_Operaciones'
  fi
}

ensure_table_windows() {
  if aws dynamodb describe-table --table-name TeleCorp_VentanasZonales >/dev/null 2>&1; then
    echo 'Tabla existente: TeleCorp_VentanasZonales'
  else
    aws dynamodb create-table \
      --table-name TeleCorp_VentanasZonales \
      --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
      --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
      --billing-mode PAY_PER_REQUEST >/dev/null
    echo 'Tabla creada: TeleCorp_VentanasZonales'
  fi
}

ensure_table_operations
ensure_table_windows
aws dynamodb wait table-exists --table-name TeleCorp_Operaciones
aws dynamodb wait table-exists --table-name TeleCorp_VentanasZonales

for config in 'TeleCorp_Operaciones:ttl_epoch' 'TeleCorp_VentanasZonales:expires_at'; do
  IFS=: read -r table attr <<< "$config"
  ttl_status="$(aws dynamodb describe-time-to-live --table-name "$table" \
    --query 'TimeToLiveDescription.TimeToLiveStatus' --output text)"
  if [[ "$ttl_status" == DISABLED || "$ttl_status" == None ]]; then
    aws dynamodb update-time-to-live --table-name "$table" \
      --time-to-live-specification "Enabled=true,AttributeName=$attr" >/dev/null
  fi
  echo "TTL $table/$attr: $ttl_status"
done

for tipo in telemetry tickets logs; do
  queue_name="telecorp-${tipo}-q"
  dlq_name="telecorp-${tipo}-dlq"
  if ! aws sqs get-queue-url --queue-name "$dlq_name" >/dev/null 2>&1; then
    aws sqs create-queue --queue-name "$dlq_name" \
      --attributes MessageRetentionPeriod=1209600 >/dev/null
  fi
  if ! aws sqs get-queue-url --queue-name "$queue_name" >/dev/null 2>&1; then
    aws sqs create-queue --queue-name "$queue_name" >/dev/null
  fi
  dlq_url="$(aws sqs get-queue-url --queue-name "$dlq_name" --query QueueUrl --output text)"
  queue_url="$(aws sqs get-queue-url --queue-name "$queue_name" --query QueueUrl --output text)"
  dlq_arn="$(aws sqs get-queue-attributes --queue-url "$dlq_url" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)"
  attrs="$(printf '{"RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}","VisibilityTimeout":"60"}' "$dlq_arn")"
  aws sqs set-queue-attributes --queue-url "$queue_url" --attributes "$attrs"
  echo "SQS configurada: $queue_name -> $dlq_name"
done

if ! aws events describe-event-bus --name telecorp-bus >/dev/null 2>&1; then
  aws events create-event-bus --name telecorp-bus >/dev/null
fi
echo 'EventBridge configurado: telecorp-bus'

# Evita sobrescribir los umbrales que P2 haya ajustado durante integración.
for entry in \
  '/telecorp/thresholds/min_gb:60' \
  '/telecorp/thresholds/max_gb:129' \
  '/telecorp/thresholds/collective_users:10' \
  '/telecorp/thresholds/window_hours:24' \
  '/telecorp/thresholds/recurrence_days:3'; do
  name="${entry%%:*}"
  value="${entry#*:}"
  if aws ssm get-parameter --name "$name" >/dev/null 2>&1; then
    echo "SSM conservado: $name"
  else
    aws ssm put-parameter --name "$name" --value "$value" --type SecureString >/dev/null
    echo "SSM creado: $name"
  fi
done

echo 'Infraestructura base de P1 lista.'
