import { RefreshCw, Search } from "lucide-react";
import { LiveDot } from "../../components/domain";
import { Button, Tooltip } from "../../components/ui";
import { cn, formatTime } from "../../lib/format";

interface TopbarProps {
  title: string;
  liveState: "live" | "paused" | "error";
  lastUpdated: number | null;
  fetching: boolean;
  onRefresh: () => void;
  onSearch: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Topbar({ title, liveState, lastUpdated, fetching, onRefresh, onSearch }: TopbarProps) {
  const liveLabel = liveState === "live" ? "En vivo" : liveState === "paused" ? "Pausado" : "Con errores";
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line/10 bg-surface-1/80 px-5 backdrop-blur">
      <h1 className="text-md font-semibold tracking-tight">{title}</h1>

      <div
        className={cn(
          "flex h-7 items-center gap-2 rounded-full border px-2.5",
          liveState === "live" && "border-ok/30 bg-ok/8",
          liveState === "paused" && "border-line/15 bg-surface-2",
          liveState === "error" && "border-danger/35 bg-danger/10",
        )}
        role="status"
        aria-live="polite"
      >
        <LiveDot state={liveState} />
        <span className={cn("text-2xs font-bold uppercase tracking-[0.14em]", liveState === "live" ? "text-ok" : liveState === "error" ? "text-danger" : "text-fg-muted")}>{liveLabel}</span>
        <span className="h-3 w-px bg-line/20" aria-hidden />
        <span className="num text-xs text-fg-muted">
          <span className="sr-only">Último refresco: </span>
          {lastUpdated ? formatTime(lastUpdated) : "--:--:--"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onSearch}
          className="group flex h-8 w-72 items-center gap-2 rounded-md border border-line/12 bg-surface-2 px-2.5 text-sm text-fg-subtle transition-colors hover:border-line/25 hover:text-fg-muted max-lg:w-48"
          aria-label="Buscar incidentes, zonas o antenas (Ctrl+K)"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span className="flex-1 truncate text-left">Buscar incidentes, zonas…</span>
          <kbd className="num rounded-sm border border-line/15 bg-surface-3 px-1.5 text-2xs text-fg-muted">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <Tooltip content="Refrescar ahora" side="bottom">
          <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refrescar datos ahora">
            <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} aria-hidden />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
