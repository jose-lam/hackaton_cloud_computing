import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { CloudOff, WifiOff } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { IncidentDrawer } from "./IncidentDrawer";
import { NocContext } from "./noc-context";
import { useToast } from "../../components/ui";
import { useAnalytics, useAntennas, useIncidents } from "../../lib/queries";
import { useDocumentTitle, useLocalStorage, useOnline, usePageVisible } from "../../lib/hooks";
import { isClosedStatus } from "../../types";

const TITLES: Record<string, string> = {
  "/noc": "Resumen operativo",
  "/noc/incidentes": "Incidentes",
  "/noc/antenas": "Antenas",
  "/noc/analitica": "Analítica",
};

export function NocLayout() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useLocalStorage("sentinel.sidebar.collapsed", () => window.innerWidth < 1280);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());

  const incidents = useIncidents();
  const antennas = useAntennas();
  const analytics = useAnalytics();
  const fetching = useIsFetching() > 0;
  const online = useOnline();
  const visible = usePageVisible();
  const pageTitle = TITLES[location.pathname] ?? "Centro de operaciones";
  useDocumentTitle(`${pageTitle} · NOC`);

  const selectedId = params.get("incidente");
  const openIncident = useCallback(
    (id: string) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set("incidente", id);
          return n;
        },
        { replace: false },
      ),
    [setParams],
  );
  const closeIncident = useCallback(
    () =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete("incidente");
        return n;
      }),
    [setParams],
  );

  // Ctrl/⌘ + K abre la paleta de comandos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Detecta incidentes nuevos: destello en la fila + toast
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = incidents.data;
    if (!list) return;
    if (!seen.current) {
      seen.current = new Set(list.map((i) => i.incident_id));
      return;
    }
    const fresh = list.filter((i) => !seen.current?.has(i.incident_id));
    if (!fresh.length) return;
    fresh.forEach((i) => seen.current?.add(i.incident_id));
    const ids = fresh.map((i) => i.incident_id);
    setFlashIds((prev) => new Set([...prev, ...ids]));
    window.setTimeout(() => setFlashIds((prev) => new Set([...prev].filter((x) => !ids.includes(x)))), 2600);
    for (const i of fresh) {
      toast({
        tone: i.priority_level === "CRITICA" || i.priority_level === "ALTA" ? "warning" : "info",
        title: `Nuevo incidente ${i.incident_id}`,
        description: `${i.zone_name} · ${i.affected_users_count} usuarios afectados`,
        action: { label: "Ver detalle", onClick: () => openIncident(i.incident_id) },
      });
    }
  }, [incidents.data, toast, openIncident]);

  const activeCount = incidents.data?.filter((i) => !isClosedStatus(i.status)).length;
  const criticalAntennas = antennas.data?.filter((a) => a.health_status !== "NORMAL").length;
  const lastUpdated = Math.max(incidents.dataUpdatedAt, antennas.dataUpdatedAt, analytics.dataUpdatedAt) || null;
  const allFailing = incidents.isError && antennas.isError && analytics.isError;
  const anyError = incidents.isError || antennas.isError || analytics.isError;
  const liveState = !visible ? "paused" : anyError ? "error" : "live";

  const ctx = useMemo(() => ({ flashIds, openIncident, openPalette: () => setPaletteOpen(true) }), [flashIds, openIncident]);

  return (
    <NocContext.Provider value={ctx}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[2000] focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">
        Saltar al contenido
      </a>
      <div className="flex h-full overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} activeIncidents={activeCount} criticalAntennas={criticalAntennas} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            title={pageTitle}
            liveState={liveState}
            lastUpdated={lastUpdated}
            fetching={fetching}
            onRefresh={() => void qc.invalidateQueries()}
            onSearch={() => setPaletteOpen(true)}
          />
          {(!online || allFailing) && (
            <div role="alert" className="flex items-center gap-3 border-b border-danger/30 bg-danger/10 px-5 py-2 text-sm text-fg">
              {!online ? <WifiOff className="h-4 w-4 text-danger" aria-hidden /> : <CloudOff className="h-4 w-4 text-danger" aria-hidden />}
              <span className="font-semibold">{!online ? "Sin conexión a internet." : "Sin conexión con el servidor."}</span>
              <span className="text-fg-muted">Se muestran los últimos datos disponibles; reintentaremos automáticamente.</span>
              <button type="button" onClick={() => void qc.invalidateQueries()} className="ml-auto text-sm font-semibold text-accent hover:underline">
                Reintentar ahora
              </button>
            </div>
          )}
          <main id="contenido" className="flex-1 overflow-y-auto" tabIndex={-1}>
            <div key={location.pathname} className="animate-page-in">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <IncidentDrawer incidentId={selectedId} incidents={incidents.data} loading={incidents.isLoading} antennas={antennas.data} onClose={closeIncident} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} incidents={incidents.data ?? []} antennas={antennas.data ?? []} onOpenIncident={openIncident} />
    </NocContext.Provider>
  );
}
