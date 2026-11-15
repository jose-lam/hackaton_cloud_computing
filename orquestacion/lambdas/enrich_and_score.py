import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Clientes AWS reutilizables entre invocaciones en caliente
dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")

TABLA_OPERACIONES_NAME = os.environ.get("TABLA_OPERACIONES", "TeleCorp_Operaciones")
SSM_GCP_URL_PARAM = os.environ.get("SSM_GCP_URL_PARAM", "/telecorp/gcp/endpoint_url")
SSM_GCP_KEY_PARAM = os.environ.get("SSM_GCP_KEY_PARAM", "/telecorp/gcp/api_key")
GCP_TIMEOUT_SEC = float(os.environ.get("GCP_TIMEOUT_SEC", "8.0"))

tabla_operaciones = dynamodb.Table(TABLA_OPERACIONES_NAME)

# Caché en memoria para parámetros SSM (TTL 60 segundos)
_SSM_CACHE: Dict[str, Any] = {"expires_at": 0.0, "data": {}}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_ddb(value: Any) -> Any:
    """Convierte recursivamente float a Decimal para compatibilidad con DynamoDB."""
    if isinstance(value, float):
        return Decimal(str(round(value, 4)))
    if isinstance(value, dict):
        return {k: _to_ddb(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_to_ddb(v) for v in value]
    return value


def _get_gcp_credentials() -> Dict[str, str]:
    """Lee URL y API Key de GCP desde SSM Parameter Store con caché en memoria."""
    now = time.time()
    if now < _SSM_CACHE["expires_at"] and _SSM_CACHE["data"]:
        return _SSM_CACHE["data"]

    try:
        resp = ssm.get_parameters(
            Names=[SSM_GCP_URL_PARAM, SSM_GCP_KEY_PARAM],
            WithDecryption=True,
        )
        params = {p["Name"]: p["Value"] for p in resp.get("Parameters", [])}
        raw_url = params.get(SSM_GCP_URL_PARAM, "").strip()
        api_key = params.get(SSM_GCP_KEY_PARAM, "").strip()

        if raw_url and not raw_url.startswith("PENDIENTE"):
            endpoint_url = (
                raw_url
                if raw_url.rstrip("/").endswith("/ia/analizar")
                else f"{raw_url.rstrip('/')}/ia/analizar"
            )
        else:
            endpoint_url = ""

        creds = {"endpoint_url": endpoint_url, "api_key": api_key}
        _SSM_CACHE["data"] = creds
        _SSM_CACHE["expires_at"] = now + 60.0
        return creds
    except Exception as exc:
        logger.warning("Error leyendo parámetros GCP desde SSM: %s", exc)
        return {"endpoint_url": "", "api_key": ""}


def _classify_traffic_threshold(traffic_gb: Optional[float]) -> str:
    """Evalúa umbrales oficiales de Red TeleCorp (0, <60, 60-129, >129 GB/min)."""
    if traffic_gb is None:
        return "DESCONOCIDO"
    if traffic_gb == 0:
        return "INHABILITADA"
    if traffic_gb < 60:
        return "CAIDA"
    if traffic_gb > 129:
        return "SATURADA"
    return "NORMAL"


def _fetch_antenna_context(geohash: str, antenna_id: Optional[str]) -> Dict[str, Any]:
    """Obtiene estado actual y nombre de zona de la antena desde TeleCorp_Operaciones."""
    try:
        if antenna_id:
            resp = tabla_operaciones.get_item(
                Key={"PK": f"ANTENNA#{antenna_id}", "SK": "CURRENT"}
            )
            item = resp.get("Item")
            if item:
                return {
                    "antenna_id": item.get("antenna_id", antenna_id),
                    "zone_name": item.get("zone_name", f"Zona {geohash}"),
                    "health_status": item.get("health_status", "DESCONOCIDO"),
                    "last_traffic_gb": float(item["last_traffic_gb"])
                    if "last_traffic_gb" in item
                    else None,
                    "structural_risk": bool(item.get("structural_risk", False)),
                }

        # Búsqueda por geohash en GSI1_ZonaEstado si no vino antenna_id
        resp = tabla_operaciones.query(
            IndexName="GSI1_ZonaEstado",
            KeyConditionExpression=Key("GSI1PK").eq(f"ZONA#{geohash}")
            & Key("GSI1SK").begins_with("ANTENNA#"),
        )
        items = resp.get("Items", [])
        if items:
            # Priorizar antenas anómalas
            priority_order = {"INHABILITADA": 0, "CAIDA": 1, "SATURADA": 2, "NORMAL": 3}
            items.sort(key=lambda x: priority_order.get(x.get("health_status", "NORMAL"), 4))
            top = items[0]
            return {
                "antenna_id": top.get("antenna_id"),
                "zone_name": top.get("zone_name", f"Zona {geohash}"),
                "health_status": top.get("health_status", "DESCONOCIDO"),
                "last_traffic_gb": float(top["last_traffic_gb"])
                if "last_traffic_gb" in top
                else None,
                "structural_risk": bool(top.get("structural_risk", False)),
            }
    except Exception as exc:
        logger.warning("No se pudo consultar contexto de antena en DynamoDB: %s", exc)

    return {
        "antenna_id": antenna_id,
        "zone_name": f"Zona {geohash}",
        "health_status": "DESCONOCIDO",
        "last_traffic_gb": None,
        "structural_risk": False,
    }


def _call_gcp_ai(payload: Dict[str, Any], creds: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Invoca POST /ia/analizar en Google Cloud Run con cabecera X-API-Key."""
    endpoint_url = creds.get("endpoint_url", "")
    api_key = creds.get("api_key", "")

    if not endpoint_url:
        logger.info("URL de GCP Cloud Run aún no configurada en SSM; usando fallback local.")
        return None

    req = urllib.request.Request(
        url=endpoint_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
            "User-Agent": "TeleCorp-AWS-StepFunctions/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=GCP_TIMEOUT_SEC) as response:
            status_code = response.getcode()
            raw_body = response.read().decode("utf-8")
            if 200 <= status_code < 300:
                parsed = json.loads(raw_body)
                logger.info("Respuesta exitosa desde GCP Cloud Run (/ia/analizar).")
                return parsed
            logger.warning("GCP Cloud Run respondió HTTP %s: %s", status_code, raw_body)
    except urllib.error.HTTPError as http_err:
        logger.warning("HTTPError invocando GCP Cloud Run (%s): %s", http_err.code, http_err.reason)
    except Exception as exc:
        logger.warning("Timeout o error de red invocando GCP Cloud Run: %s", exc)

    return None


def _local_resilient_fallback(
    descriptions: List[str],
    unique_users_count: int,
    antenna_id: Optional[str],
    antenna_status: str,
    recent_failure_days: List[str],
    structural_risk: bool,
) -> Dict[str, Any]:
    """Motor de respaldo determinista si GCP Cloud Run no responde o está en despliegue."""
    joined_text = " ".join(descriptions).lower()

    # 1. Detección heurística de zonas críticas por contexto textual
    critical_pois = []
    multiplier = 1.0
    if any(k in joined_text for k in ["hospital", "clinica", "clínica", "posta", "emergencia", "loayza", "medico", "médico"]):
        multiplier = 3.0
        critical_pois.append(
            {"name": "Infraestructura de Salud Cercana (Fallback)", "type": "hospital", "distance_m": 250}
        )
    elif any(k in joined_text for k in ["colegio", "escuela", "universidad", "instituto", "campus"]):
        multiplier = 2.2
        critical_pois.append(
            {"name": "Institución Educativa Cercana (Fallback)", "type": "school", "distance_m": 300}
        )
    elif any(k in joined_text for k in ["industrial", "fabrica", "fábrica", "planta", "comisaria", "comisaría", "bomberos"]):
        multiplier = 2.0
        critical_pois.append(
            {"name": "Zona Industrial / Servicio Crítico (Fallback)", "type": "industrial", "distance_m": 350}
        )

    # 2. Clasificación normalizada de falla
    if "sin_internet" in joined_text or "internet" in joined_text or "datos" in joined_text:
        category = "CORTE_TOTAL_DATOS"
    elif "sin_senal" in joined_text or "señal" in joined_text or "senal" in joined_text:
        category = "SIN_SENAL"
    elif "llamada" in joined_text or "voz" in joined_text:
        category = "FALLA_LLAMADAS"
    elif "lent" in joined_text or "satur" in joined_text:
        category = "INTERNET_LENTO"
    else:
        category = "OTRO"

    is_anomalous = antenna_status in {"CAIDA", "SATURADA", "INHABILITADA"}
    early_anomaly = unique_users_count >= 3 and is_anomalous
    is_recurrent = structural_risk or len(recent_failure_days) >= 3

    diagnosis_parts = [
        f"Afectación zonal detectada ({unique_users_count} usuarios únicos, categoría {category})."
    ]
    if antenna_id and is_anomalous:
        diagnosis_parts.append(f"Antena {antenna_id} en estado {antenna_status}.")
    if is_recurrent:
        diagnosis_parts.append(
            f"Alerta estructural: falla recurrente registrada en {len(recent_failure_days)} días distintos; requiere inspección especializada."
        )
    if critical_pois:
        diagnosis_parts.append(f"Impacto en zona crítica ({critical_pois[0]['type']}).")

    return {
        "normalized_category": category,
        "semantic_cluster_confidence": 0.80,
        "early_anomaly_detected": early_anomaly,
        "critical_pois": critical_pois,
        "zone_criticality_multiplier": multiplier,
        "structural_recurrence_alert": is_recurrent,
        "ai_executive_diagnosis": " ".join(diagnosis_parts),
    }


def _compute_priority(
    unique_users_count: int,
    zone_multiplier: float,
    antenna_status: str,
    structural_alert: bool,
) -> Dict[str, Any]:
    """
    Calcula el score de prioridad operativo:
    Score = (Usuarios_Afectados * 10) * Multiplicador_Zona_Critica + Bonus_Antena + Bonus_Recurrencia
    """
    base_impact = (max(1, unique_users_count) * 10.0) * max(1.0, zone_multiplier)

    if antenna_status in {"CAIDA", "INHABILITADA"}:
        antenna_bonus = 40.0
    elif antenna_status == "SATURADA":
        antenna_bonus = 25.0
    else:
        antenna_bonus = 0.0

    recurrence_bonus = 35.0 if structural_alert else 0.0

    total_score = round(base_impact + antenna_bonus + recurrence_bonus, 2)

    if total_score >= 150:
        level = "CRITICA"
    elif total_score >= 80:
        level = "ALTA"
    elif total_score >= 40:
        level = "MEDIA"
    else:
        level = "BAJA"

    return {
        "priority_score": total_score,
        "priority_level": level,
        "score_breakdown": {
            "base_impact": round(base_impact, 2),
            "antenna_bonus": antenna_bonus,
            "recurrence_bonus": recurrence_bonus,
        },
    }


def _persist_master_incident(record: Dict[str, Any]) -> None:
    """Crea o enriquece INCIDENT#<incident_id> (SK=META) en TeleCorp_Operaciones."""
    incident_id = record["incident_id"]
    score_int = int(round(record["priority_score"]))
    gsi1_sk = f"SCORE#{score_int:05d}"

    tabla_operaciones.update_item(
        Key={"PK": f"INCIDENT#{incident_id}", "SK": "META"},
        UpdateExpression="""
            SET incident_id = :iid,
                geohash = :gh,
                zone_name = :zn,
                trigger_type = :tt,
                affected_users_count = if_not_exists(affected_users_count, :users),
                critical_pois = :pois,
                priority_score = :pscore,
                priority_level = :plevel,
                #st = if_not_exists(#st, :status_default),
                ai_diagnosis = :diag,
                normalized_category = :cat,
                early_anomaly_detected = :early,
                structural_recurrence_alert = :rec_alert,
                ai_source = :aisrc,
                antenna_id = :aid,
                antenna_status = :ast,
                created_at = if_not_exists(created_at, :now),
                updated_at = :now,
                GSI1PK = :gsi1pk,
                GSI1SK = :gsi1sk
        """,
        ExpressionAttributeNames={"#st": "status"},
        ExpressionAttributeValues=_to_ddb(
            {
                ":iid": incident_id,
                ":gh": record["geohash"],
                ":zn": record["zone_name"],
                ":tt": record["trigger_type"],
                ":users": int(record["affected_users_count"]),
                ":pois": record["critical_pois"],
                ":pscore": record["priority_score"],
                ":plevel": record["priority_level"],
                ":status_default": "En revisión",
                ":diag": record["ai_executive_diagnosis"],
                ":cat": record["normalized_category"],
                ":early": bool(record["early_anomaly_detected"]),
                ":rec_alert": bool(record["structural_recurrence_alert"]),
                ":aisrc": record["ai_source"],
                ":aid": record.get("antenna_id") or "N/A",
                ":ast": record.get("antenna_status") or "DESCONOCIDO",
                ":now": record["updated_at"],
                ":gsi1pk": "ACTIVE#true",
                ":gsi1sk": gsi1_sk,
            }
        ),
    )


def _enrich_linked_tickets(
    geohash: str,
    incident_id: str,
    ai_category: str,
    priority_score: float,
    priority_level: str,
    now_iso: str,
) -> int:
    """Propaga categoría IA y prioridad a los tickets individuales vinculados al incidente."""
    updated_count = 0
    try:
        resp = tabla_operaciones.query(
            IndexName="GSI1_ZonaEstado",
            KeyConditionExpression=Key("GSI1PK").eq(f"ZONA#{geohash}")
            & Key("GSI1SK").begins_with("TS#"),
        )
        for item in resp.get("Items", []):
            if item.get("master_incident_id") == incident_id:
                tabla_operaciones.update_item(
                    Key={"PK": item["PK"], "SK": "META"},
                    UpdateExpression="""
                        SET ai_category = :cat,
                            priority_score = :pscore,
                            priority_level = :plevel,
                            updated_at = :now
                    """,
                    ExpressionAttributeValues=_to_ddb(
                        {
                            ":cat": ai_category,
                            ":pscore": priority_score,
                            ":plevel": priority_level,
                            ":now": now_iso,
                        }
                    ),
                )
                updated_count += 1
    except Exception as exc:
        logger.warning("No se pudieron actualizar tickets vinculados en zona %s: %s", geohash, exc)
    return updated_count


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Tarea P2.3: Puente Multi-Cloud AWS -> GCP Cloud Run (/ia/analizar) y Cálculo de Prioridad.
    Recibe el contexto acumulado de Step Functions (P2.1 + P2.2), enriquece con IA/OSM,
    calcula el score de criticidad y persiste el Incidente Maestro en DynamoDB.
    """
    logger.info("Evento recibido en enrich_and_score: %s", json.dumps(event, default=str))

    # Soporta payload plano o anidado si Step Functions usó ResultPath
    rec_block = event.get("recurrence") if isinstance(event.get("recurrence"), dict) else {}

    incident_id = event["incident_id"]
    geohash = event["geohash"]
    lat = float(event.get("lat", -12.0464))
    lon = float(event.get("lon", -77.0428))
    unique_users_count = int(event.get("unique_users_count", 1))
    trigger_type = event.get("trigger_type", "COLECTIVO_10")
    descriptions = event.get("descriptions") or event.get("sample_descriptions") or [
        "Reporte de interrupción de servicio en zona"
    ]

    antenna_id = event.get("antenna_id") or rec_block.get("antenna_id")
    antenna_traffic_gb = event.get("antenna_traffic_gb")
    if antenna_traffic_gb is None:
        antenna_traffic_gb = rec_block.get("antenna_traffic_gb")
    if antenna_traffic_gb is not None:
        antenna_traffic_gb = float(antenna_traffic_gb)

    structural_risk = bool(
        event.get("structural_risk", rec_block.get("structural_risk", False))
    )
    recent_failure_days = (
        event.get("recent_failure_days")
        or rec_block.get("recent_failure_days")
        or []
    )

    # Completar contexto de antena desde DynamoDB si falta estado o nombre de zona
    antenna_ctx = _fetch_antenna_context(geohash, antenna_id)
    antenna_id = antenna_id or antenna_ctx.get("antenna_id")
    zone_name = event.get("zone_name") or antenna_ctx.get("zone_name") or f"Zona {geohash}"

    if antenna_traffic_gb is None:
        antenna_traffic_gb = antenna_ctx.get("last_traffic_gb")

    antenna_status = (
        event.get("antenna_status")
        or rec_block.get("antenna_status")
        or antenna_ctx.get("health_status")
    )
    if not antenna_status or antenna_status == "DESCONOCIDO":
        antenna_status = _classify_traffic_threshold(antenna_traffic_gb)

    structural_risk = structural_risk or bool(antenna_ctx.get("structural_risk", False))

    # Construir request según contrato openapi.yaml -> AIAnalyzeRequest
    gcp_request_payload: Dict[str, Any] = {
        "geohash": geohash,
        "lat": lat,
        "lon": lon,
        "unique_users_count": unique_users_count,
        "descriptions": descriptions[:15],  # Límite razonable para prompt/latencia
    }
    if antenna_id:
        gcp_request_payload["antenna_id"] = antenna_id
    if antenna_traffic_gb is not None:
        gcp_request_payload["antenna_traffic_gb"] = antenna_traffic_gb
    if recent_failure_days:
        gcp_request_payload["recent_failure_days"] = recent_failure_days

    # Invocar GCP Cloud Run con fallback resiliente
    creds = _get_gcp_credentials()
    ai_result = _call_gcp_ai(gcp_request_payload, creds)
    if ai_result is not None:
        ai_source = "GCP_GEMINI_OSM"
    else:
        ai_source = "FALLBACK_LOCAL"
        ai_result = _local_resilient_fallback(
            descriptions=descriptions,
            unique_users_count=unique_users_count,
            antenna_id=antenna_id,
            antenna_status=antenna_status,
            recent_failure_days=recent_failure_days,
            structural_risk=structural_risk,
        )

    zone_multiplier = float(ai_result.get("zone_criticality_multiplier", 1.0))
    structural_alert = bool(
        ai_result.get("structural_recurrence_alert", False) or structural_risk
    )
    early_anomaly_detected = bool(ai_result.get("early_anomaly_detected", False))
    critical_pois = ai_result.get("critical_pois", [])
    normalized_category = ai_result.get("normalized_category", "INCIDENCIA_GENERAL_SERVICIO")
    ai_diagnosis = ai_result.get(
        "ai_executive_diagnosis", "Incidencia zonal en evaluación."
    )

    # Calcular score y nivel de prioridad
    priority = _compute_priority(
        unique_users_count=unique_users_count,
        zone_multiplier=zone_multiplier,
        antenna_status=antenna_status,
        structural_alert=structural_alert,
    )

    now_iso = _now_iso()
    master_record = {
        "incident_id": incident_id,
        "geohash": geohash,
        "zone_name": zone_name,
        "trigger_type": trigger_type,
        "affected_users_count": unique_users_count,
        "critical_pois": critical_pois,
        "priority_score": priority["priority_score"],
        "priority_level": priority["priority_level"],
        "ai_executive_diagnosis": ai_diagnosis,
        "normalized_category": normalized_category,
        "early_anomaly_detected": early_anomaly_detected,
        "structural_recurrence_alert": structural_alert,
        "ai_source": ai_source,
        "antenna_id": antenna_id,
        "antenna_status": antenna_status,
        "updated_at": now_iso,
    }

    _persist_master_incident(master_record)
    tickets_updated = _enrich_linked_tickets(
        geohash=geohash,
        incident_id=incident_id,
        ai_category=normalized_category,
        priority_score=priority["priority_score"],
        priority_level=priority["priority_level"],
        now_iso=now_iso,
    )

    # Salida consolidada para los siguientes estados de Step Functions (P2.4 y P2.5)
    output = {
        **event,
        "incident_id": incident_id,
        "geohash": geohash,
        "zone_name": zone_name,
        "trigger_type": trigger_type,
        "affected_users_count": unique_users_count,
        "antenna_id": antenna_id,
        "antenna_status": antenna_status,
        "antenna_traffic_gb": antenna_traffic_gb,
        "structural_risk": structural_alert,
        "recent_failure_days": recent_failure_days,
        "normalized_category": normalized_category,
        "semantic_cluster_confidence": float(
            ai_result.get("semantic_cluster_confidence", 0.85)
        ),
        "early_anomaly_detected": early_anomaly_detected,
        "critical_pois": critical_pois,
        "zone_criticality_multiplier": zone_multiplier,
        "structural_recurrence_alert": structural_alert,
        "ai_executive_diagnosis": ai_diagnosis,
        "ai_source": ai_source,
        "priority_score": priority["priority_score"],
        "priority_level": priority["priority_level"],
        "score_breakdown": priority["score_breakdown"],
        "tickets_enriched_count": tickets_updated,
        "enriched_at": now_iso,
    }

    logger.info(
        "Incidente %s enriquecido: score=%s (%s), source=%s, tickets_actualizados=%s",
        incident_id,
        priority["priority_score"],
        priority["priority_level"],
        ai_source,
        tickets_updated,
    )
    return output
