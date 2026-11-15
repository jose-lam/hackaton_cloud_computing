import { ShieldAlert } from "lucide-react";
import { HealthBadge } from "../../components/domain";
import { cn, formatRelative } from "../../lib/format";
import { healthMeta, TRAFFIC } from "../../lib/labels";
import type { Antenna, RecurrentAntenna } from "../../types";

const pct = (v: number) => `${Math.min(100, Math.max(0, (v / TRAFFIC.SCALE_MAX) * 100))}%`;

/** Barra de tráfico con las bandas de umbral (0 | <60 | 60–129 | >129) marcadas. */
export function TrafficBar({ value, status }: { value: number; status: Antenna["health_status"] }) {
  const m = healthMeta(status);
  return (
    <div>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label="Tráfico de la antena"
        aria-valuemin={0}
        aria-valuemax={TRAFFIC.SCALE_MAX}
        aria-valuenow={value}
        aria-valuetext={`${value} GB/min, ${m.label}`}
      >
        {/* Bandas de referencia */}
        <span className="absolute inset-y-0 left-0 bg-health-caida/12" style={{ width: pct(TRAFFIC.DOWN_BELOW) }} aria-hidden />
        <span className="absolute inset-y-0 bg-health-normal/10" style={{ left: pct(TRAFFIC.DOWN_BELOW), width: `calc(${pct(TRAFFIC.SATURATED_ABOVE)} - ${pct(TRAFFIC.DOWN_BELOW)})` }} aria-hidden />
        <span className="absolute inset-y-0 right-0 bg-health-saturada/12" style={{ left: pct(TRAFFIC.SATURATED_ABOVE) }} aria-hidden />
        {/* Valor */}
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out" style={{ width: pct(value), background: m.color }} aria-hidden />
        {/* Marcas de umbral */}
        <span className="absolute -inset-y-0 w-px bg-fg/60" style={{ left: pct(TRAFFIC.DOWN_BELOW) }} aria-hidden />
        <span className="absolute -inset-y-0 w-px bg-fg/60" style={{ left: pct(TRAFFIC.SATURATED_ABOVE) }} aria-hidden />
      </div>
      <div className="num relative mt-1 h-3 text-2xs text-fg-subtle" aria-hidden>
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(TRAFFIC.DOWN_BELOW) }}>
          60
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(TRAFFIC.SATURATED_ABOVE) }}>
          129
        </span>
        <span className="absolute right-0">{TRAFFIC.SCALE_MAX}</span>
      </div>
    </div>
  );
}

export function AntennaCard({ antenna, recurrent, now, highlight }: { antenna: Antenna; recurrent?: RecurrentAntenna; now: number; highlight?: boolean }) {
  const risk = antenna.structural_risk || Boolean(recurrent);
  const disabled = antenna.health_status === "INHABILITADA";
  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-surface-1 p-4 shadow-card transition-colors",
        risk ? "border-prio-critica/25" : "border-line/10",
        highlight && "ring-1 ring-accent/60",
      )}
      aria-label={`Antena ${antenna.antenna_id}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("num text-base font-semibold text-fg", disabled && "text-fg-muted line-through decoration-fg-subtle")}>{antenna.antenna_id}</h3>
          <p className="truncate text-sm text-fg-muted">{antenna.zone_name}</p>
        </div>
        <HealthBadge status={antenna.health_status} />
      </header>

      <div className="flex items-baseline gap-1.5">
        <span className={cn("num text-3xl font-semibold leading-none tracking-tight", disabled ? "text-fg-subtle" : "text-fg")}>{antenna.last_traffic_gb}</span>
        <span className="text-sm text-fg-subtle">GB/min</span>
      </div>

      <TrafficBar value={antenna.last_traffic_gb} status={antenna.health_status} />

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line/8 pt-3">
        {risk ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-prio-critica/40 bg-prio-critica/10 px-2 text-2xs font-bold uppercase tracking-[0.08em] text-prio-critica">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Riesgo estructural
          </span>
        ) : null}
        {recurrent && <span className="text-xs text-fg-muted">Falla recurrente</span>}
        {antenna.updated_at && <span className="num ml-auto text-2xs text-fg-subtle">Act. {formatRelative(antenna.updated_at, now)}</span>}
      </footer>
    </article>
  );
}
