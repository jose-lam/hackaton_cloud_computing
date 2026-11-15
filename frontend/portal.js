// Lógica del Portal Ciudadano (index.html).
import * as api from "./api.js";
import {
  el, STATUSES, PROBLEM_TYPES, DEMO_ZONES, formatDate, nowForDatetimeLocal, toast, copyToClipboard,
  stateBox, setButtonLoading, statusBadge, priorityBadge, mockBadge,
} from "./app.js";

const $ = (id) => document.getElementById(id);
const form = $("ticket-form");
const submitBtn = $("submit-btn");

// ---------- Inicialización ----------
if (api.isMockMode()) {
  $("mock-slot").append(mockBadge());
  $("search-hint").textContent = "Modo demo: prueba con el ticket TCK-DEMO01 o el usuario U-1001.";
}

for (const z of DEMO_ZONES) $("zone").append(el("option", { value: z.id }, z.name));
for (const [value, label] of Object.entries(PROBLEM_TYPES)) $("problem_type").append(el("option", { value }, label));
$("incident_time").value = nowForDatetimeLocal();

$("zone").addEventListener("change", (e) => {
  const z = DEMO_ZONES.find((x) => x.id === e.target.value);
  if (!z) return;
  $("lat").value = z.lat.toFixed(6);
  $("lon").value = z.lon.toFixed(6);
  $("location_text").value = z.name;
  clearError("lat"); clearError("lon"); clearError("location_text");
});

$("description").addEventListener("input", (e) => {
  $("desc-count").textContent = `${e.target.value.length} / 300`;
});

// Geolocalización del navegador
$("geo-btn").addEventListener("click", () => {
  const msg = $("geo-msg");
  if (!("geolocation" in navigator)) {
    msg.textContent = "Tu navegador no permite obtener la ubicación.";
    return;
  }
  const btn = $("geo-btn");
  setButtonLoading(btn, true, "Obteniendo…");
  msg.textContent = "";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("lat").value = pos.coords.latitude.toFixed(6);
      $("lon").value = pos.coords.longitude.toFixed(6);
      clearError("lat"); clearError("lon");
      msg.textContent = `Ubicación obtenida (precisión ±${Math.round(pos.coords.accuracy)} m).`;
      setButtonLoading(btn, false);
    },
    (err) => {
      msg.textContent = err.code === 1
        ? "Permiso denegado. Ingresa la ubicación manualmente o elige una zona."
        : "No se pudo obtener la ubicación. Intenta nuevamente o ingrésala manualmente.";
      setButtonLoading(btn, false);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
});

// ---------- Validación ----------
function setError(id, message) {
  const input = $(id);
  const p = $(`${id}-err`);
  input.setAttribute("aria-invalid", "true");
  input.classList.add("border-red-600");
  if (p) { p.textContent = message; p.classList.remove("hidden"); }
}
function clearError(id) {
  const input = $(id);
  const p = $(`${id}-err`);
  input.removeAttribute("aria-invalid");
  input.classList.remove("border-red-600");
  if (p) { p.textContent = ""; p.classList.add("hidden"); }
}
form.addEventListener("input", (e) => { if (e.target.id && $(`${e.target.id}-err`)) clearError(e.target.id); });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+51\d{9}$/;

function readAndValidate() {
  const v = (id) => $(id).value.trim();
  const errors = {};
  const data = {
    user_id: v("user_id"),
    service_number: v("service_number").replace(/\s+/g, ""),
    email: v("email"),
    phone: v("phone").replace(/[\s-]/g, ""),
    location_text: v("location_text"),
    lat: Number(v("lat")),
    lon: Number(v("lon")),
    problem_type: v("problem_type"),
    description: v("description"),
    incident_time: v("incident_time"),
  };

  if (!data.user_id) errors.user_id = "Ingresa tu ID de usuario.";
  else if (data.user_id.length > 40) errors.user_id = "Máximo 40 caracteres.";
  if (!data.service_number) errors.service_number = "Ingresa tu número de servicio.";
  else if (!/^\d{6,12}$/.test(data.service_number)) errors.service_number = "Debe contener solo dígitos (6 a 12).";
  if (!data.email) errors.email = "Ingresa tu correo.";
  else if (!EMAIL_RE.test(data.email)) errors.email = "El correo no tiene un formato válido.";
  if (!data.phone || data.phone === "+51") errors.phone = "Ingresa tu teléfono.";
  else if (!PHONE_RE.test(data.phone)) errors.phone = "Usa el formato +51 seguido de 9 dígitos (ej. +51999111222).";
  if (!data.location_text) errors.location_text = "Indica una dirección o referencia.";
  if (v("lat") === "" || !Number.isFinite(data.lat) || data.lat < -90 || data.lat > 90) errors.lat = "Latitud inválida (entre -90 y 90).";
  if (v("lon") === "" || !Number.isFinite(data.lon) || data.lon < -180 || data.lon > 180) errors.lon = "Longitud inválida (entre -180 y 180).";
  if (!data.problem_type) errors.problem_type = "Selecciona el tipo de problema.";
  if (!data.description) errors.description = "Describe brevemente el problema.";
  else if (data.description.length > 300) errors.description = "Máximo 300 caracteres.";
  if (!data.incident_time) errors.incident_time = "Indica la fecha y hora.";
  else {
    const t = new Date(data.incident_time);
    if (Number.isNaN(t.getTime())) errors.incident_time = "Fecha inválida.";
    else if (t.getTime() > Date.now() + 5 * 60000) errors.incident_time = "La fecha no puede estar en el futuro.";
    else data.incident_time = t.toISOString();
  }
  return { data, errors };
}

// ---------- Envío ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  form.querySelectorAll("[aria-invalid]").forEach((n) => clearError(n.id));
  const { data, errors } = readAndValidate();
  const ids = Object.keys(errors);
  if (ids.length) {
    ids.forEach((id) => setError(id, errors[id]));
    $("form-msg").textContent = `Revisa ${ids.length === 1 ? "1 campo" : `${ids.length} campos`} marcados en rojo.`;
    $("form-msg").className = "text-sm text-red-700";
    $(ids[0]).focus();
    return;
  }

  $("form-msg").textContent = "";
  setButtonLoading(submitBtn, true, "Enviando…");
  try {
    const res = await api.createTicket(data);
    const ticketId = res && res.ticket_id ? String(res.ticket_id) : "";
    showCreated(ticketId, res);
    toast(`Reporte registrado. Tu código es ${ticketId}`, "success", {
      action: { label: "Copiar", onClick: () => copyId(ticketId) },
    });
    // Limpia solo los campos del problema; conserva los datos de contacto
    $("description").value = "";
    $("desc-count").textContent = "0 / 300";
    $("problem_type").value = "";
    $("incident_time").value = nowForDatetimeLocal();
  } catch (err) {
    $("form-msg").textContent = `No se pudo enviar el reporte: ${err.message}`;
    $("form-msg").className = "text-sm text-red-700";
    toast(`No se pudo enviar el reporte: ${err.message}`, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

async function copyId(id) {
  const ok = await copyToClipboard(id);
  toast(ok ? "Código copiado al portapapeles" : "No se pudo copiar; selecciónalo manualmente", ok ? "info" : "error");
}

function showCreated(ticketId, res) {
  const box = $("last-ticket");
  box.classList.remove("hidden");
  box.replaceChildren(
    el("div", { class: "rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900" }, [
      el("p", { class: "font-semibold" }, "¡Reporte recibido! Guarda tu código de seguimiento:"),
      el("div", { class: "mt-2 flex flex-wrap items-center gap-2" }, [
        el("code", { class: "rounded bg-white px-3 py-1.5 text-lg font-bold tracking-wide ring-1 ring-emerald-300" }, ticketId),
        el("button", {
          type: "button", class: "rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800",
          onclick: () => copyId(ticketId),
        }, "Copiar"),
        el("button", {
          type: "button", class: "rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-100",
          onclick: () => {
            $("search-by").value = "ticket_id";
            $("search-q").value = ticketId;
            $("consulta").scrollIntoView({ behavior: "smooth" });
            runSearch();
          },
        }, "Ver estado"),
      ]),
      el("p", { class: "mt-2 text-sm" }, `Estado: ${res.status || "Registrada"}${res.geohash ? ` · Zona (geohash): ${res.geohash}` : ""}`),
    ]),
  );
}

// ---------- Consulta ----------
const results = $("search-results");
const searchBtn = $("search-btn");

$("search-by").addEventListener("change", (e) => {
  $("search-q").placeholder = e.target.value === "ticket_id" ? "TCK-DEMO01" : "U-1001";
});
$("search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch(); });

async function runSearch() {
  const by = $("search-by").value;
  const q = $("search-q").value.trim();
  if (!q) {
    results.replaceChildren(stateBox("error", "Ingresa un código de ticket o un ID de usuario."));
    $("search-q").focus();
    return;
  }
  setButtonLoading(searchBtn, true, "Buscando…");
  results.replaceChildren(stateBox("loading", "Consultando tu reporte…"));
  try {
    const list = await api.getTickets({ [by]: q });
    if (!list.length) {
      results.replaceChildren(stateBox("empty", by === "ticket_id"
        ? `No encontramos el ticket "${q}". Verifica el código.`
        : `No hay reportes asociados al usuario "${q}".`));
      return;
    }
    results.replaceChildren(...list.map(ticketCard));
  } catch (err) {
    results.replaceChildren(stateBox("error", `No se pudo consultar: ${err.message}`, { onRetry: runSearch }));
  } finally {
    setButtonLoading(searchBtn, false);
  }
}

function timeline(status) {
  const current = STATUSES.indexOf(status);
  const wrap = el("div", { class: "overflow-x-auto pb-2" });
  const ol = el("ol", { class: "timeline", "aria-label": "Progreso del reporte" });
  STATUSES.forEach((s, i) => {
    const cls = i < current ? "is-done" : i === current ? "is-current" : "";
    const label = i < current ? "completado" : i === current ? "estado actual" : "pendiente";
    ol.append(el("li", { class: `timeline-step ${cls}`, "aria-current": i === current ? "step" : null }, [
      el("span", { class: "timeline-dot", "aria-hidden": "true" }, i < current ? "✓" : String(i + 1)),
      el("span", { class: `mt-2 text-xs sm:text-sm ${i === current ? "font-bold text-sky-800" : "text-slate-600"}` }, s),
      el("span", { class: i === current ? "text-[11px] font-semibold uppercase text-sky-700" : "sr-only" },
        i === current ? "Actual" : `(${label})`),
    ]));
  });
  wrap.append(ol);
  return wrap;
}

function ticketCard(t) {
  const card = el("article", { class: "rounded-lg border border-slate-200 p-4" });
  card.append(el("header", { class: "flex flex-wrap items-center gap-2" }, [
    el("h3", { class: "font-mono text-base font-bold" }, t.ticket_id || "Ticket"),
    statusBadge(t.status),
    t.priority_level ? priorityBadge(t.priority_level) : null,
    el("span", { class: "ml-auto text-xs text-slate-500" }, `Creado: ${formatDate(t.created_at)}`),
  ]));
  card.append(el("p", { class: "mt-1 text-sm text-slate-700" },
    `${PROBLEM_TYPES[t.problem_type] || t.problem_type || "Problema"} · ${t.location_text || "Ubicación no indicada"}`));
  if (t.description) card.append(el("p", { class: "mt-1 text-sm italic text-slate-600 break-words" }, `“${t.description}”`));

  if (t.master_incident_id) {
    card.append(el("div", { class: "mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900", role: "note" }, [
      el("span", { "aria-hidden": "true", class: "font-bold" }, "⚠"),
      el("div", {}, [
        el("p", { class: "font-semibold" }, "Hay una incidencia identificada en tu zona"),
        el("p", {}, "Nuestro equipo técnico ya trabaja en ella. Te notificaremos cuando el servicio se restablezca."),
      ]),
    ]));
  }

  card.append(el("div", { class: "mt-4" }, timeline(t.status)));

  const history = [...(t.history || [])].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  const hist = el("div", { class: "mt-3" }, el("h4", { class: "text-sm font-semibold" }, "Historial"));
  if (!history.length) hist.append(el("p", { class: "text-sm text-slate-500" }, "Sin cambios registrados."));
  else {
    const ul = el("ul", { class: "mt-2 space-y-2" });
    for (const h of history) {
      ul.append(el("li", { class: "border-l-4 border-sky-200 pl-3 text-sm" }, [
        el("p", { class: "font-medium" }, h.old_status ? `${h.old_status} → ${h.new_status}` : `${h.new_status}`),
        el("p", { class: "text-xs text-slate-500" }, `${formatDate(h.ts)} · por ${h.changed_by || "Sistema"}`),
        h.note ? el("p", { class: "text-slate-700 break-words" }, h.note) : null,
      ]));
    }
    hist.append(ul);
  }
  card.append(hist);
  return card;
}

// Permite enlazar directamente: index.html?ticket=TCK-XXXX
const pre = new URLSearchParams(location.search).get("ticket");
if (pre) {
  $("search-q").value = pre;
  runSearch();
}
