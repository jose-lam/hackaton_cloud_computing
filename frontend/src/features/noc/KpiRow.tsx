import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, RadioTower, Siren, Timer, Users, type LucideIcon } from "lucide-react";
import { Sparkline } from "../../components/domain";
import { Skeleton } from "../../components/ui";
import { useCountUp } from "../../lib/hooks";
import { cn, formatMinutes, formatNumber } from "../../lib/format";
import type { AnalyticsSummary, Antenna, Incident, TrendPoint } from "../../types";
import { isClosedStatus } from "../../types";

type Field = Exclude<keyof TrendPoint, "ts">;

interface KpiDef {
  key: Field;
  label: string;
  icon: LucideIcon;
  value: number | null;
  sub: string;
  format?: (n: number) => string;
  accent: string;
}

interface Props {
  incidents: Incident[] | undefined;
  antennas: Antenna[] | undefined;
  analytics: AnalyticsSummary | undefined;
  loading: boolean;
  updatedAt: number;
}

export function KpiRow({ incidents, antennas, analytics, loading, updatedAt }: Props) {
  const active = incidents?.filter((i) => !isClosedStatus(i.status)) ?? [];
  const critical = active.filter((i) => i.priority_level === "CRITICA").length;
  const count = (s: Antenna["health_status"]) => antennas?.filter((a) => a.health_status === s).length ?? 0;
  const critAnts = antennas ? count("CAIDA") + count("INHABILITADA") + count("SATURADA") : null;
  const affected = analytics?.kpis.total_affected_users ?? (incidents ? active.reduce((s, i) => s + i.affected_users_count, 0) : null);

  const kpis: KpiDef[] = [
    { key: "active_incidents", label: "Incidentes activos", icon: Siren, value: incidents ? active.length : null, sub: `${critical} de prioridad crítica`, accent: "rgb(var(--prio-critica))" },
    {
      key: "critical_antennas",
      label: "Antenas críticas",
      icon: RadioTower,
      value: critAnts,
      sub: `${count("CAIDA")} caídas · ${count("INHABILITADA")} inhab. · ${count("SATURADA")} saturadas`,
      accent: "rgb(var(--health-caida))",
    },
    { key: "affected_users", label: "Usuarios afectados", icon: Users, value: affected, sub: analytics ? "Usuarios únicos con reportes" : "En incidentes activos", accent: "rgb(var(--prio-alta))" },
    { key: "mttr_minutes", label: "MTTR promedio", icon: Timer, value: analytics?.kpis.avg_mttr_minutes ?? null, sub: "Tiempo medio de restablecimiento", format: formatMinutes, accent: "rgb(var(--accent))" },
  ];

  // Serie de la sesión: respaldo si el API no entrega "trend"
  const [session, setSession] = useState<Record<string, number[]>>({});
  const signature = kpis.map((k) => k.value ?? "x").join("|");
  useEffect(() => {
    if (!updatedAt) return;
    setSession((prev) => {
      const next: Record<string, number[]> = { ...prev };
      for (const k of kpis) if (k.value !== null) next[k.key] = [...(prev[k.key] ?? []), k.value].slice(-24);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se registra una muestra por refresco
  }, [updatedAt, signature]);

  const trend = analytics?.trend ?? [];
  const fromTrend = trend.length >= 2;

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" role="list" aria-label="Indicadores clave">
      {kpis.map((k) => {
        const series = fromTrend ? trend.map((p) => p[k.key] ?? 0) : (session[k.key] ?? []);
        if (fromTrend && k.value !== null) series[series.length - 1] = k.value; // el último punto es el valor en vivo
        return <KpiCard key={k.key} def={k} series={series} loading={loading && k.value === null} compareLabel={fromTrend ? "vs. hora anterior" : "vs. lectura anterior"} />;
      })}
    </div>
  );
}

function KpiCard({ def, series, loading, compareLabel }: { def: KpiDef; series: number[]; loading: boolean; compareLabel: string }) {
  const animated = useCountUp(def.value);
  const Icon = def.icon;
  const prev = series.length >= 2 ? series[series.length - 2] : undefined;
  const delta = def.value !== null && prev !== undefined ? Math.round(def.value - prev) : null;
  // En todos estos KPIs, subir es peor
  const deltaTone = delta === null || delta === 0 ? "text-fg-muted bg-surface-3/70" : delta > 0 ? "text-danger bg-danger/10" : "text-ok bg-ok/10";
  const DeltaIcon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const shown = animated === null ? null : Math.max(0, animated); // evita "-0" en la animación
  const display = shown === null ? "—" : def.format ? def.format(shown) : formatNumber(Math.round(shown));

  return (
    <article role="listitem" className="relative overflow-hidden rounded-lg border border-line/10 bg-surface-1 p-4 shadow-card">
      <span className="absolute inset-x-0 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg, ${def.accent}, transparent 70%)` }} aria-hidden />
      <div className="flex items-center gap-2 text-fg-muted">
        <span className="grid h-6 w-6 place-items-center rounded bg-surface-3" style={{ color: def.accent }}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-[0.1em]">{def.label}</h3>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <p className="num whitespace-nowrap text-3xl font-semibold leading-none tracking-tight text-fg" aria-live="polite">
              {display}
            </p>
          )}
          <div className="mt-2.5 flex h-5 items-center gap-2 whitespace-nowrap">
            {delta !== null && (
              <span className={cn("num inline-flex h-5 items-center gap-0.5 rounded-sm px-1.5 text-2xs font-semibold", deltaTone)}>
                <DeltaIcon className="h-3 w-3" aria-hidden />
                {delta > 0 ? "+" : ""}
                {def.format ? def.format(Math.abs(delta)).replace(/^/, delta < 0 ? "−" : "") : delta}
                <span className="sr-only"> {compareLabel}</span>
              </span>
            )}
            {delta !== null && <span className="truncate text-xs text-fg-subtle">{compareLabel}</span>}
          </div>
        </div>
        <Sparkline values={series} color={def.accent} label={`Tendencia de ${def.label.toLowerCase()}`} className="w-[96px] shrink-0 2xl:w-[120px]" />
      </div>
      <p className="mt-2 truncate border-t border-line/8 pt-2 text-xs text-fg-muted">{def.value === null ? "Sin datos disponibles" : def.sub}</p>
    </article>
  );
}
