import { useRef } from "react";
import { Link } from "react-router-dom";
import { BellRing, Clock3, MessageSquareWarning, Radar, Search, Users } from "lucide-react";
import { Button, buttonClasses, Card } from "../../components/ui";
import { useDocumentTitle } from "../../lib/hooks";
import { ReportWizard } from "./ReportWizard";

const HIGHLIGHTS = [
  { icon: Clock3, text: "Menos de 2 minutos" },
  { icon: Radar, text: "Seguimiento en línea" },
  { icon: BellRing, text: "Aviso al restablecerse" },
];

const HOW = [
  { icon: MessageSquareWarning, title: "Reportas", text: "Nos cuentas qué pasa y dónde, desde tu celular." },
  { icon: Users, title: "Agrupamos", text: "Unimos los reportes de tu zona para detectar fallas de red más rápido." },
  { icon: BellRing, title: "Te avisamos", text: "Recibes un correo y un SMS cuando el servicio vuelve." },
];

export function HomePage() {
  useDocumentTitle("Reporta un problema");
  const wizardTitle = useRef<HTMLHeadingElement>(null);

  const goToReport = () => {
    const el = wizardTitle.current;
    if (!el) return;
    el.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line/8 bg-surface-1" aria-labelledby="hero-title">
        <div className="hero-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-14 lg:grid-cols-[1.1fr,0.9fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/8 px-3 py-1 text-sm font-medium text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              Atención de fallas 24/7
            </p>
            <h1 id="hero-title" className="mt-4 text-balance text-[2rem] font-semibold leading-[1.15] tracking-tight text-fg sm:text-[2.75rem]">
              Reporta un problema con tu servicio
            </h1>
            <p className="mt-4 max-w-xl text-md text-fg-muted sm:text-lg">
              ¿Sin internet, sin señal o con llamadas que se cortan? Cuéntanos qué pasa y te mantendremos al tanto hasta que tu servicio vuelva a funcionar.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button variant="primary" size="lg" onClick={goToReport} icon={<MessageSquareWarning className="h-[18px] w-[18px]" aria-hidden />} className="justify-center">
                Reportar
              </Button>
              <Link to="/seguimiento" className={buttonClasses("secondary", "lg", "bg-surface-1")}>
                <Search className="h-[18px] w-[18px]" aria-hidden />
                Consultar mi incidencia
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
              {HIGHLIGHTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 text-sm text-fg-muted">
                  <Icon className="h-4 w-4 text-accent" aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <HeroIllustration />
        </div>
      </section>

      {/* Asistente + ayuda */}
      <div className="mx-auto grid max-w-6xl items-start gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1fr),320px]">
        <ReportWizard ref={wizardTitle} />

        <aside className="space-y-4" aria-label="Ayuda">
          <Card className="rounded-xl p-5">
            <h2 className="text-base font-semibold text-fg">Cómo funciona</h2>
            <ol className="mt-4 space-y-4">
              {HOW.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div>
                    <p className="text-base font-medium text-fg">{title}</p>
                    <p className="text-sm text-fg-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="rounded-xl p-5">
            <h2 className="text-base font-semibold text-fg">¿Ya hiciste un reporte?</h2>
            <p className="mt-1 text-sm text-fg-muted">Consulta en qué etapa está con tu código o tu número de documento.</p>
            <Link to="/seguimiento" className={buttonClasses("secondary", "md", "mt-4 w-full rounded-lg")}>
              <Search className="h-4 w-4" aria-hidden />
              Ver seguimiento
            </Link>
          </Card>
        </aside>
      </div>
    </>
  );
}

/** Ilustración original: antena emitiendo ondas sobre un mapa abstracto. */
function HeroIllustration() {
  return (
    <div className="relative mx-auto hidden aspect-square w-full max-w-[380px] lg:block" aria-hidden>
      <svg viewBox="0 0 380 380" className="h-full w-full" fill="none">
        <defs>
          <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="rgb(var(--accent))" stopOpacity=".16" />
            <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="190" cy="190" r="185" fill="url(#hero-glow)" />
        {[150, 112, 74].map((r, i) => (
          <circle key={r} cx="190" cy="190" r={r} stroke="rgb(var(--accent))" strokeOpacity={0.14 + i * 0.1} strokeWidth="1.5" strokeDasharray={i === 0 ? "4 6" : undefined} />
        ))}
        {/* calles abstractas */}
        <path d="M40 250 Q 120 220 190 240 T 345 210" stroke="rgb(var(--line))" strokeOpacity=".14" strokeWidth="10" strokeLinecap="round" />
        <path d="M95 60 Q 130 160 110 330" stroke="rgb(var(--line))" strokeOpacity=".1" strokeWidth="8" strokeLinecap="round" />
        {/* ondas */}
        <path d="M150 150 a56 56 0 0 1 80 0" stroke="rgb(var(--accent))" strokeWidth="5" strokeLinecap="round" strokeOpacity=".55" />
        <path d="M128 128 a88 88 0 0 1 124 0" stroke="rgb(var(--accent))" strokeWidth="5" strokeLinecap="round" strokeOpacity=".3" />
        {/* torre */}
        <path d="M190 178 L166 282 M190 178 L214 282 M174 246 H206 M180 214 H200" stroke="rgb(var(--fg))" strokeOpacity=".85" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="190" cy="172" r="11" fill="rgb(var(--accent))" />
        <circle cx="190" cy="172" r="20" stroke="rgb(var(--accent))" strokeOpacity=".35" strokeWidth="3" />
        {/* usuarios en la zona */}
        {[
          [88, 120],
          [292, 132],
          [300, 268],
          [76, 262],
          [250, 318],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="14" fill="rgb(var(--surface-1))" stroke="rgb(var(--line))" strokeOpacity=".2" />
            <circle cx={x} cy={y} r="5" fill="rgb(var(--accent))" fillOpacity=".75" />
          </g>
        ))}
      </svg>
      {/* tarjeta flotante */}
      <div className="absolute bottom-6 left-0 flex items-center gap-3 rounded-xl border border-line/10 bg-surface-1 px-4 py-3 shadow-pop">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-ok/12 text-ok">
          <BellRing className="h-[18px] w-[18px]" />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">Servicio restablecido</p>
          <p className="text-xs text-fg-muted">Te avisamos al instante</p>
        </div>
      </div>
    </div>
  );
}
