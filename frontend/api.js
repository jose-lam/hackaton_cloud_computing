// Cliente REST único. Si CONFIG.MOCK_MODE está activo delega en mock.js.
// Normaliza las respuestas para tolerar campos extra y pequeñas variantes del
// contrato (p. ej. GET /tickets como arreglo o como { items: [...] }).
import { CONFIG } from "./config.js";
import { decodeGeohash } from "./app.js";
import * as mock from "./mock.js";

const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const STATUS_MESSAGES = {
  400: "Los datos enviados no son válidos.",
  401: "No autorizado.",
  403: "Acceso denegado o recurso no disponible.",
  404: "No se encontró el recurso solicitado.",
  429: "Demasiadas solicitudes. Espera unos segundos.",
  500: "Error interno del servidor.",
  502: "El servidor no respondió correctamente.",
  503: "Servicio no disponible temporalmente.",
  504: "El servidor tardó demasiado en responder.",
};

function buildUrl(path, query) {
  const base = String(CONFIG.API_BASE_URL || "").replace(/\/+$/, "");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, String(v).trim());
  }
  const q = qs.toString();
  return `${base}${path}${q ? `?${q}` : ""}`;
}

async function request(method, path, { query, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw new ApiError("La solicitud superó el tiempo límite (8 s).", 0);
    throw new ApiError("No se pudo conectar con el servidor. Revisa tu conexión.", 0);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const serverMsg = data && typeof data === "object" ? (data.message || data.error || data.detail) : null;
    throw new ApiError(
      typeof serverMsg === "string" && serverMsg.length < 200 ? serverMsg : (STATUS_MESSAGES[res.status] || `Error ${res.status}`),
      res.status, data,
    );
  }
  return data;
}

/** Envuelve llamadas al mock para que lancen ApiError igual que el modo real. */
async function viaMock(fn) {
  try {
    return await fn();
  } catch (err) {
    throw new ApiError(err.message || "Error simulado", err.status || 500);
  }
}

// ---------- Normalizadores ----------
const asList = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of ["items", "data", ...keys]) if (Array.isArray(data[k])) return data[k];
  }
  return [];
};

function normalizeTicket(t) {
  return {
    ...t,
    history: asList(t && t.history).map((h) => ({ ...h, ts: h.ts || h.timestamp || h.changed_at || null })),
  };
}

function normalizeAnalytics(d) {
  const k = (d && d.kpis) || {};
  d = d || {};
  return {
    ...d,
    top_zones: asList(d.top_zones).map((z) => ({
      ...z,
      zone_name: z.zone_name || z.geohash || "Sin zona",
      count: Number(z.count ?? z.incident_count ?? 0),
    })),
    problem_types: asList(d.problem_types ?? d.top_problem_types).map((p) => ({
      ...p,
      type: p.type || p.problem_type || "OTRO",
      count: Number(p.count ?? 0),
    })),
    recurrent_antennas: asList(d.recurrent_antennas),
    mttr_minutes: d.mttr_minutes ?? k.avg_mttr_minutes ?? null,
    affected_users_total: d.affected_users_total ?? k.total_affected_users ?? null,
    active_incidents: k.active_incidents ?? null,
    master_incidents: asList(d.master_incidents),
  };
}

// ---------- Endpoints ----------
/** POST /tickets -> { ticket_id, status, geohash } */
export function createTicket(payload) {
  if (CONFIG.MOCK_MODE) return viaMock(() => mock.createTicket(payload));
  return request("POST", "/tickets", { body: payload });
}

/** GET /tickets?user_id&ticket_id&geohash -> lista normalizada */
export async function getTickets(params = {}) {
  const data = CONFIG.MOCK_MODE
    ? await viaMock(() => mock.getTickets(params))
    : await request("GET", "/tickets", { query: params });
  return asList(data, "tickets").map(normalizeTicket);
}

/** PATCH /tickets/{id}/estado. Envía new_status (OpenAPI) y status (por compatibilidad). */
export function updateTicketStatus(ticketId, status, note = "") {
  const body = { new_status: status, status, note, changed_by: "OPERADOR" };
  if (CONFIG.MOCK_MODE) return viaMock(() => mock.updateTicketStatus(ticketId, body));
  return request("PATCH", `/tickets/${encodeURIComponent(ticketId)}/estado`, { body });
}

/** GET /analytics/resumen */
export async function getAnalytics() {
  const data = CONFIG.MOCK_MODE
    ? await viaMock(() => mock.getAnalytics())
    : await request("GET", "/analytics/resumen");
  return normalizeAnalytics(data);
}

/**
 * GET /incidentes (propuesto). Si la ruta aún no existe (403/404 de API Gateway),
 * usa master_incidents de /analytics/resumen como respaldo.
 */
export async function getIncidents() {
  if (CONFIG.MOCK_MODE) return asList(await viaMock(() => mock.getIncidents()), "incidents");
  try {
    return asList(await request("GET", "/incidentes"), "incidents", "incidentes");
  } catch (err) {
    if (err.status === 403 || err.status === 404) return (await getAnalytics()).master_incidents;
    throw err;
  }
}

/** GET /antenas (propuesto) */
export async function getAntennas() {
  if (CONFIG.MOCK_MODE) return asList(await viaMock(() => mock.getAntennas()), "antennas", "antenas");
  try {
    return asList(await request("GET", "/antenas"), "antennas", "antenas");
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      const { recurrent_antennas } = await getAnalytics();
      return recurrent_antennas.map((a) => ({ ...decodeGeohash(a.geohash), ...a }));
    }
    throw err;
  }
}

/**
 * Cambia el estado de un incidente maestro aplicando PATCH a sus tickets asociados
 * (no existe aún un endpoint de estado para incidentes en el contrato).
 * Devuelve { updated: [...ids], failed: [...ids] }.
 */
export async function updateIncidentStatus(incident, status, note = "") {
  let ids = Array.isArray(incident.ticket_ids) ? incident.ticket_ids : null;
  if (!ids || !ids.length) {
    const tickets = incident.geohash ? await getTickets({ geohash: incident.geohash }) : [];
    ids = tickets
      .filter((t) => !t.master_incident_id || t.master_incident_id === incident.incident_id)
      .map((t) => t.ticket_id);
  }
  if (!ids.length) throw new ApiError("El incidente no tiene tickets asociados para actualizar.", 404);
  // Un reintento por ticket ante fallos transitorios
  const patchWithRetry = (id) => updateTicketStatus(id, status, note)
    .catch((err) => (err.status === 0 || err.status >= 500 ? updateTicketStatus(id, status, note) : Promise.reject(err)));
  const results = await Promise.allSettled(ids.map(patchWithRetry));
  const updated = [], failed = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? updated : failed).push(ids[i]));
  if (!updated.length) {
    const firstErr = results.find((r) => r.status === "rejected");
    throw firstErr ? firstErr.reason : new ApiError("No se pudo actualizar el incidente.");
  }
  return { updated, failed };
}

export const isMockMode = () => Boolean(CONFIG.MOCK_MODE);
