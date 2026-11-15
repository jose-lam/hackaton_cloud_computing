import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileSearch, MessageSquareWarning, Search } from "lucide-react";
import { Button, buttonClasses, Card, ErrorState, Skeleton } from "../../components/ui";
import { useTickets } from "../../lib/queries";
import { CONFIG } from "../../lib/config";
import { cn, formatTime } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { TicketTracker } from "./TicketTracker";
import { FieldMessage, inputCls } from "./form";

type By = "ticket" | "doc";

interface Mode {
  key: By;
  label: string;
  placeholder: string;
  hint: string;
}
const MODES: readonly [Mode, Mode] = [
  { key: "ticket", label: "Código de ticket", placeholder: "TCK-XXXXXX", hint: CONFIG.MOCK ? "Demo: prueba con TCK-DEMO01." : "Lo recibiste al enviar tu reporte." },
  { key: "doc", label: "N.° de documento", placeholder: "70451289", hint: CONFIG.MOCK ? "Demo: prueba con U-1001." : "El documento con el que hiciste el reporte." },
];

export function TrackingPage() {
  useDocumentTitle("Seguimiento de incidencia");
  const [params, setParams] = useSearchParams();
  const ticket = params.get("ticket")?.trim() || null;
  const doc = params.get("doc")?.trim() || null;
  const active: { by: By; value: string } | null = ticket ? { by: "ticket", value: ticket } : doc ? { by: "doc", value: doc } : null;

  const [by, setBy] = useState<By>(active?.by ?? "ticket");
  const [value, setValue] = useState(active?.value ?? "");
  const [error, setError] = useState("");
  const uid = useId();

  // Sincroniza el formulario cuando la búsqueda llega por URL (p. ej. desde "Ver seguimiento")
  const activeBy = active?.by;
  const activeValue = active?.value;
  useEffect(() => {
    if (!activeBy || !activeValue) return;
    setBy(activeBy);
    setValue(activeValue);
  }, [activeBy, activeValue]);

  const q = useTickets(active ? (active.by === "ticket" ? { ticket_id: active.value } : { user_id: active.value }) : null, { live: true });
  const mode = MODES.find((m) => m.key === by) ?? MODES[0];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) {
      setError(by === "ticket" ? "Ingresa el código de tu ticket." : "Ingresa tu número de documento.");
      return;
    }
    if (by === "ticket" && !/^[A-Za-z0-9-]{4,40}$/.test(v)) {
      setError("El código solo tiene letras, números y guiones (ej. TCK-AB12CD).");
      return;
    }
    setError("");
    setParams(by === "ticket" ? { ticket: v.toUpperCase() } : { doc: v });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[2rem] sm:leading-tight">Seguimiento de tu incidencia</h1>
      <p className="mt-2 text-md text-fg-muted">Consulta en qué etapa está tu reporte. Esta página se actualiza sola.</p>

      <Card className="mt-6 rounded-xl p-5 sm:p-6">
        <form onSubmit={submit} noValidate role="search" aria-label="Buscar reporte">
          <div role="radiogroup" aria-label="Buscar por" className="mb-4 grid grid-cols-2 rounded-lg border border-line/12 bg-surface-2 p-1 sm:inline-grid">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={by === m.key}
                onClick={() => {
                  setBy(m.key);
                  setError("");
                }}
                className={cn("h-9 rounded-md px-4 text-sm font-medium transition-colors", by === m.key ? "bg-surface-1 text-fg shadow-card" : "text-fg-muted hover:text-fg")}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label htmlFor={`${uid}-q`} className="sr-only">
            {mode.label}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`${uid}-q`}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError("");
              }}
              placeholder={mode.placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-q-err` : `${uid}-q-hint`}
              className={inputCls(!!error, "num sm:flex-1")}
            />
            <Button type="submit" variant="primary" size="lg" loading={q.isFetching && !q.data} icon={<Search className="h-4 w-4" aria-hidden />} className="justify-center">
              Buscar
            </Button>
          </div>
          <FieldMessage id={`${uid}-q`} error={error} hint={mode.hint} />
        </form>
      </Card>

      <div className="mt-6" aria-live="polite" aria-busy={q.isLoading || undefined}>
        {!active ? (
          <Placeholder />
        ) : q.isLoading ? (
          <TrackerSkeleton />
        ) : q.isError && !q.data ? (
          <Card className="rounded-xl">
            <ErrorState title="No pudimos consultar tu reporte" description={`${q.error.message} Revisa tu conexión e inténtalo otra vez.`} onRetry={() => void q.refetch()} retrying={q.isFetching} />
          </Card>
        ) : !q.data?.length ? (
          <NotFound by={active.by} value={active.value} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 text-sm text-fg-muted">
              <span>
                {q.data.length === 1 ? "1 reporte encontrado" : `${q.data.length} reportes encontrados`}
              </span>
              <span className="num text-fg-subtle">Actualizado {formatTime(q.dataUpdatedAt)}</span>
            </div>
            {q.data.map((t) => (
              <TicketTracker key={t.ticket_id} ticket={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="rounded-xl border border-dashed border-line/20 px-6 py-12 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent">
        <FileSearch className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-4 text-md font-medium text-fg">Ingresa tu código para ver el avance</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">Verás cada etapa de tu reporte, quién la actualizó y si ya identificamos un problema en tu zona.</p>
    </div>
  );
}

function NotFound({ by, value }: { by: By; value: string }) {
  return (
    <Card className="rounded-xl px-6 py-10 text-center" role="status">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-3 text-fg-muted">
        <Search className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-4 text-md font-medium text-fg">{by === "ticket" ? "No encontramos ese ticket" : "No hay reportes con ese documento"}</p>
      <p className="mx-auto mt-1 max-w-sm break-words text-sm text-fg-muted">
        Buscamos «<span className="num">{value}</span>». Revisa que esté bien escrito; si acabas de reportar, espera unos segundos.
      </p>
      <Link to="/" className={buttonClasses("secondary", "md", "mt-5 rounded-lg")}>
        <MessageSquareWarning className="h-4 w-4" aria-hidden />
        Reportar un problema
      </Link>
    </Card>
  );
}

function TrackerSkeleton() {
  return (
    <Card className="space-y-5 rounded-xl p-6" aria-label="Cargando reporte">
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-4 w-2/3" />
      <div className="flex justify-between gap-2 pt-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-8 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-24 w-full" />
    </Card>
  );
}
