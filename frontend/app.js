// Utilidades compartidas entre el Portal Ciudadano y el NOC.
// Regla de seguridad: todo dato externo se inserta con textContent / createElement.

export const STATUSES = ["Registrada", "En revisión", "Siendo atendida", "Solucionada", "Cerrada"];
export const CLOSED_STATUSES = ["Solucionada", "Cerrada"];

export const PROBLEM_TYPES = {
  SIN_INTERNET: "Sin internet",
  SIN_SENAL: "Sin señal",
  INTERNET_LENTO: "Internet lento",
  FALLA_LLAMADAS: "Falla en llamadas",
  OTRO: "Otro",
};

export const TRIGGER_LABELS = {
  COLECTIVO_10: "Colectivo (≥10 reportes)",
  TEMPRANO_IA: "Alerta temprana IA",
  ANTENA_UMBRAL: "Umbral de antena",
};

// Zonas demo para el selector del portal (coordenadas en Lima).
export const DEMO_ZONES = [
  { id: "loayza", name: "Cercado de Lima – Hospital Loayza", lat: -12.0493, lon: -77.0427 },
  { id: "jesusmaria", name: "Jesús María – Residencial San Felipe", lat: -12.0826, lon: -77.0509 },
  { id: "rimac", name: "Rímac – Cerro San Cristóbal", lat: -12.0313, lon: -77.0236 },
  { id: "sanisidro", name: "San Isidro – Centro Financiero", lat: -12.0966, lon: -77.0336 },
  { id: "miraflores", name: "Miraflores – Parque Kennedy", lat: -12.1211, lon: -77.0297 },
  { id: "chorrillos", name: "Chorrillos – Malecón", lat: -12.1647, lon: -77.0253 },
];

/** Crea un elemento DOM de forma segura. children: string | Node | array. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Vacía un contenedor y le agrega nuevos hijos. */
export function replaceChildren(container, ...children) {
  container.replaceChildren(...children.filter(Boolean));
}

// ---------- Fechas ----------
const dateFmt = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" });
const timeFmt = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

export function formatTime(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? "—" : timeFmt.format(d);
}

/** "hace 5 min", "hace 2 h 10 min", "hace 3 d". */
export function timeAgo(value, now = Date.now()) {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "hace <1 min";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h ${mins % 60} min`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function formatMinutes(mins) {
  if (mins === undefined || mins === null || Number.isNaN(Number(mins))) return "—";
  const m = Math.round(Number(mins));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Valor por defecto para <input type="datetime-local"> (hora local). */
export function nowForDatetimeLocal() {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

// ---------- Badges (siempre con texto, nunca solo color) ----------
const BADGE_BASE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

const PRIORITY_CLASSES = {
  CRITICA: "bg-red-600 text-white",
  ALTA: "bg-orange-500 text-black",
  MEDIA: "bg-yellow-400 text-black",
  BAJA: "bg-slate-500 text-white",
};
const PRIORITY_TEXT = { CRITICA: "CRÍTICA", ALTA: "ALTA", MEDIA: "MEDIA", BAJA: "BAJA" };

export function priorityBadge(level) {
  const key = String(level || "").toUpperCase();
  return el("span", { class: `${BADGE_BASE} ${PRIORITY_CLASSES[key] || "bg-slate-600 text-white"}` },
    PRIORITY_TEXT[key] || (level ? String(level) : "Sin prioridad"));
}

const STATUS_CLASSES = {
  "Registrada": "bg-sky-100 text-sky-900 ring-1 ring-sky-300",
  "En revisión": "bg-violet-100 text-violet-900 ring-1 ring-violet-300",
  "Siendo atendida": "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  "Solucionada": "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300",
  "Cerrada": "bg-slate-200 text-slate-800 ring-1 ring-slate-300",
};

export function statusBadge(status) {
  return el("span", { class: `${BADGE_BASE} ${STATUS_CLASSES[status] || "bg-slate-200 text-slate-800"}` },
    status ? String(status) : "Desconocido");
}

export const HEALTH = {
  INHABILITADA: { label: "Inhabilitada", short: "I", color: "#a855f7", cls: "bg-purple-600 text-white" },
  CAIDA: { label: "Caída", short: "C", color: "#ef4444", cls: "bg-red-600 text-white" },
  SATURADA: { label: "Saturada", short: "S", color: "#f59e0b", cls: "bg-amber-400 text-black" },
  NORMAL: { label: "Normal", short: "N", color: "#22c55e", cls: "bg-emerald-500 text-black" },
};

export function healthBadge(status) {
  const h = HEALTH[String(status || "").toUpperCase()];
  return el("span", { class: `${BADGE_BASE} ${h ? h.cls : "bg-slate-600 text-white"}` },
    h ? h.label : (status ? String(status) : "Desconocido"));
}

export const POI_TYPES = {
  hospital: { label: "Hospital", icon: "✚", cls: "bg-red-950 text-red-200 ring-1 ring-red-700" },
  escuela: { label: "Escuela", icon: "✎", cls: "bg-sky-950 text-sky-200 ring-1 ring-sky-700" },
  industria: { label: "Industria", icon: "⚙", cls: "bg-amber-950 text-amber-200 ring-1 ring-amber-700" },
};

export function poiBadge(type) {
  const key = String(type || "").toLowerCase();
  const p = POI_TYPES[key];
  return el("span", { class: `${BADGE_BASE} ${p ? p.cls : "bg-slate-800 text-slate-200 ring-1 ring-slate-600"}` },
    [el("span", { "aria-hidden": "true" }, p ? p.icon : "•"), p ? p.label : (type ? String(type) : "Otro")]);
}

// ---------- Toasts ----------
function toastRegion() {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = el("div", {
      id: "toast-region",
      class: "fixed z-[2000] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none",
      "aria-live": "polite",
      role: "status",
    });
    document.body.append(region);
  }
  return region;
}

const TOAST_CLASSES = {
  success: "bg-emerald-700 text-white",
  error: "bg-red-700 text-white",
  info: "bg-slate-800 text-white",
};

/**
 * Muestra un toast. options: { action: { label, onClick }, duration }
 */
export function toast(message, type = "info", options = {}) {
  const box = el("div", {
    class: `toast pointer-events-auto max-w-md w-full sm:w-auto rounded-lg shadow-lg px-4 py-3 text-sm flex items-start gap-3 ${TOAST_CLASSES[type] || TOAST_CLASSES.info}`,
    role: type === "error" ? "alert" : "status",
  });
  const text = el("div", { class: "flex-1 break-words" }, message);
  box.append(text);
  if (options.action) {
    box.append(el("button", {
      type: "button",
      class: "shrink-0 rounded bg-white/20 hover:bg-white/30 px-2 py-1 text-xs font-semibold",
      onclick: options.action.onClick,
    }, options.action.label));
  }
  const close = el("button", {
    type: "button", class: "shrink-0 opacity-80 hover:opacity-100 px-1", "aria-label": "Cerrar aviso",
  }, "✕");
  const remove = () => box.remove();
  close.addEventListener("click", remove);
  box.append(close);
  toastRegion().append(box);
  setTimeout(remove, options.duration || (options.action ? 12000 : 5000));
  return box;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para contextos sin permisos de portapapeles
    const ta = el("textarea", { class: "sr-only", "aria-hidden": "true" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// ---------- Estados de carga / vacío / error ----------
/** kind: "loading" | "empty" | "error". dark: true para el NOC. */
export function stateBox(kind, message, { dark = false, onRetry } = {}) {
  const palette = dark
    ? { loading: "text-slate-300", empty: "text-slate-400", error: "text-red-300" }
    : { loading: "text-slate-600", empty: "text-slate-500", error: "text-red-700" };
  const box = el("div", {
    class: `flex flex-col items-center justify-center gap-2 py-6 px-3 text-sm text-center ${palette[kind]}`,
    role: kind === "error" ? "alert" : "status",
  });
  if (kind === "loading") box.append(el("span", { class: "spinner", "aria-hidden": "true" }));
  box.append(el("p", {}, message));
  if (kind === "error" && onRetry) {
    box.append(el("button", {
      type: "button",
      class: dark
        ? "rounded border border-slate-600 px-3 py-1 text-slate-100 hover:bg-slate-800"
        : "rounded border border-slate-300 px-3 py-1 text-slate-800 hover:bg-slate-100",
      onclick: onRetry,
    }, "Reintentar"));
  }
  return box;
}

/** Pone un botón en estado "enviando" (deshabilitado + spinner) y lo restaura. */
export function setButtonLoading(button, loading, loadingText = "Enviando…") {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.replaceChildren(el("span", { class: "spinner spinner-sm", "aria-hidden": "true" }), " " + loadingText);
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

/** Muestra una etiqueta "MODO DEMO" si el mock está activo. */
export function mockBadge() {
  return el("span", {
    class: "inline-flex items-center rounded bg-fuchsia-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white",
    title: "Datos simulados en el navegador (mock.js)",
  }, "MODO DEMO");
}

// ---------- Geohash ----------
const GEO_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
/** Decodifica un geohash al centro de su celda. Devuelve { lat, lon } o null. */
export function decodeGeohash(hash) {
  if (!hash || typeof hash !== "string") return null;
  let lat = [-90, 90], lon = [-180, 180], even = true;
  for (const c of hash.toLowerCase()) {
    const idx = GEO_BASE32.indexOf(c);
    if (idx < 0) return null;
    for (let b = 4; b >= 0; b--) {
      const r = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if ((idx >> b) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}
