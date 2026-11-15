// Backend simulado en memoria (+ localStorage) para la demo.
// Implementa las mismas operaciones que api.js y devuelve copias de los datos.
// Al guardar en localStorage, el Portal y el NOC (en otra pestaña) comparten el estado.

const STORAGE_KEY = "telecorp_sentinel_mock_v1";
const STATUSES = ["Registrada", "En revisión", "Siendo atendida", "Solucionada", "Cerrada"];
const CLOSED = ["Solucionada", "Cerrada"];

// Probabilidad de error simulado (desactivable con ?mockerr=0)
let ERROR_RATE = 0.06;
try {
  const p = new URLSearchParams(window.location.search).get("mockerr");
  if (p !== null && !Number.isNaN(Number(p))) ERROR_RATE = Math.min(1, Math.max(0, Number(p)));
} catch { /* sin window */ }

// ---------- Utilidades ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60000;

function mockError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function simulateNetwork({ canFail = true } = {}) {
  await sleep(200 + Math.random() * 400);
  if (canFail && Math.random() < ERROR_RATE) {
    throw mockError(503, "Error simulado del servidor (503). Intenta nuevamente.");
  }
}

// Codificador geohash estándar (base32)
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function encodeGeohash(lat, lon, precision = 7) {
  let latR = [-90, 90], lonR = [-180, 180];
  let hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const range = even ? lonR : latR;
    const val = even ? lon : lat;
    const mid = (range[0] + range[1]) / 2;
    if (val >= mid) { ch = (ch << 1) | 1; range[0] = mid; } else { ch <<= 1; range[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const levelFromScore = (s) => (s >= 85 ? "CRITICA" : s >= 65 ? "ALTA" : s >= 40 ? "MEDIA" : "BAJA");
const randomId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

// ---------- Datos semilla ----------
function seed() {
  const antennas = [
    { antenna_id: "ANT-HOSP-01", zone_name: "Cercado de Lima – Hospital Loayza", lat: -12.0499, lon: -77.0436, last_traffic_gb: 42, health_status: "CAIDA", structural_risk: false },
    { antenna_id: "ANT-RES-02", zone_name: "Jesús María – Residencial San Felipe", lat: -12.0831, lon: -77.0515, last_traffic_gb: 51, health_status: "CAIDA", structural_risk: false },
    { antenna_id: "ANT-REC-09", zone_name: "Rímac – Cerro San Cristóbal", lat: -12.0306, lon: -77.0229, last_traffic_gb: 0, health_status: "INHABILITADA", structural_risk: true },
    { antenna_id: "ANT-SI-05", zone_name: "San Isidro – Centro Financiero", lat: -12.0966, lon: -77.0336, last_traffic_gb: 142, health_status: "SATURADA", structural_risk: false },
    { antenna_id: "ANT-MIR-04", zone_name: "Miraflores – Parque Kennedy", lat: -12.1211, lon: -77.0297, last_traffic_gb: 96, health_status: "NORMAL", structural_risk: false },
    { antenna_id: "ANT-CHO-07", zone_name: "Chorrillos – Malecón", lat: -12.1647, lon: -77.0253, last_traffic_gb: 88, health_status: "NORMAL", structural_risk: false },
  ].map((a) => ({ ...a, geohash: encodeGeohash(a.lat, a.lon, 6), updated_at: iso() }));

  const incidents = [
    {
      incident_id: "INC-001", antenna_id: "ANT-HOSP-01", zone_name: "Cercado de Lima – Hospital Loayza",
      lat: -12.0493, lon: -77.0427, trigger_type: "COLECTIVO_10", priority_score: 96, status: "En revisión",
      created_at: iso(38 * MIN), closed_at: null,
      critical_pois: [
        { name: "Hospital Nacional Arzobispo Loayza", type: "hospital", distance_m: 180 },
        { name: "G.U.E. Nuestra Señora de Guadalupe", type: "escuela", distance_m: 750 },
      ],
      ai_diagnosis:
        "La antena ANT-HOSP-01 reporta 42 GB/min, por debajo del umbral operativo (60 GB/min), y concentra 15 reportes ciudadanos en 25 minutos. " +
        "Patrón compatible con falla de enlace de transmisión (backhaul) y no con saturación. " +
        "Impacto crítico: el Hospital Nacional Arzobispo Loayza está a 180 m. Recomendación: despachar cuadrilla de inmediato y activar celda de respaldo temporal.",
    },
    {
      incident_id: "INC-002", antenna_id: "ANT-RES-02", zone_name: "Jesús María – Residencial San Felipe",
      lat: -12.0826, lon: -77.0509, trigger_type: "TEMPRANO_IA", priority_score: 74, status: "Siendo atendida",
      created_at: iso(70 * MIN), closed_at: null,
      critical_pois: [{ name: "I.E. Residencial San Felipe", type: "escuela", distance_m: 260 }],
      ai_diagnosis:
        "El modelo detectó una caída progresiva de tráfico en ANT-RES-02 (de 98 a 51 GB/min en 40 min) antes de alcanzar 10 reportes. " +
        "Probable degradación de módulo de radio. Zona residencial densa con un colegio cercano. Prioridad ALTA; cuadrilla en camino.",
    },
    {
      incident_id: "INC-003", antenna_id: "ANT-REC-09", zone_name: "Rímac – Cerro San Cristóbal",
      lat: -12.0313, lon: -77.0236, trigger_type: "ANTENA_UMBRAL", priority_score: 58, status: "En revisión",
      created_at: iso(150 * MIN), closed_at: null,
      critical_pois: [
        { name: "Parque Industrial del Rímac", type: "industria", distance_m: 420 },
        { name: "I.E. Ricardo Bentín", type: "escuela", distance_m: 610 },
      ],
      ai_diagnosis:
        "ANT-REC-09 está inhabilitada (0 GB/min) y acumula 6 fallas en los últimos 14 días. La recurrencia sugiere un problema estructural " +
        "(torre o soporte afectado por vibraciones/humedad) y no un fallo puntual de equipo. Recomendación: inspección estructural y evaluar reubicación; " +
        "las reparaciones de equipo no han resuelto la causa raíz.",
    },
    {
      incident_id: "INC-000", antenna_id: "ANT-MIR-04", zone_name: "Miraflores – Parque Kennedy",
      lat: -12.1211, lon: -77.0297, trigger_type: "TEMPRANO_IA", priority_score: 35, status: "Cerrada",
      created_at: iso(26 * 60 * MIN), closed_at: iso(26 * 60 * MIN - 52 * MIN),
      critical_pois: [], affected_users_count: 6,
      ai_diagnosis: "Microcorte por reinicio programado no notificado. Servicio restablecido sin intervención en campo.",
    },
    {
      incident_id: "INC-00A", antenna_id: "ANT-SI-05", zone_name: "San Isidro – Centro Financiero",
      lat: -12.0966, lon: -77.0336, trigger_type: "ANTENA_UMBRAL", priority_score: 44, status: "Cerrada",
      created_at: iso(30 * 60 * MIN), closed_at: iso(30 * 60 * MIN - 38 * MIN),
      critical_pois: [], affected_users_count: 4,
      ai_diagnosis: "Saturación en hora punta. Se balanceó carga hacia celdas vecinas.",
    },
  ].map((i) => ({ ...i, geohash: encodeGeohash(i.lat, i.lon, 6), priority_level: levelFromScore(i.priority_score) }));

  const tickets = [];
  let userSeq = 1001;
  const mkHistory = (path, createdMs, note) => {
    const h = [{ old_status: null, new_status: "Registrada", changed_by: "CIUDADANO", note: "Reporte recibido", ts: iso(createdMs) }];
    for (let k = 1; k < path.length; k++) {
      h.push({
        old_status: path[k - 1], new_status: path[k],
        changed_by: k === 1 ? "SISTEMA" : "OPERADOR",
        note: k === 1 ? note : "Cuadrilla técnica asignada",
        ts: iso(Math.max(0, createdMs - k * 6 * MIN)),
      });
    }
    return h;
  };
  const types = ["SIN_SENAL", "SIN_INTERNET", "FALLA_LLAMADAS", "SIN_INTERNET", "INTERNET_LENTO"];
  const descs = [
    "No tengo señal desde hace un rato, el celular dice 'Solo emergencias'.",
    "Se cayó el internet en todo el edificio.",
    "Las llamadas se cortan apenas contestan.",
    "Sin datos móviles cerca del hospital.",
    "Internet muy lento, no cargan ni los mensajes.",
  ];

  const addLinked = (inc, n, path, startMin) => {
    for (let i = 0; i < n; i++) {
      const createdMs = (startMin - i * 2) * MIN;
      const lat = inc.lat + (Math.random() - 0.5) * 0.004;
      const lon = inc.lon + (Math.random() - 0.5) * 0.004;
      const id = inc.incident_id === "INC-001" && i === 0 ? "TCK-DEMO01" : randomId("TCK");
      tickets.push({
        ticket_id: id, user_id: `U-${userSeq++}`, service_number: `9${String(10000000 + userSeq * 7919).slice(-8)}`,
        status: path[path.length - 1], problem_type: types[i % types.length], description: descs[i % descs.length],
        location_text: inc.zone_name, zone_name: inc.zone_name, lat, lon, geohash: encodeGeohash(lat, lon, 7),
        priority_level: inc.priority_level, master_incident_id: inc.incident_id,
        incident_time: iso(createdMs + 5 * MIN), created_at: iso(createdMs),
        history: mkHistory(path, createdMs, `Vinculado al incidente maestro ${inc.incident_id}`),
      });
    }
    inc.affected_users_count = n;
  };
  addLinked(incidents[0], 15, ["Registrada", "En revisión"], 36);
  addLinked(incidents[1], 9, ["Registrada", "En revisión", "Siendo atendida"], 68);
  addLinked(incidents[2], 4, ["Registrada", "En revisión"], 145);

  // Tickets sueltos (sin incidente maestro)
  const loose = [
    { zone: antennas[3], type: "INTERNET_LENTO", desc: "En hora punta el internet se vuelve muy lento.", path: ["Registrada"], min: 20 },
    { zone: antennas[5], type: "OTRO", desc: "El router muestra luz roja intermitente.", path: ["Registrada", "En revisión"], min: 95 },
    { zone: antennas[4], type: "SIN_INTERNET", desc: "Me quedé sin internet unos minutos ayer.", path: ["Registrada", "En revisión", "Siendo atendida", "Solucionada", "Cerrada"], min: 26 * 60 },
  ];
  for (const l of loose) {
    tickets.push({
      ticket_id: randomId("TCK"), user_id: `U-${userSeq++}`, service_number: "987654321",
      status: l.path[l.path.length - 1], problem_type: l.type, description: l.desc,
      location_text: l.zone.zone_name, zone_name: l.zone.zone_name, lat: l.zone.lat, lon: l.zone.lon,
      geohash: encodeGeohash(l.zone.lat, l.zone.lon, 7), priority_level: "BAJA", master_incident_id: null,
      incident_time: iso(l.min * MIN + 5 * MIN), created_at: iso(l.min * MIN),
      history: mkHistory(l.path, l.min * MIN, "Revisión inicial del reporte"),
    });
  }

  return {
    version: 1,
    antennas,
    incidents,
    tickets,
    recurrent_antennas: [
      { antenna_id: "ANT-REC-09", failures: 6, days: 14 },
      { antenna_id: "ANT-RES-02", failures: 3, days: 21 },
    ],
  };
}

// ---------- Persistencia ----------
let state = null;

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tickets) && Array.isArray(parsed.incidents) && Array.isArray(parsed.antennas)) {
        state = parsed;
        return state;
      }
    }
  } catch { /* localStorage no disponible o datos corruptos */ }
  if (!state) {
    state = seed();
    save();
  }
  return state;
}

function save() {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* modo privado / bloqueado */ }
}

/** Restaura los datos semilla (útil para repetir la demo). */
export function resetMock() {
  state = seed();
  save();
}

// ---------- Lógica de negocio simulada ----------
function recomputeIncident(inc) {
  const linked = state.tickets.filter((t) => t.master_incident_id === inc.incident_id);
  if (!linked.length) return;
  const minIdx = Math.min(...linked.map((t) => Math.max(0, STATUSES.indexOf(t.status))));
  inc.status = STATUSES[minIdx];
  const antenna = state.antennas.find((a) => a.antenna_id === inc.antenna_id);
  if (CLOSED.includes(inc.status)) {
    if (!inc.closed_at) inc.closed_at = new Date().toISOString();
    // Al solucionar, la antena vuelve a operar con tráfico normal
    if (antenna) { antenna.health_status = "NORMAL"; antenna.last_traffic_gb = 95; antenna.updated_at = new Date().toISOString(); }
  } else {
    inc.closed_at = null;
  }
}

function findNearbyIncident(lat, lon) {
  let best = null;
  for (const inc of state.incidents) {
    if (CLOSED.includes(inc.status)) continue;
    const d = distanceM(lat, lon, inc.lat, inc.lon);
    if (d <= 1200 && (!best || d < best.d)) best = { inc, d };
  }
  return best ? best.inc : null;
}

function nearestAntenna(lat, lon) {
  let best = null;
  for (const a of state.antennas) {
    const d = distanceM(lat, lon, a.lat, a.lon);
    if (!best || d < best.d) best = { a, d };
  }
  return best ? best.a : null;
}

export async function createTicket(body) {
  await simulateNetwork();
  load();
  const required = ["user_id", "service_number", "email", "phone", "location_text", "problem_type", "description"];
  for (const k of required) {
    if (!body || body[k] === undefined || body[k] === null || String(body[k]).trim() === "") {
      throw mockError(400, `Falta el campo obligatorio: ${k}`);
    }
  }
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw mockError(400, "Coordenadas inválidas");

  const now = new Date().toISOString();
  const ticket = {
    ticket_id: randomId("TCK"),
    user_id: String(body.user_id), service_number: String(body.service_number),
    email: String(body.email), phone: String(body.phone),
    status: "Registrada", problem_type: String(body.problem_type), description: String(body.description).slice(0, 300),
    location_text: String(body.location_text), zone_name: String(body.location_text),
    lat, lon, geohash: encodeGeohash(lat, lon, 7),
    priority_level: null, master_incident_id: null,
    incident_time: body.incident_time || now, created_at: now,
    history: [{ old_status: null, new_status: "Registrada", changed_by: "CIUDADANO", note: "Reporte recibido", ts: now }],
  };

  // Correlación: vincular a un incidente activo cercano
  const inc = findNearbyIncident(lat, lon);
  if (inc) {
    ticket.master_incident_id = inc.incident_id;
    ticket.priority_level = inc.priority_level;
    ticket.zone_name = inc.zone_name;
    inc.affected_users_count = (inc.affected_users_count || 0) + 1;
    inc.priority_score = Math.min(100, inc.priority_score + 1);
    inc.priority_level = levelFromScore(inc.priority_score);
  }
  state.tickets.push(ticket);

  // Regla colectiva: 10 o más reportes abiertos sin incidente en ~1 km crean un incidente maestro
  if (!inc) {
    const nearby = state.tickets.filter((t) => !t.master_incident_id && !CLOSED.includes(t.status)
      && distanceM(lat, lon, t.lat, t.lon) <= 1000);
    if (nearby.length >= 10) {
      const antenna = nearestAntenna(lat, lon);
      const newInc = {
        incident_id: `INC-${String(state.incidents.length + 1).padStart(3, "0")}`,
        antenna_id: antenna ? antenna.antenna_id : null,
        zone_name: ticket.location_text, lat, lon, geohash: encodeGeohash(lat, lon, 6),
        trigger_type: "COLECTIVO_10", affected_users_count: nearby.length, critical_pois: [],
        priority_score: 70, priority_level: "ALTA", status: "Registrada",
        ai_diagnosis: "Incidente generado automáticamente por acumulación de 10 o más reportes en la zona. Diagnóstico de IA pendiente.",
        created_at: now, closed_at: null,
      };
      state.incidents.push(newInc);
      nearby.forEach((t) => { t.master_incident_id = newInc.incident_id; t.priority_level = "ALTA"; });
    }
  }
  save();
  return { ticket_id: ticket.ticket_id, status: ticket.status, geohash: ticket.geohash };
}

export async function getTickets(params = {}) {
  await simulateNetwork();
  load();
  const { user_id, ticket_id, geohash } = params;
  let list = state.tickets;
  if (ticket_id) list = list.filter((t) => t.ticket_id.toUpperCase() === String(ticket_id).trim().toUpperCase());
  if (user_id) list = list.filter((t) => t.user_id.toUpperCase() === String(user_id).trim().toUpperCase());
  if (geohash) list = list.filter((t) => t.geohash.startsWith(String(geohash)));
  return clone(list).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function updateTicketStatus(ticketId, body = {}) {
  await simulateNetwork();
  load();
  // El contrato OpenAPI usa new_status; se acepta también status
  body = { ...body, status: body.new_status || body.status };
  if (!STATUSES.includes(body.status)) throw mockError(400, `Estado inválido: ${body.status}`);
  const ticket = state.tickets.find((t) => t.ticket_id === ticketId);
  if (!ticket) throw mockError(404, `No existe el ticket ${ticketId}`);
  const ts = new Date().toISOString();
  ticket.history.push({
    old_status: ticket.status, new_status: body.status,
    changed_by: body.changed_by || "OPERADOR", note: body.note || "", ts,
  });
  ticket.status = body.status;
  const inc = state.incidents.find((i) => i.incident_id === ticket.master_incident_id);
  if (inc) recomputeIncident(inc);
  save();
  return { ticket_id: ticketId, status: ticket.status, updated_at: ts };
}

export async function getIncidents() {
  await simulateNetwork();
  load();
  return clone(state.incidents).map((inc) => ({
    ...inc,
    ticket_ids: state.tickets.filter((t) => t.master_incident_id === inc.incident_id).map((t) => t.ticket_id),
  }));
}

export async function getAntennas() {
  await simulateNetwork();
  load();
  // Variación leve de tráfico para dar sensación de tiempo real, sin cambiar de banda
  const bands = { CAIDA: [30, 59], NORMAL: [60, 129], SATURADA: [130, 175], INHABILITADA: [0, 0] };
  const now = new Date().toISOString();
  for (const a of state.antennas) {
    const [lo, hi] = bands[a.health_status] || [0, 200];
    const next = a.last_traffic_gb + Math.round((Math.random() - 0.5) * 6);
    a.last_traffic_gb = Math.min(hi, Math.max(lo, next));
    a.updated_at = now;
  }
  save();
  return clone(state.antennas);
}

export async function getAnalytics() {
  await simulateNetwork();
  load();
  const zoneCounts = new Map();
  const typeCounts = new Map();
  for (const t of state.tickets) {
    const z = t.zone_name || t.location_text || "Sin zona";
    zoneCounts.set(z, (zoneCounts.get(z) || 0) + 1);
    typeCounts.set(t.problem_type, (typeCounts.get(t.problem_type) || 0) + 1);
  }
  const closedInc = state.incidents.filter((i) => i.closed_at);
  const mttr = closedInc.length
    ? closedInc.reduce((s, i) => s + (new Date(i.closed_at) - new Date(i.created_at)) / MIN, 0) / closedInc.length
    : null;
  const active = state.incidents.filter((i) => !CLOSED.includes(i.status));
  return {
    top_zones: [...zoneCounts].map(([zone_name, count]) => ({ zone_name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6),
    recurrent_antennas: clone(state.recurrent_antennas || []),
    problem_types: [...typeCounts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    mttr_minutes: mttr === null ? null : Math.round(mttr),
    affected_users_total: active.reduce((s, i) => s + (i.affected_users_count || 0), 0),
    generated_at: new Date().toISOString(),
  };
}
