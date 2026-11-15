// Configuración pública (sin secretos). Se resuelve en build con variables VITE_*.

/** Lee un parámetro tanto de ?x= normal como del query dentro del hash (#/noc?x=). */
export function getUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const fromSearch = new URLSearchParams(window.location.search).get(name);
  if (fromSearch !== null) return fromSearch;
  const hashQuery = window.location.hash.split("?")[1];
  return hashQuery ? new URLSearchParams(hashQuery).get(name) : null;
}

const mockParam = getUrlParam("mock");
const envMock = (import.meta.env.VITE_MOCK ?? "true").toLowerCase() !== "false";

export const CONFIG = {
  API_BASE_URL: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
  MOCK: mockParam === "1" ? true : mockParam === "0" ? false : envMock,
  POLL_MS: 8000,
  REQUEST_TIMEOUT_MS: 8000,
  /** Tiles propios opcionales (ver mapTiles). */
  MAP_TILE_URL: import.meta.env.VITE_MAP_TILE_URL ?? "",
  MAP_ATTRIBUTION: import.meta.env.VITE_MAP_ATTRIBUTION ?? "",
  TIME_ZONE: "America/Lima",
  LOCALE: "es-PE",
} as const;

const CARTO_KEY = (import.meta.env.VITE_CARTO_API_KEY ?? "").trim();
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export interface TileConfig {
  url: string;
  attribution: string;
  /** true si hay que oscurecer los tiles con CSS (OSM estándar en el NOC). */
  darken: boolean;
}

/**
 * Tiles del mapa. Prioridad: VITE_MAP_TILE_URL > CARTO (con VITE_CARTO_API_KEY) > OpenStreetMap.
 * CARTO exige key desde 2026; sin ella se usa OSM (oscurecido en el NOC) para no mostrar marcas de agua.
 */
export function mapTiles(theme: "dark" | "light"): TileConfig {
  if (CONFIG.MAP_TILE_URL) return { url: CONFIG.MAP_TILE_URL, attribution: CONFIG.MAP_ATTRIBUTION || OSM_ATTRIBUTION, darken: false };
  if (CARTO_KEY) {
    const style = theme === "dark" ? "dark_all" : "rastertiles/voyager";
    return { url: `https://basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`, attribution: CARTO_ATTRIBUTION, darken: false };
  }
  return { url: OSM_TILES, attribution: OSM_ATTRIBUTION, darken: theme === "dark" };
}
