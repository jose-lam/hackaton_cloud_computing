"""Red TeleCorp Sentinel AI - microservicio de IA (Google Cloud Run).

Variables de entorno:
  API_KEY         clave compartida que el llamador envía en X-API-Key (obligatoria)
  GEMINI_API_KEY  clave de Gemini (si falta se usa el fallback sin IA)
  MOCK_MODE       "true" para devolver el JSON de ejemplo sin servicios externos
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import sys
import time
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

import gemini_engine
import geo_osm

# ---------------------------------------------------------------------------
# Logging JSON a stdout (Cloud Logging interpreta "severity")
# ---------------------------------------------------------------------------

_SAFE_EXTRA_FIELDS = (
    "geohash", "poi_count", "error_type", "descriptions_count", "unique_users_count",
    "antenna_id", "ai_source", "multiplier", "category", "duration_ms", "mock",
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in _SAFE_EXTRA_FIELDS:  # lista blanca: nunca se registran descripciones ni claves
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        return json.dumps(entry, ensure_ascii=False)


def _setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for noisy in ("httpx", "httpx2", "httpcore", "google_genai", "google"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


_setup_logging()
logger = logging.getLogger("telecorp.main")

TOTAL_BUDGET_S = 5.5  # el llamador corta a los 8 s

# ---------------------------------------------------------------------------
# Modelos (contrato)
# ---------------------------------------------------------------------------

MAX_DESCRIPTIONS = 20
MAX_DESCRIPTION_CHARS = 300
MAX_FAILURE_DAYS = 60


class AnalisisRequest(BaseModel):
    geohash: str = Field(..., min_length=1, max_length=12)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    unique_users_count: int = Field(0, ge=0)
    descriptions: list[str] = Field(default_factory=list)
    antenna_id: str | None = Field(None, max_length=64)
    antenna_traffic_gb: float | None = Field(None, ge=0)
    recent_failure_days: list[str] = Field(default_factory=list)

    @field_validator("descriptions", mode="before")
    @classmethod
    def _limit_descriptions(cls, v: Any) -> Any:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(d)[:MAX_DESCRIPTION_CHARS] for d in v[:MAX_DESCRIPTIONS] if d is not None and str(d).strip()]
        return v

    @field_validator("recent_failure_days", mode="before")
    @classmethod
    def _limit_days(cls, v: Any) -> Any:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(d)[:10] for d in v[:MAX_FAILURE_DAYS]]
        return v


class CriticalPoi(BaseModel):
    name: str
    type: str
    distance_m: int


class AnalisisResponse(BaseModel):
    normalized_category: Literal["CORTE_TOTAL_DATOS", "SIN_SENAL", "INTERNET_LENTO", "FALLA_LLAMADAS", "OTRO"]
    semantic_cluster_confidence: float
    early_anomaly_detected: bool
    critical_pois: list[CriticalPoi]
    zone_criticality_multiplier: float
    structural_recurrence_alert: bool
    ai_executive_diagnosis: str


MOCK_RESPONSE: dict[str, Any] = {
    "normalized_category": "CORTE_TOTAL_DATOS",
    "semantic_cluster_confidence": 0.94,
    "early_anomaly_detected": True,
    "critical_pois": [{"name": "Hospital Nacional Arzobispo Loayza", "type": "hospital", "distance_m": 180}],
    "zone_criticality_multiplier": 3.0,
    "structural_recurrence_alert": True,
    "ai_executive_diagnosis": (
        "Corte total de datos en la zona del Hospital Loayza atribuible a ANT-LIM-042 (61.5 GB), "
        "con fallas el 10, 12 y 14 de noviembre. Despachar cuadrilla prioritaria y evaluar reemplazo del equipo."
    ),
}

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Red TeleCorp Sentinel AI", version="1.0.0")


def _mock_mode() -> bool:
    return os.environ.get("MOCK_MODE", "false").strip().lower() in ("1", "true", "yes")


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    expected = os.environ.get("API_KEY", "")
    if not expected:
        logger.error("api_key_not_configured")
    if not expected or not x_api_key or not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ia/analizar", response_model=AnalisisResponse, dependencies=[Depends(verify_api_key)])
async def analizar(req: AnalisisRequest) -> dict[str, Any]:
    started = time.perf_counter()

    if _mock_mode():
        logger.info("analisis_mock", extra={"geohash": req.geohash, "mock": True})
        return MOCK_RESPONSE

    failure_days = req.recent_failure_days
    geo_task = geo_osm.consulta_poi(req.lat, req.lon, req.geohash)
    ai_task = gemini_engine.analizar(req.descriptions, req.antenna_id, req.antenna_traffic_gb, failure_days)

    try:
        (pois, multiplier), (ai, ai_source) = await asyncio.wait_for(
            asyncio.gather(geo_task, ai_task), timeout=TOTAL_BUDGET_S
        )
    except Exception as exc:  # noqa: BLE001 - red de seguridad: nunca 500 por dependencias externas
        logger.error("analisis_budget_exceeded", extra={"geohash": req.geohash, "error_type": type(exc).__name__})
        pois, multiplier = geo_osm._static_fallback(req.lat, req.lon)
        ai = gemini_engine.fallback_analysis(req.descriptions, req.antenna_id, req.antenna_traffic_gb, failure_days)
        ai_source = "fallback"

    response = {
        "normalized_category": ai["normalized_category"],
        "semantic_cluster_confidence": ai["semantic_cluster_confidence"],
        "early_anomaly_detected": ai["early_anomaly_detected"],
        "critical_pois": pois,
        "zone_criticality_multiplier": multiplier,
        # Regla de negocio calculada en código, no por la IA.
        "structural_recurrence_alert": len(failure_days) >= 3,
        "ai_executive_diagnosis": ai["ai_executive_diagnosis"],
    }

    logger.info(
        "analisis_ok",
        extra={
            "geohash": req.geohash,
            "descriptions_count": len(req.descriptions),
            "unique_users_count": req.unique_users_count,
            "antenna_id": req.antenna_id,
            "ai_source": ai_source,
            "category": response["normalized_category"],
            "multiplier": multiplier,
            "poi_count": len(pois),
            "duration_ms": int((time.perf_counter() - started) * 1000),
        },
    )
    return response
