// Tipos de dominio compartidos. Los objetos del API pueden traer campos extra.

export const TICKET_STATUSES = ["Registrada", "En revisión", "Siendo atendida", "Solucionada", "Cerrada"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const CLOSED_STATUSES: readonly TicketStatus[] = ["Solucionada", "Cerrada"];

export const PRIORITY_LEVELS = ["CRITICA", "ALTA", "MEDIA", "BAJA"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const HEALTH_STATUSES = ["CAIDA", "INHABILITADA", "SATURADA", "NORMAL"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export type TriggerType = "COLECTIVO_10" | "TEMPRANO_IA" | "ANTENA_UMBRAL";

export const PROBLEM_TYPES = ["SIN_INTERNET", "SIN_SENAL", "INTERNET_LENTO", "FALLA_LLAMADAS", "OTRO"] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

// ============================================================================
// Contrato REST (contratos/openapi.yaml). Los nombres de campo son los del contrato.
// Los normalizadores de lib/api rellenan valores por defecto cuando un campo falta.
// ============================================================================

/** TicketDetail.history[] */
export interface HistoryEntry {
  /** Ausente/null en la primera entrada (creación del ticket). */
  old_status: string | null;
  new_status: string;
  changed_by: string;
  note: string;
  timestamp: string | null;
}

/** POST /tickets · TicketCreateRequest */
export interface TicketCreateRequest {
  user_id: string;
  service_number: string;
  email?: string;
  phone?: string;
  location_text: string;
  lat: number;
  lon: number;
  problem_type: ProblemType | string;
  description: string;
  /** Fecha y hora del inconveniente (ISO 8601, opcional). */
  incident_time?: string;
}

/** POST /tickets → 202 · TicketCreateResponse */
export interface TicketCreateResponse {
  ticket_id: string;
  status: TicketStatus | string;
  geohash: string;
}

/** GET /tickets → 200 · items[] · TicketDetail (allOf TicketCreateRequest + detalle) */
export interface TicketDetail extends Omit<TicketCreateRequest, "incident_time"> {
  /** Guardado y devuelto por el backend; null en tickets antiguos sin el dato. */
  incident_time: string | null;
  ticket_id: string;
  geohash: string;
  status: TicketStatus | string;
  ai_category: string | null;
  master_incident_id: string | null;
  priority_score: number | null;
  priority_level: PriorityLevel | null;
  created_at: string;
  history: HistoryEntry[];
}
/** Alias usado por la UI. */
export type Ticket = TicketDetail;

/** GET /tickets → 200 */
export interface TicketListResponse {
  items: TicketDetail[];
}

/** PATCH /tickets/{ticket_id}/estado (200 sin cuerpo · 400 estado fuera de catálogo · 404 ticket no encontrado) */
export interface TicketStatusUpdateRequest {
  new_status: TicketStatus;
  changed_by?: string;
  note?: string;
}

export type PoiType = "hospital" | "escuela" | "industria" | string;

export interface CriticalPoi {
  name: string;
  type: PoiType;
  distance_m: number;
}

// ============================================================================
// GET /incidentes y GET /antenas → 200 { items: [...] } (esquemas Incidente y Antena).
// ============================================================================

/** Esquema Incidente. */
export interface Incident {
  incident_id: string;
  geohash: string;
  zone_name: string;
  trigger_type: TriggerType | string;
  affected_users_count: number;
  critical_pois: CriticalPoi[];
  priority_score: number;
  priority_level: PriorityLevel;
  status: TicketStatus | string;
  /** null mientras la IA no termina el análisis. */
  ai_diagnosis: string | null;
  created_at: string;
  closed_at: string | null;
  // Fuera del esquema Incidente: se aprovechan solo si el backend los envía.
  ai_confidence?: number | null;
  antenna_id?: string | null;
}

/** GET /incidentes → 200 */
export interface IncidentListResponse {
  items: Incident[];
}

/** Esquema Antena. */
export interface Antenna {
  antenna_id: string;
  zone_name: string;
  lat: number;
  lon: number;
  geohash: string;
  last_traffic_gb: number;
  health_status: HealthStatus;
  updated_at: string;
  structural_risk: boolean;
}

/** GET /antenas → 200 */
export interface AntennaListResponse {
  items: Antenna[];
}

/** GET /analytics/resumen · AnalyticsSummaryResponse.kpis */
export interface AnalyticsKpis {
  total_tickets: number | null;
  active_incidents: number | null;
  avg_mttr_minutes: number | null;
  total_affected_users: number | null;
}

/** AnalyticsSummaryResponse.recurrent_antennas[] */
export interface RecurrentAntenna {
  antenna_id: string;
  health_status: HealthStatus;
  last_traffic_gb: number;
  structural_risk: boolean;
  /** Campos extra que hoy envía el backend (api_crud.py); no están en el contrato. */
  zone_name?: string;
  geohash?: string;
}

/** Punto horario construido en el cliente (lib/trend.ts) a partir de created_at/closed_at. */
export interface TrendPoint {
  /** Inicio de la hora (ISO 8601). */
  ts: string;
  /** Tickets creados en esa hora. */
  reports: number;
  /** Incidentes abiertos al cierre de la hora. */
  active_incidents: number;
  /** Usuarios afectados por esos incidentes. */
  affected_users: number;
  /** MTTR acumulado de los incidentes cerrados hasta esa hora. */
  mttr_minutes: number | null;
}

/** GET /analytics/resumen → 200 · AnalyticsSummaryResponse */
export interface AnalyticsSummaryResponse {
  kpis: AnalyticsKpis;
  top_zones: { geohash: string; zone_name: string; incident_count: number }[];
  recurrent_antennas: RecurrentAntenna[];
  top_problem_types: { problem_type: string; count: number }[];
  /** El contrato lo define como `object`; se normaliza con el esquema Incidente. */
  master_incidents: Incident[];
}
export type AnalyticsSummary = AnalyticsSummaryResponse;

export interface TicketQuery {
  user_id?: string;
  ticket_id?: string;
  geohash?: string;
}

/** Interfaz común del API real y del adaptador mock. */
export interface SentinelApi {
  createTicket(input: TicketCreateRequest): Promise<TicketCreateResponse>;
  getTickets(query: TicketQuery, signal?: AbortSignal): Promise<Ticket[]>;
  updateTicketStatus(ticketId: string, input: TicketStatusUpdateRequest): Promise<void>;
  getAnalytics(signal?: AbortSignal): Promise<AnalyticsSummary>;
  getIncidents(signal?: AbortSignal): Promise<Incident[]>;
  getAntennas(signal?: AbortSignal): Promise<Antenna[]>;
}

/** true si el estado es Solucionada o Cerrada. */
export const isClosedStatus = (s: string): boolean => (CLOSED_STATUSES as readonly string[]).includes(s);
