import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, Siren, X } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { PoiBadge, PriorityBadge, StatusBadge, TriggerLabel } from "../../components/domain";
import { useNoc } from "./noc-context";
import { useNow } from "../../lib/hooks";
import { cn, formatAge } from "../../lib/format";
import { PRIORITY_META, STATUS_META } from "../../lib/labels";
import { PRIORITY_LEVELS, TICKET_STATUSES, type Incident, type PriorityLevel, type TicketStatus } from "../../types";

type SortKey = "priority" | "zone" | "users" | "trigger" | "status" | "age";
const OPEN_STATUSES: TicketStatus[] = ["Registrada", "En revisión", "Siendo atendida"];

interface Props {
  incidents: Incident[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  retrying: boolean;
  className?: string;
  maxHeight?: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function IncidentQueue({ incidents, loading, error, onRetry, retrying, className, maxHeight }: Props) {
  const { openIncident, flashIds } = useNoc();
  const now = useNow(30_000);
  const [query, setQuery] = useState("");
  const [prios, setPrios] = useState<Set<PriorityLevel>>(new Set());
  const [statuses, setStatuses] = useState<Set<TicketStatus>>(new Set(OPEN_STATUSES));
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "priority", dir: "desc" });

  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  const base = useMemo(() => incidents ?? [], [incidents]);
  const rows = useMemo(() => {
    const q = norm(query.trim());
    const filtered = base.filter(
      (i) =>
        (!prios.size || prios.has(i.priority_level)) &&
        (!statuses.size || statuses.has(i.status as TicketStatus)) &&
        (!q || norm(`${i.incident_id} ${i.zone_name} ${i.geohash} ${i.trigger_type}`).includes(q)),
    );
    const val = (i: Incident): number | string => {
      switch (sort.key) {
        case "priority":
          return i.priority_score;
        case "zone":
          return norm(i.zone_name);
        case "users":
          return i.affected_users_count;
        case "trigger":
          return i.trigger_type;
        case "status":
          return TICKET_STATUSES.indexOf(i.status as TicketStatus);
        case "age":
          return -Date.parse(i.created_at || "0");
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? r : -r;
    });
  }, [base, query, prios, statuses, sort]);

  const prioCount = (p: PriorityLevel) => base.filter((i) => i.priority_level === p && (!statuses.size || statuses.has(i.status as TicketStatus))).length;
  const statusCount = (s: TicketStatus) => base.filter((i) => i.status === s).length;
  const filtersDirty = query || prios.size || statuses.size !== OPEN_STATUSES.length || !OPEN_STATUSES.every((s) => statuses.has(s));
  const reset = () => {
    setQuery("");
    setPrios(new Set());
    setStatuses(new Set(OPEN_STATUSES));
  };

  const header = (key: SortKey, label: string, cls = "") => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("sticky top-0 z-10 bg-surface-1 px-3 py-0 font-semibold", cls)}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
          className={cn("inline-flex h-9 items-center gap-1 uppercase tracking-[0.08em] transition-colors hover:text-fg", active ? "text-fg" : "text-fg-subtle")}
        >
          {label}
          <Icon className={cn("h-3 w-3", !active && "opacity-50")} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <Card className={cn("flex flex-col", className)} aria-labelledby="queue-title">
      <CardHeader
        id="queue-title"
        icon={<Siren />}
        title="Cola de incidentes"
        subtitle="Incidentes maestros correlacionados, ordenados por prioridad"
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar zona, ID o geohash"
              aria-label="Buscar en la cola de incidentes"
              className="h-8 w-60 rounded-md border border-line/12 bg-surface-2 pl-8 pr-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent/60"
            />
          </div>
        }
      />

      {/* Chips de filtro */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/8 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por prioridad">
          <span className="mr-1 text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">Prioridad</span>
          {PRIORITY_LEVELS.map((p) => {
            const on = prios.has(p);
            const m = PRIORITY_META[p];
            const Icon = m.icon;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => setPrios((s) => toggle(s, p))}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors", on ? m.tone : "border-line/12 text-fg-muted hover:border-line/25 hover:text-fg")}
              >
                <Icon className="h-3 w-3" aria-hidden />
                {m.label}
                <span className="num text-2xs opacity-80">{prioCount(p)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por estado">
          <span className="mr-1 text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">Estado</span>
          {TICKET_STATUSES.map((s) => {
            const on = statuses.has(s);
            const m = STATUS_META[s];
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setStatuses((x) => toggle(x, s))}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors", on ? "border-accent/40 bg-accent/10 text-fg" : "border-line/12 text-fg-muted hover:border-line/25 hover:text-fg")}
              >
                {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                {m.label}
                <span className="num text-2xs opacity-70">{statusCount(s)}</span>
              </button>
            );
          })}
        </div>
        {filtersDirty ? (
          <button type="button" onClick={reset} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
            <X className="h-3 w-3" aria-hidden /> Restablecer filtros
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto" style={{ maxHeight }}>
        {loading ? (
          <div className="space-y-2 p-4" aria-busy>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error && !incidents ? (
          <ErrorState title="No se pudo cargar la cola de incidentes" description={error.message} onRetry={onRetry} retrying={retrying} />
        ) : !base.length ? (
          <EmptyState title="Sin incidentes" description="La red opera con normalidad. Los nuevos incidentes aparecerán aquí automáticamente." />
        ) : !rows.length ? (
          <EmptyState
            title="Ningún incidente coincide con los filtros"
            description="Prueba con otra búsqueda o restablece los filtros."
            action={
              <button type="button" onClick={reset} className="text-sm font-semibold text-accent hover:underline">
                Restablecer filtros
              </button>
            }
          />
        ) : (
          <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
            <caption className="sr-only">Incidentes maestros. Selecciona una fila para abrir el detalle.</caption>
            <thead className="text-2xs">
              <tr className="[&>th]:border-b [&>th]:border-line/10">
                {header("priority", "Prioridad", "w-[140px]")}
                {header("zone", "Zona")}
                {header("users", "Afectados", "w-[100px] text-right [&>button]:justify-end [&>button]:w-full")}
                {header("trigger", "Disparador", "w-[150px]")}
                <th scope="col" className="sticky top-0 z-10 w-[200px] bg-surface-1 px-3 font-semibold uppercase tracking-[0.08em] text-fg-subtle">
                  Zonas críticas
                </th>
                {header("status", "Estado", "w-[150px]")}
                {header("age", "Antigüedad", "w-[110px]")}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const poiTypes = [...new Set(i.critical_pois.map((p) => p.type))];
                return (
                  <tr
                    key={i.incident_id}
                    tabIndex={0}
                    onClick={() => openIncident(i.incident_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openIncident(i.incident_id);
                      }
                    }}
                    aria-label={`${i.incident_id}, ${i.zone_name}, prioridad ${PRIORITY_META[i.priority_level].label}. Abrir detalle`}
                    className={cn(
                      "group cursor-pointer transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60 [&>td]:border-b [&>td]:border-line/6",
                      flashIds.has(i.incident_id) && "animate-row-flash",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <PriorityBadge level={i.priority_level} />
                        <span className="num text-xs text-fg-subtle">{i.priority_score}</span>
                      </div>
                    </td>
                    <td className="max-w-0 px-3 py-2.5">
                      <p className="truncate font-medium text-fg">{i.zone_name}</p>
                      <p className="num truncate text-2xs text-fg-subtle">
                        {i.incident_id} · {i.geohash}
                      </p>
                    </td>
                    <td className="num px-3 py-2.5 text-right text-base font-semibold text-fg">{i.affected_users_count}</td>
                    <td className="px-3 py-2.5">
                      <TriggerLabel type={i.trigger_type} />
                    </td>
                    <td className="px-3 py-2.5">
                      {poiTypes.length ? (
                        <div className="flex flex-wrap gap-1">
                          {poiTypes.map((t) => (
                            <PoiBadge key={t} type={t} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-fg-subtle">Ninguna</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="num px-3 py-2.5 text-sm text-fg-muted">{formatAge(i.created_at, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {!loading && base.length > 0 && (
        <div className="flex items-center justify-between border-t border-line/8 px-4 py-2 text-xs text-fg-subtle">
          <span>
            Mostrando <span className="num text-fg-muted">{rows.length}</span> de <span className="num text-fg-muted">{base.length}</span> incidentes
          </span>
          <span className="hidden sm:inline">Enter abre el detalle · clic en encabezados para ordenar</span>
        </div>
      )}
    </Card>
  );
}
