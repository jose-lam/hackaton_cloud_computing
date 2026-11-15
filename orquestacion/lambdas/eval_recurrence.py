import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Clientes AWS reutilizables entre invocaciones en caliente
dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")

TABLA_OPERACIONES = os.environ.get("TABLA_OPERACIONES", "TeleCorp_Operaciones")
SSM_RECURRENCE_PARAM = os.environ.get(
    "SSM_RECURRENCE_DAYS_PARAM", "/telecorp/thresholds/recurrence_days"
)
DEFAULT_LOOKBACK_DAYS = int(os.environ.get("RECURRENCE_LOOKBACK_DAYS", "7"))

ANOMALOUS_STATUSES = {"CAIDA", "SATURADA", "INHABILITADA"}

# Caché en memoria para evitar throttling en SSM Parameter Store
_SSM_CACHE: Dict[str, Tuple[int, float]] = {}
_CACHE_TTL_SECONDS = 60.0


def _decimal_to_native(obj: Any) -> Any:
    """Convierte objetos Decimal de DynamoDB a int o float serializables en JSON."""
    if isinstance(obj, list):
        return [_decimal_to_native(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _decimal_to_native(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def _get_recurrence_threshold() -> int:
    """Lee el umbral de días distintos de falla desde SSM (/telecorp/thresholds/recurrence_days)."""
    now = time.time()
    cached = _SSM_CACHE.get(SSM_RECURRENCE_PARAM)
    if cached and (now - cached[1]) < _CACHE_TTL_SECONDS:
        return cached[0]

    try:
        resp = ssm.get_parameter(Name=SSM_RECURRENCE_PARAM, WithDecryption=True)
        value = int(resp["Parameter"]["Value"])
        _SSM_CACHE[SSM_RECURRENCE_PARAM] = (value, now)
        return value
    except Exception as exc:
        logger.warning(
            "No se pudo leer SSM %s (%s). Usando umbral por defecto = 3.",
            SSM_RECURRENCE_PARAM,
            exc,
        )
        return 3


def _parse_reference_datetime(ts_str: Optional[str]) -> datetime:
    """Parsea timestamp ISO-8601 a UTC o devuelve datetime.now(timezone.utc)."""
    if not ts_str:
        return datetime.now(timezone.utc)
    try:
        normalized = ts_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _classify_traffic_status(traffic_gb: Optional[float]) -> Optional[str]:
    """Clasifica tráfico GB/min según las reglas oficiales de Red TeleCorp."""
    if traffic_gb is None:
        return None
    if traffic_gb == 0:
        return "INHABILITADA"
    if traffic_gb < 60:
        return "CAIDA"
    if traffic_gb > 129:
        return "SATURADA"
    return "NORMAL"


def _extract_event_date(item: Dict[str, Any]) -> Optional[str]:
    """Extrae YYYY-MM-DD desde el atributo date_day o desde la SK EVENT#<YYYY-MM-DD>#<ts>."""
    date_day = item.get("date_day")
    if isinstance(date_day, str) and len(date_day) >= 10:
        return date_day[:10]

    sk = item.get("SK", "")
    if isinstance(sk, str) and sk.startswith("EVENT#"):
        parts = sk.split("#")
        if len(parts) >= 2 and len(parts[1]) >= 10:
            return parts[1][:10]
    return None


def _discover_antennas_by_geohash(table: Any, geohash: str) -> List[Dict[str, Any]]:
    """Busca antenas registradas en una zona usando GSI1_ZonaEstado (GSI1PK = ZONA#<geohash>)."""
    if not geohash:
        return []
    try:
        resp = table.query(
            IndexName="GSI1_ZonaEstado",
            KeyConditionExpression=Key("GSI1PK").eq(f"ZONA#{geohash}")
            & Key("GSI1SK").begins_with("ANTENNA#"),
        )
        return resp.get("Items", [])
    except ClientError as exc:
        logger.error("Error consultando GSI1_ZonaEstado para geohash %s: %s", geohash, exc)
        return []


def _evaluate_antenna_recurrence(
    table: Any,
    antenna_id: str,
    reference_dt: datetime,
    threshold_days: int,
    lookback_days: int,
    incoming_status: Optional[str] = None,
    incoming_traffic_gb: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Consulta los eventos EVENT#<YYYY-MM-DD>#<iso_ts> de los últimos `lookback_days` días
    para `antenna_id`, determina si hubo fallas en >= `threshold_days` días distintos
    con recuperación aparente entre eventos, y actualiza `structural_risk` en CURRENT.
    """
    end_date_str = reference_dt.strftime("%Y-%m-%d")
    start_dt = reference_dt - timedelta(days=max(lookback_days - 1, 0))
    start_date_str = start_dt.strftime("%Y-%m-%d")

    sk_start = f"EVENT#{start_date_str}#"
    sk_end = f"EVENT#{end_date_str}#\uffff"

    items: List[Dict[str, Any]] = []
    query_kwargs = {
        "KeyConditionExpression": Key("PK").eq(f"ANTENNA#{antenna_id}")
        & Key("SK").between(sk_start, sk_end)
    }

    while True:
        resp = table.query(**query_kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key

    failure_days = set()
    total_failure_events = 0
    recovered_cycles = 0
    durations: List[float] = []

    for item in items:
        status = item.get("health_status")
        if not status and item.get("traffic_gb") is not None:
            status = _classify_traffic_status(float(item["traffic_gb"]))

        if status not in ANOMALOUS_STATUSES:
            continue

        day_str = _extract_event_date(item)
        if not day_str:
            continue

        failure_days.add(day_str)
        total_failure_events += 1

        # Se considera recuperado entre eventos si tiene recovered_at explícito
        # o si la falla ocurrió en un día calendario anterior al evento actual.
        if item.get("recovered_at") or day_str < end_date_str:
            recovered_cycles += 1

        if item.get("duration_sec") is not None:
            try:
                durations.append(float(item["duration_sec"]))
            except (TypeError, ValueError):
                pass

    # Salvaguarda ante condición de carrera: si esta invocación viene de antena.anomalia
    # y el registro EVENT# de hoy aún no fue escrito, contabilizamos la fecha actual.
    if incoming_status in ANOMALOUS_STATUSES:
        if end_date_str not in failure_days:
            failure_days.add(end_date_str)
            total_failure_events += 1

    recent_failure_days = sorted(failure_days)
    distinct_days_count = len(recent_failure_days)
    structural_risk = distinct_days_count >= threshold_days
    avg_duration_sec = round(sum(durations) / len(durations), 2) if durations else None

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Actualizar bandera structural_risk en EstadoAntena (SK = CURRENT)
    try:
        table.update_item(
            Key={"PK": f"ANTENNA#{antenna_id}", "SK": "CURRENT"},
            UpdateExpression=(
                "SET antenna_id = if_not_exists(antenna_id, :aid), "
                "structural_risk = :sr, "
                "recurrence_days_count = :cnt, "
                "recent_failure_days = :days, "
                "last_recurrence_check = :ts"
            ),
            ExpressionAttributeValues={
                ":aid": antenna_id,
                ":sr": structural_risk,
                ":cnt": distinct_days_count,
                ":days": recent_failure_days,
                ":ts": now_iso,
            },
        )
    except ClientError as exc:
        logger.error("Error actualizando structural_risk en %s: %s", antenna_id, exc)

    # Leer estado actual de la antena para enriquecer la salida hacia GCP / Step Functions
    current_status = incoming_status
    current_traffic = incoming_traffic_gb
    zone_name = None

    try:
        curr_resp = table.get_item(
            Key={"PK": f"ANTENNA#{antenna_id}", "SK": "CURRENT"}
        )
        curr_item = _decimal_to_native(curr_resp.get("Item", {}))
        if curr_item:
            current_status = curr_item.get("health_status") or current_status
            if curr_item.get("last_traffic_gb") is not None:
                current_traffic = float(curr_item["last_traffic_gb"])
            zone_name = curr_item.get("zone_name")
    except ClientError as exc:
        logger.warning("No se pudo leer CURRENT de %s: %s", antenna_id, exc)

    return {
        "antenna_id": antenna_id,
        "zone_name": zone_name,
        "antenna_status": current_status or "DESCONOCIDO",
        "antenna_traffic_gb": current_traffic,
        "structural_risk": structural_risk,
        "recurrence_threshold_days": threshold_days,
        "lookback_window_days": lookback_days,
        "distinct_failure_days_count": distinct_days_count,
        "recent_failure_days": recent_failure_days,
        "total_failure_events_7d": total_failure_events,
        "recovered_cycles_detected": recovered_cycles,
        "avg_failure_duration_sec": avg_duration_sec,
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Soporta invocación tanto desde AWS Step Functions (payload directo)
    como desde Amazon EventBridge (evento antena.anomalia en event['detail']).
    """
    logger.info("Evento recibido en eval_recurrence: %s", json.dumps(event, default=str))

    is_eventbridge = isinstance(event.get("detail"), dict)
    payload: Dict[str, Any] = dict(event["detail"]) if is_eventbridge else dict(event)

    reference_dt = _parse_reference_datetime(payload.get("timestamp"))
    threshold_days = _get_recurrence_threshold()
    table = dynamodb.Table(TABLA_OPERACIONES)

    antenna_id: Optional[str] = payload.get("antenna_id")
    geohash: Optional[str] = payload.get("geohash")
    incoming_status: Optional[str] = payload.get("health_status") or payload.get(
        "antenna_status"
    )
    raw_traffic = payload.get("traffic_gb_min")
    if raw_traffic is None:
        raw_traffic = payload.get("antenna_traffic_gb")
    incoming_traffic = float(raw_traffic) if raw_traffic is not None else None

    target_antenna_ids: List[str] = []
    if antenna_id:
        target_antenna_ids.append(antenna_id)
    elif geohash:
        zone_antennas = _discover_antennas_by_geohash(table, geohash)
        for ant in zone_antennas:
            aid = ant.get("antenna_id")
            if not aid and isinstance(ant.get("PK"), str) and ant["PK"].startswith("ANTENNA#"):
                aid = ant["PK"].split("#", 1)[1]
            if aid and aid not in target_antenna_ids:
                target_antenna_ids.append(aid)

    # Caso borde: incidente ciudadano en una zona sin antenas registradas todavía
    if not target_antenna_ids:
        logger.info(
            "No se encontró antenna_id explícito ni antenas en geohash=%s.", geohash
        )
        result = dict(payload)
        result.update(
            {
                "antenna_id": None,
                "antenna_status": incoming_status or "SIN_ANTENA_ASOCIADA",
                "antenna_traffic_gb": incoming_traffic,
                "structural_risk": False,
                "recurrence_threshold_days": threshold_days,
                "lookback_window_days": DEFAULT_LOOKBACK_DAYS,
                "distinct_failure_days_count": 0,
                "recent_failure_days": [],
                "total_failure_events_7d": 0,
                "recovered_cycles_detected": 0,
                "avg_failure_duration_sec": None,
                "evaluated_antennas": [],
            }
        )
        return result

    evaluations: List[Dict[str, Any]] = []
    for aid in target_antenna_ids:
        eval_res = _evaluate_antenna_recurrence(
            table=table,
            antenna_id=aid,
            reference_dt=reference_dt,
            threshold_days=threshold_days,
            lookback_days=DEFAULT_LOOKBACK_DAYS,
            incoming_status=incoming_status if aid == antenna_id else None,
            incoming_traffic_gb=incoming_traffic if aid == antenna_id else None,
        )
        evaluations.append(eval_res)

    # Priorizar la antena con structural_risk=True, luego estado anómalo, luego mayor cantidad de días
    evaluations.sort(
        key=lambda x: (
            1 if x["structural_risk"] else 0,
            1 if x["antenna_status"] in ANOMALOUS_STATUSES else 0,
            x["distinct_failure_days_count"],
        ),
        reverse=True,
    )
    primary = evaluations[0]

    # Preservar todos los campos de entrada para no romper el flujo de Step Functions
    result = dict(payload)
    result.update(
        {
            "antenna_id": primary["antenna_id"],
            "antenna_status": primary["antenna_status"],
            "antenna_traffic_gb": primary["antenna_traffic_gb"],
            "structural_risk": primary["structural_risk"],
            "recurrence_threshold_days": primary["recurrence_threshold_days"],
            "lookback_window_days": primary["lookback_window_days"],
            "distinct_failure_days_count": primary["distinct_failure_days_count"],
            "recent_failure_days": primary["recent_failure_days"],
            "total_failure_events_7d": primary["total_failure_events_7d"],
            "recovered_cycles_detected": primary["recovered_cycles_detected"],
            "avg_failure_duration_sec": primary["avg_failure_duration_sec"],
            "evaluated_antennas": evaluations,
        }
    )

    if primary["zone_name"] and not result.get("zone_name"):
        result["zone_name"] = primary["zone_name"]

    logger.info(
        "Resultado recurrencia antenna_id=%s -> structural_risk=%s, days=%s",
        primary["antenna_id"],
        primary["structural_risk"],
        primary["recent_failure_days"],
    )
    return result
