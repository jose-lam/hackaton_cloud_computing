# Módulo de Orquestación y Reglas de Negocio (`orquestacion/` — P2)

Implementa el enrutamiento de eventos en **Amazon EventBridge**, la detección colectiva deduplicada en ventanas menores a $24\text{h}$, el análisis de recurrencia estructural, la priorización multi-cloud y la orquestación de respuesta mediante **AWS Step Functions**[cite: 6].

## 1. Arquitectura del Módulo P2

```mermaid
flowchart LR
    IN["Eventos de Entrada\n(incidencia.creada / antena.anomalia)"] --> EB["EventBridge\n(telecorp-bus)"]
    EB --> RULE_C["Regla: telecorp-collective-rule"]
    EB --> RULE_R["Regla: telecorp-recurrence-rule"]

    RULE_C --> L_COL["Lambda: eval_collective.py\n[P2.1 - ACTIVO]"]
    RULE_R --> L_REC["Lambda: eval_recurrence.py\n[P2.2 - ACTIVO]"]

    SSM["SSM Parameter Store\n(/telecorp/thresholds/*)"] -.-> L_COL & L_REC
    L_COL <--> DDB_V[("DynamoDB\nTeleCorp_VentanasZonales")]
    L_COL <--> DDB_O[("DynamoDB\nTeleCorp_Operaciones")]
    L_REC <--> DDB_O

    L_COL -->|"Umbral >= 10 ó (>= 3 + Antena Anómala)"| SFN["AWS Step Functions\nTeleCorpSentinelWorkflow\n[P2.4 - Pendiente]"]

    subgraph FLUJO_SFN ["Estados Internos Step Functions"]
        direction TB
        S1["P2.2: eval_recurrence.py\n[ACTIVO]"] --> S2["P2.3: enrich_and_score.py\n[Siguiente]"] --> S3["P2.5: notify_users.py\n[Pendiente]"]
    end

    SFN -.-> FLUJO_SFN
```

## 2. Estructura de Carpeta (`orquestacion/`)

```text
orquestacion/
├── README.md                    # Documentación específica del módulo P2
├── eventbridge_rules.json       # Patrones de enrutamiento de telecorp-bus (ACTIVO - P2.1 / P2.2)
├── state_machine.asl.json       # Definición ASL de AWS Step Functions (Pendiente P2.4)
└── lambdas/
    ├── eval_collective.py       # Motor de detección colectiva < 24h (ACTIVO - P2.1)
    ├── eval_recurrence.py       # Detección de fallas estructurales multi-día (ACTIVO - P2.2)
    ├── enrich_and_score.py      # Integración GCP /ia/analizar y score (Pendiente P2.3)
    └── notify_users.py          # Envío de alertas SES/SNS por hito (Pendiente P2.5)
```

## 3. Dependencias Mínimas para P2.1 y P2.2

Antes de desplegar `eval_collective.py` y `eval_recurrence.py`, deben existir en `us-east-1` (creados en Fase 0 / P1.1)[cite: 1, 6]:

* **Bus EventBridge:** `telecorp-bus`[cite: 6]
* **Tablas DynamoDB:** `TeleCorp_VentanasZonales` (TTL: `expires_at`) y `TeleCorp_Operaciones` (GSI: `GSI1_ZonaEstado`)[cite: 6]
* **Parámetros SSM (`SecureString`):**[cite: 6]
  * `/telecorp/thresholds/collective_users` $\rightarrow$ `"10"`[cite: 6]
  * `/telecorp/thresholds/window_hours` $\rightarrow$ `"24"`[cite: 6]
  * `/telecorp/thresholds/recurrence_days` $\rightarrow$ `"3"`[cite: 1]

## 4. Etapa Implementada: Detección Colectiva (`Tarea P2.1`)

### Reglas de Negocio (`lambdas/eval_collective.py`)

1. **Deduplicación estricta ($< 24\text{h}$):** Inserta `PK=WIN#<geohash>`, `SK=USER#<user_id>` con `ConditionExpression="attribute_not_exists(PK) OR expires_at <= :now"`. Reportes repetidos del mismo usuario en menos de $24\text{h}$ no incrementan el contador[cite: 6].
2. **Contador atómico zonal:** Ante un usuario nuevo en la ventana vigente, ejecuta `ADD unique_users_count :inc` sobre `SK=COUNTER` (reiniciando atómicamente la ventana si `expires_at <= now`)[cite: 6].
3. **Condiciones de disparo hacia Step Functions:**[cite: 6]
   * **`COLECTIVO_10`:** `unique_users_count` alcanza el umbral de SSM ($10$)[cite: 6].
   * **`TEMPRANO_IA`:** `unique_users_count` $\ge 3$ **y** existe una antena en el mismo `geohash` con estado `CAIDA`, `SATURADA` o `INHABILITADA` (consultada vía `GSI1_ZonaEstado`)[cite: 6].
4. **Vinculación automática:** Reserva atómicamente `active_incident_id` para evitar disparos duplicados durante tormentas y asocia `master_incident_id` + `updated_at` en los tickets de la zona[cite: 6].

### Despliegue AWS CLI

```bash
export AWS_DEFAULT_REGION=us-east-1
export LAB_ROLE_ARN=$(aws iam get-role --role-name LabRole --query 'Role.Arn' --output text)

# 1. Empaquetar y desplegar Lambda
cd orquestacion/lambdas
zip eval_collective.zip eval_collective.py

aws lambda create-function \
  --function-name telecorp-eval-collective \
  --runtime python3.11 \
  --role "$LAB_ROLE_ARN" \
  --handler eval_collective.lambda_handler \
  --zip-file fileb://eval_collective.zip \
  --timeout 15 \
  --memory-size 256 \
  --environment "Variables={TABLA_OPERACIONES=TeleCorp_Operaciones,TABLA_VENTANAS=TeleCorp_VentanasZonales,STATE_MACHINE_NAME=TeleCorpSentinelWorkflow}"

# 2. Crear regla en telecorp-bus y vincular Lambda
export LAMBDA_ARN=$(aws lambda get-function --function-name telecorp-eval-collective --query 'Configuration.FunctionArn' --output text)

aws events put-rule \
  --name telecorp-collective-rule \
  --event-bus-name telecorp-bus \
  --state ENABLED \
  --event-pattern '{
    "source": ["telecorp.ingesta", "telecorp.telemetria"],
    "detail-type": ["incidencia.creada", "antena.anomalia"]
  }'

aws lambda add-permission \
  --function-name telecorp-eval-collective \
  --statement-id AllowEventBridgeTeleCorpBus \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn $(aws events describe-rule --name telecorp-collective-rule --event-bus-name telecorp-bus --query 'Arn' --output text)

aws events put-targets \
  --rule telecorp-collective-rule \
  --event-bus-name telecorp-bus \
  --targets "Id=1,Arn=$LAMBDA_ARN"
```

### Validación (Definition of Done)

```bash
# 1. Enviar 10 reportes del MISMO user_id -> unique_users_count debe quedar en 1 (sin disparar Step Functions)
for i in {1..10}; do
  aws events put-events --entries "[{\"EventBusName\":\"telecorp-bus\",\"Source\":\"telecorp.ingesta\",\"DetailType\":\"incidencia.creada\",\"Detail\":\"{\\\"ticket_id\\\":\\\"TCK-DUP-$i\\\",\\\"user_id\\\":\\\"DNI-REPETIDO\\\",\\\"geohash\\\":\\\"6mc5test\\\",\\\"lat\\\":-12.0464,\\\"lon\\\":-77.0428,\\\"problem_type\\\":\\\"SIN_INTERNET\\\",\\\"description\\\":\\\"Prueba duplicada $i\\\"}\"}]" > /dev/null
done
aws dynamodb get-item --table-name TeleCorp_VentanasZonales --key '{"PK":{"S":"WIN#6mc5test"},"SK":{"S":"COUNTER"}}'

# 2. Completar 10 user_id DISTINTOS -> unique_users_count = 10 y reserva active_incident_id
for u in {2..10}; do
  aws events put-events --entries "[{\"EventBusName\":\"telecorp-bus\",\"Source\":\"telecorp.ingesta\",\"DetailType\":\"incidencia.creada\",\"Detail\":\"{\\\"ticket_id\\\":\\\"TCK-UNIQ-$u\\\",\\\"user_id\\\":\\\"DNI-UNICO-$u\\\",\\\"geohash\\\":\\\"6mc5test\\\",\\\"lat\\\":-12.0464,\\\"lon\\\":-77.0428,\\\"problem_type\\\":\\\"SIN_INTERNET\\\",\\\"description\\\":\\\"Corte en zona $u\\\"}\"}]" > /dev/null
done
aws dynamodb get-item --table-name TeleCorp_VentanasZonales --key '{"PK":{"S":"WIN#6mc5test"},"SK":{"S":"COUNTER"}}'
```

## 5. Etapa Implementada: Motor de Recurrencia Estructural (`Tarea P2.2`)

### Reglas de Negocio (`lambdas/eval_recurrence.py`)

1. **Ventana móvil multi-día ($7\text{ días}$):** Consulta en `TeleCorp_Operaciones` los eventos históricos `PK=ANTENNA#<id>`, `SK=EVENT#<YYYY-MM-DD>#<iso_ts>` dentro de los últimos $7\text{ días}$ calendario (`RECURRENCE_LOOKBACK_DAYS=7`)[cite: 1, 3].
2. **Conteo de días distintos con recuperación aparente:** Filtra registros anómalos (`CAIDA` $<60\text{ GB/min}$, `SATURADA` $>129\text{ GB/min}$, `INHABILITADA` $=0\text{ GB/min}$), contabiliza **días calendario únicos (`YYYY-MM-DD`)** y detecta ciclos de recuperación intermedia (`recovered_at` o fallas en días previos distintos)[cite: 1, 3]. Incluye salvaguarda ante condiciones de carrera si el evento `antena.anomalia` aún no terminó de escribir su `EVENT#` del día.
3. **Marcado de riesgo estructural (`structural_risk`):** Si `distinct_failure_days_count >= 3` (leído desde SSM `/telecorp/thresholds/recurrence_days` con caché en memoria de $60\text{s}$), actualiza `structural_risk = true`, `recurrence_days_count` y `recent_failure_days` en `PK=ANTENNA#<id>`, `SK=CURRENT`[cite: 1, 3].
4. **Doble invocación y descubrimiento zonal por `geohash`:** Soporta tanto payloads directos desde **AWS Step Functions** como eventos `antena.anomalia` desde **EventBridge** (`event["detail"]`)[cite: 4]. Si el incidente nace solo de reportes ciudadanos sin `antenna_id`, consulta `GSI1_ZonaEstado` (`GSI1PK=ZONA#<geohash>`) y selecciona la antena de mayor riesgo[cite: 3].

### Despliegue AWS CLI

```bash
export AWS_DEFAULT_REGION=us-east-1
export LAB_ROLE_ARN=$(aws iam get-role --role-name LabRole --query 'Role.Arn' --output text)

# 1. Empaquetar y desplegar Lambda eval_recurrence
cd orquestacion/lambdas
zip eval_recurrence.zip eval_recurrence.py

aws lambda create-function \
  --function-name telecorp-eval-recurrence \
  --runtime python3.11 \
  --role "$LAB_ROLE_ARN" \
  --handler eval_recurrence.lambda_handler \
  --zip-file fileb://eval_recurrence.zip \
  --timeout 15 \
  --memory-size 256 \
  --environment "Variables={TABLA_OPERACIONES=TeleCorp_Operaciones,SSM_RECURRENCE_DAYS_PARAM=/telecorp/thresholds/recurrence_days,RECURRENCE_LOOKBACK_DAYS=7}"

# 2. Suscribir regla de EventBridge para antena.anomalia
export REC_LAMBDA_ARN=$(aws lambda get-function --function-name telecorp-eval-recurrence --query 'Configuration.FunctionArn' --output text)

aws events put-rule \
  --name telecorp-recurrence-rule \
  --event-bus-name telecorp-bus \
  --state ENABLED \
  --event-pattern '{
    "source": ["telecorp.telemetria"],
    "detail-type": ["antena.anomalia"]
  }'

aws lambda add-permission \
  --function-name telecorp-eval-recurrence \
  --statement-id AllowEventBridgeRecurrenceRule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn $(aws events describe-rule --name telecorp-recurrence-rule --event-bus-name telecorp-bus --query 'Arn' --output text)

aws events put-targets \
  --rule telecorp-recurrence-rule \
  --event-bus-name telecorp-bus \
  --targets "Id=1,Arn=$REC_LAMBDA_ARN"
```

### Validación (Definition of Done)

```bash
# 1. Sembrar estado CURRENT y 3 eventos históricos en días distintos (2026-11-10, 2026-11-12, 2026-11-14)
aws dynamodb put-item --table-name TeleCorp_Operaciones --item '{
  "PK": {"S": "ANTENNA#ANT-REC-09"},
  "SK": {"S": "CURRENT"},
  "GSI1PK": {"S": "ZONA#6mc5p8"},
  "GSI1SK": {"S": "ANTENNA#ANT-REC-09"},
  "antenna_id": {"S": "ANT-REC-09"},
  "zone_name": {"S": "Cercado Centro"},
  "geohash": {"S": "6mc5p8"},
  "last_traffic_gb": {"N": "41.2"},
  "health_status": {"S": "CAIDA"},
  "structural_risk": {"BOOL": false}
}'

for FECHA in 2026-11-10 2026-11-12 2026-11-14; do
  aws dynamodb put-item --table-name TeleCorp_Operaciones --item "{
    \"PK\": {\"S\": \"ANTENNA#ANT-REC-09\"},
    \"SK\": {\"S\": \"EVENT#${FECHA}#${FECHA}T10:15:00Z\"},
    \"GSI1PK\": {\"S\": \"FAILURES#ALL\"},
    \"GSI1SK\": {\"S\": \"TS#${FECHA}T10:15:00Z\"},
    \"antenna_id\": {\"S\": \"ANT-REC-09\"},
    \"date_day\": {\"S\": \"${FECHA}\"},
    \"health_status\": {\"S\": \"CAIDA\"},
    \"traffic_gb\": {\"N\": \"41.2\"},
    \"recovered_at\": {\"S\": \"${FECHA}T10:45:00Z\"},
    \"duration_sec\": {\"N\": \"1800\"}
  }"
done

# 2. Invocar Lambda simulando el payload que recibirá desde Step Functions
aws lambda invoke \
  --function-name telecorp-eval-recurrence \
  --cli-binary-format raw-in-base64-out \
  --payload '{
    "incident_id": "INC-TEST-REC-01",
    "geohash": "6mc5p8",
    "lat": -12.0464,
    "lon": -77.0428,
    "unique_users_count": 10,
    "descriptions": ["Internet caído nuevamente en Cercado"],
    "timestamp": "2026-11-14T11:00:00Z"
  }' \
  response_p2_2.json

cat response_p2_2.json
# Resultado esperado: "structural_risk": true, "distinct_failure_days_count": 3,
# "recent_failure_days": ["2026-11-10", "2026-11-12", "2026-11-14"]
```

## 6. Progreso del Módulo P2

| Tarea | Archivo / Recurso | Estado |
| :--- | :--- | :--- |
| **P2.1** — Reglas EventBridge + Detección Colectiva | `eventbridge_rules.json` + `eval_collective.py` | **Completado**[cite: 6] |
| **P2.2** — Motor de Recurrencia Estructural | `eventbridge_rules.json` + `eval_recurrence.py` | **Completado** |
| **P2.3** — Puente Multi-Cloud AWS $\rightarrow$ GCP + Score | `lambdas/enrich_and_score.py` | Pendiente[cite: 6] |
| **P2.4** — Máquina de Estados AWS Step Functions | `state_machine.asl.json` | Pendiente[cite: 6] |
| **P2.5** — Sistema de Notificaciones Omnicanal | `lambdas/notify_users.py` | Pendiente[cite: 6] |

## 7. Notas de Sincronización para P1 y P3

Los contratos congelados (`dynamodb_schemas.json`, `eventbridge_events.json`, `openapi.yaml`) **no cambian**; solo consideren estos puntos operativos al integrar[cite: 6]:

* **Para P1 (Datos e Ingesta):**[cite: 6]
  * **Geohash de precisión 6:** `ingest_ticket.py` e `ingest_telemetry.py` deben calcular `geohash` con exactamente **6 caracteres** para cruzar reportes con antenas[cite: 6].
  * **Índice `GSI1_ZonaEstado`:** Al guardar `ANTENNA#<id>` (`SK=CURRENT`) en `TeleCorp_Operaciones`, llenar `GSI1PK="ZONA#<geohash>"` y `GSI1SK="ANTENNA#<id>"` con `health_status` válido (`NORMAL`, `CAIDA`, `SATURADA`, `INHABILITADA`)[cite: 3, 6].
  * **Historial de fallas de antena (`EVENT#`):** Cuando `ingest_telemetry.py` (o `storm_simulator.py --mode recurrent`) detecte un estado anómalo (`CAIDA`, `SATURADA`, `INHABILITADA`), debe insertar `PK="ANTENNA#<id>"`, `SK="EVENT#<YYYY-MM-DD>#<iso_ts>"` con `date_day`, `health_status` y `traffic_gb`[cite: 1, 3]; cuando la antena regrese a `NORMAL` ($60\text{–}129\text{ GB/min}$), actualizar `recovered_at` y `duration_sec`[cite: 1, 3].
  * **Bus `telecorp-bus`:** Publicar `incidencia.creada` y `antena.anomalia` con `geohash`, `lat`, `lon` y `timestamp`[cite: 4, 6]. No creen reglas duplicadas (`telecorp-collective-rule` y `telecorp-recurrence-rule` ya están configuradas)[cite: 6].
* **Para P3 (Frontend & IA GCP):**[cite: 6]
  * **Coordenadas obligatorias:** `POST /tickets` debe enviar siempre `lat` y `lon` numéricos desde el portal para calcular la zona[cite: 5, 6].
  * **Contexto enriquecido para Gemini:** Cada texto en `descriptions` hacia `POST /ia/analizar` llegará con el prefijo `"[TIPO_PROBLEMA] descripción"`[cite: 6].
  * **Contrato de recurrencia hacia `POST /ia/analizar`:** `eval_recurrence.py` entrega `antenna_id`, `antenna_traffic_gb`, `structural_risk` (`boolean`) y `recent_failure_days` (`["YYYY-MM-DD", ...]`) listos para ser enviados al endpoint de GCP[cite: 5].
  * **Conteo vivo y alerta estructural en NOC:** `affected_users_count` en `INCIDENT#<id>` sigue incrementándose automáticamente si ingresan más afectados tras abrirse el incidente, y `structural_risk` en `ANTENNA#<id>` (`SK=CURRENT`) ya queda persistido para encender el badge **"RIESGO ESTRUCTURAL"** en `GET /analytics/resumen` y el Dashboard NOC[cite: 1, 3, 5, 6].
