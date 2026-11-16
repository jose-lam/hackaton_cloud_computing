# Despliegue del servicio IA en Azure Container Apps

El servicio corre en **Azure Container Apps**. El modelo sigue siendo Gemini, que se llama a través de la **API de Google AI Studio** (solo hace falta `GEMINI_API_KEY`).

- URL actual: https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io
- Imagen: `ghcr.io/valdiviezojr/telecorp-ia:<tag>` (paquete público en GHCR)

> No escribas keys reales en este archivo ni en el repo. Usa `<X_API_KEY>` y `<GEMINI_API_KEY>` como marcadores.

## 1. Construir y subir la imagen (desde `ia-azure/`)

ACR Tasks (`az acr build`) no está disponible en Azure for Students, así que la imagen se construye en local y se sube a GHCR.

```bash
docker build -t ghcr.io/valdiviezojr/telecorp-ia:<tag> .
docker push ghcr.io/valdiviezojr/telecorp-ia:<tag>
```

El paquete debe ser **público** en GHCR para que Container Apps lo descargue sin credenciales.

## 2. Grupo de recursos y entorno

```bash
az group create -n rg-telecorp -l eastus2

# eastus2 está bloqueada por la política de Azure for Students; westus2 funcionó.
az containerapp env create -n telecorp-env -g rg-telecorp -l westus2 --logs-destination none
```

## 3. Crear la Container App

```bash
az containerapp create -n telecorp-ia -g rg-telecorp \
  --environment telecorp-env \
  --image ghcr.io/valdiviezojr/telecorp-ia:1 \
  --target-port 8080 --ingress external \
  --min-replicas 0 --max-replicas 3 \
  --secrets api-key=<X_API_KEY> gemini-key=<GEMINI_API_KEY> \
  --env-vars API_KEY=secretref:api-key GEMINI_API_KEY=secretref:gemini-key PORT=8080
```

## 4. Probar

```bash
URL=https://telecorp-ia.ambitiouspebble-a4a0a323.westus2.azurecontainerapps.io

curl -s "$URL/health"

curl -s -X POST "$URL/ia/analizar" \
  -H "Content-Type: application/json" -H "X-API-Key: <X_API_KEY>" \
  -d '{
    "geohash": "6mc5p8", "lat": -12.0464, "lon": -77.0428,
    "unique_users_count": 3,
    "descriptions": ["Internet muerto cerca al hospital", "Sin datos móviles desde hace una hora", "No carga nada, cero internet en el celular"],
    "antenna_id": "ANT-LIM-042", "antenna_traffic_gb": 61.5,
    "recent_failure_days": ["2026-11-10", "2026-11-12", "2026-11-14"]
  }'
```

También puedes usar `BASE_URL=$URL API_KEY=<X_API_KEY> ./test_local.sh`.

## Notas

- **Antes de la demo**, sube a `--min-replicas 1` para evitar el arranque en frío:
  `az containerapp update -n telecorp-ia -g rg-telecorp --min-replicas 1`
- Los parámetros SSM `/telecorp/gcp/endpoint_url` y `/telecorp/gcp/api_key` conservan su nombre histórico (el servicio corre en Azure); la URL de arriba es la que va en `endpoint_url`.
