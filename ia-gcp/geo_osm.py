"""Consulta de POIs críticos alrededor de un punto usando OpenStreetMap (Overpass API).

Devuelve los POIs críticos (hospitales, clínicas, colegios, universidades, zonas
industriales) en un radio de 500 m y el multiplicador de criticidad de la zona.
Consulta dos espejos de Overpass en paralelo (gana el primero válido). Si ambos fallan
o tardan más de 2,5 s en total se usa un respaldo estático de POIs demo.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Any

import httpx

logger = logging.getLogger("telecorp.geo_osm")

# Espejos consultados en paralelo: gana la primera respuesta 200 válida.
OVERPASS_MIRRORS: tuple[str, ...] = (
    "https://overpass.openstreetmap.fr/api/interpreter",  # principal
    "https://overpass-api.de/api/interpreter",  # secundario
)
RADIUS_M = 500
OVERPASS_TIMEOUT_S = 2.5  # timeout total (ambos espejos)
CACHE_TTL_S = 3600
MAX_POIS = 5
USER_AGENT = "TeleCorpSentinel/1.0 (hackathon UTEC)"

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
        "[out:json][timeout:5];("
        f'nwr({around})[amenity~"hospital|clinic|doctors|school|university"];'
        f"nwr({around})[landuse=industrial];"
        ");out center 30;"
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


class OverpassInvalidResponse(Exception):
    pass


async def _query_mirror(client: httpx.AsyncClient, url: str, query: str) -> tuple[list[dict[str, Any]], str]:
    """Consulta un espejo. Solo devuelve si la respuesta es 200 con JSON válido; si no, lanza."""
    resp = await client.post(url, data={"data": query})
    if resp.status_code != 200:
        raise OverpassInvalidResponse(f"HTTP {resp.status_code}")
    payload = resp.json()
    elements = payload.get("elements") if isinstance(payload, dict) else None
    if not isinstance(elements, list):
        raise OverpassInvalidResponse("sin elements")
    # Overpass puede responder 200 con un error de ejecución en "remark".
    if not elements and "error" in str(payload.get("remark", "")).lower():
        raise OverpassInvalidResponse("remark con error")
    return elements, httpx.URL(url).host


async def _query_overpass(lat: float, lon: float) -> tuple[tuple[list[dict[str, Any]], float], str]:
    """Lanza todos los espejos en paralelo; gana la primera respuesta válida y se cancelan las demás."""
    query = _build_query(lat, lon)
    async with httpx.AsyncClient(timeout=OVERPASS_TIMEOUT_S, headers={"User-Agent": USER_AGENT}) as client:
        pending = {asyncio.create_task(_query_mirror(client, url, query)) for url in OVERPASS_MIRRORS}
        last_exc: BaseException | None = None
        try:
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    if task.exception() is None:
                        elements, mirror = task.result()
                        return _finalize(_parse_elements(lat, lon, elements)), mirror
                    last_exc = task.exception()
        finally:
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
    raise last_exc or OverpassInvalidResponse("ningún espejo respondió")


async def consulta_poi(lat: float, lon: float, geohash: str) -> tuple[list[dict[str, Any]], float]:
    """Devuelve (critical_pois ordenados por distancia, zone_criticality_multiplier). Nunca lanza."""
    cache_key = geohash or f"{lat:.4f},{lon:.4f}"
    now = time.monotonic()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL_S:
        logger.info("poi_cache_hit", extra={"geohash": cache_key})
        return cached[1]

    try:
        # wait_for impone el timeout total: httpx lo aplica por operación, no por petición completa.
        result, mirror = await asyncio.wait_for(_query_overpass(lat, lon), timeout=OVERPASS_TIMEOUT_S)
        _cache[cache_key] = (now, result)
        logger.info(
            "poi_overpass_ok",
            extra={"geohash": cache_key, "poi_count": len(result[0]), "overpass_mirror": mirror},
        )
        return result
    except Exception as exc:  # noqa: BLE001 - cualquier fallo -> respaldo estático
        logger.error("poi_overpass_failed", extra={"geohash": cache_key, "error_type": type(exc).__name__})
        return _static_fallback(lat, lon)
