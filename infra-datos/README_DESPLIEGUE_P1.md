# Despliegue P1 — TeleCorp Sentinel AI

Este paquete contiene los componentes P1: `setup_aws.sh`, `deploy_p1.sh`, las Lambdas de ingesta/API (`lambdas/ingest_telemetry.py`, `lambdas/ingest_ticket.py`, `lambdas/ingest_logs.py`, `lambdas/api_crud.py`) y el simulador de escenarios (`simulator/storm_simulator.py`), con blindaje estricto de concurrencia ($\le 10$ Lambdas simultáneas) y soporte completo de endpoints para P3.

## 1. Preparación local (sin AWS)

Desde la raíz del repositorio:

```bash
bash infra-datos/deploy_p1.sh check
python3 infra-datos/simulator/storm_simulator.py --self-test
git diff --check
```

## 2. Despliegue en CloudShell (Cuenta AWS `390577088044`)

### Opción A: Despliegue completo P1 + P2 + Frontend S3 (`~/deploy_all.sh`)

```bash
export AWS_PAGER=""
export AWS_DEFAULT_REGION="us-east-1"
export TELECORP_ACCOUNT_ID="390577088044"
export GCP_ENDPOINT_URL="https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io"
export GCP_API_KEY="5dff4dad49d1ed2c8d0bc9dc9fbf4cb3ffbb300531108ca6"

bash ~/deploy_all.sh
```

### Opción B: Despliegue aislado del módulo P1 (`deploy_p1.sh`)

```bash
export AWS_PAGER=""
export AWS_DEFAULT_REGION="us-east-1"
export TELECORP_ACCOUNT_ID="390577088044"

P1_PUBLIC_DEMO=true bash infra-datos/deploy_p1.sh deploy
bash infra-datos/deploy_p1.sh smoke
```

El script valida el ID real con STS (`390577088044`), crea/configura las dos tablas DynamoDB (`TeleCorp_Operaciones` y `TeleCorp_VentanasZonales`), 3 colas SQS y DLQ, el bus EventBridge `telecorp-bus`, parámetros SSM y despliega `telecorp-ingest-telemetry`, `telecorp-ingest-ticket`, `telecorp-ingest-logs` y `telecorp-api-crud`.

**Control de concurrencia ($\le 10$ Lambdas) y Throttling:**
* Los *event-source mappings* SQS se configuran con `BatchSize = 10`, `MaximumBatchingWindowInSeconds = 3` ($5\text{ s}$ en logs), `--scaling-config '{"MaximumConcurrency":2}'` y `ReportBatchItemFailures`.
* `ingest_ticket.py` e `ingest_telemetry.py` deduplican por lote y espacian en $0.25\text{ s}$ sus publicaciones hacia EventBridge para mantener a `telecorp-eval-collective` en $\le 1$ ejecución concurrente.
* El stage `prod` de API Gateway limita ráfagas HTTP mediante `throttling/burstLimit = 2` y `throttling/rateLimit = 3`.
* `infra-datos/simulator/storm_simulator.py` opera con `max_workers = 2` (en `--transport http`) y pausas de $1.5\text{ s}$ entre lotes SQS de $10$ mensajes.

**Endpoints expuestos por `telecorp-api-crud` (`API Gateway /prod`):**
* `POST /tickets` y `GET /tickets` (con soporte de `incident_time` e historial `HIST#`)
* `PATCH /tickets/{ticket_id}/estado` (emite `incidente.solucionado` al marcar `"Solucionada"`)
* `GET /incidentes` y `PATCH /incidentes/{incident_id}/estado` (cierre en cascada de incidente maestro + tickets vinculados)
* `GET /antenas` (estado actual, tráfico y `structural_risk`)
* `POST /telemetria`, `POST /logs` y `GET /analytics/resumen`

**Autenticación:** Por defecto, los métodos `ANY` de API Gateway requieren firma SigV4 (`AWS_IAM`), mientras que la preflight `OPTIONS` es pública. Para demostraciones web con el SPA en S3, ejecutar con `P1_PUBLIC_DEMO=true` (`authorization-type NONE`). Re-ejecutar sin `P1_PUBLIC_DEMO` para volver a `AWS_IAM`.

El modo `smoke` invoca `telecorp-api-crud` directamente y comprueba los casos principales de las rutas (`OPTIONS /tickets`, validaciones `400` en `POST /tickets`, `POST /telemetria`, `POST /logs`, `PATCH /tickets/{id}/estado`, y consultas `200` en `GET /tickets`, `GET /incidentes`, `GET /antenas`, `GET /analytics/resumen`) sin escribir datos.

## 3. Simulación Controlada y Verificación de Concurrencia

```bash
# Ejecutar escenarios E2E sin desbordar <= 10 Lambdas
python3 infra-datos/simulator/storm_simulator.py --mode storm-hospital --transport sqs
sleep 8
python3 infra-datos/simulator/storm_simulator.py --mode recurrent --transport sqs
sleep 6

# Verificar pico real de concurrencia en CloudWatch
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name ConcurrentExecutions \
  --start-time "$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 60 \
  --statistics Maximum \
  --query 'Datapoints | sort_by(@, &Timestamp)[*].{Minuto:Timestamp,PicoConcurrente:Maximum}' \
  --output table
```

## 4. Git

```bash
git add infra-datos/setup_aws.sh infra-datos/deploy_p1.sh infra-datos/lambdas/api_crud.py infra-datos/lambdas/ingest_ticket.py infra-datos/lambdas/ingest_telemetry.py infra-datos/simulator/storm_simulator.py infra-datos/README_DESPLIEGUE_P1.md
git commit -m 'feat(p1): add concurrency cap <=10, incident/antenna endpoints and account 390577088044'
git push
```
