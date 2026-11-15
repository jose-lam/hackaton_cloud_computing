// Relaciones derivadas de un incidente (el esquema Incidente no trae antenna_id ni tickets).
import type { Antenna, Incident, Ticket } from "../types";
import { decodeGeohash, distanceMeters } from "./geo";

/** Antena del incidente: antenna_id si viene; si no, la de su geohash o la más cercana (≤ 1,5 km). */
export function antennaForIncident(incident: Incident, antennas: Antenna[] | undefined): Antenna | undefined {
  if (!antennas?.length) return undefined;
  if (incident.antenna_id) return antennas.find((a) => a.antenna_id === incident.antenna_id);
  const sameCell = antennas.find((a) => a.geohash && incident.geohash && a.geohash.startsWith(incident.geohash));
  if (sameCell) return sameCell;
  const pos = decodeGeohash(incident.geohash);
  if (!pos) return undefined;
  let best: { a: Antenna; d: number } | undefined;
  for (const a of antennas) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
    const d = distanceMeters(pos.lat, pos.lon, a.lat, a.lon);
    if (d <= 1500 && (!best || d < best.d)) best = { a, d };
  }
  return best?.a;
}

/** Inicio reportado del problema: el incident_time más temprano de los tickets vinculados. */
export function earliestIncidentTime(tickets: Ticket[]): string | null {
  const times = tickets.map((t) => t.incident_time).filter((t): t is string => Boolean(t) && !Number.isNaN(Date.parse(t ?? "")));
  return times.length ? times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
}
