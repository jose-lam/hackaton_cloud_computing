import json
from datetime import datetime, timezone, timedelta
from botocore.exceptions import ClientError

import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("TeleCorp_Operaciones")

VALID_LEVELS = {"INFO", "WARN", "ERROR", "CRITICAL"}


def process_log(data, record):
    if not isinstance(data, dict):
        raise ValueError("El mensaje debe ser un objeto JSON")

    for field in ("system", "level", "message"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError(f"Campo invalido: {field}")

    if data["level"] not in VALID_LEVELS:
        raise ValueError("Nivel de log invalido")

    log_id = str(data.get("log_id") or record["messageId"])

    timestamp = data.get("timestamp") or (
        datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )

    if not isinstance(timestamp, str):
        raise ValueError("Timestamp invalido")

    now = datetime.now(timezone.utc)
    ttl = int((now + timedelta(days=7)).timestamp())

    item = {
        "PK": f"LOG#{log_id}",
        "SK": "META",
        "log_id": log_id,
        "system": data["system"],
        "level": data["level"],
        "message": data["message"],
        "timestamp": timestamp,
        "ttl_epoch": ttl
    }

    if data.get("antenna_id"):
        item["antenna_id"] = str(data["antenna_id"])

    if data.get("geohash"):
        geohash = str(data["geohash"])
        item["geohash"] = geohash
        item["GSI1PK"] = f"ZONA#{geohash}"
        item["GSI1SK"] = f"TS#{timestamp}#LOG#{log_id}"

    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(PK)"
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise

    print(f"Log {log_id}: {data['level']} - {data['system']}")


def lambda_handler(event, context):
    failures = []

    for record in event["Records"]:
        try:
            data = json.loads(record["body"])
            process_log(data, record)
        except Exception as error:
            print(f"Error procesando log: {error}")
            failures.append({
                "itemIdentifier": record["messageId"]
            })

    return {"batchItemFailures": failures}
