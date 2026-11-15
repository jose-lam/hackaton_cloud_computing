# Frontend · Red TeleCorp Sentinel AI

SPA en Vite + React 18 + TypeScript + Tailwind, con HashRouter (funciona en S3/CloudFront sin reglas de rewrite).

- **Instalar y correr:** `cd frontend && npm install && npm run dev`, luego abre http://localhost:5173/#/ (portal ciudadano), `#/seguimiento` o `#/noc` (centro de operaciones).
- **Build estático:** `npm run build` genera `dist/` (base `./`). Revisa con `npm run preview`. Calidad: `npm run lint` y `npm run typecheck`.
- **Variables:** `npm run dev` usa el mock; `npm run build` usa `.env.production` (API real de AWS). Para otro entorno copia `.env.example` a `.env`. `VITE_API_BASE_URL` es la URL del API Gateway sin `/` final. `VITE_MOCK` usa `true` (por defecto) para el backend simulado o `false` para el API real. `VITE_CARTO_API_KEY` (opcional, gratis en dashboard.basemaps.carto.com) activa los mapas de CARTO; sin ella se usa OpenStreetMap. Se leen al compilar: vuelve a ejecutar `npm run build` tras cambiarlas.
- **En la URL:** `?mock=1` o `?mock=0` fuerza el modo; `?mockerr=0` desactiva los errores simulados y `?mockerr=1` fuerza fallos para ver los estados de error.
- **Demo:** ticket `TCK-DEMO01`, usuario `U-1001`. Cada ~20 s llega un reporte nuevo y cada ~100 s nace un incidente. `#/noc?incidente=INC-001` abre el detalle.
- **Atajos:** Ctrl+K (⌘K en Mac) abre la paleta de comandos; Esc cierra paneles.
- **Contrato:** tipos y cliente siguen `contratos/openapi.yaml`. `GET /incidentes` y `GET /antenas` son propuestos (TODO): sin ellos el NOC usa `master_incidents` y `recurrent_antennas` de `/analytics/resumen`.
- **Despliegue:** `aws s3 sync dist/ s3://<bucket> --delete` e invalida CloudFront. API Gateway debe permitir CORS desde ese origen.
