// Configuración pública del frontend. NO colocar secretos ni claves aquí:
// este archivo se sirve tal cual desde S3/CloudFront.
export const CONFIG = {
  // URL base del API Gateway, p. ej. "https://abc123.execute-api.us-east-1.amazonaws.com/prod"
  API_BASE_URL: "",
  // true = usa datos simulados en memoria (mock.js) en lugar del API real
  MOCK_MODE: true,
  // Intervalo de refresco del NOC en milisegundos
  POLL_MS: 8000,
};

// El modo mock también se puede forzar con ?mock=1 (o desactivar con ?mock=0).
try {
  const flag = new URLSearchParams(window.location.search).get("mock");
  if (flag === "1") CONFIG.MOCK_MODE = true;
  if (flag === "0") CONFIG.MOCK_MODE = false;
} catch {
  /* entorno sin window.location: se mantiene la configuración por defecto */
}
