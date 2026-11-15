# Frontend · Red TeleCorp Sentinel AI

Web estática (HTML + Tailwind CDN + JS vanilla + Chart.js + Leaflet), sin build. Lista para S3 + CloudFront.

- **Correr local:** `cd frontend && python3 -m http.server 8000` y abrir http://localhost:8000/?mock=1 (portal) o http://localhost:8000/noc.html?mock=1 (NOC).
- **Modo demo:** `MOCK_MODE: true` en `config.js` o `?mock=1` en la URL. Usa `?mock=0` para forzar el API real y `?mockerr=0` para desactivar los errores simulados.
- **Datos demo:** ticket `TCK-DEMO01`, usuario `U-1001`. Se guardan en localStorage (clave `telecorp_sentinel_mock_v1`); bórrala para reiniciar.
- **API real:** edita `config.js` → `API_BASE_URL: "https://<apiId>.execute-api.us-east-1.amazonaws.com/prod"` y `MOCK_MODE: false`. Sin secretos en el front.
- **CORS:** API Gateway debe permitir el origen de CloudFront para `GET`, `POST` y `PATCH`.
- **Archivos:** `index.html` + `portal.js` (ciudadano), `noc.html` + `noc.js` (NOC), `api.js` (cliente REST, timeout 8 s), `mock.js`, `app.js` (utilidades), `styles.css`.
- **Contrato:** el PATCH envía `new_status` (OpenAPI) y `status`. GET acepta un arreglo o `{items}`. Si `/incidentes` no existe, se usan los `master_incidents` de `/analytics/resumen`.
- **Despliegue:** `aws s3 sync frontend/ s3://<bucket> --exclude "*.md"` e invalidar CloudFront.
