// Datos semilla coherentes con el guion de la demo.
import type { Antenna, HealthStatus, HistoryEntry, Incident, PriorityLevel, ProblemType, TicketDetail, TicketStatus } from "../../types";
import { encodeGeohash } from "../geo";

/** TicketDetail del contrato + zona interna (solo para agrupar la analítica; no se expone). */
export interface MockTicket extends TicketDetail {
  zone_name: string;
}
export interface MockIncident extends Incident {
  lat: number;
  lon: number;
}
export interface MockState {
  antennas: Antenna[];
  incidents: MockIncident[];
  tickets: MockTicket[];
  /** Histórico horario (11 puntos) para sparklines y tendencia */
  history: { ts: string; reports: number; active_incidents: number; critical_antennas: number; affected_users: number; mttr_minutes: number }[];
  seq: { user: number; incident: number };
}

export const MIN = 60_000;
export const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
export const randomId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
/** Datos de contacto ficticios y deterministas para el usuario U-n. */
export const contactFor = (user: number) => ({
  service_number: String(1020000000 + user),
  email: `usuario${user}@correo.pe`,
  phone: `+5199${String(user).padStart(7, "0")}`,
});
export const levelFromScore = (s: number): PriorityLevel => (s >= 85 ? "CRITICA" : s >= 65 ? "ALTA" : s >= 40 ? "MEDIA" : "BAJA");

export const DESCRIPTIONS: Record<ProblemType, string[]> = {
  SIN_SENAL: ["No tengo señal, el celular dice «Solo emergencias».", "Cero barras desde hace media hora.", "Perdí la señal en toda la cuadra."],
  SIN_INTERNET: ["Se cayó el internet en todo el edificio.", "Sin datos móviles desde hace 20 minutos.", "No cargan páginas ni WhatsApp."],
  INTERNET_LENTO: ["El internet está lentísimo, no carga ni un video.", "Muy lento en hora punta.", "Las videollamadas se congelan."],
  FALLA_LLAMADAS: ["Las llamadas se cortan apenas contestan.", "No puedo hacer llamadas, da ocupado.", "Se escucha entrecortado en las llamadas."],
  OTRO: ["El router muestra una luz roja intermitente.", "Recibo mensajes con mucho retraso.", "Intermitencia general del servicio."],
};
export const TYPES_CYCLE: ProblemType[] = ["SIN_SENAL", "SIN_INTERNET", "FALLA_LLAMADAS", "SIN_INTERNET", "INTERNET_LENTO", "SIN_SENAL"];

const antenna = (antenna_id: string, zone_name: string, lat: number, lon: number, health_status: HealthStatus, last_traffic_gb: number, structural_risk = false): Antenna => ({
  antenna_id,
  zone_name,
  lat,
  lon,
  geohash: encodeGeohash(lat, lon, 6),
  last_traffic_gb,
  health_status,
  updated_at: iso(),
  structural_risk,
});

export function createSeed(): MockState {
  const antennas: Antenna[] = [
    antenna("ANT-HOSP-01", "Cercado de Lima – Hospital Loayza", -12.0499, -77.0436, "CAIDA", 42),
    antenna("ANT-RES-02", "Jesús María – Residencial San Felipe", -12.0831, -77.0515, "CAIDA", 53),
    antenna("ANT-REC-09", "Rímac – Cerro San Cristóbal", -12.0306, -77.0229, "INHABILITADA", 0, true),
    antenna("ANT-SI-05", "San Isidro – Centro Financiero", -12.0966, -77.0336, "SATURADA", 142),
    antenna("ANT-MIR-04", "Miraflores – Parque Kennedy", -12.1211, -77.0297, "NORMAL", 96),
    antenna("ANT-SUR-11", "Santiago de Surco – Monterrico", -12.1065, -76.9715, "NORMAL", 88),
    antenna("ANT-SJL-07", "San Juan de Lurigancho – Canto Grande", -11.9805, -77.0003, "NORMAL", 104),
    antenna("ANT-CHO-03", "Chorrillos – Malecón", -12.1647, -77.0253, "NORMAL", 77),
    antenna("ANT-OLI-06", "Los Olivos – Plaza Norte", -11.9915, -77.0605, "SATURADA", 134),
  ];

  const mk = (
    incident_id: string,
    antenna_id: string,
    zone_name: string,
    lat: number,
    lon: number,
    trigger_type: Incident["trigger_type"],
    priority_score: number,
    status: TicketStatus,
    createdMinAgo: number,
    extra: Partial<MockIncident>,
  ): MockIncident => ({
    incident_id,
    antenna_id,
    zone_name,
    lat,
    lon,
    geohash: encodeGeohash(lat, lon, 6),
    trigger_type,
    affected_users_count: 0,
    critical_pois: [],
    priority_score,
    priority_level: levelFromScore(priority_score),
    status,
    ai_diagnosis: null,
    ai_confidence: null,
    created_at: iso(createdMinAgo * MIN),
    closed_at: null,
    ...extra,
  });

  const incidents: MockIncident[] = [
    mk("INC-001", "ANT-HOSP-01", "Cercado de Lima – Hospital Loayza", -12.0493, -77.0427, "COLECTIVO_10", 96, "En revisión", 38, {
      critical_pois: [
        { name: "Hospital Nacional Arzobispo Loayza", type: "hospital", distance_m: 180 },
        { name: "G.U.E. Nuestra Señora de Guadalupe", type: "escuela", distance_m: 750 },
      ],
      ai_confidence: 0.94,
      ai_diagnosis:
        "La antena ANT-HOSP-01 reporta 42 GB/min, por debajo del umbral operativo de 60 GB/min, y concentra 15 reportes ciudadanos en 25 minutos.\n\n" +
        "El patrón es compatible con una falla del enlace de transmisión (backhaul) y no con saturación: el tráfico cayó de forma abrupta y los reportes describen pérdida total de datos y llamadas.\n\n" +
        "Impacto crítico: el Hospital Nacional Arzobispo Loayza está a 180 m. Recomendación: despachar cuadrilla de inmediato y activar una celda de respaldo temporal.",
    }),
    mk("INC-002", "ANT-RES-02", "Jesús María – Residencial San Felipe", -12.0826, -77.0509, "TEMPRANO_IA", 74, "Siendo atendida", 70, {
      critical_pois: [{ name: "I.E. Residencial San Felipe", type: "escuela", distance_m: 260 }],
      ai_confidence: 0.81,
      ai_diagnosis:
        "El modelo detectó una caída progresiva de tráfico en ANT-RES-02 (de 98 a 53 GB/min en 40 minutos) antes de alcanzar el umbral colectivo de 10 reportes.\n\n" +
        "Probable degradación del módulo de radio. Zona residencial densa con un colegio a 260 m. Prioridad ALTA; cuadrilla en camino.",
    }),
    mk("INC-003", "ANT-REC-09", "Rímac – Cerro San Cristóbal", -12.0313, -77.0236, "ANTENA_UMBRAL", 58, "En revisión", 150, {
      critical_pois: [
        { name: "Parque Industrial del Rímac", type: "industria", distance_m: 420 },
        { name: "I.E. Ricardo Bentín", type: "escuela", distance_m: 610 },
      ],
      ai_confidence: 0.88,
      ai_diagnosis:
        "ANT-REC-09 está inhabilitada (0 GB/min) y acumula 6 fallas en los últimos 14 días.\n\n" +
        "La recurrencia apunta a un problema estructural (torre o soporte afectados por vibración y humedad) y no a un fallo puntual del equipo: las tres reparaciones previas de hardware no resolvieron la causa raíz.\n\n" +
        "Recomendación: inspección estructural prioritaria y evaluar la reubicación de la antena.",
    }),
    mk("INC-000", "ANT-MIR-04", "Miraflores – Parque Kennedy", -12.1211, -77.0297, "TEMPRANO_IA", 35, "Cerrada", 26 * 60, {
      affected_users_count: 6,
      closed_at: iso(26 * 60 * MIN - 52 * MIN),
      ai_confidence: 0.72,
      ai_diagnosis: "Microcorte por un reinicio programado no notificado. El servicio se restableció sin intervención en campo.",
    }),
    mk("INC-00A", "ANT-SI-05", "San Isidro – Centro Financiero", -12.0966, -77.0336, "ANTENA_UMBRAL", 44, "Solucionada", 30 * 60, {
      affected_users_count: 4,
      closed_at: iso(30 * 60 * MIN - 38 * MIN),
      ai_confidence: 0.79,
      ai_diagnosis: "Saturación en hora punta (>129 GB/min). Se balanceó la carga hacia celdas vecinas.",
    }),
  ];

  const tickets: MockTicket[] = [];
  let user = 1001;
  const addLinked = (inc: MockIncident, n: number, path: TicketStatus[], startMin: number) => {
    for (let i = 0; i < n; i++) {
      const createdMs = (startMin - i * 2) * MIN;
      const lat = inc.lat + (Math.random() - 0.5) * 0.004;
      const lon = inc.lon + (Math.random() - 0.5) * 0.004;
      const type = TYPES_CYCLE[i % TYPES_CYCLE.length] ?? "OTRO";
      const history: HistoryEntry[] = [{ old_status: null, new_status: "Registrada", changed_by: "CIUDADANO", note: "Reporte recibido", timestamp: iso(createdMs) }];
      for (let k = 1; k < path.length; k++) {
        history.push({
          old_status: path[k - 1] ?? null,
          new_status: path[k] ?? "Registrada",
          changed_by: k === 1 ? "SISTEMA" : "OPERADOR",
          note: k === 1 ? `Vinculado al incidente maestro ${inc.incident_id}` : "Cuadrilla técnica asignada",
          timestamp: iso(Math.max(0, createdMs - k * 6 * MIN)),
        });
      }
      tickets.push({
        ticket_id: inc.incident_id === "INC-001" && i === 0 ? "TCK-DEMO01" : randomId("TCK"),
        user_id: `U-${user}`,
        ...contactFor(user++),
        status: path[path.length - 1] ?? "Registrada",
        problem_type: type,
        description: DESCRIPTIONS[type][i % 3] ?? "",
        location_text: inc.zone_name,
        zone_name: inc.zone_name,
        ai_category: "CORTE_TOTAL_DATOS",
        priority_score: inc.priority_score,
        priority_level: inc.priority_level,
        master_incident_id: inc.incident_id,
        created_at: iso(createdMs),
        geohash: encodeGeohash(lat, lon, 6),
        lat,
        lon,
        history,
      });
    }
    inc.affected_users_count = n;
  };
  const [i1, i2, i3] = incidents;
  if (i1) addLinked(i1, 15, ["Registrada", "En revisión"], 36);
  if (i2) addLinked(i2, 9, ["Registrada", "En revisión", "Siendo atendida"], 68);
  if (i3) addLinked(i3, 4, ["Registrada", "En revisión"], 145);

  // Histórico horario para sparklines (11 h previas)
  const history: MockState["history"] = [];
  const reports = [6, 4, 3, 5, 8, 11, 9, 7, 10, 14, 19];
  const active = [1, 1, 0, 1, 1, 2, 2, 2, 2, 3, 3];
  const crit = [2, 2, 1, 2, 2, 3, 3, 3, 3, 4, 4];
  const affected = [4, 4, 0, 6, 6, 10, 10, 13, 13, 22, 26];
  const mttr = [58, 55, 55, 52, 50, 50, 49, 48, 47, 46, 45];
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  for (let h = 11; h >= 1; h--) {
    const idx = 11 - h;
    history.push({
      ts: new Date(hourStart.getTime() - h * 60 * MIN).toISOString(),
      reports: reports[idx] ?? 0,
      active_incidents: active[idx] ?? 0,
      critical_antennas: crit[idx] ?? 0,
      affected_users: affected[idx] ?? 0,
      mttr_minutes: mttr[idx] ?? 45,
    });
  }

  return {
    antennas,
    incidents,
    tickets,
    history,
    seq: { user, incident: 3 },
  };
}
