import { useId, useMemo, useState } from "react";
import { BellRing, CircleCheck, Clock, Hash, History, MapPin, RadioTower, Sparkles, Users } from "lucide-react";
import { Badge, Button, Drawer, DrawerCloseButton, EmptyState, ErrorState, Skeleton, SkeletonText, TabPanel, Tabs, useToast } from "../../components/ui";
import { HealthBadge, PoiBadge, PriorityBadge, StatusBadge, TriggerLabel } from "../../components/domain";
import { useTickets, useUpdateIncidentStatus } from "../../lib/queries";
import { linkedTickets } from "../../lib/api";
import { antennaForIncident, earliestIncidentTime } from "../../lib/incident";
import { useNow } from "../../lib/hooks";
import { cn, formatDateTime, formatDistance, formatRelative } from "../../lib/format";
import { poiMeta, priorityMeta, problemLabel, statusMeta, TRIGGER_META } from "../../lib/labels";
import { isClosedStatus, TICKET_STATUSES, type Antenna, type Incident, type TicketStatus } from "../../types";

interface Props {
  incidentId: string | null;
  incidents: Incident[] | undefined;
  antennas: Antenna[] | undefined;
  loading: boolean;
  onClose: () => void;
}

export function IncidentDrawer({ incidentId, incidents, antennas, loading, onClose }: Props) {
  const titleId = useId();
  const incident = incidents?.find((i) => i.incident_id === incidentId);
  return (
    <Drawer open={Boolean(incidentId)} onClose={onClose} labelledBy={titleId}>
      {incident ? (
        <DrawerBody key={incident.incident_id} incident={incident} antennas={antennas} titleId={titleId} onClose={onClose} />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-line/10 px-5 py-4">
            <h2 id={titleId} className="text-md font-semibold">
              {loading ? "Cargando incidente…" : "Incidente no encontrado"}
            </h2>
            <DrawerCloseButton onClose={onClose} />
          </div>
          <div className="p-5">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-2/3" />
                <SkeletonText lines={5} />
              </div>
            ) : (
              <EmptyState title="No encontramos este incidente" description={`El identificador ${incidentId ?? ""} no existe o ya no está disponible.`} action={<Button onClick={onClose}>Cerrar</Button>} />
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

function DrawerBody({ incident, antennas, titleId, onClose }: { incident: Incident; antennas: Antenna[] | undefined; titleId: string; onClose: () => void }) {
  const [tab, setTab] = useState("resumen");
  const tabsId = useId();
  const now = useNow(30_000);
  const antenna = antennaForIncident(incident, antennas);
  const prio = priorityMeta(incident.priority_level);

  return (
    <>
      {/* Encabezado */}
      <div className="border-b border-line/10 px-5 pb-0 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-xs font-semibold text-fg-muted">{incident.incident_id}</span>
              <PriorityBadge level={incident.priority_level} />
              <StatusBadge status={incident.status} />
            </div>
            <h2 id={titleId} className="mt-2 text-xl font-semibold tracking-tight text-fg">
              {incident.zone_name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
                <span className="num font-semibold text-fg">{incident.affected_users_count}</span> afectados
              </span>
              <TriggerLabel type={incident.trigger_type} />
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
                <span className="num">{formatRelative(incident.created_at, now)}</span>
              </span>
            </div>
          </div>
          <DrawerCloseButton onClose={onClose} />
        </div>
        <span className="mt-4 block h-0.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, incident.priority_score)}%`, background: prio.color }} />
        </span>
        <Tabs
          idBase={tabsId}
          label="Secciones del incidente"
          value={tab}
          onChange={setTab}
          className="mt-2 border-b-0"
          items={[
            { id: "resumen", label: "Resumen" },
            {
              id: "ia",
              label: (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Diagnóstico IA
                </>
              ),
            },
            { id: "pois", label: "Zonas críticas", badge: <span className="num rounded-sm bg-surface-3 px-1 text-2xs text-fg-muted">{incident.critical_pois.length}</span> },
            { id: "historial", label: "Historial" },
          ]}
        />
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {tab === "resumen" && (
          <TabPanel idBase={tabsId} id="resumen">
            <SummaryTab incident={incident} antenna={antenna} now={now} onGoTo={setTab} />
          </TabPanel>
        )}
        {tab === "ia" && (
          <TabPanel idBase={tabsId} id="ia">
            <DiagnosisCard incident={incident} />
          </TabPanel>
        )}
        {tab === "pois" && (
          <TabPanel idBase={tabsId} id="pois">
            <PoisTab incident={incident} />
          </TabPanel>
        )}
        {tab === "historial" && (
          <TabPanel idBase={tabsId} id="historial">
            <HistoryTab incident={incident} />
          </TabPanel>
        )}
      </div>

      <ActionsFooter incident={incident} />
    </>
  );
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border border-line/10 bg-surface-2 p-3", className)}>
      <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function SummaryTab({ incident, antenna, now, onGoTo }: { incident: Incident; antenna: Antenna | undefined; now: number; onGoTo: (t: string) => void }) {
  const prio = priorityMeta(incident.priority_level);
  const firstParagraph = incident.ai_diagnosis?.split(/\n\s*\n/)[0];
  const ticketsQ = useTickets(incident.geohash ? { geohash: incident.geohash } : null);
  const linked = useMemo(() => linkedTickets(ticketsQ.data ?? [], incident.incident_id), [ticketsQ.data, incident.incident_id]);
  const reportedStart = earliestIncidentTime(linked);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Usuarios afectados">
          <p className="num text-2xl font-semibold">{incident.affected_users_count}</p>
        </Stat>
        <Stat label="Puntaje de prioridad">
          <p className="num text-2xl font-semibold">
            {incident.priority_score}
          </p>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, incident.priority_score)}%`, background: prio.color }} />
          </span>
        </Stat>
        <Stat label="Antena asociada">
          {antenna ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-sm font-semibold">{antenna.antenna_id}</span>
              <HealthBadge status={antenna.health_status} />
              <span className="num w-full text-xs text-fg-muted">{antenna.last_traffic_gb} GB/min</span>
            </div>
          ) : (
            <p className="num text-sm text-fg-muted">{incident.antenna_id ?? "Sin antena asociada"}</p>
          )}
        </Stat>
        <Stat label={incident.closed_at ? "Cerrado" : "Abierto desde"}>
          <p className="num text-sm font-semibold">{formatDateTime(incident.closed_at ?? incident.created_at)}</p>
          <p className="num text-xs text-fg-muted">{formatRelative(incident.closed_at ?? incident.created_at, now)}</p>
        </Stat>
      </div>

      <section aria-labelledby="sum-ia" className="rounded-md border border-accent/20 bg-accent/[0.04] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          <h3 id="sum-ia" className="text-sm font-semibold">
            Diagnóstico IA
          </h3>
          <Badge tone="text-accent border-accent/35 bg-accent/10" className="normal-case tracking-normal">
            Gemini
          </Badge>
        </div>
        {firstParagraph ? <p className="mt-2 line-clamp-3 text-sm text-fg-muted">{firstParagraph}</p> : <SkeletonText lines={2} className="mt-3" />}
        <button type="button" onClick={() => onGoTo("ia")} className="mt-2 text-sm font-semibold text-accent hover:underline">
          Ver diagnóstico completo
        </button>
      </section>

      <section aria-labelledby="sum-pois">
        <h3 id="sum-pois" className="mb-2 text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">
          Zonas críticas detectadas
        </h3>
        {incident.critical_pois.length ? (
          <div className="flex flex-wrap gap-2">
            {incident.critical_pois.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-2 rounded-md border border-line/10 bg-surface-2 py-1 pl-1 pr-2.5 text-sm">
                <PoiBadge type={p.type} />
                <span className="text-fg">{p.name}</span>
                <span className="num text-xs text-fg-subtle">{formatDistance(p.distance_m)}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">No hay hospitales, escuelas ni industrias cerca.</p>
        )}
      </section>

      <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="flex items-center gap-1.5 text-fg-subtle">
          <Hash className="h-3.5 w-3.5" aria-hidden /> Geohash
        </dt>
        <dd className="num text-fg">{incident.geohash || "—"}</dd>
        <dt className="flex items-center gap-1.5 text-fg-subtle">
          <RadioTower className="h-3.5 w-3.5" aria-hidden /> Disparador
        </dt>
        <dd className="text-fg">{TRIGGER_META[incident.trigger_type]?.label ?? incident.trigger_type}</dd>
        <dt className="flex items-center gap-1.5 text-fg-subtle">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> Tickets vinculados
        </dt>
        <dd className="num text-fg">{ticketsQ.isLoading ? "…" : linked.length}</dd>
        <dt className="flex items-center gap-1.5 text-fg-subtle">
          <Clock className="h-3.5 w-3.5" aria-hidden /> Inicio reportado
        </dt>
        <dd className="text-fg">
          {reportedStart ? (
            <>
              <span className="num">{formatDateTime(reportedStart)}</span> <span className="text-xs text-fg-subtle">· primer reporte de los usuarios</span>
            </>
          ) : ticketsQ.isLoading ? (
            "…"
          ) : (
            <span className="text-fg-muted">Sin dato en los tickets</span>
          )}
        </dd>
      </dl>
    </div>
  );
}

function confidenceLevel(c: number) {
  if (c >= 0.85) return { label: "Alta", cls: "text-ok" };
  if (c >= 0.65) return { label: "Media", cls: "text-warn" };
  return { label: "Baja", cls: "text-danger" };
}

function DiagnosisCard({ incident }: { incident: Incident }) {
  const pending = !incident.ai_diagnosis;
  const conf = incident.ai_confidence;
  const level = conf !== null && conf !== undefined ? confidenceLevel(conf) : null;
  return (
    <article className="overflow-hidden rounded-lg border border-accent/20 bg-gradient-to-b from-accent/[0.06] to-transparent" aria-busy={pending}>
      <header className="flex items-center gap-3 border-b border-accent/15 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-accent/15 text-accent">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Diagnóstico operativo</h3>
          <p className="text-xs text-fg-subtle">Análisis semántico de reportes + telemetría + geografía</p>
        </div>
        <Badge tone="text-accent border-accent/40 bg-accent/10" icon={Sparkles} size="md">
          Gemini
        </Badge>
      </header>

      <div className="space-y-4 p-4">
        {(pending || (conf !== null && conf !== undefined)) && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">Confianza del modelo</span>
            {pending || conf === null || conf === undefined ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <span className="text-sm">
                <span className="num font-semibold text-fg">{Math.round(conf * 100)}%</span> <span className={cn("font-semibold", level?.cls)}>· {level?.label}</span>
              </span>
            )}
          </div>
          <div
            className="mt-2 flex h-2 gap-0.5"
            role="meter"
            aria-label="Confianza del modelo"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={conf !== null && conf !== undefined ? Math.round(conf * 100) : undefined}
            aria-valuetext={conf !== null && conf !== undefined ? `${Math.round(conf * 100)}%, ${level?.label ?? ""}` : "Calculando"}
          >
            {Array.from({ length: 20 }, (_, i) => {
              const on = conf !== null && conf !== undefined && !pending && i < Math.round(conf * 20);
              return <span key={i} className={cn("flex-1 rounded-[1px] transition-colors duration-300", on ? "bg-accent" : "bg-surface-3")} />;
            })}
          </div>
        </div>
        )}

        {pending ? (
          <div role="status" className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-accent" aria-hidden />
              Gemini está analizando los reportes de la zona…
            </p>
            <SkeletonText lines={4} />
            <SkeletonText lines={3} />
          </div>
        ) : (
          <div className="space-y-3 text-base leading-relaxed text-fg">
            {incident.ai_diagnosis?.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
          </div>
        )}
      </div>
      <footer className="border-t border-line/8 px-4 py-2.5 text-xs text-fg-subtle">Generado automáticamente. Valida en campo antes de cerrar el incidente.</footer>
    </article>
  );
}

function PoisTab({ incident }: { incident: Incident }) {
  const pois = [...incident.critical_pois].sort((a, b) => a.distance_m - b.distance_m);
  if (!pois.length) return <EmptyState title="Sin zonas críticas cercanas" description="No se detectaron hospitales, escuelas ni industrias en el radio de análisis." />;
  const max = Math.max(1000, ...pois.map((p) => p.distance_m));
  return (
    <ul className="space-y-2">
      {pois.map((p) => {
        const meta = poiMeta(p.type);
        const Icon = meta.icon;
        return (
          <li key={p.name} className="flex items-center gap-3 rounded-md border border-line/10 bg-surface-2 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 text-fg-muted">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{p.name}</p>
              <div className="mt-1 flex items-center gap-2">
                <PoiBadge type={p.type} />
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.max(6, 100 - (p.distance_m / max) * 100)}%` }} />
                </span>
              </div>
            </div>
            <span className="num w-16 text-right text-sm font-semibold text-fg">{formatDistance(p.distance_m)}</span>
          </li>
        );
      })}
      <p className="pt-1 text-xs text-fg-subtle">Distancia desde el centro del incidente. La barra es más larga cuanto más cerca está el punto.</p>
    </ul>
  );
}

function HistoryTab({ incident }: { incident: Incident }) {
  const q = useTickets(incident.geohash ? { geohash: incident.geohash } : null);
  const tickets = useMemo(() => linkedTickets(q.data ?? [], incident.incident_id), [q.data, incident.incident_id]);
  const events = useMemo(() => {
    const groups = new Map<string, { old_status: string | null; new_status: string; changed_by: string; note: string; timestamp: string | null; n: number }>();
    for (const t of tickets)
      for (const h of t.history) {
        const key = `${h.old_status}|${h.new_status}|${h.changed_by}|${h.note}`;
        const g = groups.get(key);
        if (!g) groups.set(key, { ...h, n: 1 });
        else {
          g.n += 1;
          if ((h.timestamp ?? "") > (g.timestamp ?? "")) g.timestamp = h.timestamp;
        }
      }
    return [...groups.values()].sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  }, [tickets]);

  if (q.isLoading)
    return (
      <div className="space-y-4" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <SkeletonText lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    );
  if (q.isError) return <ErrorState compact title="No se pudo cargar el historial" description={q.error.message} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  if (!events.length) return <EmptyState compact title="Sin movimientos registrados" />;

  return (
    <div>
      <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-line/15">
        {events.map((e, i) => {
          const m = statusMeta(e.new_status);
          const Icon = m.icon;
          return (
            <li key={i} className="relative flex gap-3">
              <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line/15 bg-surface-2" style={{ color: m.color }}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm text-fg">
                  {e.old_status ? (
                    <>
                      <span className="text-fg-muted">{e.old_status}</span> → <span className="font-semibold">{e.new_status}</span>
                    </>
                  ) : (
                    <span className="font-semibold">{e.new_status}</span>
                  )}
                  {e.n > 1 && <span className="num ml-2 rounded-sm bg-surface-3 px-1.5 text-2xs text-fg-muted">×{e.n} tickets</span>}
                </p>
                <p className="num mt-0.5 text-xs text-fg-subtle">
                  {formatDateTime(e.timestamp)} · {e.changed_by}
                </p>
                {e.note && <p className="mt-1 break-words text-sm text-fg-muted">{e.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <details className="group mt-6 rounded-md border border-line/10 bg-surface-2">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-medium text-fg-muted hover:text-fg">
          <History className="h-4 w-4" aria-hidden /> Ver {tickets.length} tickets vinculados
        </summary>
        <ul className="divide-y divide-line/8 border-t border-line/8">
          {tickets.map((t) => (
            <li key={t.ticket_id} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="num text-xs font-semibold">{t.ticket_id}</span>
                <StatusBadge status={t.status} />
                <span className="ml-auto text-xs text-fg-subtle">{problemLabel(t.problem_type)}</span>
              </div>
              {/* Texto de usuario: se renderiza como texto plano */}
              <p className="mt-1 break-words text-sm text-fg-muted">{t.description}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ActionsFooter({ incident }: { incident: Incident }) {
  const { toast } = useToast();
  const mutation = useUpdateIncidentStatus();
  const [status, setStatus] = useState<TicketStatus>((TICKET_STATUSES as readonly string[]).includes(incident.status) ? (incident.status as TicketStatus) : "En revisión");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  const statusId = useId();
  const closed = isClosedStatus(incident.status);

  const run = (target: TicketStatus) =>
    mutation.mutate(
      { incident, status: target, note: note.trim() },
      {
        onSuccess: (res) => {
          setConfirming(false);
          setNote("");
          setStatus(target);
          if (target === "Solucionada")
            toast({
              tone: "success",
              title: "Notificación de restablecimiento enviada",
              description: `${incident.affected_users_count} usuarios de ${incident.zone_name} fueron notificados.`,
            });
          else toast({ tone: "success", title: `Estado actualizado: ${target}`, description: `${incident.incident_id} · ${res.updated} tickets actualizados.` });
          if (res.failed) toast({ tone: "warning", title: `${res.failed} tickets no se actualizaron`, description: "Vuelve a aplicar el estado para reintentar." });
        },
        onError: (err) => toast({ tone: "error", title: "No se pudo actualizar el estado", description: err.message }),
      },
    );

  return (
    <div className="border-t border-line/10 bg-surface-1 px-5 py-4">
      {confirming ? (
        <div role="alertdialog" aria-labelledby={`${noteId}-c`} aria-describedby={`${noteId}-d`} className="animate-scale-in rounded-md border border-ok/30 bg-ok/8 p-4">
          <p id={`${noteId}-c`} className="flex items-center gap-2 text-sm font-semibold text-fg">
            <BellRing className="h-4 w-4 text-ok" aria-hidden /> ¿Confirmas que el servicio está restablecido?
          </p>
          <p id={`${noteId}-d`} className="mt-1 text-sm text-fg-muted">
            Se marcará <span className="num text-fg">{incident.incident_id}</span> como solucionado y se notificará a{" "}
            <span className="num font-semibold text-fg">{incident.affected_users_count}</span> usuarios afectados.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={mutation.isPending} data-autofocus>
              Cancelar
            </Button>
            <Button size="sm" variant="success" loading={mutation.isPending} icon={<CircleCheck className="h-4 w-4" aria-hidden />} onClick={() => run("Solucionada")}>
              Confirmar y notificar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[180px,1fr] gap-3">
            <div>
              <label htmlFor={statusId} className="mb-1 block text-xs font-medium text-fg-muted">
                Estado
              </label>
              <select
                id={statusId}
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus)}
                className="h-9 w-full rounded-md border border-line/15 bg-surface-2 px-2.5 text-sm text-fg focus:border-accent/60"
              >
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={noteId} className="mb-1 flex justify-between text-xs font-medium text-fg-muted">
                <span>Nota para el historial (opcional)</span>
                <span className="num text-fg-subtle">{note.length}/300</span>
              </label>
              <input
                id={noteId}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej.: Reemplazo de tarjeta RF en sector B"
                className="h-9 w-full rounded-md border border-line/15 bg-surface-2 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent/60"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="md" onClick={() => run(status)} loading={mutation.isPending && !confirming} disabled={status === incident.status && !note.trim()}>
              Aplicar estado
            </Button>
            <Button size="md" variant="primary" onClick={() => setConfirming(true)} disabled={closed || mutation.isPending} icon={<CircleCheck className="h-4 w-4" aria-hidden />}>
              Marcar como solucionada
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
