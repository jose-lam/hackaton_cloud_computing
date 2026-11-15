import { Activity, MapPinned, PieChart as PieIcon, ShieldAlert, Timer } from "lucide-react";
import { ProblemTypesChart, TopZonesChart, TrendChart } from "./charts";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { HealthBadge } from "../../components/domain";
import { useAnalytics, useAntennas } from "../../lib/queries";
import { formatMinutes, formatNumber } from "../../lib/format";

export function AnalyticsPage() {
  const analytics = useAnalytics();
  const antennas = useAntennas();
  const d = analytics.data;
  const retry = () => void analytics.refetch();

  const body = (content: (data: NonNullable<typeof d>) => React.ReactNode, empty: (data: NonNullable<typeof d>) => boolean, h = "h-64") => {
    if (analytics.isLoading) return <Skeleton className={`${h} w-full`} />;
    if (!d) return <ErrorState compact title="No se pudo cargar la analítica" description={analytics.error?.message} onRetry={retry} retrying={analytics.isFetching} />;
    if (empty(d)) return <EmptyState compact title="Aún no hay datos suficientes" />;
    return <div className={h}>{content(d)}</div>;
  };

  const totalReports = d?.kpis.total_tickets ?? null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-6">
      {/* Cifras resumen */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Reportes registrados", value: totalReports === null ? "—" : formatNumber(totalReports) },
          { label: "Usuarios afectados", value: formatNumber(d?.kpis.total_affected_users ?? null) },
          { label: "MTTR promedio", value: formatMinutes(d?.kpis.avg_mttr_minutes ?? null) },
          { label: "Antenas con riesgo estructural", value: formatNumber(d ? d.recurrent_antennas.length : null) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-line/10 bg-surface-1 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">{s.label}</p>
            {analytics.isLoading ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="num mt-2 text-2xl font-semibold text-fg">{s.value}</p>}
          </div>
        ))}
      </div>

      <Card aria-labelledby="an-trend">
        <CardHeader id="an-trend" icon={<Activity />} title="Tendencia de reportes" subtitle="Reportes ciudadanos por hora · últimas 12 h (hora de Lima)" />
        <div className="p-4">{body((x) => <TrendChart data={x.trend} />, (x) => x.trend.length < 2, "h-56")}</div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card aria-labelledby="an-zones">
          <CardHeader id="an-zones" icon={<MapPinned />} title="Zonas con más incidencias" subtitle="Top 6 zonas por número de incidencias" />
          <div className="p-4">{body((x) => <TopZonesChart data={x.top_zones} />, (x) => !x.top_zones.length)}</div>
        </Card>
        <Card aria-labelledby="an-types">
          <CardHeader id="an-types" icon={<PieIcon />} title="Tipos de falla" subtitle="Distribución de reportes por tipo" />
          <div className="p-4">{body((x) => <ProblemTypesChart data={x.top_problem_types} />, (x) => !x.top_problem_types.length)}</div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card aria-labelledby="an-rec" className="xl:col-span-2">
          <CardHeader id="an-rec" icon={<ShieldAlert />} title="Antenas con riesgo estructural" subtitle="Fallas recurrentes · candidatas a inspección" />
          <div className="overflow-x-auto">
            {analytics.isLoading ? (
              <div className="p-4">
                <Skeleton className="h-24" />
              </div>
            ) : !d?.recurrent_antennas.length ? (
              <EmptyState compact title="Sin fallas recurrentes" />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-2xs uppercase tracking-[0.08em] text-fg-subtle">
                  <tr className="[&>th]:border-b [&>th]:border-line/10 [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-semibold">
                    <th scope="col">Antena</th>
                    <th scope="col">Zona</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="text-right">
                      Tráfico
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.recurrent_antennas.map((r) => {
                    const a = antennas.data?.find((x) => x.antenna_id === r.antenna_id);
                    return (
                      <tr key={r.antenna_id} className="[&>td]:border-b [&>td]:border-line/6 [&>td]:px-4 [&>td]:py-3">
                        <td className="num font-semibold">{r.antenna_id}</td>
                        <td className="text-fg-muted">{r.zone_name ?? a?.zone_name ?? "—"}</td>
                        <td>
                          <HealthBadge status={r.health_status} />
                        </td>
                        <td className="num text-right font-semibold">
                          {r.last_traffic_gb} <span className="text-2xs font-normal text-fg-subtle">GB/min</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <Card aria-labelledby="an-mttr">
          <CardHeader id="an-mttr" icon={<Timer />} title="Tiempo de restablecimiento" subtitle="MTTR por hora (min)" />
          <div className="p-4">
            {analytics.isLoading ? (
              <Skeleton className="h-32" />
            ) : d && d.kpis.avg_mttr_minutes !== null ? (
              <div>
                <p className="num text-3xl font-semibold">{formatMinutes(d.kpis.avg_mttr_minutes)}</p>
                <p className="mt-1 text-sm text-fg-muted">Promedio de incidentes cerrados</p>
                {d.trend.length >= 2 && (
                <ul className="mt-4 grid grid-cols-6 items-end gap-1" aria-label="MTTR por hora">
                  {d.trend.slice(-6).map((p) => {
                    const max = Math.max(...d.trend.slice(-6).map((x) => x.mttr_minutes ?? 0), 1);
                    return (
                      <li key={p.ts} className="flex flex-col items-center gap-1" title={`${formatMinutes(p.mttr_minutes)}`}>
                        <span className="num text-2xs text-fg-subtle">{p.mttr_minutes ?? "—"}</span>
                        <span className="w-full rounded-t-sm bg-accent/60" style={{ height: `${Math.max(6, ((p.mttr_minutes ?? 0) / max) * 64)}px` }} aria-hidden />
                      </li>
                    );
                  })}
                </ul>
                )}
              </div>
            ) : (
              <EmptyState compact title="Sin datos de MTTR" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
