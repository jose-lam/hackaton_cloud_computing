import json
import os
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLA_OPERACIONES = os.environ.get("TABLA_OPERACIONES", "TeleCorp_Operaciones")
TABLA_VENTANAS = os.environ.get("TABLA_VENTANAS", "TeleCorp_VentanasZonales")
STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN", "")
STATE_MACHINE_NAME = os.environ.get("STATE_MACHINE_NAME", "TeleCorpSentinelWorkflow")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)
sfn = boto3.client("stepfunctions", region_name=REGION)

table_operaciones = dynamodb.Table(TABLA_OPERACIONES)
table_ventanas = dynamodb.Table(TABLA_VENTANAS)

_SSM_CACHE = {"expires_at": 0, "collective_users": 10, "window_seconds": 86400}
_CACHED_SFN_ARN = STATE_MACHINE_ARN


def _to_native(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _to_native(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_native(i) for i in obj]
    return obj


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_thresholds():
    """Lee umbrales globales desde AWS SSM Parameter Store con caché de 60s."""
    now = time.time()
    if now < _SSM_CACHE["expires_at"]:
        return _SSM_CACHE["collective_users"], _SSM_CACHE["window_seconds"]

    try:
        resp = ssm.get_parameters(
            Names=[
                "/telecorp/thresholds/collective_users",
                "/telecorp/thresholds/window_hours",
            ],
            WithDecryption=True,
        )
        params = {p["Name"]: p["Value"] for p in resp.get("Parameters", [])}
        collective_users = int(params.get("/telecorp/thresholds/collective_users", "10"))
        window_hours = int(params.get("/telecorp/thresholds/window_hours", "24"))
        _SSM_CACHE["collective_users"] = collective_users
        _SSM_CACHE["window_seconds"] = window_hours * 3600
        _SSM_CACHE["expires_at"] = now + 60
    except Exception as e:
        print(f"[WARN] Error leyendo SSM, usando valores por defecto: {e}")

    return _SSM_CACHE["collective_users"], _SSM_CACHE["window_seconds"]


def get_state_machine_arn() -> str:
    """Obtiene el ARN de TeleCorpSentinelWorkflow desde env o buscando por nombre."""
    global _CACHED_SFN_ARN
    if _CACHED_SFN_ARN:
        return _CACHED_SFN_ARN

    paginator = sfn.get_paginator("list_state_machines")
    for page in paginator.paginate():
        for sm in page.get("stateMachines", []):
            if sm["name"] == STATE_MACHINE_NAME:
                _CACHED_SFN_ARN = sm["stateMachineArn"]
                return _CACHED_SFN_ARN
    return ""


def get_degraded_antenna_in_zone(geohash: str):
    """Consulta GSI1_ZonaEstado en TeleCorp_Operaciones para detectar antenas anómalas."""
    resp = table_operaciones.query(
        IndexName="GSI1_ZonaEstado",
        KeyConditionExpression=Key("GSI1PK").eq(f"ZONA#{geohash}")
        & Key("GSI1SK").begins_with("ANTENNA#"),
    )
    for item in resp.get("Items", []):
        if item.get("health_status", "NORMAL") in ("CAIDA", "INHABILITADA", "SATURADA"):
            return _to_native(item)
    return None


def get_sample_descriptions(geohash: str, now: int, limit: int = 5):
    """Extrae descripciones de usuarios activos (<24h) en la ventana zonal."""
    resp = table_ventanas.query(
        KeyConditionExpression=Key("PK").eq(f"WIN#{geohash}")
        & Key("SK").begins_with("USER#"),
        Limit=limit * 2,
    )
    samples = []
    for item in resp.get("Items", []):
        if int(item.get("expires_at", 0)) > now and item.get("description"):
            p_type = item.get("problem_type", "OTRO")
            samples.append(f"[{p_type}] {item['description']}")
            if len(samples) >= limit:
                break
    return samples


def link_ticket_to_incident(
    ticket_id: str, incident_id: str, increment_incident_users: bool = False
):
    """Vincula TicketUsuario al IncidenteMaestro y actualiza updated_at."""
    if not ticket_id or not incident_id:
        return
    try:
        table_operaciones.update_item(
            Key={"PK": f"TICKET#{ticket_id}", "SK": "META"},
            UpdateExpression="SET master_incident_id = :inc, updated_at = :upd",
            ExpressionAttributeValues={
                ":inc": incident_id,
                ":upd": _iso_now(),
            },
        )
        if increment_incident_users:
            try:
                table_operaciones.update_item(
                    Key={"PK": f"INCIDENT#{incident_id}", "SK": "META"},
                    UpdateExpression="ADD affected_users_count :inc",
                    ConditionExpression="attribute_exists(PK)",
                    ExpressionAttributeValues={":inc": 1},
                )
            except ClientError:
                pass
    except Exception as e:
        print(f"[ERROR] No se pudo vincular ticket {ticket_id} a {incident_id}: {e}")


def link_all_window_tickets(geohash: str, incident_id: str, now: int):
    """Vincula todos los tickets vigentes (<24h) de la zona al incidente maestro."""
    resp = table_ventanas.query(
        KeyConditionExpression=Key("PK").eq(f"WIN#{geohash}")
        & Key("SK").begins_with("USER#"),
    )
    for item in resp.get("Items", []):
        if int(item.get("expires_at", 0)) > now and item.get("first_ticket_id"):
            link_ticket_to_incident(
                item["first_ticket_id"], incident_id, increment_incident_users=False
            )


def increment_zone_counter_strict_24h(pk: str, now: int, expires_at: int) -> dict:
    """Incrementa COUNTER atómicamente si la ventana sigue vigente (<24h) o la reinicia."""
    try:
        resp = table_ventanas.update_item(
            Key={"PK": pk, "SK": "COUNTER"},
            UpdateExpression="ADD unique_users_count :inc SET expires_at = if_not_exists(expires_at, :exp)",
            ConditionExpression="attribute_not_exists(expires_at) OR expires_at > :now",
            ExpressionAttributeValues={":inc": 1, ":exp": expires_at, ":now": now},
            ReturnValues="ALL_NEW",
        )
        return resp.get("Attributes", {})
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            resp = table_ventanas.update_item(
                Key={"PK": pk, "SK": "COUNTER"},
                UpdateExpression="SET unique_users_count = :one, expires_at = :exp REMOVE active_incident_id",
                ExpressionAttributeValues={":one": 1, ":exp": expires_at},
                ReturnValues="ALL_NEW",
            )
            return resp.get("Attributes", {})
        raise


def try_trigger_step_functions(
    geohash: str,
    lat: float,
    lon: float,
    trigger_type: str,
    unique_users_count: int,
    now: int,
    antenna_info: dict = None,
    timestamp: str = None,
):
    """Reserva atómicamente active_incident_id e inicia AWS Step Functions."""
    incident_id = f"INC-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"

    try:
        table_ventanas.update_item(
            Key={"PK": f"WIN#{geohash}", "SK": "COUNTER"},
            UpdateExpression="SET active_incident_id = :inc",
            ConditionExpression="attribute_not_exists(active_incident_id)",
            ExpressionAttributeValues={":inc": incident_id},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            counter = table_ventanas.get_item(
                Key={"PK": f"WIN#{geohash}", "SK": "COUNTER"}
            ).get("Item", {})
            return counter.get("active_incident_id"), False
        raise

    link_all_window_tickets(geohash, incident_id, now)
    sample_descriptions = get_sample_descriptions(geohash, now, limit=5)

    antenna_id = None
    antenna_status = "NORMAL"
    antenna_traffic_gb = None

    if antenna_info:
        pk_ant = antenna_info.get("PK", "")
        antenna_id = antenna_info.get("antenna_id") or pk_ant.replace("ANTENNA#", "")
        antenna_status = antenna_info.get("health_status", "CAIDA")
        antenna_traffic_gb = antenna_info.get(
            "traffic_gb_min", antenna_info.get("last_traffic_gb")
        )

    sfn_payload = {
        "incident_id": incident_id,
        "geohash": geohash,
        "lat": lat,
        "lon": lon,
        "trigger_type": trigger_type,
        "unique_users_count": unique_users_count,
        "descriptions": sample_descriptions,
        "sample_descriptions": sample_descriptions,
        "antenna_id": antenna_id,
        "antenna_status": antenna_status,
        "antenna_traffic_gb": antenna_traffic_gb,
        "timestamp": timestamp or _iso_now(),
    }

    arn = get_state_machine_arn()
    if not arn:
        print(f"[WARN] State Machine ARN no encontrado. Payload listo: {json.dumps(sfn_payload)}")
        return incident_id, False

    sfn.start_execution(
        stateMachineArn=arn,
        name=f"{incident_id}-{int(time.time())}",
        input=json.dumps(_to_native(sfn_payload)),
    )
    print(f"[SUCCESS] Step Functions iniciado ({arn}) para {incident_id} [{trigger_type}]")
    return incident_id, True


def handle_incidencia_creada(detail: dict):
    ticket_id = detail["ticket_id"]
    user_id = detail["user_id"]
    geohash = detail["geohash"]
    lat = detail.get("lat")
    lon = detail.get("lon")
    problem_type = detail.get("problem_type", "OTRO")
    description = detail.get("description", "")
    timestamp = detail.get("timestamp")

    collective_threshold, window_seconds = get_thresholds()
    now = int(time.time())
    expires_at = now + window_seconds

    pk = f"WIN#{geohash}"
    sk_user = f"USER#{user_id}"

    # 1. Insertar usuario único respetando atributos exactos de UsuarioUnicoVentana
    try:
        table_ventanas.put_item(
            Item={
                "PK": pk,
                "SK": sk_user,
                "first_ticket_id": ticket_id,
                "problem_type": problem_type,
                "description": description,
                "expires_at": expires_at,
            },
            ConditionExpression="attribute_not_exists(PK) OR expires_at <= :now",
            ExpressionAttributeValues={":now": now},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            counter = table_ventanas.get_item(
                Key={"PK": pk, "SK": "COUNTER"}
            ).get("Item", {})
            active_inc = counter.get("active_incident_id")
            if active_inc and int(counter.get("expires_at", 0)) > now:
                link_ticket_to_incident(
                    ticket_id, active_inc, increment_incident_users=False
                )
            return {
                "status": "DUPLICATE_USER_IGNORED",
                "geohash": geohash,
                "unique_users_count": int(counter.get("unique_users_count", 1)),
                "active_incident_id": active_inc,
            }
        raise

    # 2. Usuario nuevo en ventana <24h: incrementar COUNTER atómicamente
    attrs = increment_zone_counter_strict_24h(pk, now, expires_at)
    unique_users_count = int(attrs.get("unique_users_count", 1))
    active_incident_id = attrs.get("active_incident_id")

    # 3. Si ya existe incidente activo, vincular ticket y sumar usuario afectado
    if active_incident_id:
        link_ticket_to_incident(
            ticket_id, active_incident_id, increment_incident_users=True
        )
        return {
            "status": "LINKED_TO_EXISTING_INCIDENT",
            "geohash": geohash,
            "unique_users_count": unique_users_count,
            "active_incident_id": active_incident_id,
        }

    # 4. Evaluar umbral colectivo (10) o detección temprana (>=3 + antena anómala)
    degraded_antenna = get_degraded_antenna_in_zone(geohash)
    triggered = False
    incident_id = None

    if unique_users_count == collective_threshold:
        incident_id, triggered = try_trigger_step_functions(
            geohash=geohash,
            lat=lat,
            lon=lon,
            trigger_type="COLECTIVO_10",
            unique_users_count=unique_users_count,
            now=now,
            antenna_info=degraded_antenna,
            timestamp=timestamp,
        )
    elif unique_users_count >= 3 and degraded_antenna is not None:
        incident_id, triggered = try_trigger_step_functions(
            geohash=geohash,
            lat=lat,
            lon=lon,
            trigger_type="TEMPRANO_IA",
            unique_users_count=unique_users_count,
            now=now,
            antenna_info=degraded_antenna,
            timestamp=timestamp,
        )

    return {
        "status": "STEP_FUNCTIONS_STARTED" if triggered else "COUNTED",
        "geohash": geohash,
        "unique_users_count": unique_users_count,
        "incident_id": incident_id,
    }


def handle_antena_anomalia(detail: dict):
    geohash = detail["geohash"]
    if detail.get("health_status", "CAIDA") == "NORMAL":
        return {"status": "IGNORED_NORMAL_ANTENNA"}

    now = int(time.time())
    counter = table_ventanas.get_item(
        Key={"PK": f"WIN#{geohash}", "SK": "COUNTER"}
    ).get("Item", {})

    if int(counter.get("expires_at", 0)) <= now:
        return {"status": "NO_ACTIVE_WINDOW", "geohash": geohash}

    unique_users_count = int(counter.get("unique_users_count", 0))
    active_incident_id = counter.get("active_incident_id")

    if not active_incident_id and unique_users_count >= 3:
        incident_id, triggered = try_trigger_step_functions(
            geohash=geohash,
            lat=detail.get("lat"),
            lon=detail.get("lon"),
            trigger_type="TEMPRANO_IA",
            unique_users_count=unique_users_count,
            now=now,
            antenna_info=detail,
            timestamp=detail.get("timestamp"),
        )
        return {
            "status": "STEP_FUNCTIONS_STARTED_ON_ANTENNA" if triggered else "ALREADY_ACTIVE",
            "geohash": geohash,
            "unique_users_count": unique_users_count,
            "incident_id": incident_id,
        }

    return {
        "status": "ANTENNA_ANOMALY_CHECKED",
        "geohash": geohash,
        "unique_users_count": unique_users_count,
        "active_incident_id": active_incident_id,
    }


def lambda_handler(event, context):
    detail_type = event.get("detail-type") or event.get("DetailType")
    detail = event.get("detail") or event.get("Detail") or {}

    if isinstance(detail, str):
        detail = json.loads(detail)

    if detail_type == "incidencia.creada":
        return handle_incidencia_creada(detail)
    elif detail_type == "antena.anomalia":
        return handle_antena_anomalia(detail)
    else:
        return {"status": "UNSUPPORTED_EVENT", "detail_type": detail_type}
