import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, MessageSquareWarning, Search, ShieldCheck } from "lucide-react";
import { Logo } from "../../components/Logo";
import { CONFIG } from "../../lib/config";
import { cn } from "../../lib/format";
import { useLightTheme, useOnline } from "../../lib/hooks";

const NAV = [
  { to: "/", label: "Reportar", icon: MessageSquareWarning, end: true },
  { to: "/seguimiento", label: "Seguimiento", icon: Search, end: false },
] as const;

export function PortalLayout() {
  useLightTheme();
  const { pathname } = useLocation();
  const online = useOnline();

  // Cada página empieza arriba
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[2000] focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">
        Saltar al contenido
      </a>

      <header className="sticky top-0 z-[600] border-b border-line/10 bg-surface-1/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="rounded-md" aria-label="Sentinel AI, Red TeleCorp: inicio del portal">
            <span className="sm:hidden">
              <Logo collapsed />
            </span>
            <span className="hidden sm:block">
              <Logo />
            </span>
          </Link>
          <span className="hidden h-6 w-px bg-line/12 md:block" aria-hidden />
          <span className="hidden text-sm font-medium text-fg-muted md:block">Portal ciudadano</span>

          <nav aria-label="Portal" className="ml-auto flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-base font-medium transition-colors",
                    isActive ? "bg-accent/10 text-accent" : "text-fg-muted hover:bg-surface-3 hover:text-fg",
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {!online && (
        <div role="alert" className="border-b border-danger/25 bg-danger/8 px-4 py-2 text-center text-sm text-fg">
          <span className="font-semibold">Sin conexión a internet.</span> <span className="text-fg-muted">Podrás enviar tu reporte cuando vuelvas a conectarte.</span>
        </div>
      )}

      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        <div key={pathname} className="animate-page-in">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-line/10 bg-surface-1">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-fg-muted sm:flex-row sm:items-center sm:px-6">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            Usamos tus datos solo para atender el reporte y avisarte sobre tu servicio.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 whitespace-nowrap sm:ml-auto">
            {CONFIG.MOCK && <span className="rounded-sm border border-warn/35 bg-warn/8 px-1.5 text-2xs font-semibold uppercase leading-5 text-warn">Modo demo</span>}
            <Link to="/noc" className="inline-flex items-center gap-1 font-medium text-fg-muted hover:text-fg">
              Acceso operadores <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <span className="text-fg-subtle">© {new Date().getFullYear()} Red TeleCorp</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
