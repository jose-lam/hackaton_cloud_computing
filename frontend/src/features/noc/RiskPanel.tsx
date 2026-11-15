import { Link } from "react-router-dom";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { HealthBadge } from "../../components/domain";
import type { Antenna } from "../../types";

interface Props {
  antennas: Antenna[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

/** Antenas con structural_risk = true (GET /antenas). */
export function RiskPanel({ antennas, loading, error, onRetry }: Props) {
  const list = (antennas ?? [])
    .filter((a) => a.structural_risk)
    .map((a) => [a.antenna_id, { health: a.health_status, zone: a.zone_name, traffic: a.last_traffic_gb }] as const)
    .sort((a, b) => a[1].traffic - b[1].traffic);

  return (
    <Card aria-labelledby="risk-title">
      <CardHeader
        id="risk-title"
        icon={<ShieldAlert />}
        title="Riesgo estructural"
        subtitle="Fallas recurrentes que sugieren daño físico"
        actions={
          <Link to="/noc/antenas" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Antenas <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        }
      />
      <div className="p-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : error && !list.length ? (
          <ErrorState compact title="No se pudo cargar" description={error.message} onRetry={onRetry} />
        ) : !list.length ? (
          <EmptyState compact title="Sin antenas en riesgo" />
        ) : (
          <ul className="space-y-2">
            {list.map(([id, it]) => (
              <li key={id} className="rounded-md border border-prio-critica/20 bg-prio-critica/[0.05] p-3">
                <div className="flex items-center gap-2">
                  <span className="num whitespace-nowrap text-sm font-semibold text-fg">{id}</span>
                  <HealthBadge status={it.health} />
                </div>
                <p className="mt-1.5 inline-flex items-center gap-1 text-2xs font-bold uppercase tracking-[0.08em] text-prio-critica">
                  <ShieldAlert className="h-3 w-3" aria-hidden /> Riesgo estructural
                </p>
                <p className="mt-0.5 truncate text-xs text-fg-muted">
                  {it.zone ?? "Zona no disponible"}
                  {" · "}
                  <span className="num font-semibold text-fg">{it.traffic}</span> GB/min
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
