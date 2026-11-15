from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from collections import Counter
import json
import math
import uuid

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

sqs = boto3.client("sqs")
events = boto3.client("events")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("TeleCorp_Operaciones")

VALID_STATUSES = (
    "Registrada", "En revisión", "Siendo atendida", "Solucionada", "Cerrada"
)
VALID_LOG_LEVELS = {"INFO", "WARN", "ERROR", "CRITICAL"}


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        },
        "body": json.dumps(
            body,
            ensure_ascii=False,
            default=lambda x: float(x) if isinstance(x, Decimal) else str(x),
        ),
    }


def encode_geohash(lat, lon, precision=6):
    alphabet = "0123456789bcdefghjkmnpqrstuvwxyz"
    lat_range = [-90.0, 90.0]
    lon_range = [-180.0, 180.0]
    result = ""
    bits = 0
    value = 0
    while len(result) < precision:
        current = lon_range if bits % 2 == 0 else lat_range
        coordinate = lon if bits % 2 == 0 else lat
        midpoint = (current[0] + current[1]) / 2
        value = (value << 1) | int(coordinate >= midpoint)
        if coordinate >= midpoint:
            current[0] = midpoint
        else:
            current[1] = midpoint
        bits += 1
        if bits % 5 == 0:
            result += alphabet[value]
            value = 0
    return result


def scan_all():
    """Recorre páginas de DynamoDB; apropiado para un dataset pequeño de demo."""
    items = []
    kwargs = {}
    while True:
        result = table.scan(**kwargs)
        items.extend(result.get("Items", []))
        if "LastEvaluatedKey" not in result:
            return items
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def as_utc(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except ValueError:
        return None


def make_analytics():
    records = scan_all()
    tickets = [x for x in records if x.get("PK", "").startswith("TICKET#") and x.get("SK") == "META"]
    antennas = [x for x in records if x.get("PK", "").startswith("ANTENNA#") and x.get("SK") == "CURRENT"]
    incidents = [x for x in records if x.get("PK", "").startswith("INCIDENT#") and x.get("SK") == "META"]

    users = {str(t["user_id"]) for t in tickets if t.get("user_id")}
    active = sum(
        1 for inc in incidents
        if inc.get("GSI1PK") != "ACTIVE#false"
        and inc.get("is_active") is not False
        and inc.get("status") not in ("Solucionada", "Cerrada")
        and not inc.get("closed_at")
    )

    durations = []
    for inc in incidents:
        created = as_utc(inc.get("created_at"))
        closed = as_utc(inc.get("closed_at"))
        if created and closed and closed >= created:
            durations.append((closed - created).total_seconds() / 60)

    zone_names = {}
    zone_counts = Counter()
    for ant in antennas:
        if ant.get("geohash") and ant.get("zone_name"):
            zone_names[ant["geohash"]] = ant["zone_name"]
    for inc in incidents:
        zone = inc.get("geohash")
        if zone:
            zone_counts[zone] += 1
            if inc.get("zone_name"):
                zone_names[zone] = inc["zone_name"]
    top_zones = [
        {
            "geohash": zone,
            "zone_name": zone_names.get(zone, f"Zona {zone}"),
            "incident_count": count,
        }
        for zone, count in zone_counts.most_common(10)
    ]

    recurrent = [
        {
            "antenna_id": ant.get("antenna_id") or ant["PK"].removeprefix("ANTENNA#"),
            "health_status": ant.get("health_status", "NORMAL"),
            "last_traffic_gb": ant.get("last_traffic_gb", Decimal(0)),
            "structural_risk": True,
            "zone_name": ant.get("zone_name", f"Zona {ant.get('geohash', '')}"),
            "geohash": ant.get("geohash", ""),
        }
        for ant in antennas if ant.get("structural_risk") is True
    ]

    problem_counts = Counter(str(t["problem_type"]) for t in tickets if t.get("problem_type"))
    top_types = [
        {"problem_type": kind, "count": count}
        for kind, count in problem_counts.most_common(10)
    ]

    incident_fields = (
        "incident_id", "geohash", "zone_name", "trigger_type", "affected_users_count",
        "critical_pois", "priority_score", "priority_level", "status", "ai_diagnosis",
        "ai_executive_diagnosis", "structural_recurrence_alert", "ai_source",
        "dispatch_mode", "workflow_execution_id", "created_at", "closed_at",
    )
    master_incidents = []
    for inc in incidents:
        entry = {k: inc[k] for k in incident_fields if k in inc}
        entry.setdefault("incident_id", inc["PK"].removeprefix("INCIDENT#"))
        master_incidents.append(entry)
    master_incidents.sort(key=lambda inc: float(inc.get("priority_score") or 0), reverse=True)

    return {
        "kpis": {
            "total_tickets": len(tickets),
            "active_incidents": active,
            "avg_mttr_minutes": round(sum(durations) / len(durations), 2) if durations else 0.0,
            "total_affected_users": len(users),
        },
        "top_zones": top_zones,
        "recurrent_antennas": recurrent,
        "top_problem_types": top_types,
        "master_incidents": master_incidents,
    }


def get_tickets(params):
    ticket_id = params.get("ticket_id")
    user_id = params.get("user_id")
    geohash = params.get("geohash")
    if not (ticket_id or user_id or geohash):
        return response(400, {"error": "Se requiere ticket_id, user_id o geohash"})

    if ticket_id:
        item = table.get_item(
            Key={"PK": f"TICKET#{ticket_id}", "SK": "META"},
            ConsistentRead=True,
        ).get("Item")
        tickets = [item] if item else []
    else:
        # Para la demo; en producción consultar índices específicos por usuario/zona.
        tickets = [
            x for x in scan_all()
            if x.get("PK", "").startswith("TICKET#") and x.get("SK") == "META"
            and (not user_id or x.get("user_id") == user_id)
            and (not geohash or x.get("geohash") == geohash)
        ]

    result = []
    for item in tickets:
        pk = item["PK"]
        histories = table.query(
            KeyConditionExpression=Key("PK").eq(pk) & Key("SK").begins_with("HIST#"),
            ConsistentRead=True,
        )["Items"]
        obj = dict(item)
        obj["history"] = [
            {
                "old_status": h.get("old_status"),
                "new_status": h.get("new_status"),
                "changed_by": h.get("changed_by"),
                "note": h.get("note"),
                "timestamp": h["SK"][5:],
            }
            for h in histories
        ]
        result.append(obj)
    return response(200, {"items": result})


def lambda_handler(event, context):
    method = event.get("httpMethod", "")
    path = event.get("path", "")

    if method == "OPTIONS":
        return response(200, {})

    if method == "POST" and path == "/tickets":
        try:
            data = json.loads(event.get("body") or "{}")
            if not isinstance(data, dict):
                return response(400, {"error": "JSON invalido"})
            required = [
                "user_id", "service_number", "location_text",
                "lat", "lon", "problem_type", "description",
            ]
            for field in required:
                if field not in data or data[field] is None or data[field] == "":
                    return response(400, {"error": f"Falta {field}"})
            lat = float(data["lat"])
            lon = float(data["lon"])
            if not (math.isfinite(lat) and math.isfinite(lon)) or not (
                -90 <= lat <= 90 and -180 <= lon <= 180
            ):
                return response(400, {"error": "Coordenadas invalidas"})

            ticket_id = f"TCK-{uuid.uuid4().hex[:12].upper()}"
            geohash = encode_geohash(lat, lon)
            data["ticket_id"] = ticket_id
            data.setdefault("email", "")
            data.setdefault("phone", "")
            queue_url = sqs.get_queue_url(QueueName="telecorp-tickets-q")["QueueUrl"]
            sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(data))
            return response(202, {
                "ticket_id": ticket_id,
                "status": "Registrada",
                "geohash": geohash,
            })
        except (ValueError, TypeError) as error:
            return response(400, {"error": str(error)})

    if method == "POST" and path == "/telemetria":
        try:
            data = json.loads(event.get("body") or "{}")
            if not isinstance(data, dict):
                return response(400, {"error": "JSON invalido"})
            for field in ("antenna_id", "lat", "lon", "traffic_gb_min"):
                if field not in data or data[field] is None:
                    return response(400, {"error": f"Falta {field}"})
            lat = float(data["lat"])
            lon = float(data["lon"])
            traffic = Decimal(str(data["traffic_gb_min"]))
            if not (math.isfinite(lat) and math.isfinite(lon)) or not (
                -90 <= lat <= 90 and -180 <= lon <= 180
            ):
                return response(400, {"error": "Coordenadas invalidas"})
            if not traffic.is_finite() or traffic < 0:
                return response(400, {"error": "Trafico invalido"})
            if not str(data["antenna_id"]).strip():
                return response(400, {"error": "antenna_id invalido"})
            data["timestamp"] = data.get("timestamp") or now_utc()
            queue_url = sqs.get_queue_url(QueueName="telecorp-telemetry-q")["QueueUrl"]
            sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(data))
            return response(202, {
                "message": "Telemetria recibida",
                "antenna_id": data["antenna_id"],
            })
        except (ValueError, TypeError, InvalidOperation) as error:
            return response(400, {"error": str(error)})

    if method == "POST" and path == "/logs":
        try:
            data = json.loads(event.get("body") or "{}")
            if not isinstance(data, dict):
                return response(400, {"error": "JSON invalido"})
            for field in ("system", "level", "message"):
                if not isinstance(data.get(field), str):
                    return response(400, {"error": f"Campo invalido: {field}"})
                if not data[field].strip():
                    return response(400, {"error": f"Falta {field}"})
            if data["level"] not in VALID_LOG_LEVELS:
                return response(400, {"error": "level debe ser INFO, WARN, ERROR o CRITICAL"})
            for field in ("antenna_id", "geohash", "timestamp"):
                if field in data and not isinstance(data[field], str):
                    return response(400, {"error": f"Campo invalido: {field}"})
            data["log_id"] = f"LOG-{uuid.uuid4().hex[:16].upper()}"
            data["timestamp"] = data.get("timestamp") or now_utc()
            queue_url = sqs.get_queue_url(QueueName="telecorp-logs-q")["QueueUrl"]
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps(data, ensure_ascii=False),
            )
            return response(202, {"message": "Log recibido", "log_id": data["log_id"]})
        except (ValueError, TypeError) as error:
            return response(400, {"error": str(error)})

    if method == "PATCH" and path.startswith("/tickets/") and path.endswith("/estado"):
        ticket_id = (
            (event.get("pathParameters") or {}).get("ticket_id")
            or path[len("/tickets/"):-len("/estado")].strip("/")
        )
        if not ticket_id or "/" in ticket_id:
            return response(400, {"error": "ticket_id invalido"})
        try:
            data = json.loads(event.get("body") or "{}")
        except (ValueError, TypeError):
            return response(400, {"error": "JSON invalido"})
        if not isinstance(data, dict):
            return response(400, {"error": "JSON invalido"})
        new_status = data.get("new_status")
        if new_status not in VALID_STATUSES:
            return response(400, {"error": "Estado invalido"})
        changed_by = data.get("changed_by") or "OPERADOR"
        note = data.get("note") or ""
        if changed_by not in ("OPERADOR", "SISTEMA_SFN"):
            return response(400, {"error": "changed_by invalido"})
        if not isinstance(note, str):
            return response(400, {"error": "note debe ser texto"})
        key = {"PK": f"TICKET#{ticket_id}", "SK": "META"}
        item = table.get_item(Key=key, ConsistentRead=True).get("Item")
        if not item:
            return response(404, {"error": "Ticket no encontrado"})
        old_status = item.get("status")
        if old_status == new_status:
            return response(200, {
                "ticket_id": ticket_id,
                "status": new_status,
                "message": "El ticket ya tiene ese estado",
            })
        timestamp = now_utc()
        try:
            table.update_item(
                Key=key,
                UpdateExpression="SET #st = :new, updated_at = :ts",
                ConditionExpression="attribute_exists(PK) AND #st = :old",
                ExpressionAttributeNames={"#st": "status"},
                ExpressionAttributeValues={
                    ":new": new_status,
                    ":old": old_status,
                    ":ts": timestamp,
                },
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return response(409, {"error": "El estado cambio durante la solicitud"})
            raise
        table.put_item(Item={
            "PK": f"TICKET#{ticket_id}",
            "SK": f"HIST#{timestamp}",
            "GSI1PK": f"USER#{item['user_id']}",
            "GSI1SK": f"TS#{timestamp}",
            "ticket_id": ticket_id,
            "old_status": old_status,
            "new_status": new_status,
            "changed_by": changed_by,
            "note": note,
            "timestamp": timestamp,
            "created_at": timestamp,
        })
        if new_status == "Solucionada":
            detail = {
                "incident_id": item.get("master_incident_id") or "",
                "ticket_id": ticket_id,
                "geohash": item.get("geohash", ""),
                "new_status": new_status,
                "changed_by": changed_by,
                "note": note,
                "timestamp": timestamp,
            }
            result = events.put_events(Entries=[{
                "Source": "telecorp.operaciones",
                "DetailType": "incidente.solucionado",
                "Detail": json.dumps(detail),
                "EventBusName": "telecorp-bus",
            }])
            if result["FailedEntryCount"] > 0:
                raise RuntimeError("Error publicando en EventBridge")
        return response(200, {
            "ticket_id": ticket_id,
            "old_status": old_status,
            "new_status": new_status,
            "updated_at": timestamp,
        })

    if method == "GET" and path == "/tickets":
        return get_tickets(event.get("queryStringParameters") or {})

    if method == "GET" and path == "/analytics/resumen":
        return response(200, make_analytics())

    return response(404, {"error": "Ruta no encontrada"})
