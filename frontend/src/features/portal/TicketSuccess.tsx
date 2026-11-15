import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Copy, Plus } from "lucide-react";
import { Button, Card, useToast } from "../../components/ui";
import { StatusBadge } from "../../components/domain";
import type { TicketCreateResponse } from "../../types";

/** "nombre@correo.com" -> "no•••@correo.com" */
const maskEmail = (email: string) => {
  const [user = "", domain = ""] = email.split("@");
  return domain ? `${user.slice(0, 2)}•••@${domain}` : email;
};

interface Props {
  result: TicketCreateResponse;
  email: string;
  onRestart: () => void;
}

export function TicketSuccess({ result, email, onRestart }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.ticket_id);
      setCopied(true);
    } catch {
      toast({ tone: "error", title: "No se pudo copiar", description: "Selecciona el código y cópialo manualmente." });
    }
  };

  const steps = [
    "Revisamos tu reporte y lo agrupamos con otros de tu zona para atenderlo más rápido.",
    email ? `Te avisaremos a ${maskEmail(email)} cada vez que cambie el estado.` : "Como no dejaste correo, revisa esta página para conocer cada cambio de estado.",
    "Puedes ver el avance cuando quieras con tu código de seguimiento.",
  ];

  return (
    <Card className="scroll-mt-24 animate-page-in overflow-hidden rounded-xl" aria-labelledby="ticket-ok-title">
      <div className="px-5 pb-6 pt-8 text-center sm:px-8">
        <span className="mx-auto grid h-14 w-14 animate-pop-in place-items-center rounded-full bg-ok/12 text-ok ring-8 ring-ok/6">
          <Check className="h-7 w-7" strokeWidth={2.75} aria-hidden />
        </span>
        <h2 id="ticket-ok-title" ref={heading} tabIndex={-1} className="mt-4 text-xl font-semibold tracking-tight text-fg focus:outline-none">
          ¡Recibimos tu reporte!
        </h2>
        <p className="mx-auto mt-1 max-w-md text-base text-fg-muted">Guarda tu código: lo necesitarás para consultar el avance.</p>

        <div className="mx-auto mt-6 max-w-md rounded-xl border border-line/12 bg-surface-2 p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">Código de seguimiento</span>
            <StatusBadge status={result.status || "Registrada"} size="md" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="num min-w-0 flex-1 truncate text-2xl font-semibold tracking-wide text-fg">{result.ticket_id}</code>
            <Button
              size="md"
              onClick={() => void copy()}
              aria-label={copied ? "Código copiado" : `Copiar código ${result.ticket_id}`}
              icon={copied ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              className="h-10 shrink-0 rounded-lg"
            >
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? "Código copiado al portapapeles" : ""}
          </span>
        </div>
      </div>

      <section className="border-t border-line/8 px-5 py-6 sm:px-8" aria-labelledby="ticket-next">
        <h3 id="ticket-next" className="text-base font-semibold text-fg">
          ¿Qué sigue?
        </h3>
        <ol className="mt-3 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-base text-fg-muted">
              <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/10 text-xs font-semibold text-accent" aria-hidden>
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-line/8 bg-surface-2/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-8">
        <Button variant="ghost" size="lg" onClick={onRestart} icon={<Plus className="h-4 w-4" aria-hidden />} className="justify-center">
          Reportar otro problema
        </Button>
        <Button variant="primary" size="lg" onClick={() => navigate(`/seguimiento?ticket=${encodeURIComponent(result.ticket_id)}`)} className="justify-center">
          Ver seguimiento <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </Card>
  );
}
