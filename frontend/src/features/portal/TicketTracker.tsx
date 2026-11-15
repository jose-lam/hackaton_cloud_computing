import { useEffect, useState } from "react";
import { Check, CircleCheckBig, MapPin, RadioTower } from "lucide-react";
import { Card } from "../../components/ui";
import { StatusBadge } from "../../components/domain";
import { cn, formatDateTime } from "../../lib/format";
import { PROBLEM_META, problemLabel, statusMeta } from "../../lib/labels";
import { TICKET_STATUSES, type ProblemType, type Ticket, type TicketStatus } from "../../types";

const STATUS_HELP: Record<TicketStatus, string> = {
  Registrada: "Recibimos tu reporte y está en cola para revisión.",
  "En revisión": "Estamos analizando tu reporte junto con otros de tu zona.",
  "Siendo atendida": "Un equipo técnico está trabajando en la solución.",
  Solucionada: "El servicio fue restablecido. Si el problema continúa, haz un nuevo reporte.",
  Cerrada: "El caso fue cerrado. Gracias por avisarnos.",
};

const AUTHOR: Record<string, string> = {
  CIUDADANO: "Tú",
  USUARIO: "Tú",
  SISTEMA: "Sistema Sentinel",
  SISTEMA_SFN: "Sistema Sentinel",
  OPERADOR: "Operador de red",
  IA: "Sistema Sentinel",
};
const authorLabel = (a: string) => AUTHOR[a.toUpperCase()] ?? a;

export function TicketTracker({ ticket: t }: { ticket: Ticket }) {
  const history = [...t.history].sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  const ProblemIcon = PROBLEM_META[t.problem_type as ProblemType]?.icon ?? MapPin;
  const resolved = t.status === "Solucionada" || t.status === "Cerrada";

  return (
    <Card className="overflow-hidden rounded-xl animate-page-in" aria-labelledby={`tk-${t.ticket_id}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-5 sm:px-6">
        <h2 id={`tk-${t.ticket_id}`} className="num text-lg font-semibold text-fg">
          {t.ticket_id}
        </h2>
        <StatusBadge status={t.status} size="md" />
        <span className="num w-full text-sm text-fg-subtle sm:ml-auto sm:w-auto">Reportado {formatDateTime(t.created_at)}</span>
      </header>
      <div className="px-5 pt-2 sm:px-6">
        <p className="flex items-start gap-2 text-base text-fg-muted">
          <ProblemIcon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
          <span>
            <span className="font-medium text-fg">{problemLabel(t.problem_type)}</span>
            {t.location_text ? ` · ${t.location_text}` : ""}
          </span>
        </p>
        {/* Texto del usuario: se renderiza como texto plano (no confiable) */}
        {t.description && <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">{t.description}</p>}
      </div>

      {t.master_incident_id && (
        <div className="px-5 pt-5 sm:px-6">
          <ZoneBanner incidentId={t.master_incident_id} resolved={resolved} />
        </div>
      )}

      <div className="px-5 py-6 sm:px-6">
        <StatusTimeline status={t.status} />
        <p className="mt-5 rounded-lg border border-line/10 bg-surface-2 px-4 py-3 text-base text-fg">
          <span className="sr-only">Estado actual: {t.status}. </span>
          {STATUS_HELP[t.status as TicketStatus] ?? "Estamos procesando tu reporte."}
        </p>
      </div>

      <section className="border-t border-line/8 px-5 py-5 sm:px-6" aria-labelledby={`tk-h-${t.ticket_id}`}>
        <h3 id={`tk-h-${t.ticket_id}`} className="text-sm font-semibold uppercase tracking-[0.1em] text-fg-subtle">
          Historial
        </h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">Aún no hay movimientos.</p>
        ) : (
          <ol className="mt-4">
            {history.map((h, i) => {
              const m = statusMeta(h.new_status);
              const Icon = m.icon;
              const last = i === history.length - 1;
              return (
                <li key={`${h.timestamp ?? ""}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-line/15" aria-hidden />}
                  <span className={cn("relative grid h-7 w-7 shrink-0 place-items-center rounded-full border", i === 0 ? "border-accent/40 bg-accent/10 text-accent" : "border-line/15 bg-surface-2 text-fg-subtle")}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-base font-medium text-fg">
                      {h.old_status ? (
                        <>
                          <span className="text-fg-muted">{h.old_status}</span> <span aria-label="pasó a">→</span> {h.new_status}
                        </>
                      ) : (
                        h.new_status
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-subtle">
                      <span className="num">{formatDateTime(h.timestamp)}</span> · {authorLabel(h.changed_by)}
                    </p>
                    {h.note && <p className="mt-1 break-words text-sm text-fg-muted">{h.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </Card>
  );
}

function ZoneBanner({ incidentId, resolved }: { incidentId: string; resolved: boolean }) {
  if (resolved)
    return (
      <div role="note" className="flex gap-3 rounded-xl border border-ok/30 bg-ok/8 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
          <CircleCheckBig className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-base font-semibold text-fg">Restablecimos el servicio en tu zona</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            La incidencia <span className="num font-medium text-fg">{incidentId}</span> fue solucionada. Si aún tienes problemas, reinicia tu equipo o haz un nuevo reporte.
          </p>
        </div>
      </div>
    );
  return (
    <div role="note" className="relative flex gap-3 overflow-hidden rounded-xl border border-accent/30 bg-accent/8 p-4">
      <span className="absolute inset-y-0 left-0 w-1 bg-accent" aria-hidden />
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
        <RadioTower className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-base font-semibold text-fg">Ya identificamos un problema en tu zona</p>
        <p className="mt-0.5 text-sm text-fg-muted">
          Tu reporte está vinculado a la incidencia <span className="num font-medium text-fg">{incidentId}</span>. Nuestro equipo técnico ya trabaja en ella; no necesitas volver a reportar.
        </p>
      </div>
    </div>
  );
}

function StatusTimeline({ status }: { status: string }) {
  const idx = Math.max(0, TICKET_STATUSES.indexOf(status as TicketStatus));
  const final = idx === TICKET_STATUSES.length - 1;
  // Arranca en 0 y avanza tras el primer frame para animar el llenado
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(idx));
    return () => cancelAnimationFrame(raf);
  }, [idx]);
  const pct = (shown / (TICKET_STATUSES.length - 1)) * 100;

  return (
    <div className="relative">
      {/* pista y relleno entre el primer y el último punto */}
      <span className="absolute left-[10%] right-[10%] top-4 h-1 -translate-y-1/2 rounded-full bg-surface-3" aria-hidden>
        <span className="block h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </span>
      <ol className="relative grid grid-cols-5" aria-label="Etapas del reporte">
      {TICKET_STATUSES.map((s, i) => {
        const done = i < shown || (final && i === shown);
        const current = i === idx && !final;
        const reached = i <= shown;
        return (
          <li key={s} className="relative flex flex-col items-center text-center" aria-current={i === idx ? "step" : undefined}>
            <span
              className={cn(
                "relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 transition-colors duration-300",
                done && "border-accent bg-accent text-accent-fg",
                current && reached && "border-accent bg-surface-1 text-accent",
                !reached && "border-line/20 bg-surface-1 text-fg-subtle",
              )}
              style={{ transitionDelay: `${i * 110}ms` }}
            >
              {current && reached && <span className="absolute inset-0 animate-ping rounded-full bg-accent/25 motion-reduce:hidden" aria-hidden />}
              {done ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : <span className={cn("h-2.5 w-2.5 rounded-full", current && reached ? "bg-accent" : "bg-line/25")} aria-hidden />}
            </span>
            <span className={cn("mt-2 px-0.5 text-xs leading-tight sm:text-sm", i === idx ? "font-semibold text-fg" : reached ? "text-fg-muted" : "text-fg-subtle")}>{s}</span>
            <span className="sr-only">{i < idx || (final && i === idx) ? "(completada)" : i === idx ? "(etapa actual)" : "(pendiente)"}</span>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
