// Normalizadores: convierten los cuerpos del contrato (contratos/openapi.yaml) a los tipos de
// src/types, rellenando valores por defecto. Ignoran campos extra (p. ej. PK/SK de DynamoDB).
import type { AnalyticsSummaryResponse, Antenna, HealthStatus, HistoryEntry, Incident, PriorityLevel, RecurrentAntenna, Ticket, TicketCreateResponse, TrendPoint } from "../../types";
import { HEALTH_STATUSES, PRIORITY_LEVELS } from "../../types";
import { decodeGeohash } from "../geo";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
};

export function asList(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (isObj(data)) for (const k of ["items", "data", ...keys]) if (Array.isArray(data[k])) return data[k] as unknown[];
  return [];
}

const priority = (v: unknown): PriorityLevel => {
  const s = str(v).toUpperCase();
  return (PRIORITY_LEVELS as readonly string[]).includes(s) ? (s as PriorityLevel) : "BAJA";
};
const health = (v: unknown): HealthStatus => {
  const s = str(v).toUpperCase();
  return (HEALTH_STATUSES as readonly string[]).includes(s) ? (s as HealthStatus) : "NORMAL";
};

/** TicketDetail.history[] → { old_status, new_status, changed_by, note, timestamp } */
function history(v: unknown): HistoryEntry[] {
  return asList(v)
    .filter(isObj)
    .map((h) => ({
      old_status: strOrNull(h.old_status),
      new_status: str(h.new_status, "—"),
      changed_by: str(h.changed_by, "SISTEMA"),
      note: str(h.note),
      timestamp: strOrNull(h.timestamp),
    }))
    .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
}

/** TicketDetail (allOf TicketCreateRequest + detalle) */
export function normalizeTicket(t: Obj): Ticket {
  return {
    ticket_id: str(t.ticket_id),
    user_id: str(t.user_id),
    service_number: str(t.service_number),
    email: str(t.email) || undefined,
    phone: str(t.phone) || undefined,
    location_text: str(t.location_text),
    lat: num(t.lat, NaN),
    lon: num(t.lon, NaN),
    problem_type: str(t.problem_type, "OTRO"),
    description: str(t.description),
    geohash: str(t.geohash),
    status: str(t.status, "Registrada"),
    ai_category: strOrNull(t.ai_category),
    master_incident_id: strOrNull(t.master_incident_id),
    priority_score: numOrNull(t.priority_score),
    priority_level: t.priority_level ? priority(t.priority_level) : null,
    created_at: str(t.created_at),
    history: history(t.history),
  };
}

/** GET /tickets → { items: TicketDetail[] } */
export const normalizeTicketList = (data: unknown): Ticket[] => asList(data).filter(isObj).map(normalizeTicket);

/** POST /tickets → TicketCreateResponse */
export function normalizeCreateResponse(data: unknown): TicketCreateResponse {
  const d: Obj = isObj(data) ? data : {};
  const ticket_id = str(d.ticket_id);
  if (!ticket_id) throw new Error("El servidor no devolvió el código del ticket.");
  return { ticket_id, status: str(d.status, "Registrada"), geohash: str(d.geohash) };
}

export function normalizeIncident(i: Obj): Incident {
  return {
    incident_id: str(i.incident_id),
    geohash: str(i.geohash),
    zone_name: str(i.zone_name, "Zona sin nombre"),
    trigger_type: str(i.trigger_type),
    affected_users_count: num(i.affected_users_count),
    critical_pois: asList(i.critical_pois)
      .filter(isObj)
      .map((p) => ({ name: str(p.name, "Sin nombre"), type: str(p.type, "otro").toLowerCase(), distance_m: num(p.distance_m) })),
    priority_score: num(i.priority_score),
    priority_level: priority(i.priority_level),
    status: str(i.status, "Registrada"),
    ai_diagnosis: strOrNull(i.ai_diagnosis) ?? strOrNull(i.ai_executive_diagnosis),
    created_at: str(i.created_at),
    closed_at: strOrNull(i.closed_at),
    ai_confidence: numOrNull(i.ai_confidence ?? i.semantic_cluster_confidence),
    ticket_ids: Array.isArray(i.ticket_ids) ? i.ticket_ids.map((x) => str(x)).filter(Boolean) : undefined,
    antenna_id: strOrNull(i.antenna_id),
    lat: numOrNull(i.lat) ?? undefined,
    lon: numOrNull(i.lon) ?? undefined,
  };
}

export function normalizeAntenna(a: Obj): Antenna {
  return {
    antenna_id: str(a.antenna_id),
    zone_name: str(a.zone_name),
    lat: num(a.lat, NaN),
    lon: num(a.lon, NaN),
    geohash: str(a.geohash),
    last_traffic_gb: num(a.last_traffic_gb ?? a.traffic_gb_min),
    health_status: health(a.health_status),
    updated_at: str(a.updated_at),
    structural_risk: a.structural_risk === true || a.structural_risk === "true",
  };
}

/** AnalyticsSummaryResponse.recurrent_antennas[] */
function recurrentAntenna(r: Obj): RecurrentAntenna {
  return {
    antenna_id: str(r.antenna_id),
    health_status: health(r.health_status),
    last_traffic_gb: num(r.last_traffic_gb),
    structural_risk: r.structural_risk === true || r.structural_risk === "true",
    zone_name: str(r.zone_name) || undefined,
    geohash: str(r.geohash) || undefined,
  };
}

/** GET /analytics/resumen → AnalyticsSummaryResponse */
export function normalizeAnalytics(raw: unknown): AnalyticsSummaryResponse {
  const d: Obj = isObj(raw) ? raw : {};
  const k: Obj = isObj(d.kpis) ? d.kpis : {};
  return {
    kpis: {
      total_tickets: numOrNull(k.total_tickets),
      active_incidents: numOrNull(k.active_incidents),
      avg_mttr_minutes: numOrNull(k.avg_mttr_minutes),
      total_affected_users: numOrNull(k.total_affected_users),
    },
    top_zones: asList(d.top_zones)
      .filter(isObj)
      .map((z) => ({ geohash: str(z.geohash), zone_name: str(z.zone_name) || `Zona ${str(z.geohash, "?")}`, incident_count: num(z.incident_count) })),
    recurrent_antennas: asList(d.recurrent_antennas)
      .filter(isObj)
      .map(recurrentAntenna)
      .filter((r) => r.antenna_id),
    top_problem_types: asList(d.top_problem_types)
      .filter(isObj)
      .map((p) => ({ problem_type: str(p.problem_type, "OTRO"), count: num(p.count) })),
    master_incidents: asList(d.master_incidents).filter(isObj).map(normalizeIncident),
    // TODO(contrato): "trend" no está en AnalyticsSummaryResponse; solo lo envía el mock.
    trend: asList(d.trend)
      .filter(isObj)
      .map(
        (p): TrendPoint => ({
          ts: str(p.ts),
          reports: num(p.reports),
          active_incidents: num(p.active_incidents),
          critical_antennas: num(p.critical_antennas),
          affected_users: num(p.affected_users),
          mttr_minutes: numOrNull(p.mttr_minutes),
        }),
      ),
  };
}

/** Respaldo mientras GET /antenas no exista: antenas con riesgo desde recurrent_antennas. */
export function antennasFromRecurrent(list: RecurrentAntenna[]): Antenna[] {
  return list.flatMap((r) => {
    const pos = decodeGeohash(r.geohash);
    if (!pos) return [];
    return [
      {
        antenna_id: r.antenna_id,
        zone_name: r.zone_name ?? `Zona ${r.geohash ?? ""}`,
        lat: pos.lat,
        lon: pos.lon,
        geohash: r.geohash ?? "",
        last_traffic_gb: r.last_traffic_gb,
        health_status: r.health_status,
        updated_at: "",
        structural_risk: r.structural_risk,
      },
    ];
  });
}

export const normalizeList = <T>(data: unknown, fn: (o: Obj) => T, ...keys: string[]): T[] => asList(data, ...keys).filter(isObj).map(fn);
