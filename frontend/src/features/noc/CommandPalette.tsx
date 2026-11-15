import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, CornerDownLeft, Globe, LayoutDashboard, RadioTower, Search, Siren, type LucideIcon } from "lucide-react";
import { useFocusTrap } from "../../components/ui";
import { PriorityBadge, HealthBadge } from "../../components/domain";
import { cn } from "../../lib/format";
import type { Antenna, Incident } from "../../types";

interface Command {
  id: string;
  group: "Navegación" | "Incidentes" | "Antenas";
  label: string;
  hint?: string;
  icon: LucideIcon;
  meta?: React.ReactNode;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  incidents: Incident[];
  antennas: Antenna[];
  onOpenIncident: (id: string) => void;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Paleta de comandos (Ctrl/⌘+K): navegación y búsqueda de incidentes y antenas. */
export function CommandPalette({ open, onClose, incidents, antennas, onOpenIncident }: Props) {
  if (!open) return null;
  return createPortal(<PaletteDialog onClose={onClose} incidents={incidents} antennas={antennas} onOpenIncident={onOpenIncident} />, document.body);
}

function PaletteDialog({ onClose, incidents, antennas, onOpenIncident }: Omit<Props, "open">) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  useFocusTrap(true, ref, onClose);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const nav: Command[] = [
      { id: "nav-res", group: "Navegación", label: "Ir a Resumen", icon: LayoutDashboard, run: go("/noc") },
      { id: "nav-inc", group: "Navegación", label: "Ir a Incidentes", icon: Siren, run: go("/noc/incidentes") },
      { id: "nav-ant", group: "Navegación", label: "Ir a Antenas", icon: RadioTower, run: go("/noc/antenas") },
      { id: "nav-ana", group: "Navegación", label: "Ir a Analítica", icon: BarChart3, run: go("/noc/analitica") },
      { id: "nav-por", group: "Navegación", label: "Abrir Portal ciudadano", icon: Globe, run: go("/") },
    ];
    const inc: Command[] = [...incidents]
      .sort((a, b) => b.priority_score - a.priority_score)
      .map((i) => ({
        id: `inc-${i.incident_id}`,
        group: "Incidentes",
        label: i.zone_name,
        hint: `${i.incident_id} · ${i.geohash} · ${i.status}`,
        icon: Siren,
        meta: <PriorityBadge level={i.priority_level} />,
        run: () => {
          onOpenIncident(i.incident_id);
          onClose();
        },
      }));
    const ant: Command[] = antennas.map((a) => ({
      id: `ant-${a.antenna_id}`,
      group: "Antenas",
      label: a.antenna_id,
      hint: a.zone_name,
      icon: RadioTower,
      meta: <HealthBadge status={a.health_status} />,
      run: go(`/noc/antenas?q=${encodeURIComponent(a.antenna_id)}`),
    }));
    return [...nav, ...inc, ...ant];
  }, [incidents, antennas, navigate, onClose, onOpenIncident]);

  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return commands.filter((c) => c.group !== "Antenas").slice(0, 10);
    return commands.filter((c) => norm(`${c.label} ${c.hint ?? ""}`).includes(q)).slice(0, 12);
  }, [commands, query]);

  const safeActive = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((safeActive - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[safeActive]?.run();
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[1300] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Paleta de comandos" className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-lg border border-line/15 bg-surface-2 shadow-pop">
        <div className="flex items-center gap-3 border-b border-line/10 px-4">
          <Search className="h-4 w-4 text-fg-subtle" aria-hidden />
          <input
            data-autofocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Buscar incidente, zona, antena o acción…"
            className="h-12 flex-1 bg-transparent text-md text-fg placeholder:text-fg-subtle focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? optionId(safeActive) : undefined}
            aria-autocomplete="list"
            aria-label="Buscar"
          />
          <kbd className="num rounded-sm border border-line/15 bg-surface-3 px-1.5 text-2xs text-fg-muted">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Resultados" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-fg-muted">Sin resultados para «{query}»</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <li key={c.id} role="presentation">
                {header && <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.12em] text-fg-subtle" aria-hidden>{header}</p>}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === safeActive}
                  onMouseMove={() => setActive(i)}
                  onClick={() => c.run()}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2", i === safeActive ? "bg-accent/12 text-fg" : "text-fg-muted")}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", i === safeActive ? "text-accent" : "text-fg-subtle")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{c.label}</span>
                    {c.hint && <span className="num block truncate text-2xs text-fg-subtle">{c.hint}</span>}
                  </span>
                  {c.meta}
                  {i === safeActive ? <CornerDownLeft className="h-3.5 w-3.5 text-fg-subtle" aria-hidden /> : <ArrowRight className="h-3.5 w-3.5 opacity-0" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line/10 px-4 py-2 text-2xs text-fg-subtle">
          <span><kbd className="num">↑↓</kbd> navegar</span>
          <span><kbd className="num">Enter</kbd> abrir</span>
          <span><kbd className="num">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}
