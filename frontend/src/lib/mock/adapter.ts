// Backend simulado en memoria a nivel HTTP: recibe las mismas rutas, cuerpos y query strings que
// el API real y responde con los cuerpos y códigos de contratos/openapi.yaml.
// - Latencia simulada de 200-600 ms y errores 503 ocasionales (?mockerr=0 los desactiva, ?mockerr=1 fuerza fallos).
// - Cada ~20 s llega un reporte nuevo; algunas zonas acumulan reportes y disparan un incidente nuevo.
import type {
  AnalyticsSummaryResponse,
  Antenna,
  AntennaListResponse,
  IncidentListResponse,
  HistoryEntry,
  Incident,
  ProblemType,
  TicketCreateRequest,
  TicketCreateResponse,
  TicketDetail,
  TicketListResponse,
  TicketStatus,
} from "../../types";
import { CLOSED_STATUSES, TICKET_STATUSES } from "../../types";
import { getUrlParam } from "../config";
import { distanceMeters, encodeGeohash } from "../geo";
import { ApiError, type RequestOptions } from "../api/http";
import { contactFor, createSeed, DESCRIPTIONS, iso, levelFromScore, MIN, randomId, TYPES_CYCLE, type MockIncident, type MockState, type MockTicket } from "./seed";

const errParam = getUrlParam("mockerr");
const ERROR_RATE = errParam !== null && Number.isFinite(Number(errParam)) ? Math.min(1, Math.max(0, Number(errParam))) : 0.05;
const TICK_MS = 20_000;

let state: MockState = createSeed();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isOpen = (s: string) => !(CLOSED_STATUSES as readonly string[]).includes(s);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    });
  });

async function network(signal?: AbortSignal, canFail = true) {
  ensureGenerator();
  await sleep(200 + Math.random() * 400, signal);
  if (canFail && Math.random() < ERROR_RATE) throw new ApiError("Servicio no disponible temporalmente (simulado).", 503, true, "Servicio no disponible (simulado)");
}

// ---------- Lógica de negocio simulada ----------
function linkTicketToIncident(t: MockTicket, inc: MockIncident) {
  t.master_incident_id = inc.incident_id;
  t.priority_score = inc.priority_score;
  t.priority_level = inc.priority_level;
  t.ai_category ??= "CORTE_TOTAL_DATOS";
  t.zone_name = inc.zone_name;
  inc.affected_users_count += 1;
  inc.priority_score = Math.min(99, inc.priority_score + 1);
  inc.priority_level = levelFromScore(inc.priority_score);
}

function nearestActiveIncident(lat: number, lon: number, maxM = 1200): MockIncident | null {
  let best: { inc: MockIncident; d: number } | null = null;
  for (const inc of state.incidents) {
    if (!isOpen(inc.status)) continue;
    const d = distanceMeters(lat, lon, inc.lat, inc.lon);
    if (d <= maxM && (!best || d < best.d)) best = { inc, d };
  }
  return best?.inc ?? null;
}

function nearestAntenna(lat: number, lon: number): Antenna | null {
  let best: { a: Antenna; d: number } | null = null;
  for (const a of state.antennas) {
    const d = distanceMeters(lat, lon, a.lat, a.lon);
    if (!best || d < best.d) best = { a, d };
  }
  return best?.a ?? null;
}

function createIncident(zoneName: string, lat: number, lon: number, trigger: Incident["trigger_type"], tickets: MockTicket[], score: number): MockIncident {
  state.seq.incident += 1;
  const ant = nearestAntenna(lat, lon);
  const inc: MockIncident = {
    incident_id: `INC-${String(state.seq.incident).padStart(3, "0")}`,
    antenna_id: ant?.antenna_id ?? null,
    zone_name: zoneName,
    lat,
    lon,
    geohash: encodeGeohash(lat, lon, 6),
    trigger_type: trigger,
    affected_users_count: 0,
    critical_pois: [],
    priority_score: score,
    priority_level: levelFromScore(score),
    status: "Registrada",
    ai_diagnosis: null, // Gemini aún analizando: el front muestra skeleton
    created_at: iso(),
    closed_at: null,
  };
  state.incidents.push(inc);
  for (const t of tickets) linkTicketToIncident(t, inc);
  if (ant) {
    ant.health_status = "CAIDA";
    ant.last_traffic_gb = 48;
    ant.updated_at = iso();
  }
  // Diagnóstico de IA "llega" unos segundos después
  setTimeout(() => {
    inc.critical_pois = HOTSPOT_POIS[zoneName] ?? [];
    inc.ai_diagnosis =
      `Se detectó una caída anticipada de tráfico en ${ant?.antenna_id ?? "la antena de la zona"} (${ant?.last_traffic_gb ?? 48} GB/min) ` +
      `junto con ${inc.affected_users_count} reportes con descripciones semánticamente similares («sin señal», «sin datos»).\n\n` +
      "El patrón coincide con una degradación del enlace de radio. Recomendación: verificar el estado del sector y preparar una cuadrilla preventiva.";
    if (inc.critical_pois.some((p) => p.type === "hospital" || p.type === "escuela")) {
      inc.priority_score = Math.min(99, inc.priority_score + 10);
      inc.priority_level = levelFromScore(inc.priority_score);
    }
  }, 9000);
  return inc;
}

function recomputeIncident(inc: MockIncident) {
  const linked = state.tickets.filter((t) => t.master_incident_id === inc.incident_id);
  if (!linked.length) return;
  const minIdx = Math.min(...linked.map((t) => Math.max(0, TICKET_STATUSES.indexOf(t.status as TicketStatus))));
  inc.status = TICKET_STATUSES[minIdx] ?? "Registrada";
  const ant = state.antennas.find((a) => a.antenna_id === inc.antenna_id);
  if (!isOpen(inc.status)) {
    inc.closed_at ??= iso();
    if (ant) {
      ant.health_status = "NORMAL";
      ant.last_traffic_gb = 95;
      ant.structural_risk = ant.antenna_id === "ANT-REC-09"; // el riesgo estructural persiste
      ant.updated_at = iso();
    }
  } else {
    inc.closed_at = null;
  }
}

function newTicket(input: TicketCreateRequest & { zone_name: string }): MockTicket {
  const now = iso();
  return {
    ...input,
    incident_time: input.incident_time ?? null,
    ticket_id: randomId("TCK"),
    status: "Registrada",
    ai_category: null,
    priority_score: null,
    priority_level: null,
    master_incident_id: null,
    created_at: now,
    geohash: encodeGeohash(input.lat, input.lon, 6), // misma precisión que api_crud.py
    history: [{ old_status: null, new_status: "Registrada", changed_by: "CIUDADANO", note: "Reporte recibido", timestamp: now }],
  };
}

/** Esquema Incidente exacto (sin lat/lon ni antenna_id internos del mock). */
function toIncidente(inc: MockIncident): Incident {
  return {
    incident_id: inc.incident_id,
    geohash: inc.geohash,
    zone_name: inc.zone_name,
    trigger_type: inc.trigger_type,
    affected_users_count: inc.affected_users_count,
    critical_pois: inc.critical_pois,
    priority_score: inc.priority_score,
    priority_level: inc.priority_level,
    status: inc.status,
    ai_diagnosis: inc.ai_diagnosis,
    created_at: inc.created_at,
    closed_at: inc.closed_at,
  };
}

/** Esquema Antena exacto. */
function toAntena(a: Antenna): Antenna {
  const { antenna_id, zone_name, lat, lon, geohash, last_traffic_gb, health_status, updated_at, structural_risk } = a;
  return { antenna_id, zone_name, lat, lon, geohash, last_traffic_gb, health_status, updated_at, structural_risk };
}

/** Quita los campos internos del mock: devuelve exactamente un TicketDetail. */
function toDetail({ zone_name: _zone, ...t }: MockTicket): TicketDetail {
  return t;
}

// ---------- Generador de tiempo real ----------
const HOTSPOTS = [
  { zone: "San Juan de Lurigancho – Canto Grande", lat: -11.9812, lon: -77.0011 },
  { zone: "Santiago de Surco – Monterrico", lat: -12.1071, lon: -76.9722 },
  { zone: "Chorrillos – Malecón", lat: -12.1641, lon: -77.0247 },
];
const HOTSPOT_POIS: Record<string, Incident["critical_pois"]> = {
  "San Juan de Lurigancho – Canto Grande": [
    { name: "Hospital San Juan de Lurigancho", type: "hospital", distance_m: 640 },
    { name: "I.E. César Vallejo", type: "escuela", distance_m: 310 },
  ],
  "Santiago de Surco – Monterrico": [{ name: "Colegio Monterrico", type: "escuela", distance_m: 420 }],
  "Chorrillos – Malecón": [{ name: "Zona industrial La Villa", type: "industria", distance_m: 880 }],
};
let tick = 0;
let generatorStarted = false;

function generateReport() {
  tick += 1;
  const phase = (tick - 1) % 5; // [H, H, H, L, L]: 3 reportes en un hotspot, luego 2 a incidentes activos
  const type: ProblemType = TYPES_CYCLE[tick % TYPES_CYCLE.length] ?? "SIN_SENAL";
  const desc = DESCRIPTIONS[type][tick % 3] ?? "";
  state.seq.user += 1;
  const userId = `U-${state.seq.user}`;
  const contact = contactFor(state.seq.user);

  if (phase < 3) {
    const spot = HOTSPOTS[Math.floor((tick - 1) / 5) % HOTSPOTS.length];
    if (!spot) return;
    const lat = spot.lat + (Math.random() - 0.5) * 0.003;
    const lon = spot.lon + (Math.random() - 0.5) * 0.003;
    const t = newTicket({ user_id: userId, ...contact, problem_type: type, description: desc, location_text: spot.zone, zone_name: spot.zone, lat, lon, incident_time: iso(10 * MIN) });
    state.tickets.push(t);
    const active = nearestActiveIncident(lat, lon);
    if (active) {
      linkTicketToIncident(t, active);
      return;
    }
    const pending = state.tickets.filter((x) => !x.master_incident_id && isOpen(x.status) && distanceMeters(lat, lon, x.lat, x.lon) < 800);
    if (pending.length >= 3) createIncident(spot.zone, spot.lat, spot.lon, "TEMPRANO_IA", pending, 62);
  } else {
    const open = state.incidents.filter((i) => isOpen(i.status));
    const inc = open[tick % Math.max(1, open.length)];
    if (!inc) return;
    const lat = inc.lat + (Math.random() - 0.5) * 0.003;
    const lon = inc.lon + (Math.random() - 0.5) * 0.003;
    const t = newTicket({ user_id: userId, ...contact, problem_type: type, description: desc, location_text: inc.zone_name, zone_name: inc.zone_name, lat, lon, incident_time: iso(10 * MIN) });
    state.tickets.push(t);
    linkTicketToIncident(t, inc);
  }
}

function ensureGenerator() {
  if (generatorStarted || typeof window === "undefined") return;
  generatorStarted = true;
  window.setInterval(generateReport, TICK_MS);
}

// ---------- Analítica (forma de api_crud.make_analytics) ----------
function analytics(): AnalyticsSummaryResponse {
  const zones = new Map<string, { zone_name: string; incident_count: number }>();
  for (const inc of state.incidents) {
    const z = zones.get(inc.geohash) ?? { zone_name: inc.zone_name, incident_count: 0 };
    z.incident_count += 1;
    zones.set(inc.geohash, z);
  }
  // Las "incidencias" del contrato son los tickets: el top de zonas también cuenta reportes de la zona
  for (const t of state.tickets) {
    const inc = state.incidents.find((i) => i.incident_id === t.master_incident_id);
    const key = inc?.geohash ?? t.geohash;
    const z = zones.get(key) ?? { zone_name: t.zone_name || t.location_text || `Zona ${key}`, incident_count: 0 };
    z.incident_count += 1;
    zones.set(key, z);
  }
  const typeCounts = new Map<string, number>();
  for (const t of state.tickets) typeCounts.set(t.problem_type, (typeCounts.get(t.problem_type) ?? 0) + 1);

  const closed = state.incidents.filter((i) => i.closed_at);
  const mttr = closed.length ? Math.round((closed.reduce((s, i) => s + (Date.parse(i.closed_at ?? "") - Date.parse(i.created_at)) / MIN, 0) / closed.length) * 100) / 100 : 0;
  const active = state.incidents.filter((i) => isOpen(i.status));
  const affected = active.reduce((s, i) => s + i.affected_users_count, 0);
  return {
    kpis: {
      total_tickets: state.tickets.length,
      active_incidents: active.length,
      avg_mttr_minutes: mttr,
      total_affected_users: affected,
    },
    top_zones: [...zones]
      .map(([geohash, z]) => ({ geohash, ...z }))
      .sort((a, b) => b.incident_count - a.incident_count)
      .slice(0, 10),
    // Igual que el backend: solo antenas con structural_risk (+ zone_name/geohash extra)
    recurrent_antennas: state.antennas
      .filter((a) => a.structural_risk)
      .map((a) => ({ antenna_id: a.antenna_id, health_status: a.health_status, last_traffic_gb: a.last_traffic_gb, structural_risk: true, zone_name: a.zone_name, geohash: a.geohash })),
    top_problem_types: [...typeCounts].map(([problem_type, count]) => ({ problem_type, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    master_incidents: [...state.incidents].sort((a, b) => b.priority_score - a.priority_score).map(toIncidente),
  };
}

// ---------- Rutas ----------
const REQUIRED_CREATE = ["user_id", "service_number", "location_text", "lat", "lon", "problem_type", "description"] as const;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const badRequest = (error: string) => new ApiError(error, 400, false, error);
const notFound = (error: string) => new ApiError(error, 404, false, error);

/** POST /tickets → 202 TicketCreateResponse · 400 */
function postTicket(body: unknown): TicketCreateResponse {
  if (!isObject(body)) throw badRequest("JSON invalido");
  for (const f of REQUIRED_CREATE) if (body[f] === undefined || body[f] === null || body[f] === "") throw badRequest(`Falta ${f}`);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw badRequest("Coordenadas invalidas");
  const s = (v: unknown) => String(v ?? "");
  // incident_time: opcional, ISO 8601
  let incidentTime: string | undefined;
  if (body.incident_time !== undefined && body.incident_time !== null && body.incident_time !== "") {
    if (typeof body.incident_time !== "string" || Number.isNaN(Date.parse(body.incident_time))) throw badRequest("incident_time invalido");
    incidentTime = new Date(body.incident_time).toISOString();
  }
  const t = newTicket({
    user_id: s(body.user_id),
    service_number: s(body.service_number),
    email: s(body.email),
    phone: s(body.phone),
    location_text: s(body.location_text),
    lat,
    lon,
    problem_type: s(body.problem_type),
    description: s(body.description).slice(0, 300),
    incident_time: incidentTime,
    zone_name: s(body.location_text),
  });
  state.tickets.push(t);
  const inc = nearestActiveIncident(t.lat, t.lon);
  if (inc) linkTicketToIncident(t, inc);
  else {
    const pending = state.tickets.filter((x) => !x.master_incident_id && isOpen(x.status) && distanceMeters(t.lat, t.lon, x.lat, x.lon) <= 1000);
    if (pending.length >= 10) createIncident(t.location_text, t.lat, t.lon, "COLECTIVO_10", pending, 70);
  }
  return { ticket_id: t.ticket_id, status: "Registrada", geohash: t.geohash };
}

/** GET /tickets?ticket_id=&user_id=&geohash= → 200 { items } · 400 sin filtros */
function getTickets(query: Record<string, string | undefined>): TicketListResponse {
  const ticketId = query.ticket_id?.trim();
  const userId = query.user_id?.trim();
  const geohash = query.geohash?.trim();
  if (!ticketId && !userId && !geohash) throw badRequest("Se requiere ticket_id, user_id o geohash");
  const eq = (a: string, b?: string) => !b || a.toUpperCase() === b.toUpperCase();
  const items = state.tickets
    .filter((t) => eq(t.ticket_id, ticketId) && eq(t.user_id, userId) && (!geohash || t.geohash.startsWith(geohash)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toDetail);
  return { items };
}

/** PATCH /tickets/{ticket_id}/estado → 200 · 400 estado fuera de catálogo · 404 ticket no encontrado */
function patchStatus(ticketId: string, body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw badRequest("JSON invalido");
  const newStatus = body.new_status;
  if (typeof newStatus !== "string" || !(TICKET_STATUSES as readonly string[]).includes(newStatus)) throw badRequest("Estado invalido");
  const changedBy = typeof body.changed_by === "string" && body.changed_by ? body.changed_by : "OPERADOR";
  if (changedBy !== "OPERADOR" && changedBy !== "SISTEMA_SFN") throw badRequest("changed_by invalido");
  const note = body.note ?? "";
  if (typeof note !== "string") throw badRequest("note debe ser texto");
  const t = state.tickets.find((x) => x.ticket_id === ticketId);
  if (!t) throw notFound("Ticket no encontrado");
  if (t.status === newStatus) return { ticket_id: ticketId, status: newStatus, message: "El ticket ya tiene ese estado" };
  const timestamp = iso();
  const entry: HistoryEntry = { old_status: t.status, new_status: newStatus, changed_by: changedBy, note, timestamp };
  const old = t.status;
  t.history.push(entry);
  t.status = newStatus as TicketStatus;
  const inc = state.incidents.find((i) => i.incident_id === t.master_incident_id);
  if (inc) recomputeIncident(inc);
  return { ticket_id: ticketId, old_status: old, new_status: newStatus, updated_at: timestamp };
}

/** Mismo contrato de llamada que http.request: método + ruta + { query, body, signal }. */
export async function mockRequest<T>(method: string, path: string, { query = {}, body, signal }: RequestOptions = {}): Promise<T> {
  const m = method.toUpperCase();
  const reads = m === "GET";
  await network(signal, reads); // las escrituras no fallan al azar: los reintentos son responsabilidad del cliente
  const statusMatch = /^\/tickets\/([^/]+)\/estado$/.exec(path);

  let out: unknown;
  if (m === "POST" && path === "/tickets") out = postTicket(body);
  else if (m === "GET" && path === "/tickets") out = getTickets(query);
  else if (m === "PATCH" && statusMatch) out = patchStatus(decodeURIComponent(statusMatch[1] ?? ""), body);
  else if (m === "GET" && path === "/analytics/resumen") out = analytics();
  else if (m === "GET" && path === "/incidentes") out = { items: state.incidents.map(toIncidente) } satisfies IncidentListResponse;
  else if (m === "GET" && path === "/antenas") out = { items: antennasSnapshot().map(toAntena) } satisfies AntennaListResponse;
  else throw notFound("Ruta no encontrada");
  return clone(out) as T;
}

function antennasSnapshot(): Antenna[] {
  // Variación leve del tráfico dentro de su banda para dar sensación de tiempo real
  const bands: Record<Antenna["health_status"], [number, number]> = { CAIDA: [30, 59], NORMAL: [60, 129], SATURADA: [130, 175], INHABILITADA: [0, 0] };
  for (const a of state.antennas) {
    const [lo, hi] = bands[a.health_status];
    a.last_traffic_gb = Math.min(hi, Math.max(lo, a.last_traffic_gb + Math.round((Math.random() - 0.5) * 6)));
    a.updated_at = iso();
  }
  return state.antennas;
}

/** Reinicia los datos de demo (útil en pruebas). */
export function resetMock() {
  state = createSeed();
  tick = 0;
}
