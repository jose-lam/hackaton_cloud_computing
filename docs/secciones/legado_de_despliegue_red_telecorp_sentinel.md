# Legado de Despliegue — Red TeleCorp Sentinel (Módulos P1, P2 y P3 Completos — Multi-Cloud AWS + Azure)

* **Última actualización:** 15 de noviembre de 2026
* **Cuenta AWS:** `390577088044` (AWS Academy — Límite operativo blindado: $\le 10$ ejecuciones concurrentes de Lambda)
* **Región AWS:** `us-east-1`
* **Rol de ejecución IAM:** `arn:aws:iam::390577088044:role/LabRole`
* **API Gateway Base URL (`prod`):** `https://<API_ID>.execute-api.us-east-1.amazonaws.com/prod` *(API REST `TeleCorpSentinelP1`, consultable con `aws apigateway get-rest-apis --query "items[?name=='TeleCorpSentinelP1'].id | [0]" --output text`)*
* **Microservicio IA + Geoespacial (Azure Container Apps — `westus2`):** `https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io`
* **Frontend Público (HTTPS en Amazon S3 — Vite + React + TypeScript + HashRouter):**
  * **Portal Ciudadano:** `https://telecorp-sentinel-portal-390577088044.s3.us-east-1.amazonaws.com/index.html`
  * **Dashboard NOC:** `https://telecorp-sentinel-portal-390577088044.s3.us-east-1.amazonaws.com/index.html#/noc`
* **Estado del módulo P1:** **100 % Completado, Blindado ($\le 10$ Lambdas) y Validado End-to-End** — Infraestructura base (`setup_aws.sh` — **P1.1**), **Tarea P1.2** (`telecorp-ingest-telemetry` con deduplicación intra-lote), **Tarea P1.3** (`telecorp-ingest-ticket` + `telecorp-ingest-logs`), **Tarea P1.4** (`telecorp-api-crud` + rutas `GET /incidentes`, `PATCH /incidentes/{id}/estado`, `GET /antenas`, `incident_time` + API Gateway `TeleCorpSentinelP1` con *throttling*) y **Tarea P1.5** (`infra-datos/simulator/storm_simulator.py`).
* **Estado del módulo P2:** **100 % Completado y Validado End-to-End** — Reglas EventBridge, detección colectiva (`P2.1`), recurrencia estructural (`P2.2`), puente Multi-Cloud y score (`P2.3` — timeout ampliado a $30\text{ s}$ para *cold start* de Azure Container Apps), Step Functions (`P2.4` — `TeleCorpSentinelWorkflow`) y notificaciones omnicanal SNS (`P2.5`).
* **Estado del módulo P3:** **100 % Completado e Integrado Multi-Cloud**
  * **Microservicio IA + Geoespacial (`POST /ia/analizar` — Tareas P3.1–P3.3):** Desplegado y activo en **Azure Container Apps** (`westus2`), enlazado vía SSM Parameter Store (`/telecorp/gcp/endpoint_url` y `/telecorp/gcp/api_key`).
  * **Frontend SPA (`frontend/` — Tareas P3.4 y P3.5):** Compilado con Vite (`npm run build`, `VITE_MOCK=false`) y desplegado en **Amazon S3** (`telecorp-sentinel-portal-390577088044`).

---

## 1. Inventario de Recursos Desplegados en AWS y Azure

### 1.1. Bases de Datos (Amazon DynamoDB)
Ambas tablas operan bajo demanda (`PAY_PER_REQUEST`) y cuentan con TTL activo para limpieza automática:

| Tabla | Llave Primaria | Índice Secundario Global | Atributo TTL | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| `TeleCorp_Operaciones` | `PK` (String), `SK` (String) | `GSI1_ZonaEstado` (`GSI1PK`, `GSI1SK`) — `ACTIVE` | `ttl_epoch` | Almacena estado e historial de antenas (`ANTENNA#*`), tickets individuales (`TICKET#*`), logs internos (`LOG#*`) e incidentes maestros (`INCIDENT#*`). |
| `TeleCorp_VentanasZonales` | `PK` (String), `SK` (String) | N/A | `expires_at` | Controla ventanas deslizantes de $24\text{ horas}$ (`WIN#<geohash>`), deduplicación de usuarios únicos (`USER#<user_id>`) y auditoría de notificaciones (`NOTIF#*`). |

### 1.2. Colas de Mensajería y Control de Concurrencia (Amazon SQS)
Configuradas con `VisibilityTimeout` de $60\text{ s}$ y política de reintentos (`maxReceiveCount = 5`) hacia sus colas de mensajes fallidos (retención de $14\text{ días}$). Para garantizar que la cuenta nunca supere $\le 10$ Lambdas simultáneas en tormentas, los *event-source mappings* operan con `BatchSize = 10` y `MaximumConcurrency = 2`:

* `telecorp-telemetry-q` $\rightarrow$ DLQ: `telecorp-telemetry-dlq` *(enlazada a `telecorp-ingest-telemetry`, `BatchSize = 10`, `MaximumBatchingWindowInSeconds = 3`, `MaximumConcurrency = 2`, `ReportBatchItemFailures`)*
* `telecorp-tickets-q` $\rightarrow$ DLQ: `telecorp-tickets-dlq` *(enlazada a `telecorp-ingest-ticket`, `BatchSize = 10`, `MaximumBatchingWindowInSeconds = 3`, `MaximumConcurrency = 2`, `ReportBatchItemFailures`)*
* `telecorp-logs-q` $\rightarrow$ DLQ: `telecorp-logs-dlq` *(enlazada a `telecorp-ingest-logs`, `BatchSize = 10`, `MaximumBatchingWindowInSeconds = 5`, `MaximumConcurrency = 2`, `ReportBatchItemFailures`)*

### 1.3. Bus de Eventos y Reglas (Amazon EventBridge)
* **Event Bus personalizado:** `telecorp-bus` (Estado: `Active`)

| Regla | Estado | Patrón de Evento (`detail-type`) | Destino (Lambda) |
| :--- | :--- | :--- | :--- |
| `telecorp-collective-rule` | `ENABLED` | `incidencia.creada`, `antena.anomalia` | `telecorp-eval-collective` |
| `telecorp-recurrence-rule` | `ENABLED` | `antena.anomalia` | `telecorp-eval-recurrence` |
| `telecorp-incident-resolved-rule` | `ENABLED` | `incidente.solucionado` | `telecorp-notify-users` |

### 1.4. Funciones Serverless (AWS Lambda — Python 3.11)
Todas desplegadas en la cuenta `390577088044`, arquitectura `x86_64`, memoria de $256\text{ MB}$ y rol `LabRole`:

1. **`telecorp-eval-collective` (Tarea P2.1 — Activa)**
   * **Timeout:** $15\text{ s}$ | **Handler:** `eval_collective.lambda_handler`
   * **Variables de entorno:** `STATE_MACHINE_NAME=TeleCorpSentinelWorkflow`, `TABLA_VENTANAS=TeleCorp_VentanasZonales`, `TABLA_OPERACIONES=TeleCorp_Operaciones`
   * **Función:** Acumula reportes únicos por `geohash` en ventanas de $24\text{ h}$. Al alcanzar $10$ usuarios únicos (`COLECTIVO_10`) o $\ge 3$ usuarios + anomalía crítica de antena (`TEMPRANO_IA`), genera el `incident_id` maestro e inicia Step Functions vinculando reportes posteriores al mismo incidente.
2. **`telecorp-eval-recurrence` (Tarea P2.2 — Activa)**
   * **Timeout:** $15\text{ s}$ | **Handler:** `eval_recurrence.lambda_handler`
   * **Variables de entorno:** `TABLA_OPERACIONES=TeleCorp_Operaciones`, `SSM_RECURRENCE_DAYS_PARAM=/telecorp/thresholds/recurrence_days`, `RECURRENCE_LOOKBACK_DAYS=7`
   * **Función:** Evalúa historial de fallas de antenas en los últimos $7\text{ días}$ y activa alerta estructural (`structural_risk = true`) si hay fallas en $\ge 3$ días distintos.
3. **`telecorp-enrich-and-score` (Tarea P2.3 — Activa)**
   * **Timeout:** $30\text{ s}$ | **Handler:** `enrich_and_score.lambda_handler`
   * **Variables de entorno:** `TABLA_OPERACIONES=TeleCorp_Operaciones`, `SSM_GCP_URL_PARAM=/telecorp/gcp/endpoint_url`, `SSM_GCP_KEY_PARAM=/telecorp/gcp/api_key`, `GCP_TIMEOUT_SEC=8.0`
   * **Función:** Puente Multi-Cloud hacia **Azure Container Apps** (`POST {endpoint_url}/ia/analizar` con cabecera `X-API-Key`, *timeout* de $8.0\text{ s}$ con $1$ reintento y motor de respaldo `FALLBACK_LOCAL` ante *cold start* o latencia). Calcula el puntaje de criticidad y persiste el incidente maestro en DynamoDB.
4. **`telecorp-notify-users` (Tarea P2.5 — Activa)**
   * **Timeout:** $15\text{ s}$ | **Handler:** `notify_users.lambda_handler`
   * **Variables de entorno:** `TABLA_OPERACIONES=TeleCorp_Operaciones`, `TABLA_VENTANAS=TeleCorp_VentanasZonales`, `SSM_SNS_TOPIC_PARAM=/telecorp/sns/topic_arn`, `ENABLE_DIRECT_SMS=false`
   * **Función:** Publica alertas zonales de confirmación o resolución en Amazon SNS y registra auditoría omnicanal en `TeleCorp_VentanasZonales`.
5. **`telecorp-ingest-telemetry` (Tarea P1.2 — Activa)**
   * **ARN:** `arn:aws:lambda:us-east-1:390577088044:function:telecorp-ingest-telemetry`
   * **Timeout:** $30\text{ s}$ | **Handler:** `ingest_telemetry.lambda_handler`
   * **Event Source Mapping:** Cola SQS `telecorp-telemetry-q` (`BatchSize = 10`, `MaximumConcurrency = 2`, `ReportBatchItemFailures`).
   * **Función:** Evalúa tráfico de antenas contra los umbrales SSM (`/telecorp/thresholds/min_gb` y `max_gb`), clasifica en `INHABILITADA` ($0$), `CAIDA` ($< 60$), `NORMAL` ($60\text{--}129$) y `SATURADA` ($> 129$), actualiza `PK=ANTENNA#<id>, SK=CURRENT` con `GSI1PK="ZONA#<geohash>"`, registra eventos anómalos diarios `EVENT#<YYYY-MM-DD>#<iso_ts>`, cierra `recovered_at` y `duration_sec` al volver a `NORMAL`, deduplica anomalías por antena dentro del lote y publica `antena.anomalia` en `telecorp-bus` con espaciado de $0.25\text{ s}$.
6. **`telecorp-ingest-ticket` (Tarea P1.3 — Activa)**
   * **ARN:** `arn:aws:lambda:us-east-1:390577088044:function:telecorp-ingest-ticket`
   * **Timeout:** $30\text{ s}$ | **Handler:** `ingest_ticket.lambda_handler`
   * **Event Source Mapping:** Cola SQS `telecorp-tickets-q` (`BatchSize = 10`, `MaximumConcurrency = 2`, `ReportBatchItemFailures`).
   * **Función:** Valida reportes ciudadanos recibidos por SQS (incluyendo `incident_time`), calcula `geohash` de $6$ caracteres en Python puro a partir de `(lat, lon)`, persiste `PK=TICKET#<id>, SK=META` (`status = "Registrada"`, `GSI1PK="ZONA#<geohash>"`) y `SK=HIST#<iso_ts>` (`GSI1PK="USER#<user_id>"`) en `TeleCorp_Operaciones`, deduplica `(geohash, user_id)` por lote y publica `incidencia.creada` en `telecorp-bus` con espaciado de $0.25\text{ s}$.
7. **`telecorp-ingest-logs` (Tarea P1.3 — Activa)**
   * **ARN:** `arn:aws:lambda:us-east-1:390577088044:function:telecorp-ingest-logs`
   * **Timeout:** $30\text{ s}$ | **Handler:** `ingest_logs.lambda_handler`
   * **Event Source Mapping:** Cola SQS `telecorp-logs-q` (`BatchSize = 10`, `MaximumConcurrency = 2`, `ReportBatchItemFailures`).
   * **Función:** Valida logs técnicos (`INFO`, `WARN`, `ERROR`, `CRITICAL`), asigna `ttl_epoch` de $7\text{ días}$ y los almacena en `TeleCorp_Operaciones` bajo `PK=LOG#<log_id>, SK=META`.
8. **`telecorp-api-crud` (Tarea P1.4 — Activa)**
   * **ARN:** `arn:aws:lambda:us-east-1:390577088044:function:telecorp-api-crud`
   * **Timeout:** $30\text{ s}$ | **Handler:** `api_crud.lambda_handler`
   * **Permiso de invocación:** Statement `AllowTeleCorpApiGatewayProxy` desde `apigateway.amazonaws.com` (`arn:aws:execute-api:us-east-1:390577088044:<API_ID>/*/*/*`).
   * **Función:** Expone la capa REST completa detrás de API Gateway (`AWS_PROXY`) con cabeceras CORS (`Access-Control-Allow-Origin: *`), incluyendo `POST/GET /tickets` (con `incident_time`), `PATCH /tickets/{ticket_id}/estado`, `GET /incidentes`, `PATCH /incidentes/{incident_id}/estado` (cierre en cascada), `GET /antenas`, `POST /telemetria`, `POST /logs` y `GET /analytics/resumen`.

### 1.5. Orquestación (AWS Step Functions)
* **Máquina de estados:** `TeleCorpSentinelWorkflow` (Tipo: `STANDARD`, Estado: `ACTIVE`)
* **ARN:** `arn:aws:states:us-east-1:390577088044:stateMachine:TeleCorpSentinelWorkflow`
* **Flujo:** `VerificarInfraestructuraYRecurrencia` $\rightarrow$ `AnalizarConIAYGeoespacialGCP` *(conectado a Azure Container Apps)* $\rightarrow$ `EvaluarCriticidad` (`PrepararAtencionInmediata` / `PrepararRevisionPrioritaria` / `EsperarConfirmacionPersistencia`) $\rightarrow$ `ConfirmarIncidenteZonal` (escritura directa en DynamoDB) $\rightarrow$ `NotificarUsuariosAfectados`.

### 1.6. API Gateway REST (Amazon API Gateway — Tarea P1.4 — Activa)
* **Nombre de API:** `TeleCorpSentinelP1` | **Tipo de Endpoint:** `REGIONAL` | **Stage desplegado:** `prod`
* **URL Base:** `https://<API_ID>.execute-api.us-east-1.amazonaws.com/prod`
* **Configuración de Seguridad, CORS y Throttling:** Recurso proxy `/{proxy+}` con métodos `ANY` y `OPTIONS` configurados con `authorization-type: NONE` (`P1_PUBLIC_DEMO=true`), integración `AWS_PROXY` hacia `telecorp-api-crud` y control de ráfagas en stage `prod` (`throttling/burstLimit = 2`, `throttling/rateLimit = 3`).

| Método | Ruta | Propósito | Código Esperado |
| :--- | :--- | :--- | :--- |
| `POST` | `/tickets` | Valida reporte ciudadano (incluyendo `incident_time`), calcula `geohash` ($6$ chars) y encola en `telecorp-tickets-q`. | `202 Accepted` |
| `GET` | `/tickets` | Consulta tickets por `ticket_id`, `user_id` o `geohash` incluyendo arreglo `history` e `incident_time`. | `200 OK` |
| `PATCH` | `/tickets/{ticket_id}/estado` | Actualiza estado, registra `HIST#` y emite `incidente.solucionado` si pasa a `"Solucionada"`. | `200 OK` |
| `GET` | `/incidentes` | Lista incidentes maestros (`INCIDENT#*`) ordenados por `priority_score`, incluyendo `ticket_ids`, `antenna_id` y `ai_confidence`. | `200 OK` |
| `PATCH` | `/incidentes/{incident_id}/estado` | Actualiza estado del incidente maestro y cierra/actualiza en cascada sus tickets asociados en una sola llamada. | `200 OK` |
| `GET` | `/antenas` | Lista antenas registradas (`ANTENNA#*/CURRENT`) con `health_status`, `last_traffic_gb` y `structural_risk`. | `200 OK` |
| `POST` | `/telemetria` | Valida lectura de tráfico de antena (`GB/min`) y encola en `telecorp-telemetry-q`. | `202 Accepted` |
| `POST` | `/logs` | Valida log técnico (`INFO`–`CRITICAL`) y encola en `telecorp-logs-q`. | `202 Accepted` |
| `GET` | `/analytics/resumen` | Devuelve KPIs (`total_tickets`, `active_incidents`, `avg_mttr_minutes`, `total_affected_users`), `top_zones`, `recurrent_antennas`, `top_problem_types` y `master_incidents`. | `200 OK` |
| `OPTIONS` | `/{proxy+}` | Responde *preflight* CORS para peticiones desde navegador (S3). | `200 OK` |

### 1.7. Notificaciones, Parámetros SSM y Servicio IA en Azure (SNS, SSM y Azure Container Apps)
* **Tópico SNS:** `telecorp-alertas-zonales` (`arn:aws:sns:us-east-1:390577088044:telecorp-alertas-zonales`)
* **Microservicio IA + OpenStreetMap (Azure Container Apps — `westus2`):**
  * **URL Base:** `https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io`
  * **Endpoint:** `POST {endpoint_url}/ia/analizar` (autenticado vía cabecera `X-API-Key`)
* **Parámetros SSM (`SecureString` — nombres con prefijo `/telecorp/gcp/*` preservados por compatibilidad):**
  * `/telecorp/thresholds/min_gb` = `60`
  * `/telecorp/thresholds/max_gb` = `129`
  * `/telecorp/thresholds/collective_users` = `10`
  * `/telecorp/thresholds/window_hours` = `24`
  * `/telecorp/thresholds/recurrence_days` = `3`
  * `/telecorp/gcp/endpoint_url` = `https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io`
  * `/telecorp/gcp/api_key` = `<X_API_KEY>`
  * `/telecorp/sns/topic_arn` = `arn:aws:sns:us-east-1:390577088044:telecorp-alertas-zonales`

### 1.8. Frontend Estático SPA (Amazon S3 — Tareas P3.4 y P3.5 — Activo)
* **Bucket S3:** `telecorp-sentinel-portal-390577088044` (`arn:aws:s3:::telecorp-sentinel-portal-390577088044`, región `us-east-1`)
* **Stack y Build:** SPA en **Vite + React 18 + TypeScript + Tailwind** con `HashRouter`, compilado mediante `npm run build` hacia `frontend/dist/` con `.env.production` (`VITE_API_BASE_URL=https://<API_ID>.execute-api.us-east-1.amazonaws.com/prod` y `VITE_MOCK=false`).
* **Configuración S3:** *Static Website Hosting* habilitado (`index.html`), acceso público activado (`PublicReadGetObject` para `s3:GetObject`).
* **URLs de acceso público con SSL/TLS (`HTTPS`):**
  * **Portal Ciudadano:** `https://telecorp-sentinel-portal-390577088044.s3.us-east-1.amazonaws.com/index.html`
  * **Dashboard NOC:** `https://telecorp-sentinel-portal-390577088044.s3.us-east-1.amazonaws.com/index.html#/noc`

---

## 2. Parches y Decisiones Aplicadas Durante el Despliegue

1. **Migración de Cuenta AWS a `390577088044` y Actualización de `setup_aws.sh`:** Se actualizó la validación de cuenta fija en `infra-datos/setup_aws.sh` de `139694589223` a `390577088044` y se corrigió en `infra-datos/deploy_p1.sh` la ruta de verificación sintáctica del simulador hacia `infra-datos/simulator/storm_simulator.py`.
2. **Blindaje de Concurrencia ($\le 10$ Lambdas) en Toda la Arquitectura:**
   * En `infra-datos/deploy_p1.sh` y `~/deploy_all.sh`, los tres *event-source mappings* SQS (`telecorp-telemetry-q`, `telecorp-tickets-q`, `telecorp-logs-q`) se configuraron con `BatchSize = 10`, `MaximumBatchingWindowInSeconds = 3` ($5\text{ s}$ para logs) y `--scaling-config '{"MaximumConcurrency":2}'`.
   * En `ingest_ticket.py` e `ingest_telemetry.py` se implementó deduplicación intra-lote y espaciado controlado de $0.25\text{ s}$ al publicar en EventBridge para mantener a `telecorp-eval-collective` en $\le 1$ ejecución simultánea.
   * En API Gateway stage `prod` se configuró `throttling/burstLimit = 2` y `throttling/rateLimit = 3`, y en `storm_simulator.py` se redujo `max_workers` HTTP a $2$ (con pausa de $0.35\text{ s}$) y se añadió pausa de $1.5\text{ s}$ entre lotes SQS de $10$ mensajes.
3. **Implementación de Endpoints Faltantes (`PENDIENTES_BACKEND.md`) en `api_crud.py`:** Se incorporaron `GET /incidentes` (con `ticket_ids`, `antenna_id` y `ai_confidence`), `PATCH /incidentes/{incident_id}/estado` (cierre en cascada de incidente + tickets asociados en una sola llamada) y `GET /antenas`, además de soporte completo de `incident_time` en `POST /tickets`, `GET /tickets` e `ingest_ticket.py`.
4. **Integración Multi-Cloud AWS $\rightarrow$ Azure Container Apps (`westus2`):**
   * El microservicio de IA y análisis geoespacial (`POST /ia/analizar`) fue desplegado en **Azure Container Apps** (`https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io`).
   * Se conservaron los nombres de parámetros SSM `/telecorp/gcp/endpoint_url` y `/telecorp/gcp/api_key` para mantener compatibilidad sin cambios de variables de entorno en `enrich_and_score.py`, elevando el *timeout* de la Lambda `telecorp-enrich-and-score` a $30\text{ s}$ para absorber el *cold start* del contenedor Azure más el *timeout* de $8.0\text{ s}$ con $1$ reintento.
5. **Compilación y Despliegue del Frontend Vite/React en S3 (`telecorp-sentinel-portal-390577088044`):** Se configuró `.env.production` con `VITE_API_BASE_URL` apuntando al nuevo API Gateway y `VITE_MOCK=false`, compilando `frontend/dist/` con `npm run build` y sincronizando con `aws s3 sync`.
6. **Automatización Integral en CloudShell (`~/deploy_all.sh`):** Se consolidó el despliegue idempotente completo (P1 + blindaje SQS + SNS/SSM + P2 + Step Functions + Build/Sync S3 + Smoke Tests + Simulación + Auditoría CloudWatch) en un único script ejecutable.

---

## 3. Guía Rápida de Mantenimiento Tras un `git pull`

Cuando haya cambios en el repositorio (`~/hackaton_cloud_computing`), **no ejecutar comandos `create-*` manualmente**; ejecutar el script maestro idempotente o actualizar únicamente el componente modificado:

### Redesplegar todo el entorno de forma idempotente (`~/deploy_all.sh`)
```bash
export AWS_PAGER=""
export AWS_DEFAULT_REGION="us-east-1"
export TELECORP_ACCOUNT_ID="390577088044"
export GCP_ENDPOINT_URL="https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io"
export GCP_API_KEY="<X_API_KEY>"

cd ~/hackaton_cloud_computing && git pull
bash ~/deploy_all.sh
```

### Actualizar solo el Frontend SPA (Vite/React) en Amazon S3
```bash
export AWS_PAGER=""
export ACCOUNT_ID="390577088044"
export API_ID=$(aws apigateway get-rest-apis --query "items[?name=='TeleCorpSentinelP1'].id | [0]" --output text)

cd ~/hackaton_cloud_computing/frontend
cat <<EOF > .env.production
VITE_API_BASE_URL=https://${API_ID}.execute-api.us-east-1.amazonaws.com/prod
VITE_MOCK=false
EOF

npm install && npm run build
aws s3 sync dist/ "s3://telecorp-sentinel-portal-${ACCOUNT_ID}/" --delete
```

### Actualizar el código de una Lambda (P1 o P2)
```bash
export AWS_PAGER=""
cd ~/hackaton_cloud_computing/infra-datos/lambdas   # o ~/hackaton_cloud_computing/orquestacion/lambdas

zip -q -j api_crud.zip api_crud.py
aws lambda update-function-code \
  --function-name telecorp-api-crud \
  --zip-file fileb://api_crud.zip
```

### Limpiar datos de prueba en DynamoDB antes de una demostración
```bash
export AWS_PAGER=""
python3 - <<'PY'
import boto3

ddb = boto3.resource("dynamodb", region_name="us-east-1")
t_ops = ddb.Table("TeleCorp_Operaciones")
t_win = ddb.Table("TeleCorp_VentanasZonales")

for table, name in [(t_ops, "TeleCorp_Operaciones"), (t_win, "TeleCorp_VentanasZonales")]:
    deleted = 0
    scan_kwargs = {"ProjectionExpression": "PK, SK"}
    while True:
        resp = table.scan(**scan_kwargs)
        with table.batch_writer() as batch:
            for item in resp.get("Items", []):
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
                deleted += 1
        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    print(f"{name}: {deleted} ítems eliminados")
PY
```

---

## 4. Hitos de Verificación Final y Demo (P1 + P2 + P3 Integrados)

Con **P1**, **P2**, **Frontend S3** y **Azure Container Apps (`POST /ia/analizar`)** desplegados e integrados:

1. **Verificar Suscripciones Amazon SNS:** Confirmar el enlace de suscripción al tópico `telecorp-alertas-zonales` (`arn:aws:sns:us-east-1:390577088044:telecorp-alertas-zonales`) enviado desde `no-reply@sns.amazonaws.com`.
2. **Validación Multi-Cloud en Vivo (`AWS -> Azure Container Apps`):**
   * Limpiar DynamoDB con el script de la Sección 3 y ejecutar `python3 infra-datos/simulator/storm_simulator.py --mode storm-hospital --transport sqs`.
   * Comprobar en `GET /incidentes` y en el Dashboard NOC (`https://telecorp-sentinel-portal-390577088044.s3.us-east-1.amazonaws.com/index.html#/noc`) que los incidentes muestren los puntos críticos cercanos (`critical_pois`) y el diagnóstico ejecutivo generado por IA (`ai_diagnosis`).
3. **Auditoría de Concurrencia ($\le 10$ Lambdas):** Verificar en CloudWatch (`AWS/Lambda -> ConcurrentExecutions`) que el pico máximo por minuto se mantenga $\le 10$ durante toda la ejecución de la tormenta.

---

## 5. Índice y Legado para Futuras Generaciones (Lecciones de Despliegue)

1. **Desactivar siempre el paginador de AWS CLI en CloudShell:** Ejecutar `export AWS_PAGER=""` al iniciar sesión para evitar que `less` intercepte bloques multilínea pegados en la terminal.
2. **Disciplina de repositorio:** Todo parche realizado en CloudShell debe replicarse en Git (`git add`, `git commit`, `git push`) antes de ejecutar `git pull`.
3. **Contratos estrictos de JSONPath entre Lambda y Step Functions:** Auditar toda ruta `$.*` en `state_machine.asl.json` antes de modificar salidas de Lambdas orquestadas para prevenir errores `States.Runtime`.
4. **Idempotencia de comandos AWS CLI:** Usar `update-function-code` y `update-state-machine` en redespliegues; `create-*` falla con `ResourceConflictException` si el recurso ya existe.
5. **Gestión de ventanas de deduplicación de $24\text{ horas}$ en pruebas:** Limpiar `PK=WIN#<geohash>, SK=COUNTER` en `TeleCorp_VentanasZonales` antes de repetir pruebas en la misma celda.
6. **Restricciones de IAM en AWS Academy (`LabRole`):** Utilizar siempre `arn:aws:iam::<ACCOUNT_ID>:role/LabRole` para Lambda y Step Functions.
7. **Confirmación manual de suscripciones Amazon SNS:** Confirmar el correo de `no-reply@sns.amazonaws.com` para pasar de `PendingConfirmation` a `Confirmed`.
8. **Desacoplamiento Multi-Cloud vía SSM Parameter Store:** Mantener URL y API Key del servicio de IA en `/telecorp/gcp/endpoint_url` y `/telecorp/gcp/api_key` con caché de $60\text{ s}$ y respaldo `FALLBACK_LOCAL`.
9. **Contrato de eventos históricos (`EVENT#`) y cierre de recuperación (`recovered_at`):** `ingest_telemetry.py` inserta `EVENT#` solo ante estados anómalos y cierra `recovered_at` + `duration_sec` al volver a `NORMAL`.
10. **Reporte parcial de fallos (`ReportBatchItemFailures`) en SQS:** Habilitar siempre `--function-response-types ReportBatchItemFailures` al enlazar colas SQS con Lambdas por lotes.
11. **Validación de cuenta (`TELECORP_ACCOUNT_ID`) en `setup_aws.sh`:** Exportar `TELECORP_ACCOUNT_ID=390577088044` y asegurar que `setup_aws.sh` valide contra la cuenta activa.
12. **Coordenadas reales de Lima Centro (`6mc5qz`) vs. geohash sintético (`6mc5p8`):** Las coordenadas `(-12.0464, -77.0428)` generan el `geohash` real `6mc5qz`.
13. **Declaración de variables locales en Bash estricto (`set -euo pipefail`):** Declarar variables dependientes en líneas `local` separadas para evitar `unbound variable`.
14. **Autenticación de API Gateway (`P1_PUBLIC_DEMO=true`):** Habilitar `authorization-type NONE` en `/{proxy+}` para permitir consumo directo desde el SPA en S3.
15. **Geohashes fijos de `storm_simulator.py`:** Hospital Loayza `6mc5qy`, Zona Residencial `6mc5nq`, Detección Temprana `6mc4zr`, Recurrencia Estructural `6mc4zb`.
16. **Blindaje de concurrencia ($\le 10$ Lambdas) en cuentas restrictivas:** Configurar `MaximumConcurrency=2` y `BatchSize=10` en las 3 colas SQS, `burstLimit=2` / `rateLimit=3` en API Gateway, deduplicación intra-lote con espaciado de $0.25\text{ s}$ hacia EventBridge y `max_workers=2` en `storm_simulator.py`.
17. **Disparo anticipado (`TEMPRANO_IA`):** Cuando la antena cae antes de los reportes ciudadanos, `eval_collective.py` dispara el incidente maestro al 3.er reporte único y vincula los siguientes al mismo `active_incident_id`.
18. **Uso de URLs HTTPS nativas de S3 en AWS Academy:** Ante el bloqueo IAM de CloudFront, servir el SPA desde `https://telecorp-sentinel-portal-390577088044.s3.us-east-1.amazonaws.com/index.html` con `HashRouter` (`#/noc`).
19. **Endpoints completos en `api_crud.py` (`PENDIENTES_BACKEND.md`):** `GET /incidentes`, `PATCH /incidentes/{id}/estado`, `GET /antenas` y `incident_time` están implementados nativamente en `telecorp-api-crud`.
20. **Compilación de Frontend Vite/React antes de subir a S3:** Generar `frontend/.env.production` con `VITE_API_BASE_URL` y `VITE_MOCK=false`, ejecutar `npm run build` y sincronizar `frontend/dist/` con S3.
21. **Ubicación del simulador en el repositorio:** `infra-datos/simulator/storm_simulator.py`.
22. **Migración del microservicio IA + OSM a Azure Container Apps (`westus2`):** El servicio corre en `https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io` bajo la ruta `POST /ia/analizar` con cabecera `X-API-Key`. Se mantienen las llaves SSM `/telecorp/gcp/*` para no romper compatibilidad y se amplía el *timeout* de `telecorp-enrich-and-score` a $30\text{ s}$ para tolerar el *cold start* del contenedor Azure.
