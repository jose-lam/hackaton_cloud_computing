// Punto único de acceso a datos. El API real y el mock comparten este cliente: ambos reciben las
// mismas peticiones HTTP (método + ruta + cuerpo) y devuelven los cuerpos del contrato
// (contratos/openapi.yaml), que luego pasan por los mismos normalizadores.
import { CONFIG } from "../config";
import type { Incident, SentinelApi, Ticket, TicketCreateResponse, TicketStatus, TicketStatusUpdateRequest } from "../../types";
import { ApiError, request, withRetry, type Requester } from "./http";
import { antennasFromRecurrent, normalizeAnalytics, normalizeAntenna, normalizeCreateResponse, normalizeIncident, normalizeList, normalizeTicketList } from "./normalize";
import { mockRequest } from "../mock/adapter";

/** Reescribe el mensaje de los códigos de error que el contrato documenta para cada operación. */
async function withContractErrors<T>(p: Promise<T>, messages: Partial<Record<number, string>>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    const msg = messages[err.status];
    // Mensaje del contrato + detalle del servidor ({ "error": "Falta lat" }) cuando existe
    throw msg ? new ApiError(err.detail ? `${msg} Detalle: ${err.detail}.` : msg, err.status, err.retriable, err.detail) : err;
  }
}

/** API Gateway responde 403/404 cuando la ruta no está desplegada. */
const isMissingRoute = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 403);
/** Rutas propuestas que ya respondieron 403/404: no se vuelven a pedir en cada refresco. */
const missingRoutes = new Set<string>();

export function createApi(send: Requester): SentinelApi {
  const getAnalytics: SentinelApi["getAnalytics"] = async (signal) =>
    normalizeAnalytics(await withRetry(() => send<unknown>("GET", "/analytics/resumen", { signal }), { signal }));

  return {
    // POST /tickets → 202 TicketCreateResponse · 400 datos inválidos. No es idempotente: sin reintentos.
    async createTicket(input) {
      const res = await withContractErrors(send<TicketCreateResponse>("POST", "/tickets", { body: input }), {
        400: "Datos de entrada inválidos.",
      });
      return normalizeCreateResponse(res);
    },

    // GET /tickets?ticket_id=&user_id=&geohash= → 200 { items: TicketDetail[] }
    async getTickets(query, signal) {
      return normalizeTicketList(await withRetry(() => send<unknown>("GET", "/tickets", { query: { ...query }, signal }), { signal }));
    },

    // PATCH /tickets/{ticket_id}/estado { new_status, changed_by, note } → 200 sin cuerpo · 400 · 404
    async updateTicketStatus(ticketId, { new_status, note, changed_by = "OPERADOR" }) {
      const body: TicketStatusUpdateRequest = { new_status, changed_by, note: note ?? "" };
      await withContractErrors(send<unknown>("PATCH", `/tickets/${encodeURIComponent(ticketId)}/estado`, { body }), {
        400: `Estado fuera del catálogo permitido: «${new_status}».`,
        404: `Ticket no encontrado: ${ticketId}.`,
      });
    },

    // GET /analytics/resumen → 200 AnalyticsSummaryResponse
    getAnalytics,

    // TODO(contrato): GET /incidentes no existe aún en openapi.yaml (endpoint propuesto).
    // Si la ruta no está desplegada, se usa analytics.master_incidents como respaldo.
    async getIncidents(signal) {
      if (!missingRoutes.has("/incidentes")) {
        try {
          const data = await withRetry(() => send<unknown>("GET", "/incidentes", { signal }), { signal });
          return normalizeList(data, normalizeIncident, "incidents", "incidentes");
        } catch (err) {
          if (!isMissingRoute(err)) throw err;
          missingRoutes.add("/incidentes");
        }
      }
      return (await getAnalytics(signal)).master_incidents;
    },

    // TODO(contrato): GET /antenas no existe aún en openapi.yaml (endpoint propuesto).
    // Si la ruta no está desplegada, se reconstruyen las antenas con riesgo a partir de
    // analytics.recurrent_antennas (lat/lon decodificados del geohash que envía el backend).
    async getAntennas(signal) {
      if (!missingRoutes.has("/antenas")) {
        try {
          const data = await withRetry(() => send<unknown>("GET", "/antenas", { signal }), { signal });
          return normalizeList(data, normalizeAntenna, "antennas", "antenas");
        } catch (err) {
          if (!isMissingRoute(err)) throw err;
          missingRoutes.add("/antenas");
        }
      }
      return antennasFromRecurrent((await getAnalytics(signal)).recurrent_antennas);
    },
  };
}

export const api: SentinelApi = createApi(CONFIG.MOCK ? mockRequest : request);
export { ApiError };

/**
 * Cambia el estado de un incidente maestro aplicando PATCH /tickets/{id}/estado a sus tickets
 * vinculados (el contrato no define un endpoint de estado para incidentes).
 */
export async function updateIncidentStatus(incident: Incident, status: TicketStatus, note: string): Promise<{ updated: number; failed: number }> {
  let ids = incident.ticket_ids ?? [];
  if (!ids.length && incident.geohash) {
    const tickets: Ticket[] = await api.getTickets({ geohash: incident.geohash });
    ids = tickets.filter((t) => !t.master_incident_id || t.master_incident_id === incident.incident_id).map((t) => t.ticket_id);
  }
  if (!ids.length) throw new ApiError("El incidente no tiene tickets vinculados para actualizar.", 404, false);
  // PATCH con un reintento solo ante errores transitorios
  const results = await Promise.allSettled(ids.map((id) => withRetry(() => api.updateTicketStatus(id, { new_status: status, note }), { retries: 1 })));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed === ids.length) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason instanceof Error ? first.reason : new ApiError("No se pudo actualizar el incidente.");
  }
  return { updated: ids.length - failed, failed };
}
