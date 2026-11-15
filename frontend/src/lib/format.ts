import { CONFIG } from "./config";

const dateTimeFmt = new Intl.DateTimeFormat(CONFIG.LOCALE, {
  timeZone: CONFIG.TIME_ZONE,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const timeFmt = new Intl.DateTimeFormat(CONFIG.LOCALE, {
  timeZone: CONFIG.TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const hourFmt = new Intl.DateTimeFormat(CONFIG.LOCALE, {
  timeZone: CONFIG.TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const numberFmt = new Intl.NumberFormat(CONFIG.LOCALE);

const toDate = (v: string | number | Date | null | undefined): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "15 nov., 11:45" en hora de Lima */
export function formatDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d) : "—";
}

/** "12:03:45" */
export function formatTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? timeFmt.format(d) : "—";
}

/** "12:00" */
export function formatHour(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? hourFmt.format(d) : "—";
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "—" : numberFmt.format(n);
}

/** Antigüedad compacta: "ahora", "12 min", "2 h 5 min", "3 d" */
export function formatAge(v: string | null | undefined, now = Date.now()): string {
  const d = toDate(v);
  if (!d) return "—";
  const mins = Math.max(0, Math.floor((now - d.getTime()) / 60000));
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** "hace 12 min" */
export function formatRelative(v: string | null | undefined, now = Date.now()): string {
  const age = formatAge(v, now);
  return age === "—" ? age : age === "ahora" ? "hace un momento" : `hace ${age}`;
}

export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return "—";
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || Number.isNaN(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Valor por defecto de <input type="datetime-local"> en hora local del navegador. */
export function nowForDatetimeLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
