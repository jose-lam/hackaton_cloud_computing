// Utilidades geoespaciales: geohash (codificar/decodificar) y distancia haversine.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lon: number, precision = 7): string {
  const latR = [-90, 90];
  const lonR = [-180, 180];
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const range = even ? lonR : latR;
    const val = even ? lon : lat;
    const mid = ((range[0] ?? 0) + (range[1] ?? 0)) / 2;
    if (val >= mid) {
      ch = (ch << 1) | 1;
      range[0] = mid;
    } else {
      ch <<= 1;
      range[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function decodeGeohash(hash: string | null | undefined): { lat: number; lon: number } | null {
  if (!hash) return null;
  const lat = [-90, 90];
  const lon = [-180, 180];
  let even = true;
  for (const c of hash.toLowerCase()) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) return null;
    for (let b = 4; b >= 0; b--) {
      const r = even ? lon : lat;
      const mid = ((r[0] ?? 0) + (r[1] ?? 0)) / 2;
      if ((idx >> b) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: ((lat[0] ?? 0) + (lat[1] ?? 0)) / 2, lon: ((lon[0] ?? 0) + (lon[1] ?? 0)) / 2 };
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Zonas demo del portal ciudadano (Lima). */
export const DEMO_ZONES = [
  { id: "loayza", name: "Cercado de Lima – Hospital Loayza", lat: -12.0493, lon: -77.0427 },
  { id: "jesusmaria", name: "Jesús María – Residencial San Felipe", lat: -12.0826, lon: -77.0509 },
  { id: "rimac", name: "Rímac – Cerro San Cristóbal", lat: -12.0313, lon: -77.0236 },
  { id: "sanisidro", name: "San Isidro – Centro Financiero", lat: -12.0966, lon: -77.0336 },
  { id: "miraflores", name: "Miraflores – Parque Kennedy", lat: -12.1211, lon: -77.0297 },
  { id: "surco", name: "Santiago de Surco – Monterrico", lat: -12.1065, lon: -76.9715 },
  { id: "sjl", name: "San Juan de Lurigancho – Canto Grande", lat: -11.9805, lon: -77.0003 },
] as const;
