import json
import time
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("TeleCorp_Operaciones")
events = boto3.client("events")


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

        value <<= 1

        if coordinate >= midpoint:
            value |= 1
            current[0] = midpoint
        else:
            current[1] = midpoint

        bits += 1

        if bits % 5 == 0:
            result += alphabet[value]
            value = 0

    return result


def process_ticket(data, record):
    required = [
        "user_id", "service_number",
        "location_text", "lat", "lon",
        "problem_type", "description"
    ]

    data.setdefault("email", "")
    data.setdefault("phone", "")
    for field in required:
        if field not in data:
            raise ValueError(f"Falta el campo: {field}")

    ticket_id = str(
        data.get("ticket_id") or f"TCK-{record['messageId']}"
    )

    user_id = str(data["user_id"])
    lat = float(data["lat"])
    lon = float(data["lon"])

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Coordenadas invalidas")

    sent_ms = int(record["attributes"]["SentTimestamp"])
    timestamp = data.get("timestamp") or (
        datetime.fromtimestamp(
            sent_ms / 1000, tz=timezone.utc
        ).isoformat().replace("+00:00", "Z")
    )
    incident_time = str(data.get("incident_time") or timestamp)

    geohash = encode_geohash(lat, lon)
    pk = f"TICKET#{ticket_id}"

    ticket = {
        "PK": pk,
        "SK": "META",
        "GSI1PK": f"ZONA#{geohash}",
        "GSI1SK": f"TS#{timestamp}",
        "ticket_id": ticket_id,
        "user_id": user_id,
        "service_number": str(data["service_number"]),
        "email": str(data["email"]),
        "phone": str(data["phone"]),
        "location_text": str(data["location_text"]),
        "lat": Decimal(str(lat)),
        "lon": Decimal(str(lon)),
        "geohash": geohash,
        "problem_type": str(data["problem_type"]),
        "description": str(data["description"]),
        "incident_time": incident_time,
        "status": "Registrada",
        "created_at": timestamp
    }

    try:
        table.put_item(
            Item=ticket,
            ConditionExpression="attribute_not_exists(PK)"
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise

    history = {
        "PK": pk,
        "SK": f"HIST#{timestamp}",
        "GSI1PK": f"USER#{user_id}",
        "GSI1SK": f"TS#{timestamp}",
        "old_status": "Ninguno",
        "new_status": "Registrada",
        "changed_by": "SISTEMA_SFN",
        "note": "Ticket registrado",
        "created_at": timestamp
    }

    table.put_item(Item=history)
    print(f"Ticket {ticket_id}: Registrada")

    detail = {
        "ticket_id": ticket_id,
        "user_id": user_id,
        "service_number": str(data["service_number"]),
        "email": str(data["email"]),
        "phone": str(data["phone"]),
        "geohash": geohash,
        "lat": lat,
        "lon": lon,
        "problem_type": str(data["problem_type"]),
        "description": str(data["description"]),
        "incident_time": incident_time,
        "timestamp": timestamp
    }

    return (geohash, user_id), {
        "Source": "telecorp.ingesta",
        "DetailType": "incidencia.creada",
        "Detail": json.dumps(detail),
        "EventBusName": "telecorp-bus"
    }


def lambda_handler(event, context):
    failures = []
    seen_in_batch = set()
    eb_entries = []

    for record in event["Records"]:
        try:
            data = json.loads(record["body"])
            dedup_key, eb_entry = process_ticket(data, record)
            if dedup_key not in seen_in_batch:
                seen_in_batch.add(dedup_key)
                eb_entries.append(eb_entry)
        except Exception as error:
            print(f"Error: {error}")
            failures.append({
                "itemIdentifier": record["messageId"]
            })

    # Espaciado controlado hacia EventBridge para mantener <= 1 Lambda eval_collective activa
    for idx, entry in enumerate(eb_entries):
        response = events.put_events(Entries=[entry])
        if response["FailedEntryCount"] > 0:
            raise RuntimeError("Error publicando en EventBridge")
        if idx < len(eb_entries) - 1:
            time.sleep(0.25)

    return {"batchItemFailures": failures}
