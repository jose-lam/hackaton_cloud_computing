import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RadioTower, Search } from "lucide-react";
import { AntennaCard } from "./AntennaCard";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { useAnalytics, useAntennas } from "../../lib/queries";
import { useNow } from "../../lib/hooks";
import { cn } from "../../lib/format";
import { HEALTH_META } from "../../lib/labels";
import { HEALTH_STATUSES, type HealthStatus } from "../../types";

const ORDER: Record<HealthStatus, number> = { CAIDA: 0, INHABILITADA: 1, SATURADA: 2, NORMAL: 3 };

export function AntennasPage() {
  const antennas = useAntennas();
  const analytics = useAnalytics();
  const now = useNow(30_000);
  const [params] = useSearchParams();
  const highlight = params.get("q") ?? "";
  const [query, setQuery] = useState(highlight);
  const [filter, setFilter] = useState<HealthStatus | "ALL" | "RISK">("ALL");

  const recurrent = useMemo(() => new Map((analytics.data?.recurrent_antennas ?? []).map((r) => [r.antenna_id, r])), [analytics.data]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(antennas.data ?? [])]
      .filter((a) => (filter === "ALL" ? true : filter === "RISK" ? a.structural_risk || recurrent.has(a.antenna_id) : a.health_status === filter))
      .filter((a) => !q || `${a.antenna_id} ${a.zone_name}`.toLowerCase().includes(q))
      .sort((a, b) => ORDER[a.health_status] - ORDER[b.health_status] || a.antenna_id.localeCompare(b.antenna_id));
  }, [antennas.data, filter, query, recurrent]);

  const count = (f: typeof filter) =>
    (antennas.data ?? []).filter((a) => (f === "ALL" ? true : f === "RISK" ? a.structural_risk || recurrent.has(a.antenna_id) : a.health_status === f)).length;

  const chips: { id: typeof filter; label: string }[] = [
    { id: "ALL", label: "Todas" },
    ...HEALTH_STATUSES.map((s) => ({ id: s, label: HEALTH_META[s].label })),
    { id: "RISK", label: "Riesgo estructural" },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">Tráfico en tiempo real por antena y bandas operativas.</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
            <span>
              <span className="font-semibold text-health-inhabilitada">Inhabilitada</span> = 0
            </span>
            <span>
              <span className="font-semibold text-health-caida">Caída</span> &lt; 60
            </span>
            <span>
              <span className="font-semibold text-health-normal">Normal</span> 60–129
            </span>
            <span>
              <span className="font-semibold text-health-saturada">Saturada</span> &gt; 129 <span className="text-fg-subtle">(GB/min)</span>
            </span>
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar antena o zona"
            aria-label="Buscar antena o zona"
            className="h-9 w-64 rounded-md border border-line/12 bg-surface-2 pl-8 pr-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent/60"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar antenas por estado">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={filter === c.id}
            onClick={() => setFilter(c.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
              filter === c.id ? "border-accent/45 bg-accent/12 text-fg" : "border-line/12 text-fg-muted hover:border-line/25 hover:text-fg",
            )}
          >
            {c.label}
            <span className="num text-xs text-fg-subtle">{count(c.id)}</span>
          </button>
        ))}
      </div>

      {antennas.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[220px] rounded-lg" />
          ))}
        </div>
      ) : antennas.isError && !antennas.data ? (
        <ErrorState title="No se pudieron cargar las antenas" description={antennas.error.message} onRetry={() => void antennas.refetch()} retrying={antennas.isFetching} />
      ) : !list.length ? (
        <EmptyState title="Sin antenas para mostrar" description={query ? `Ninguna antena coincide con «${query}».` : "No hay antenas en este estado."} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((a) => (
            <AntennaCard key={a.antenna_id} antenna={a} recurrent={recurrent.get(a.antenna_id)} now={now} highlight={highlight === a.antenna_id} />
          ))}
        </div>
      )}
      {!antennas.isLoading && antennas.data && (
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <RadioTower className="h-3.5 w-3.5" aria-hidden /> {antennas.data.length} antenas monitoreadas · se actualiza cada 8 s
        </p>
      )}
    </div>
  );
}
