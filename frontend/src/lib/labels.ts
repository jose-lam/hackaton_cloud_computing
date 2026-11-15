// Etiquetas en español y metadatos semánticos (íconos + clases) de los dominios.
import {
  Archive,
  Ban,
  BrainCircuit,
  ChevronsDown,
  CircleArrowDown,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Factory,
  Gauge,
  Hospital,
  MapPin,
  OctagonAlert,
  PhoneOff,
  RadioTower,
  School,
  ScanSearch,
  Antenna,
  Snail,
  TriangleAlert,
  Users,
  WifiOff,
  Wrench,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import type { HealthStatus, PriorityLevel, ProblemType, TicketStatus } from "../types";

export interface Meta {
  label: string;
  icon: LucideIcon;
  /** clases de texto/borde/fondo para badges */
  tone: string;
  /** color sólido (rgb var) para mapas y barras */
  color: string;
}

export const PRIORITY_META: Record<PriorityLevel, Meta> = {
  CRITICA: { label: "Crítica", icon: OctagonAlert, tone: "text-prio-critica border-prio-critica/40 bg-prio-critica/12", color: "rgb(var(--prio-critica))" },
  ALTA: { label: "Alta", icon: TriangleAlert, tone: "text-prio-alta border-prio-alta/40 bg-prio-alta/12", color: "rgb(var(--prio-alta))" },
  MEDIA: { label: "Media", icon: CircleDot, tone: "text-prio-media border-prio-media/40 bg-prio-media/10", color: "rgb(var(--prio-media))" },
  BAJA: { label: "Baja", icon: ChevronsDown, tone: "text-prio-baja border-prio-baja/35 bg-prio-baja/10", color: "rgb(var(--prio-baja))" },
};

export const HEALTH_META: Record<HealthStatus, Meta> = {
  NORMAL: { label: "Normal", icon: CircleCheck, tone: "text-health-normal border-health-normal/40 bg-health-normal/10", color: "rgb(var(--health-normal))" },
  CAIDA: { label: "Caída", icon: CircleArrowDown, tone: "text-health-caida border-health-caida/40 bg-health-caida/12", color: "rgb(var(--health-caida))" },
  SATURADA: { label: "Saturada", icon: Gauge, tone: "text-health-saturada border-health-saturada/40 bg-health-saturada/12", color: "rgb(var(--health-saturada))" },
  INHABILITADA: { label: "Inhabilitada", icon: Ban, tone: "text-health-inhabilitada border-health-inhabilitada/40 bg-health-inhabilitada/10 [&_.badge-label]:line-through", color: "rgb(var(--health-inhabilitada))" },
};

export const STATUS_META: Record<TicketStatus, Meta> = {
  Registrada: { label: "Registrada", icon: CircleDashed, tone: "text-fg-muted border-line/20 bg-surface-3/60", color: "rgb(var(--fg-muted))" },
  "En revisión": { label: "En revisión", icon: ScanSearch, tone: "text-accent border-accent/35 bg-accent/10", color: "rgb(var(--accent))" },
  "Siendo atendida": { label: "Siendo atendida", icon: Wrench, tone: "text-warn border-warn/35 bg-warn/10", color: "rgb(var(--warn))" },
  Solucionada: { label: "Solucionada", icon: CircleCheck, tone: "text-ok border-ok/35 bg-ok/10", color: "rgb(var(--ok))" },
  Cerrada: { label: "Cerrada", icon: Archive, tone: "text-fg-subtle border-line/15 bg-surface-2", color: "rgb(var(--fg-subtle))" },
};

export const TRIGGER_META: Record<string, { label: string; short: string; icon: LucideIcon }> = {
  COLECTIVO_10: { label: "Colectivo (≥10 reportes)", short: "Colectivo ≥10", icon: Users },
  TEMPRANO_IA: { label: "Detección temprana IA", short: "Temprano IA", icon: BrainCircuit },
  ANTENA_UMBRAL: { label: "Umbral de antena", short: "Umbral antena", icon: RadioTower },
};

export const POI_META: Record<string, { label: string; icon: LucideIcon }> = {
  hospital: { label: "Hospital", icon: Hospital },
  escuela: { label: "Escuela", icon: School },
  industria: { label: "Industria", icon: Factory },
};
export const poiMeta = (type: string) => POI_META[type] ?? { label: type ? type[0]?.toUpperCase() + type.slice(1) : "Otro", icon: MapPin };

export const PROBLEM_META: Record<ProblemType, { label: string; icon: LucideIcon }> = {
  SIN_INTERNET: { label: "Sin internet", icon: WifiOff },
  SIN_SENAL: { label: "Sin señal", icon: Antenna },
  INTERNET_LENTO: { label: "Internet lento", icon: Snail },
  FALLA_LLAMADAS: { label: "Falla en llamadas", icon: PhoneOff },
  OTRO: { label: "Otro", icon: HelpCircle },
};
export const problemLabel = (t: string) => PROBLEM_META[t as ProblemType]?.label ?? t;

export const statusMeta = (s: string): Meta => STATUS_META[s as TicketStatus] ?? STATUS_META.Registrada;
export const priorityMeta = (p: string): Meta => PRIORITY_META[p as PriorityLevel] ?? PRIORITY_META.BAJA;
export const healthMeta = (h: string): Meta => HEALTH_META[h as HealthStatus] ?? HEALTH_META.NORMAL;

// Umbrales de tráfico (GB/min)
export const TRAFFIC = { DOWN_BELOW: 60, SATURATED_ABOVE: 129, SCALE_MAX: 180 } as const;
