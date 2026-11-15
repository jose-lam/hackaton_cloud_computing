import json
from decimal import Decimal

import boto3

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


def process_telemetry(data):
    antenna_id = str(data["antenna_id"])
    lat = float(data["lat"])
    lon = float(data["lon"])
    traffic = Decimal(str(data["traffic_gb_min"]))
    timestamp = data["timestamp"]

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
    key = {"PK": f"ANTENNA#{antenna_id}", "SK": "CURRENT"}

    previous_item = table.get_item(
        Key=key,
        ConsistentRead=True
    ).get("Item", {})

    previous = previous_item.get("last_traffic_gb")
    drop = (
        previous is not None
        and previous > 0
        and traffic < previous * Decimal("0.65")
    )

    table.update_item(
        Key=key,
        UpdateExpression=(
            "SET antenna_id=:id, geohash=:geo, "
            "GSI1PK=:gpk, GSI1SK=:gsk, "
            "lat=:lat, lon=:lon, "
            "last_traffic_gb=:traffic, "
            "health_status=:status, updated_at=:ts"
        ),
        ExpressionAttributeValues={
            ":id": antenna_id,
            ":geo": geohash,
            ":gpk": f"ZONA#{geohash}",
            ":gsk": f"ANTENNA#{antenna_id}",
            ":lat": Decimal(str(lat)),
            ":lon": Decimal(str(lon)),
            ":traffic": traffic,
            ":status": status,
            ":ts": timestamp
        }
    )

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

        response = events.put_events(
            Entries=[{
                "Source": "telecorp.telemetria",
                "DetailType": "antena.anomalia",
                "Detail": json.dumps(detail),
                "EventBusName": "telecorp-bus"
            }]
        )

        if response["FailedEntryCount"] > 0:
            raise RuntimeError("Error publicando en EventBridge")

    print(f"Antena {antenna_id}: {traffic} GB/min -> {status}")


def lambda_handler(event, context):
    failures = []

    for record in event["Records"]:
        try:
            data = json.loads(record["body"])
            process_telemetry(data)
        except Exception as error:
            print(f"Error: {error}")
            failures.append({
                "itemIdentifier": record["messageId"]
            })

    return {"batchItemFailures": failures}
