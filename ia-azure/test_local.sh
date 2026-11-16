#!/usr/bin/env bash
# Pruebas locales del microservicio IA de Red TeleCorp Sentinel AI.
#
# 1) Arranca el servicio en otra terminal (desde ia-azure/):
#      export API_KEY=...  GEMINI_API_KEY=...   # opcional: MOCK_MODE=true
#      uvicorn main:app --port 8080
# 2) Ejecuta:  API_KEY=... ./test_local.sh
set -u

BASE_URL="${BASE_URL:-http://localhost:8080}"
API_KEY="${API_KEY:?Define API_KEY en el entorno (la misma que usa el servidor)}"

echo "== 1) Sin X-API-Key -> se espera 401"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE_URL/ia/analizar" \
  -H "Content-Type: application/json" \
  -d '{"geohash":"6mc5p8","lat":-12.0464,"lon":-77.0428,"unique_users_count":1,"descriptions":["test"]}'

echo
echo "== 2) Hospital Loayza, 3 descripciones similares -> early_anomaly_detected=true, multiplier=3.0"
curl -s -X POST "$BASE_URL/ia/analizar" \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -w "\nHTTP %{http_code} en %{time_total}s\n" \
  -d '{
    "geohash": "6mc5p8", "lat": -12.0464, "lon": -77.0428,
    "unique_users_count": 3,
    "descriptions": ["Internet muerto cerca al hospital", "Sin datos móviles desde hace una hora", "No carga nada, cero internet en el celular"],
    "antenna_id": "ANT-LIM-042", "antenna_traffic_gb": 61.5,
    "recent_failure_days": ["2026-11-10", "2026-11-12", "2026-11-14"]
  }'

echo
echo "== 3) Zona residencial sin POIs, 1 descripción -> multiplier=1.0"
# Coordenada en zona de lomas al sur-este de Lima, sin POIs críticos a <=500 m en OSM.
curl -s -X POST "$BASE_URL/ia/analizar" \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -w "\nHTTP %{http_code} en %{time_total}s\n" \
  -d '{
    "geohash": "6mc6e7", "lat": -12.1985, "lon": -76.8410,
    "unique_users_count": 1,
    "descriptions": ["El internet está muy lento en la noche"]
  }'
