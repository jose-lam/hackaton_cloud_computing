import json
import time
from datetime import datetime
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("TeleCorp_Operaciones")
ssm = boto3.client("ssm")
events = boto3.client("events")

_thresholds = None


def get_thresholds():
    global _thresholds

    if _thresholds is None:
        names = [
            "/telecorp/thresholds/min_gb",
            "/telecorp/thresholds/max_gb"
        ]

        response = ssm.get_parameters(
            Names=names,
            WithDecryption=True
        )

        if response.get("InvalidParameters"):
            raise ValueError("Faltan parametros SSM")

        values = {
            p["Name"]: Decimal(p["Value"])
            for p in response["Parameters"]
        }

        _thresholds = (
            values[names[0]],
            values[names[1]]
        )

    return _thresholds


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


def _parse_iso(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def process_telemetry(data):
    antenna_id = str(data["antenna_id"])
    lat = float(data["lat"])
    lon = float(data["lon"])
    traffic = Decimal(str(data["traffic_gb_min"]))
    timestamp = data["timestamp"]
    date_day = timestamp[:10]

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Coordenadas invalidas")

    if not traffic.is_finite() or traffic < 0:
        raise ValueError("Trafico invalido")

    minimum, maximum = get_thresholds()

    if traffic == 0:
        status = "INHABILITADA"
    elif traffic < minimum:
        status = "CAIDA"
    elif traffic <= maximum:
        status = "NORMAL"
    else:
        status = "SATURADA"

    geohash = encode_geohash(lat, lon)
    zone_name = str(data.get("zone_name") or f"Zona {geohash}")
    key = {"PK": f"ANTENNA#{antenna_id}", "SK": "CURRENT"}

    previous_item = table.get_item(
        Key=key,
        ConsistentRead=True
    ).get("Item", {})

    previous = previous_item.get("last_traffic_gb")
    previous_status = previous_item.get("health_status")
    previous_updated = str(previous_item.get("updated_at", ""))

    drop = (
        previous is not None
        and previous > 0
        and traffic < previous * Decimal("0.65")
    )

    table.update_item(
        Key=key,
        UpdateExpression=(
            "SET antenna_id=:id, zone_name=:zn, geohash=:geo, "
            "GSI1PK=:gpk, GSI1SK=:gsk, "
            "lat=:lat, lon=:lon, "
            "last_traffic_gb=:traffic, "
            "health_status=:status, updated_at=:ts, "
            "structural_risk=if_not_exists(structural_risk, :sr)"
        ),
        ExpressionAttributeValues={
            ":id": antenna_id,
            ":zn": zone_name,
            ":geo": geohash,
            ":gpk": f"ZONA#{geohash}",
            ":gsk": f"ANTENNA#{antenna_id}",
            ":lat": Decimal(str(lat)),
            ":lon": Decimal(str(lon)),
            ":traffic": traffic,
            ":status": status,
            ":ts": timestamp,
            ":sr": False
        }
    )

    if status != "NORMAL":
        if previous_status != status or previous_updated[:10] != date_day:
            table.put_item(
                Item={
                    "PK": f"ANTENNA#{antenna_id}",
                    "SK": f"EVENT#{date_day}#{timestamp}",
                    "GSI1PK": "FAILURES#ALL",
                    "GSI1SK": f"TS#{timestamp}",
                    "antenna_id": antenna_id,
                    "date_day": date_day,
                    "health_status": status,
                    "traffic_gb": traffic,
                    "geohash": geohash,
                    "updated_at": timestamp
                }
            )
    elif previous_status and previous_status != "NORMAL":
        resp = table.query(
            KeyConditionExpression=Key("PK").eq(f"ANTENNA#{antenna_id}") & Key("SK").begins_with("EVENT#"),
            ScanIndexForward=False,
            Limit=1
        )
        items = resp.get("Items", [])
        if items and "recovered_at" not in items[0]:
            last_event = items[0]
            try:
                start_ts = last_event["SK"].split("#", 2)[2]
                duration = max(0, int((_parse_iso(timestamp) - _parse_iso(start_ts)).total_seconds()))
            except Exception:
                duration = 0
            table.update_item(
                Key={"PK": last_event["PK"], "SK": last_event["SK"]},
                UpdateExpression="SET recovered_at=:rec, duration_sec=:dur",
                ExpressionAttributeValues={
                    ":rec": timestamp,
                    ":dur": duration
                }
            )

    print(f"Antena {antenna_id}: {traffic} GB/min -> {status}")

    if status != "NORMAL" or drop:
        detail = {
            "antenna_id": antenna_id,
            "geohash": geohash,
            "lat": lat,
            "lon": lon,
            "traffic_gb_min": float(traffic),
            "previous_traffic_gb": (
                float(previous) if previous is not None else None
            ),
            "health_status": status,
            "timestamp": timestamp
        }
        return antenna_id, {
            "Source": "telecorp.telemetria",
            "DetailType": "antena.anomalia",
            "Detail": json.dumps(detail),
            "EventBusName": "telecorp-bus"
        }

    return None, None


def lambda_handler(event, context):
    failures = []
    anomaly_by_antenna = {}

    for record in event["Records"]:
        try:
            data = json.loads(record["body"])
            antenna_id, eb_entry = process_telemetry(data)
            if antenna_id and eb_entry:
                anomaly_by_antenna[antenna_id] = eb_entry
        except Exception as error:
            print(f"Error: {error}")
            failures.append({
                "itemIdentifier": record["messageId"]
            })

    entries = list(anomaly_by_antenna.values())
    for idx, entry in enumerate(entries):
        response = events.put_events(Entries=[entry])
        if response["FailedEntryCount"] > 0:
            raise RuntimeError("Error publicando en EventBridge")
        if idx < len(entries) - 1:
            time.sleep(0.25)

    return {"batchItemFailures": failures}
