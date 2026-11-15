"""Consulta de POIs críticos alrededor de un punto usando OpenStreetMap (Overpass API).

Devuelve los POIs críticos (hospitales, clínicas, colegios, universidades, zonas
industriales) en un radio de 500 m y el multiplicador de criticidad de la zona.
Si Overpass falla o tarda más de 3 s se usa un respaldo estático de POIs demo.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Any

import httpx

logger = logging.getLogger("telecorp.geo_osm")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
RADIUS_M = 500
OVERPASS_TIMEOUT_S = 3.0
CACHE_TTL_S = 3600
MAX_POIS = 5
USER_AGENT = "telecorp-sentinel-ai/1.0"

MULTIPLIERS: dict[str, float] = {
    "hospital": 3.0,
    "clinic": 3.0,
    "doctors": 3.0,
    "school": 2.2,
    "university": 2.2,
    "industrial": 2.0,
}
DEFAULT_MULTIPLIER = 1.0

# Respaldo estático (demo) para cuando Overpass no responde.
STATIC_POIS: list[dict[str, Any]] = [
    {"name": "Hospital Nacional Arzobispo Loayza", "type": "hospital", "lat": -12.0464, "lon": -77.0428},
    {"name": "Hospital Nacional Dos de Mayo", "type": "hospital", "lat": -12.0563, "lon": -77.0160},
    {"name": "Clínica Internacional - Sede Lima", "type": "clinic", "lat": -12.0656, "lon": -77.0371},
    {"name": "Universidad Nacional Mayor de San Marcos", "type": "university", "lat": -12.0560, "lon": -77.0844},
    {"name": "Colegio Nuestra Señora de Guadalupe", "type": "school", "lat": -12.0573, "lon": -77.0370},
    {"name": "Parque Industrial de Villa El Salvador", "type": "industrial", "lat": -12.2140, "lon": -76.9360},
]

# geohash -> (timestamp, (pois, multiplier))
_cache: dict[str, tuple[float, tuple[list[dict[str, Any]], float]]] = {}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _finalize(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], float]:
    """Deduplica, ordena por distancia, corta a MAX_POIS y calcula el multiplicador máximo."""
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, Any]] = []
    for poi in sorted(candidates, key=lambda p: p["distance_m"]):
        key = (poi["name"].lower(), poi["type"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(poi)
    pois = unique[:MAX_POIS]
    multiplier = max((MULTIPLIERS.get(p["type"], DEFAULT_MULTIPLIER) for p in unique), default=DEFAULT_MULTIPLIER)
    return pois, multiplier


def _static_fallback(lat: float, lon: float) -> tuple[list[dict[str, Any]], float]:
    candidates = []
    for poi in STATIC_POIS:
        d = haversine_m(lat, lon, poi["lat"], poi["lon"])
        if d <= RADIUS_M:
            candidates.append({"name": poi["name"], "type": poi["type"], "distance_m": int(round(d))})
    return _finalize(candidates)


def _build_query(lat: float, lon: float) -> str:
    around = f"around:{RADIUS_M},{lat:.6f},{lon:.6f}"
    return (
        "[out:json][timeout:3];("
        f'node["amenity"~"^(hospital|clinic|doctors|school|university)$"]({around});'
        f'way["amenity"~"^(hospital|clinic|doctors|school|university)$"]({around});'
        f'node["landuse"="industrial"]({around});'
        f'way["landuse"="industrial"]({around});'
        ");out tags center 60;"
    )


def _parse_elements(lat: float, lon: float, elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = []
    for el in elements:
        tags = el.get("tags") or {}
        amenity = tags.get("amenity")
        if amenity in MULTIPLIERS:
            poi_type = amenity
        elif tags.get("landuse") == "industrial":
            poi_type = "industrial"
        else:
            continue
        el_lat = el.get("lat", (el.get("center") or {}).get("lat"))
        el_lon = el.get("lon", (el.get("center") or {}).get("lon"))
        if el_lat is None or el_lon is None:
            continue
        d = haversine_m(lat, lon, float(el_lat), float(el_lon))
        if d > RADIUS_M:
            continue
        name = (tags.get("name") or tags.get("official_name") or f"{poi_type} sin nombre").strip()[:120]
        candidates.append({"name": name, "type": poi_type, "distance_m": int(round(d))})
    return candidates


async def _query_overpass(lat: float, lon: float) -> tuple[list[dict[str, Any]], float]:
    async with httpx.AsyncClient(timeout=OVERPASS_TIMEOUT_S, headers={"User-Agent": USER_AGENT}) as client:
        resp = await client.post(OVERPASS_URL, data={"data": _build_query(lat, lon)})
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
    return _finalize(_parse_elements(lat, lon, elements))


async def consulta_poi(lat: float, lon: float, geohash: str) -> tuple[list[dict[str, Any]], float]:
    """Devuelve (critical_pois ordenados por distancia, zone_criticality_multiplier). Nunca lanza."""
    cache_key = geohash or f"{lat:.4f},{lon:.4f}"
    now = time.monotonic()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL_S:
        logger.info("poi_cache_hit", extra={"geohash": cache_key})
        return cached[1]

    try:
        # wait_for como red de seguridad: httpx aplica el timeout por operación, no total.
        result = await asyncio.wait_for(_query_overpass(lat, lon), timeout=OVERPASS_TIMEOUT_S)
        _cache[cache_key] = (now, result)
        logger.info("poi_overpass_ok", extra={"geohash": cache_key, "poi_count": len(result[0])})
        return result
    except Exception as exc:  # noqa: BLE001 - cualquier fallo -> respaldo estático
        logger.error("poi_overpass_failed", extra={"geohash": cache_key, "error_type": type(exc).__name__})
        return _static_fallback(lat, lon)
