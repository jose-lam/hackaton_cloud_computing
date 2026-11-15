// Serie horaria construida en el cliente a partir de created_at/closed_at de incidentes y tickets.
import type { Incident, Ticket, TrendPoint } from "../types";

const HOUR = 3_600_000;
const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/**
 * Agrupa por hora las últimas `hours` horas (la última es la hora en curso):
 * - reports: tickets creados en la hora.
 * - active_incidents / affected_users: incidentes abiertos al cierre de la hora.
 * - mttr_minutes: MTTR acumulado de los incidentes cerrados hasta el cierre de la hora.
 */
export function buildHourlyTrend(incidents: Incident[], tickets: Ticket[], now = Date.now(), hours = 12): TrendPoint[] {
  const current = new Date(now);
  current.setMinutes(0, 0, 0);
  const firstStart = current.getTime() - (hours - 1) * HOUR;

  const ticketTimes = [...new Map(tickets.map((t) => [t.ticket_id, ms(t.created_at)])).values()].filter((t): t is number => t !== null);
  const spans = incidents
    .map((i) => ({ start: ms(i.created_at), end: ms(i.closed_at), users: i.affected_users_count }))
    .filter((s): s is { start: number; end: number | null; users: number } => s.start !== null);

  const points: TrendPoint[] = [];
  for (let h = 0; h < hours; h++) {
    const start = firstStart + h * HOUR;
    const end = Math.min(start + HOUR, now);
    const active = spans.filter((s) => s.start <= end && (s.end === null || s.end > end));
    const closed = spans.filter((s) => s.end !== null && s.end <= end && s.end >= s.start);
    points.push({
      ts: new Date(start).toISOString(),
      reports: ticketTimes.filter((t) => t >= start && t < start + HOUR).length,
      active_incidents: active.length,
      affected_users: active.reduce((sum, s) => sum + s.users, 0),
      mttr_minutes: closed.length ? Math.round(closed.reduce((sum, s) => sum + ((s.end ?? s.start) - s.start), 0) / closed.length / 60_000) : null,
    });
  }
  return points;
}

/** Geohashes de los incidentes relevantes para la ventana (activos o con actividad reciente). */
export function trendZones(incidents: Incident[], now = Date.now(), hours = 12, max = 12): string[] {
  const since = now - hours * HOUR;
  const relevant = incidents.filter((i) => !i.closed_at || (ms(i.closed_at) ?? 0) >= since || (ms(i.created_at) ?? 0) >= since);
  return [...new Set(relevant.map((i) => i.geohash).filter(Boolean))].slice(0, max);
}
