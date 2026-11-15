import { Link } from "react-router-dom";
import { ArrowRight, Map as MapIcon, Siren, Users } from "lucide-react";
import { KpiRow } from "./KpiRow";
import { NetworkMap } from "./NetworkMap";
import { IncidentQueue } from "./IncidentQueue";
import { RiskPanel } from "./RiskPanel";
import { useNoc } from "./noc-context";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { PriorityBadge, StatusBadge } from "../../components/domain";
import { useAnalytics, useAntennas, useIncidents } from "../../lib/queries";
import { useNow } from "../../lib/hooks";
import { cn, formatAge } from "../../lib/format";
import { poiMeta, priorityMeta } from "../../lib/labels";
import { isClosedStatus, type Incident } from "../../types";

export function OverviewPage() {
  const incidents = useIncidents();
  const antennas = useAntennas();
  const analytics = useAnalytics();
  const { openIncident } = useNoc();
  const updatedAt = Math.max(incidents.dataUpdatedAt, antennas.dataUpdatedAt, analytics.dataUpdatedAt);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-6">
      <KpiRow incidents={incidents.data} antennas={antennas.data} analytics={analytics.data} loading={incidents.isLoading || antennas.isLoading || analytics.isLoading} updatedAt={updatedAt} />

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="flex flex-col xl:col-span-8" aria-labelledby="map-title">
          <CardHeader id="map-title" icon={<MapIcon />} title="Mapa de red · Lima Metropolitana" subtitle="Antenas por estado y áreas de incidentes activos" />
          <div className="flex-1 p-3">
            <NetworkMap className="h-full min-h-[460px]" antennas={antennas.data} incidents={incidents.data} loading={antennas.isLoading} onOpenIncident={openIncident} />
          </div>
        </Card>
        <div className="flex flex-col gap-4 xl:col-span-4">
          <PriorityNow incidents={incidents.data} loading={incidents.isLoading} error={incidents.error} onRetry={() => void incidents.refetch()} onOpen={openIncident} />
          <RiskPanel antennas={antennas.data} analytics={analytics.data} loading={antennas.isLoading || analytics.isLoading} error={antennas.error ?? analytics.error} onRetry={() => void analytics.refetch()} />
        </div>
      </div>

      <IncidentQueue incidents={incidents.data} loading={incidents.isLoading} error={incidents.error} onRetry={() => void incidents.refetch()} retrying={incidents.isFetching} maxHeight="520px" />
    </div>
  );
}

function PriorityNow({ incidents, loading, error, onRetry, onOpen }: { incidents: Incident[] | undefined; loading: boolean; error: Error | null; onRetry: () => void; onOpen: (id: string) => void }) {
  const now = useNow(30_000);
  const top = (incidents ?? [])
    .filter((i) => !isClosedStatus(i.status))
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 4);
  return (
    <Card aria-labelledby="prio-title" className="flex-1">
      <CardHeader
        id="prio-title"
        icon={<Siren />}
        title="Atención prioritaria"
        subtitle="Incidentes activos con mayor puntaje"
        actions={
          <Link to="/noc/incidentes" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Ver todos <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        }
      />
      <div className="p-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[68px]" />
            ))}
          </div>
        ) : error && !incidents ? (
          <ErrorState compact description={error.message} onRetry={onRetry} />
        ) : !top.length ? (
          <EmptyState compact title="Sin incidentes activos" description="Todo en orden por ahora." />
        ) : (
          <ul className="space-y-2">
            {top.map((i) => {
              const m = priorityMeta(i.priority_level);
              return (
                <li key={i.incident_id}>
                  <button
                    type="button"
                    onClick={() => onOpen(i.incident_id)}
                    className="group relative flex w-full items-start gap-3 overflow-hidden rounded-md border border-line/10 bg-surface-2 py-2.5 pl-4 pr-3 text-left transition-colors hover:border-line/25 hover:bg-surface-3/60"
                  >
                    <span className="absolute inset-y-0 left-0 w-1" style={{ background: m.color }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <PriorityBadge level={i.priority_level} />
                        <span className="num text-2xs text-fg-subtle">{i.incident_id}</span>
                        <span className="num ml-auto text-2xs text-fg-subtle">{formatAge(i.created_at, now)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-fg">{i.zone_name}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-fg-muted">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" aria-hidden />
                          <span className="num font-semibold text-fg">{i.affected_users_count}</span>
                        </span>
                        <StatusBadge status={i.status} />
                        <span className="ml-auto flex gap-1.5 text-fg-subtle">
                          {[...new Set(i.critical_pois.map((p) => p.type))].map((t) => {
                            const pm = poiMeta(t);
                            const Icon = pm.icon;
                            return (
                              <span key={t} title={pm.label} className={cn("inline-flex items-center gap-0.5", t === "hospital" && "text-prio-critica")}>
                                <Icon className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">{pm.label}</span>
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
