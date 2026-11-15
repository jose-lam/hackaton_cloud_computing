import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { ChevronDown, Layers } from "lucide-react";
import { HealthBadge, PriorityBadge, StatusBadge, TriggerLabel } from "../../components/domain";
import { Skeleton } from "../../components/ui";
import { mapTiles } from "../../lib/config";
import { cn, formatRelative } from "../../lib/format";
import { decodeGeohash } from "../../lib/geo";
import { HEALTH_META, PRIORITY_META } from "../../lib/labels";
import { HEALTH_STATUSES, isClosedStatus, PRIORITY_LEVELS, type Antenna, type HealthStatus, type Incident, type PriorityLevel } from "../../types";

// Íconos SVG estáticos por estado: la forma también comunica el estado (no solo el color).
const GLYPHS: Record<HealthStatus, string> = {
  NORMAL: '<path d="M4 8.5l2.5 2.5L12 5.5" stroke="#06140c" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  CAIDA: '<path d="M8 3.5v7M4.8 7.6L8 10.8l3.2-3.2" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  SATURADA: '<path d="M3 11.5a5 5 0 0 1 10 0M8 11.5l2.6-3.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>',
  INHABILITADA: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="#e7eef5" stroke-width="2.2" stroke-linecap="round"/>',
};
const FILL: Record<HealthStatus, string> = { NORMAL: "#34d378", CAIDA: "#f85252", SATURADA: "#a78bfa", INHABILITADA: "#5b6678" };

const antennaIcon = (s: HealthStatus) =>
  L.divIcon({
    className: "",
    html: `<div class="ant-marker" style="background:${FILL[s]}"><svg viewBox="0 0 16 16">${GLYPHS[s]}</svg></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
const pulseIcon = L.divIcon({ className: "", html: '<div class="crit-pulse"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

const PRIO_HEX: Record<PriorityLevel, string> = { CRITICA: "#fb4f70", ALTA: "#fb923c", MEDIA: "#fac440", BAJA: "#8ca0bc" };

const LIMA: [number, number] = [-12.065, -77.03];
const TILES = mapTiles("dark");

function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length < 2) return;
    map.fitBounds(L.latLngBounds(points).pad(0.12), { animate: false });
    done.current = true;
  }, [map, points]);
  return null;
}

interface Props {
  antennas: Antenna[] | undefined;
  incidents: Incident[] | undefined;
  loading: boolean;
  onOpenIncident: (id: string) => void;
  className?: string;
}

export function NetworkMap({ antennas, incidents, loading, onOpenIncident, className }: Props) {
  const [layers, setLayers] = useState<Record<HealthStatus | "incidents", boolean>>({ NORMAL: true, CAIDA: true, SATURADA: true, INHABILITADA: true, incidents: true });
  const [panelOpen, setPanelOpen] = useState(true);
  const icons = useMemo(() => Object.fromEntries(HEALTH_STATUSES.map((s) => [s, antennaIcon(s)])) as Record<HealthStatus, L.DivIcon>, []);

  const activeIncidents = useMemo(
    () =>
      (incidents ?? [])
        .filter((i) => !isClosedStatus(i.status))
        .map((i) => {
          const pos = decodeGeohash(i.geohash);
          return pos ? { ...i, pos } : null;
        })
        .filter((x): x is Incident & { pos: { lat: number; lon: number } } => x !== null)
        .sort((a, b) => a.priority_score - b.priority_score),
    [incidents],
  );
  const validAntennas = useMemo(() => (antennas ?? []).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon)), [antennas]);
  const points = useMemo<[number, number][]>(() => validAntennas.map((a) => [a.lat, a.lon]), [validAntennas]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of validAntennas) c[a.health_status] = (c[a.health_status] ?? 0) + 1;
    return c;
  }, [validAntennas]);
  const prioCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of activeIncidents) c[i.priority_level] = (c[i.priority_level] ?? 0) + 1;
    return c;
  }, [activeIncidents]);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-line/10 bg-bg", className)}>
      <MapContainer center={LIMA} zoom={12} minZoom={10} maxZoom={17} className="h-full w-full" zoomControl attributionControl preferCanvas={false} aria-label="Mapa de la red en Lima">
        <TileLayer url={TILES.url} attribution={TILES.attribution} className={TILES.darken ? "tiles-dark" : undefined} maxZoom={19} />
        <FitOnce points={points} />

        {layers.incidents &&
          activeIncidents.map((i) => {
            const color = PRIO_HEX[i.priority_level];
            return (
              <Circle
                key={`c-${i.incident_id}`}
                center={[i.pos.lat, i.pos.lon]}
                radius={700 + i.affected_users_count * 130} // metros; crece con los usuarios afectados
                pathOptions={{ color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.18, dashArray: i.priority_level === "BAJA" ? "4 4" : undefined }}
              >
                <Popup>
                  <IncidentPopup incident={i} onOpen={() => onOpenIncident(i.incident_id)} />
                </Popup>
              </Circle>
            );
          })}
        {layers.incidents &&
          activeIncidents
            .filter((i) => i.priority_level === "CRITICA")
            .map((i) => <Marker key={`p-${i.incident_id}`} position={[i.pos.lat, i.pos.lon]} icon={pulseIcon} interactive={false} keyboard={false} />)}

        {validAntennas
          .filter((a) => layers[a.health_status])
          .map((a) => (
            <Marker key={a.antenna_id} position={[a.lat, a.lon]} icon={icons[a.health_status]} title={`${a.antenna_id}: ${HEALTH_META[a.health_status].label}`} alt={`${a.antenna_id}, ${HEALTH_META[a.health_status].label}`}>
              <Popup>
                <AntennaPopup antenna={a} />
              </Popup>
            </Marker>
          ))}
      </MapContainer>

      {loading && (
        <div className="absolute inset-0 z-[450] grid place-items-center bg-bg/60" role="status">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-2 w-40" />
            <span className="text-sm text-fg-muted">Cargando mapa de red…</span>
          </div>
        </div>
      )}

      {/* Panel flotante: leyenda + filtros de capas */}
      <div className="surface-glass absolute right-3 top-3 z-[500] w-56 rounded-md border border-line/12 shadow-pop">
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-fg-muted hover:text-fg"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden /> Capas y leyenda
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", panelOpen && "rotate-180")} aria-hidden />
        </button>
        {panelOpen && (
          <div className="space-y-3 border-t border-line/10 px-3 pb-3 pt-2.5">
            <fieldset>
              <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">Antenas</legend>
              {HEALTH_STATUSES.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-3/50">
                  <input type="checkbox" checked={layers[s]} onChange={(e) => setLayers((l) => ({ ...l, [s]: e.target.checked }))} className="h-3.5 w-3.5 accent-[rgb(var(--accent))]" />
                  <span className="grid h-4 w-4 place-items-center rounded-full" style={{ background: FILL[s] }} aria-hidden>
                    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5">
                      <GlyphPath status={s} />
                    </svg>
                  </span>
                  <span className={cn("flex-1 text-fg", s === "INHABILITADA" && "line-through decoration-fg-subtle")}>{HEALTH_META[s].label}</span>
                  <span className="num text-xs text-fg-subtle">{counts[s] ?? 0}</span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle">Incidentes activos</legend>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-3/50">
                <input type="checkbox" checked={layers.incidents} onChange={(e) => setLayers((l) => ({ ...l, incidents: e.target.checked }))} className="h-3.5 w-3.5 accent-[rgb(var(--accent))]" />
                <span className="flex-1 text-fg">Mostrar áreas</span>
                <span className="num text-xs text-fg-subtle">{activeIncidents.length}</span>
              </label>
              <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 px-1">
                {PRIORITY_LEVELS.map((p) => (
                  <li key={p} className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: PRIO_HEX[p], background: `${PRIO_HEX[p]}40` }} aria-hidden />
                    {PRIORITY_META[p].label}
                    <span className="num ml-auto text-fg-subtle">{prioCounts[p] ?? 0}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 px-1 text-2xs text-fg-subtle">El radio crece con los usuarios afectados.</p>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}

/** Glifo de la leyenda reproducido como JSX (sin HTML inyectado). */
function GlyphPath({ status }: { status: HealthStatus }) {
  switch (status) {
    case "NORMAL":
      return <path d="M4 8.5l2.5 2.5L12 5.5" stroke="#06140c" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case "CAIDA":
      return <path d="M8 3.5v7M4.8 7.6L8 10.8l3.2-3.2" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case "SATURADA":
      return <path d="M3 11.5a5 5 0 0 1 10 0M8 11.5l2.6-3.4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
    default:
      return <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="#e7eef5" strokeWidth="2.4" strokeLinecap="round" />;
  }
}

function AntennaPopup({ antenna }: { antenna: Antenna }) {
  return (
    <div className="w-56 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="num text-sm font-semibold">{antenna.antenna_id}</span>
        <HealthBadge status={antenna.health_status} />
      </div>
      <p className="text-sm text-fg-muted">{antenna.zone_name}</p>
      <p className="num text-xl font-semibold">
        {antenna.last_traffic_gb} <span className="text-xs font-normal text-fg-subtle">GB/min</span>
      </p>
      {antenna.structural_risk && <p className="text-xs font-bold uppercase tracking-wide text-prio-critica">Riesgo estructural</p>}
      <p className="num text-2xs text-fg-subtle">Actualizado {formatRelative(antenna.updated_at)}</p>
    </div>
  );
}

function IncidentPopup({ incident, onOpen }: { incident: Incident; onOpen: () => void }) {
  return (
    <div className="w-60 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="num text-xs font-semibold text-fg-muted">{incident.incident_id}</span>
        <PriorityBadge level={incident.priority_level} />
        <StatusBadge status={incident.status} />
      </div>
      <p className="text-sm font-semibold text-fg">{incident.zone_name}</p>
      <div className="flex items-center justify-between text-sm">
        <span className="text-fg-muted">
          <span className="num font-semibold text-fg">{incident.affected_users_count}</span> afectados
        </span>
        <TriggerLabel type={incident.trigger_type} className="text-xs" />
      </div>
      <button type="button" onClick={onOpen} className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent/90">
        Abrir detalle
      </button>
    </div>
  );
}
