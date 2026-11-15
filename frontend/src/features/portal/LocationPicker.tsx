import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { LocateFixed, MousePointerClick } from "lucide-react";
import { Button } from "../../components/ui";
import { CONFIG, mapTiles } from "../../lib/config";
import { cn } from "../../lib/format";
import { DEMO_ZONES } from "../../lib/geo";

export interface Coords {
  lat: number;
  lon: number;
}

const LIMA: [number, number] = [-12.07, -77.035];
const TILES = mapTiles("light");

// Pin estático (sin datos del usuario en el HTML)
const pinIcon = L.divIcon({
  className: "",
  html: '<svg class="pin-marker" viewBox="0 0 32 40" aria-hidden="true"><path d="M16 39s13-12.1 13-22.5C29 8.5 23.2 2 16 2S3 8.5 3 16.5C3 26.9 16 39 16 39z" fill="rgb(15 118 110)" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="16.5" r="5" fill="#fff"/></svg>',
  iconSize: [32, 40],
  iconAnchor: [16, 39],
});

function ClickToPlace({ onPick }: { onPick: (c: Coords) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  return null;
}

/** Centra el mapa cuando la ubicación llega desde fuera (GPS o zona de ejemplo). */
function FlyTo({ target }: { target: (Coords & { seq: number }) | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 15), { animate: !reduced, duration: 0.6 });
  }, [map, target]);
  return null;
}

interface Props {
  value: Coords | null;
  onChange: (c: Coords) => void;
  onZone?: (name: string) => void;
  error?: string;
  describedBy?: string;
}

export function LocationPicker({ value, onChange, onZone, error, describedBy }: Props) {
  const [flyTarget, setFlyTarget] = useState<(Coords & { seq: number }) | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const jump = (c: Coords) => {
    onChange(c);
    setFlyTarget((prev) => ({ ...c, seq: (prev?.seq ?? 0) + 1 }));
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoMsg({ tone: "error", text: "Tu navegador no permite obtener la ubicación. Marca el punto en el mapa." });
      return;
    }
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        jump({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoMsg({ tone: "ok", text: `Ubicación obtenida (precisión ±${Math.round(pos.coords.accuracy)} m). Puedes ajustar el marcador.` });
        setLocating(false);
      },
      (err) => {
        setGeoMsg({
          tone: "error",
          text:
            err.code === err.PERMISSION_DENIED
              ? "No diste permiso de ubicación. Marca el punto tocando el mapa."
              : err.code === err.TIMEOUT
                ? "La ubicación tardó demasiado. Inténtalo otra vez o marca el punto en el mapa."
                : "No pudimos obtener tu ubicación. Marca el punto en el mapa.",
        });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const markerHandlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        onChange({ lat: ll.lat, lon: ll.lng });
      },
    }),
    [onChange],
  );

  return (
    <div className="space-y-3">
      <div
        className={cn("relative h-60 overflow-hidden rounded-lg border sm:h-72", error ? "border-danger/70" : "border-line/20")}
        aria-describedby={describedBy}
      >
        <MapContainer center={LIMA} zoom={12} minZoom={10} maxZoom={18} className="h-full w-full" scrollWheelZoom={false} aria-label="Mapa para marcar la ubicación del problema">
          <TileLayer url={TILES.url} attribution={TILES.attribution} maxZoom={19} />
          <ClickToPlace onPick={onChange} />
          <FlyTo target={flyTarget} />
          {value && <Marker position={[value.lat, value.lon]} icon={pinIcon} draggable eventHandlers={markerHandlers} title="Ubicación del problema (arrastra para ajustar)" />}
        </MapContainer>
        {!value && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center px-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-1/95 px-3.5 py-1.5 text-sm font-medium text-fg shadow-pop">
              <MousePointerClick className="h-4 w-4 text-accent" aria-hidden />
              Toca el mapa para marcar el lugar
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="md" onClick={locate} loading={locating} icon={<LocateFixed className="h-4 w-4" aria-hidden />} className="h-10 rounded-lg">
          {locating ? "Buscando…" : "Usar mi ubicación"}
        </Button>
        <p className="num text-sm text-fg-subtle" aria-live="polite">
          {value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : "Sin punto marcado"}
        </p>
      </div>
      {geoMsg && (
        <p role={geoMsg.tone === "error" ? "alert" : "status"} className={cn("text-sm", geoMsg.tone === "error" ? "text-danger" : "text-ok")}>
          {geoMsg.text}
        </p>
      )}

      {CONFIG.MOCK && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">Zonas de ejemplo (demo)</p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_ZONES.slice(0, 4).map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => {
                  jump({ lat: z.lat, lon: z.lon });
                  onZone?.(z.name);
                }}
                className="h-8 rounded-full border border-line/15 bg-surface-1 px-3 text-sm text-fg-muted transition-colors hover:border-accent/50 hover:text-fg"
              >
                {z.name.split(" – ")[0]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
