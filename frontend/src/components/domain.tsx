// Badges de dominio: siempre ícono + texto, nunca solo color.
import { Badge } from "./ui";
import { healthMeta, poiMeta, priorityMeta, statusMeta, TRIGGER_META } from "../lib/labels";
import { cn } from "../lib/format";

export function PriorityBadge({ level, size }: { level: string; size?: "sm" | "md" }) {
  const m = priorityMeta(level);
  return (
    <Badge tone={m.tone} icon={m.icon} size={size}>
      {m.label}
    </Badge>
  );
}

export function StatusBadge({ status, size }: { status: string; size?: "sm" | "md" }) {
  const m = statusMeta(status);
  return (
    <Badge tone={m.tone} icon={m.icon} size={size} className="normal-case tracking-normal">
      {m.label}
    </Badge>
  );
}

export function HealthBadge({ status, size }: { status: string; size?: "sm" | "md" }) {
  const m = healthMeta(status);
  return (
    <Badge tone={m.tone} icon={m.icon} size={size}>
      {m.label}
    </Badge>
  );
}

export function PoiBadge({ type }: { type: string }) {
  const m = poiMeta(type);
  const tone =
    type === "hospital"
      ? "text-prio-critica border-prio-critica/30 bg-prio-critica/8"
      : type === "escuela"
        ? "text-[rgb(125_190_255)] border-[rgb(125_190_255)]/30 bg-[rgb(125_190_255)]/8"
        : "text-prio-alta border-prio-alta/30 bg-prio-alta/8";
  return (
    <Badge tone={tone} icon={m.icon} className="normal-case tracking-normal">
      {m.label}
    </Badge>
  );
}

export function TriggerLabel({ type, className }: { type: string; className?: string }) {
  const m = TRIGGER_META[type];
  const Icon = m?.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-fg-muted", className)} title={m?.label}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />}
      <span className="truncate">{m?.short ?? (type || "—")}</span>
    </span>
  );
}

/** Indicador mono de severidad (punto + texto) para listas densas. */
export function LiveDot({ state }: { state: "live" | "paused" | "error" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        state === "live" && "animate-live-pulse bg-ok",
        state === "paused" && "bg-fg-subtle",
        state === "error" && "bg-danger",
      )}
    />
  );
}

/** Mini gráfico de línea (SVG) para KPIs. */
export function Sparkline({ values, color = "rgb(var(--accent))", className, label }: { values: number[]; color?: string; className?: string; label: string }) {
  const w = 120;
  const h = 36;
  if (values.length < 2) return <div className={cn("h-9 w-[120px]", className)} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  const gid = `spark-${label.replace(/\W/g, "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-9 w-[120px] overflow-visible", className)} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} stroke="rgb(var(--surface-1))" strokeWidth="1.5" />}
    </svg>
  );
}
