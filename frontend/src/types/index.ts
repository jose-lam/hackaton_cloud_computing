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
  /**
   * TODO(contrato): campo propuesto, NO está en TicketCreateRequest. El portal lo envía como
   * propiedad adicional (OpenAPI 3.0 permite propiedades extra); el backend puede ignorarlo.
   */
  incident_time?: string;
}

/** POST /tickets → 202 · TicketCreateResponse */
export interface TicketCreateResponse {
  ticket_id: string;
  status: TicketStatus | string;
  geohash: string;
}

/** GET /tickets → 200 · items[] · TicketDetail (allOf TicketCreateRequest + detalle) */
export interface TicketDetail extends TicketCreateRequest {
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
// TODO(contrato): GET /incidentes y GET /antenas aún NO existen en openapi.yaml.
// Son endpoints propuestos; hoy solo funcionan en modo mock. Ver lib/api/index.ts.
// ============================================================================

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
  ai_diagnosis: string | null;
  created_at: string;
  closed_at: string | null;
  // Campos opcionales que el front aprovecha si existen
  ai_confidence?: number | null;
  ticket_ids?: string[];
  antenna_id?: string | null;
  lat?: number;
  lon?: number;
}

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

/** TODO(contrato): serie horaria propuesta; no está en AnalyticsSummaryResponse (solo la entrega el mock). */
export interface TrendPoint {
  ts: string;
  reports: number;
  active_incidents: number;
  critical_antennas: number;
  affected_users: number;
  mttr_minutes: number | null;
}

/** GET /analytics/resumen → 200 · AnalyticsSummaryResponse */
export interface AnalyticsSummaryResponse {
  kpis: AnalyticsKpis;
  top_zones: { geohash: string; zone_name: string; incident_count: number }[];
  recurrent_antennas: RecurrentAntenna[];
  top_problem_types: { problem_type: string; count: number }[];
  /** El contrato lo define como `object` sin esquema; se normaliza con la forma propuesta de Incident. */
  master_incidents: Incident[];
  /** TODO(contrato): extensión propuesta (ver TrendPoint). Vacía si el API no la envía. */
  trend: TrendPoint[];
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
