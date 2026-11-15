import { NavLink } from "react-router-dom";
import { BarChart3, Globe, LayoutDashboard, PanelLeftClose, PanelLeftOpen, RadioTower, Siren, type LucideIcon } from "lucide-react";
import { Logo } from "../../components/Logo";
import { Tooltip } from "../../components/ui";
import { CONFIG } from "../../lib/config";
import { cn } from "../../lib/format";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  count?: number;
  countTone?: string;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeIncidents?: number;
  criticalAntennas?: number;
}

export function Sidebar({ collapsed, onToggle, activeIncidents, criticalAntennas }: SidebarProps) {
  const main: NavItem[] = [
    { to: "/noc", label: "Resumen", icon: LayoutDashboard, end: true },
    { to: "/noc/incidentes", label: "Incidentes", icon: Siren, count: activeIncidents, countTone: "bg-prio-critica/15 text-prio-critica" },
    { to: "/noc/antenas", label: "Antenas", icon: RadioTower, count: criticalAntennas, countTone: "bg-health-caida/15 text-health-caida" },
    { to: "/noc/analitica", label: "Analítica", icon: BarChart3 },
  ];

  const link = (item: NavItem) => {
    const Icon = item.icon;
    const node = (
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            "group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors duration-150",
            isActive ? "bg-accent/10 text-fg" : "text-fg-muted hover:bg-surface-3/60 hover:text-fg",
            collapsed && "justify-center px-0",
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
            <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")} aria-hidden />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {!collapsed && item.count !== undefined && item.count > 0 && (
              <span className={cn("num rounded-sm px-1.5 text-2xs font-semibold leading-5", item.countTone)}>{item.count}</span>
            )}
          </>
        )}
      </NavLink>
    );
    return (
      <li key={item.to}>
        {collapsed ? (
          <Tooltip content={item.count ? `${item.label} (${item.count})` : item.label} side="right" className="flex w-full">
            {node}
          </Tooltip>
        ) : (
          node
        )}
      </li>
    );
  };

  return (
    <aside
      className={cn("flex h-full shrink-0 flex-col border-r border-line/10 bg-surface-1 transition-[width] duration-200", collapsed ? "w-16" : "w-60")}
      aria-label="Navegación principal"
    >
      <div className={cn("flex h-14 items-center border-b border-line/8", collapsed ? "justify-center" : "px-4")}>
        <Logo collapsed={collapsed} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {!collapsed && <p className="mb-2 px-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">Operación</p>}
        <ul className="space-y-0.5">{main.map(link)}</ul>
        <div className="my-3 border-t border-line/8" />
        {!collapsed && <p className="mb-2 px-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">Ciudadanía</p>}
        <ul className="space-y-0.5">{link({ to: "/", label: "Portal ciudadano", icon: Globe })}</ul>
      </nav>
      <div className={cn("flex items-center gap-2 border-t border-line/8 p-2", collapsed ? "flex-col" : "justify-between")}>
        {CONFIG.MOCK && (
          <span className="num rounded-sm border border-warn/30 bg-warn/10 px-1.5 text-2xs font-semibold uppercase leading-5 text-warn" title="Datos simulados en memoria">
            {collapsed ? "Demo" : "Modo demo"}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          aria-expanded={!collapsed}
          className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </aside>
  );
}
