// Lógica del Centro de Operaciones (noc.html).
import { CONFIG } from "./config.js";
import * as api from "./api.js";
import {
  el, STATUSES, CLOSED_STATUSES, PROBLEM_TYPES, TRIGGER_LABELS, HEALTH, POI_TYPES,
  formatDate, formatTime, timeAgo, formatMinutes, toast, stateBox, setButtonLoading,
  priorityBadge, statusBadge, healthBadge, poiBadge, mockBadge, decodeGeohash,
} from "./app.js";

const $ = (id) => document.getElementById(id);
const L = window.L;
const Chart = window.Chart;

const PRIORITY_COLORS = { CRITICA: "#ef4444", ALTA: "#f97316", MEDIA: "#eab308", BAJA: "#94a3b8" };
// Paleta categórica fija por tipo de falla (el color sigue a la categoría, no al ranking)
const TYPE_COLORS = { SIN_INTERNET: "#3987e5", SIN_SENAL: "#d95926", INTERNET_LENTO: "#199e70", FALLA_LLAMADAS: "#c98500", OTRO: "#d55181" };
const HEALTH_ORDER = { CAIDA: 0, INHABILITADA: 1, SATURADA: 2, NORMAL: 3 };

const state = {
  incidents: null,
  antennas: null,
  analytics: null,
  errors: {},
  pollMs: Number(CONFIG.POLL_MS) || 8000,
  timer: null,
  inflight: null,
  lastOk: null,
  selectedId: null,
  lastFocus: null,
};

// ---------- Utilidades ----------
const isActive = (inc) => !CLOSED_STATUSES.includes(inc.status);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function incidentLatLon(inc) {
  if (Number.isFinite(Number(inc.lat)) && Number.isFinite(Number(inc.lon))) return { lat: Number(inc.lat), lon: Number(inc.lon) };
  return decodeGeohash(inc.geohash);
}

function uniquePoiTypes(pois) {
  const seen = new Set();
  return (Array.isArray(pois) ? pois : [])
    .map((p) => String(p && p.type || "").toLowerCase())
    .filter((t) => t && !seen.has(t) && seen.add(t))
    .sort((a, b) => (POI_TYPES[a] ? 0 : 1) - (POI_TYPES[b] ? 0 : 1));
}

// ---------- Barra superior / polling ----------
if (api.isMockMode()) $("mock-slot").append(mockBadge());

const pollSelect = $("poll-select");
if (![...pollSelect.options].some((o) => Number(o.value) === state.pollMs)) {
  pollSelect.append(el("option", { value: String(state.pollMs) }, `${state.pollMs / 1000} s`));
}
pollSelect.value = String(state.pollMs);
pollSelect.addEventListener("change", () => {
  state.pollMs = Number(pollSelect.value);
  setLive();
  schedule();
});

$("refresh-btn").addEventListener("click", async () => {
  const btn = $("refresh-btn");
  setButtonLoading(btn, true, "Refrescando…");
  await refresh();
  setButtonLoading(btn, false);
  schedule();
});

function setLive() {
  const dot = $("live-dot");
  const text = $("live-text");
  dot.classList.remove("is-paused", "is-error");
  const failed = Object.keys(state.errors).length;
  const last = state.lastOk ? formatTime(state.lastOk) : "—";
  if (document.hidden) {
    dot.classList.add("is-paused");
    text.textContent = `Pausado (pestaña oculta) · último: ${last}`;
  } else if (failed) {
    dot.classList.add("is-error");
    text.textContent = `Con errores (${failed}) · último OK: ${last}`;
  } else if (!state.pollMs) {
    dot.classList.add("is-paused");
    text.textContent = `Pausado · actualizado ${last}`;
  } else {
    text.textContent = `En vivo · actualizado ${last}`;
  }
}

function schedule() {
  clearTimeout(state.timer);
  if (!state.pollMs || document.hidden) return;
  state.timer = setTimeout(async () => {
    await refresh();
    schedule();
  }, state.pollMs);
}

document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    clearTimeout(state.timer);
    setLive();
  } else {
    await refresh();
    schedule();
  }
});

// ---------- Carga de datos ----------
async function refresh() {
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    const [inc, ant, ana] = await Promise.allSettled([api.getIncidents(), api.getAntennas(), api.getAnalytics()]);
    const prevErrors = { ...state.errors };
    state.errors = {};
    if (inc.status === "fulfilled") state.incidents = inc.value; else state.errors.incidents = inc.reason;
    if (ant.status === "fulfilled") state.antennas = ant.value; else state.errors.antennas = ant.reason;
    if (ana.status === "fulfilled") state.analytics = ana.value; else state.errors.analytics = ana.reason;
    if (!Object.keys(state.errors).length) state.lastOk = new Date();

    // Aviso solo cuando aparece un error nuevo (evita spam en cada ciclo)
    const newErr = Object.keys(state.errors).find((k) => !prevErrors[k]);
    if (newErr) toast(`Error al actualizar ${({ incidents: "incidentes", antennas: "antenas", analytics: "analítica" })[newErr]}: ${state.errors[newErr].message}`, "error");

    renderAll();
  })();
  try { await state.inflight; } finally { state.inflight = null; }
}

function renderAll() {
  setLive();
  renderKpis();
  renderMap();
  renderIncidents();
  renderRisk();
  renderAntennas();
  renderCharts();
}

// ---------- KPIs ----------
function kpiCard(label, value, sub, accent) {
  return el("div", { class: `rounded-xl border border-slate-800 bg-slate-900 p-4 border-l-4 ${accent}` }, [
    el("p", { class: "text-xs font-semibold uppercase tracking-wide text-slate-400" }, label),
    el("p", { class: "mt-1 text-3xl font-bold tabular-nums" }, value),
    el("p", { class: "mt-1 text-xs text-slate-400" }, sub),
  ]);
}

function renderKpis() {
  const box = $("kpis");
  if (!state.incidents && !state.antennas && !state.analytics) {
    box.replaceChildren(el("div", { class: "col-span-full" },
      state.errors.incidents
        ? stateBox("error", "No se pudieron cargar los indicadores.", { dark: true, onRetry: refresh })
        : stateBox("loading", "Cargando indicadores…", { dark: true })));
    return;
  }
  const incidents = state.incidents || [];
  const active = incidents.filter(isActive);
  const critical = active.filter((i) => i.priority_level === "CRITICA").length;
  const ants = state.antennas || [];
  const count = (s) => ants.filter((a) => a.health_status === s).length;
  const critAnts = count("CAIDA") + count("INHABILITADA") + count("SATURADA");
  const a = state.analytics || {};
  const affected = a.affected_users_total ?? active.reduce((s, i) => s + num(i.affected_users_count), 0);

  box.replaceChildren(
    kpiCard("Incidentes activos", state.incidents ? String(active.length) : "—",
      state.incidents ? `${critical} de prioridad crítica` : "Sin datos", "border-l-red-500"),
    kpiCard("Antenas críticas", state.antennas ? String(critAnts) : "—",
      state.antennas ? `${count("CAIDA")} caídas · ${count("INHABILITADA")} inhabilitadas · ${count("SATURADA")} saturadas` : "Sin datos", "border-l-orange-500"),
    kpiCard("Usuarios afectados", affected === null || affected === undefined ? "—" : String(affected),
      "En incidentes activos", "border-l-sky-500"),
    kpiCard("MTTR promedio", formatMinutes(a.mttr_minutes), "Tiempo medio de restablecimiento", "border-l-emerald-500"),
  );
}

// ---------- Mapa ----------
const mapState = { map: null, antennaLayer: null, incidentLayer: null, markers: new Map(), circles: new Map(), fitted: false };

function initMap() {
  if (!L) {
    $("map").replaceChildren(stateBox("error", "No se pudo cargar la librería de mapas (Leaflet).", { dark: true }));
    return;
  }
  mapState.map = L.map("map", { zoomControl: true }).setView([-12.075, -77.04], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapState.map);
  mapState.incidentLayer = L.layerGroup().addTo(mapState.map);
  mapState.antennaLayer = L.layerGroup().addTo(mapState.map);

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => {
    const div = el("div", { class: "map-legend" }, [el("strong", {}, "Antenas")]);
    for (const [key, h] of Object.entries(HEALTH)) {
      div.append(el("div", {}, [el("span", { class: "sw", style: `background:${h.color}` }), `${h.short} · ${h.label}`]));
      void key;
    }
    div.append(el("strong", { class: "block mt-1" }, "Incidentes (radio = usuarios)"));
    for (const [lvl, c] of Object.entries(PRIORITY_COLORS)) {
      div.append(el("div", {}, [el("span", { class: "sw", style: `background:${c}` }), lvl === "CRITICA" ? "CRÍTICA" : lvl]));
    }
    return div;
  };
  legend.addTo(mapState.map);
}

function antennaPopup(a) {
  return el("div", { class: "text-slate-900 text-sm space-y-1" }, [
    el("p", { class: "font-bold" }, a.antenna_id || "Antena"),
    el("p", {}, a.zone_name || "—"),
    el("p", {}, [healthBadge(a.health_status), " ", `${num(a.last_traffic_gb)} GB/min`]),
    a.structural_risk ? el("p", { class: "font-bold text-red-700" }, "RIESGO ESTRUCTURAL") : null,
    el("p", { class: "text-xs text-slate-500" }, `Actualizado: ${formatDate(a.updated_at)}`),
  ]);
}

function incidentPopup(inc) {
  return el("div", { class: "text-slate-900 text-sm space-y-1" }, [
    el("p", { class: "font-bold" }, `${inc.incident_id || "Incidente"} · ${inc.zone_name || ""}`),
    el("p", {}, [priorityBadge(inc.priority_level), " ", `Puntaje ${num(inc.priority_score)}`]),
    el("p", {}, `${num(inc.affected_users_count)} usuarios afectados · ${TRIGGER_LABELS[inc.trigger_type] || inc.trigger_type || "—"}`),
    el("p", {}, `Estado: ${inc.status || "—"}`),
    el("button", {
      type: "button", class: "mt-1 rounded bg-sky-700 px-2 py-1 text-xs font-semibold text-white",
      onclick: () => openDrawer(inc.incident_id),
    }, "Ver detalle"),
  ]);
}

function renderMap() {
  if (!mapState.map) return;
  const status = $("map-status");
  if (state.errors.antennas || state.errors.incidents) status.textContent = "Mostrando últimos datos disponibles";
  else status.textContent = "";

  // Antenas: actualiza en sitio para no cerrar popups abiertos
  if (state.antennas) {
    const seen = new Set();
    for (const a of state.antennas) {
      const lat = Number(a.lat), lon = Number(a.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      seen.add(a.antenna_id);
      const h = HEALTH[a.health_status] || { color: "#64748b", short: "?", label: "Desconocido" };
      const iconEl = el("div", { class: "antenna-icon", style: `background:${h.color}` }, h.short);
      const icon = L.divIcon({ html: iconEl.outerHTML, className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
      let m = mapState.markers.get(a.antenna_id);
      if (!m) {
        m = L.marker([lat, lon], { icon, keyboard: true, title: `${a.antenna_id} – ${h.label}`, alt: `${a.antenna_id} ${h.label}` })
          .bindPopup(antennaPopup(a))
          .bindTooltip(`${a.antenna_id} · ${h.label}`, { direction: "top", offset: [0, -14] });
        m.addTo(mapState.antennaLayer);
        mapState.markers.set(a.antenna_id, m);
      } else {
        m.setLatLng([lat, lon]).setIcon(icon).setPopupContent(antennaPopup(a));
        m.setTooltipContent(`${a.antenna_id} · ${h.label}`);
      }
    }
    for (const [id, m] of mapState.markers) if (!seen.has(id)) { m.remove(); mapState.markers.delete(id); }
  }

  // Incidentes activos como círculos
  if (state.incidents) {
    const seen = new Set();
    for (const inc of state.incidents.filter(isActive)) {
      const pos = incidentLatLon(inc);
      if (!pos) continue;
      seen.add(inc.incident_id);
      const color = PRIORITY_COLORS[inc.priority_level] || "#94a3b8";
      const radius = 500 + num(inc.affected_users_count) * 110; // metros, proporcional a usuarios
      let c = mapState.circles.get(inc.incident_id);
      if (!c) {
        c = L.circle([pos.lat, pos.lon], { radius, color, weight: 2, fillColor: color, fillOpacity: 0.22 })
          .bindPopup(incidentPopup(inc));
        c.addTo(mapState.incidentLayer);
        mapState.circles.set(inc.incident_id, c);
      } else {
        c.setLatLng([pos.lat, pos.lon]).setRadius(radius).setStyle({ color, fillColor: color }).setPopupContent(incidentPopup(inc));
      }
    }
    for (const [id, c] of mapState.circles) if (!seen.has(id)) { c.remove(); mapState.circles.delete(id); }
  }

  if (!mapState.fitted && mapState.markers.size) {
    const pts = [...mapState.markers.values()].map((m) => m.getLatLng());
    mapState.map.fitBounds(L.latLngBounds(pts).pad(0.15));
    mapState.fitted = true;
  }
}

// ---------- Tabla de incidentes ----------
$("hide-closed").addEventListener("change", renderIncidents);

function renderIncidents() {
  const body = $("inc-body");
  const stateEl = $("inc-state");
  if (!state.incidents) {
    body.replaceChildren();
    stateEl.replaceChildren(state.errors.incidents
      ? stateBox("error", `No se pudieron cargar los incidentes: ${state.errors.incidents.message}`, { dark: true, onRetry: refresh })
      : stateBox("loading", "Cargando incidentes…", { dark: true }));
    return;
  }
  let list = [...state.incidents].sort((a, b) => num(b.priority_score) - num(a.priority_score));
  if ($("hide-closed").checked) list = list.filter(isActive);
  if (!list.length) {
    body.replaceChildren();
    stateEl.replaceChildren(stateBox("empty", "No hay incidentes para mostrar. La red opera con normalidad.", { dark: true }));
    return;
  }
  stateEl.replaceChildren();
  body.replaceChildren(...list.map((inc) => {
    const active = isActive(inc);
    const open = () => openDrawer(inc.incident_id);
    const poiTypes = uniquePoiTypes(inc.critical_pois);
    return el("tr", {
      class: `cursor-pointer border-b border-slate-800 hover:bg-slate-800/70 focus:bg-slate-800 ${active ? "" : "opacity-60"} ${state.selectedId === inc.incident_id ? "bg-slate-800" : ""}`,
      tabindex: "0",
      "aria-label": `Ver detalle de ${inc.incident_id || "incidente"} en ${inc.zone_name || "zona desconocida"}`,
      onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    }, [
      el("td", { class: "px-2 py-2" }, el("div", { class: "flex items-center gap-2" }, [
        priorityBadge(inc.priority_level),
        el("span", { class: "tabular-nums text-xs text-slate-400" }, String(num(inc.priority_score))),
      ])),
      el("td", { class: "px-2 py-2" }, [
        el("div", { class: "font-medium" }, inc.zone_name || "—"),
        el("div", { class: "font-mono text-xs text-slate-500" }, `${inc.incident_id || ""} · ${inc.geohash || ""}`),
      ]),
      el("td", { class: "px-2 py-2 text-right font-semibold tabular-nums" }, String(num(inc.affected_users_count))),
      el("td", { class: "px-2 py-2 text-slate-300" }, TRIGGER_LABELS[inc.trigger_type] || inc.trigger_type || "—"),
      el("td", { class: "px-2 py-2" }, poiTypes.length
        ? el("div", { class: "flex flex-wrap gap-1" }, poiTypes.map(poiBadge))
        : el("span", { class: "text-slate-500" }, "Ninguna")),
      el("td", { class: "px-2 py-2" }, statusBadge(inc.status)),
      el("td", { class: "px-2 py-2 whitespace-nowrap text-slate-300" }, timeAgo(inc.created_at)),
    ]);
  }));
}

// ---------- Riesgo estructural ----------
function renderRisk() {
  const box = $("risk-list");
  if (!state.antennas && !state.analytics) {
    box.replaceChildren(state.errors.antennas || state.errors.analytics
      ? stateBox("error", "No se pudo cargar la información de riesgo.", { dark: true, onRetry: refresh })
      : stateBox("loading", "Cargando…", { dark: true }));
    return;
  }
  const byId = new Map((state.antennas || []).map((a) => [a.antenna_id, a]));
  const items = new Map();
  for (const a of state.antennas || []) if (a.structural_risk === true) items.set(a.antenna_id, { antenna: a });
  for (const r of (state.analytics && state.analytics.recurrent_antennas) || []) {
    if (!r || !r.antenna_id) continue;
    items.set(r.antenna_id, { ...(items.get(r.antenna_id) || {}), antenna: byId.get(r.antenna_id) || r, recurrent: r });
  }
  if (!items.size) {
    box.replaceChildren(stateBox("empty", "Sin antenas con riesgo estructural.", { dark: true }));
    return;
  }
  const ul = el("ul", { class: "space-y-2" });
  for (const [id, { antenna, recurrent }] of items) {
    const failures = recurrent && recurrent.failures !== undefined ? num(recurrent.failures) : null;
    const days = recurrent && recurrent.days !== undefined ? num(recurrent.days) : null;
    ul.append(el("li", { class: "rounded-lg border border-red-900/70 bg-red-950/40 p-2" }, [
      el("div", { class: "flex flex-wrap items-center gap-2" }, [
        el("span", { class: "font-mono font-bold" }, id),
        el("span", { class: "rounded border border-red-500 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-red-300" }, "⚠ RIESGO ESTRUCTURAL"),
        antenna && antenna.health_status ? healthBadge(antenna.health_status) : null,
      ]),
      el("p", { class: "mt-1 text-xs text-slate-300" }, [
        antenna && antenna.zone_name ? `${antenna.zone_name} · ` : "",
        failures !== null
          ? `${failures} ${failures === 1 ? "falla" : "fallas"}${days !== null ? ` en los últimos ${days} días` : ""}`
          : "Falla recurrente detectada",
      ]),
    ]));
  }
  box.replaceChildren(ul);
}

// ---------- Lista de antenas ----------
function renderAntennas() {
  const box = $("antenna-list");
  if (!state.antennas) {
    box.replaceChildren(state.errors.antennas
      ? stateBox("error", `No se pudieron cargar las antenas: ${state.errors.antennas.message}`, { dark: true, onRetry: refresh })
      : stateBox("loading", "Cargando antenas…", { dark: true }));
    return;
  }
  if (!state.antennas.length) {
    box.replaceChildren(stateBox("empty", "No hay antenas registradas.", { dark: true }));
    return;
  }
  const list = [...state.antennas].sort((a, b) =>
    (HEALTH_ORDER[a.health_status] ?? 9) - (HEALTH_ORDER[b.health_status] ?? 9) || String(a.antenna_id).localeCompare(String(b.antenna_id)));
  const ul = el("ul", { class: "divide-y divide-slate-800" });
  for (const a of list) {
    const gb = num(a.last_traffic_gb);
    const h = HEALTH[a.health_status];
    ul.append(el("li", { class: "py-2" }, [
      el("div", { class: "flex items-center gap-2" }, [
        el("span", { class: "font-mono text-sm font-semibold" }, a.antenna_id || "—"),
        healthBadge(a.health_status),
        el("span", { class: "ml-auto tabular-nums text-sm font-semibold" }, `${gb} GB/min`),
      ]),
      el("div", { class: "mt-1 flex items-center gap-2" }, [
        el("div", { class: "traffic-bar flex-1", role: "presentation" },
          el("span", { style: `width:${Math.min(100, (gb / 180) * 100)}%;background:${h ? h.color : "#64748b"}` })),
        el("span", { class: "w-28 truncate text-right text-[11px] text-slate-400", title: a.zone_name || "" }, a.zone_name || ""),
      ]),
    ]));
  }
  box.replaceChildren(ul);
}

// ---------- Gráficos ----------
const charts = { zones: null, types: null };

function setupChartDefaults() {
  if (!Chart) return;
  Chart.defaults.color = "#cbd5e1";
  Chart.defaults.borderColor = "#1e293b";
  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
}

function renderCharts() {
  const zState = $("zones-state"), tState = $("types-state");
  if (!Chart) {
    zState.replaceChildren(stateBox("error", "No se pudo cargar Chart.js.", { dark: true }));
    tState.replaceChildren(stateBox("error", "No se pudo cargar Chart.js.", { dark: true }));
    return;
  }
  if (!state.analytics) {
    const box = state.errors.analytics
      ? () => stateBox("error", `No se pudo cargar la analítica: ${state.errors.analytics.message}`, { dark: true, onRetry: refresh })
      : () => stateBox("loading", "Cargando analítica…", { dark: true });
    zState.replaceChildren(box()); tState.replaceChildren(box());
    return;
  }

  // Barras horizontales: una sola serie, sin leyenda (el título la nombra)
  const zones = state.analytics.top_zones.slice(0, 6);
  zState.replaceChildren(zones.length ? "" : stateBox("empty", "Sin datos de zonas.", { dark: true }));
  const zLabels = zones.map((z) => z.zone_name);
  const zData = zones.map((z) => z.count);
  if (!charts.zones) {
    charts.zones = new Chart($("zones-chart"), {
      type: "bar",
      data: { labels: zLabels, datasets: [{ label: "Reportes", data: zData, backgroundColor: "#3987e5", borderRadius: 4, maxBarThickness: 22 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.parsed.x} reportes` } } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#1e293b" } },
          y: { grid: { display: false }, ticks: { callback(v) { const l = this.getLabelForValue(v); return l.length > 28 ? `${l.slice(0, 27)}…` : l; } } },
        },
      },
    });
  } else {
    charts.zones.data.labels = zLabels;
    charts.zones.data.datasets[0].data = zData;
    charts.zones.update("none");
  }

  // Dona: color fijo por tipo; leyenda con texto para no depender del color
  const types = state.analytics.problem_types;
  tState.replaceChildren(types.length ? "" : stateBox("empty", "Sin datos de tipos de falla.", { dark: true }));
  const tLabels = types.map((t) => PROBLEM_TYPES[t.type] || t.type);
  const tData = types.map((t) => t.count);
  const tColors = types.map((t) => TYPE_COLORS[t.type] || "#64748b");
  if (!charts.types) {
    charts.types = new Chart($("types-chart"), {
      type: "doughnut",
      data: { labels: tLabels, datasets: [{ data: tData, backgroundColor: tColors, borderColor: "#0f172a", borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%", animation: { duration: 300 },
        plugins: {
          legend: { position: "right", labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = c.dataset.data.reduce((s, v) => s + v, 0) || 1;
                return ` ${c.label}: ${c.parsed} (${Math.round((c.parsed / total) * 100)}%)`;
              },
            },
          },
        },
      },
    });
  } else {
    charts.types.data.labels = tLabels;
    charts.types.data.datasets[0].data = tData;
    charts.types.data.datasets[0].backgroundColor = tColors;
    charts.types.update("none");
  }
}

// ---------- Panel lateral ----------
const drawer = $("drawer");
const overlay = $("drawer-overlay");
$("drawer-close").addEventListener("click", closeDrawer);
overlay.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.selectedId) closeDrawer(); });

function openDrawer(id) {
  const inc = (state.incidents || []).find((i) => i.incident_id === id);
  if (!inc) return;
  if (!state.selectedId) state.lastFocus = document.activeElement;
  state.selectedId = id;
  if (mapState.map) mapState.map.closePopup();
  drawer.setAttribute("aria-hidden", "false");
  drawer.removeAttribute("inert");
  overlay.classList.remove("hidden");
  renderDrawer(inc);
  renderIncidents();
  $("drawer-close").focus();
}

function closeDrawer() {
  state.selectedId = null;
  drawer.setAttribute("aria-hidden", "true");
  drawer.setAttribute("inert", "");
  overlay.classList.add("hidden");
  renderIncidents();
  if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
}

function section(title, ...children) {
  return el("section", { class: "rounded-lg border border-slate-800 bg-slate-950/60 p-3" }, [
    el("h3", { class: "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400" }, title),
    ...children,
  ]);
}

function renderDrawer(inc) {
  $("drawer-title").textContent = `${inc.incident_id || "Incidente"} · ${inc.zone_name || ""}`;
  const body = $("drawer-body");

  const header = el("div", { class: "flex flex-wrap items-center gap-2" }, [
    priorityBadge(inc.priority_level),
    el("span", { class: "text-sm text-slate-300" }, `Puntaje ${num(inc.priority_score)}`),
    statusBadge(inc.status),
    el("span", { class: "text-sm text-slate-300" }, `${num(inc.affected_users_count)} usuarios afectados`),
  ]);

  const meta = el("dl", { class: "grid grid-cols-2 gap-x-4 gap-y-1 text-sm" }, [
    el("dt", { class: "text-slate-400" }, "Disparador"), el("dd", {}, TRIGGER_LABELS[inc.trigger_type] || inc.trigger_type || "—"),
    el("dt", { class: "text-slate-400" }, "Geohash"), el("dd", { class: "font-mono" }, inc.geohash || "—"),
    el("dt", { class: "text-slate-400" }, "Creado"), el("dd", {}, `${formatDate(inc.created_at)} (${timeAgo(inc.created_at)})`),
    el("dt", { class: "text-slate-400" }, "Cerrado"), el("dd", {}, inc.closed_at ? formatDate(inc.closed_at) : "—"),
  ]);

  const diagnosis = section("Diagnóstico de IA",
    el("p", { class: "whitespace-pre-line text-sm leading-relaxed text-slate-100 break-words" },
      inc.ai_diagnosis || "Sin diagnóstico disponible todavía."));

  const pois = Array.isArray(inc.critical_pois) ? [...inc.critical_pois].sort((a, b) => num(a.distance_m) - num(b.distance_m)) : [];
  const poiSection = section("Puntos de interés críticos",
    pois.length
      ? el("ul", { class: "space-y-1" }, pois.map((p) => el("li", { class: "flex items-center gap-2 text-sm" }, [
        poiBadge(p.type),
        el("span", { class: "flex-1 break-words" }, p.name || "—"),
        el("span", { class: "tabular-nums text-slate-300" }, `${num(p.distance_m)} m`),
      ])))
      : el("p", { class: "text-sm text-slate-400" }, "No se identificaron hospitales, escuelas ni industrias cercanas."));

  body.replaceChildren(header, meta, diagnosis, poiSection, operatorActions(inc), historySection(inc));
}

function operatorActions(inc) {
  const select = el("select", { id: "op-status", class: "w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5" },
    STATUSES.map((s) => el("option", { value: s, selected: s === inc.status }, s)));
  const note = el("textarea", {
    id: "op-note", rows: "2", maxlength: "300", placeholder: "Ej.: Servicio restablecido tras reemplazo de tarjeta RF",
    class: "w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm",
  });
  const applyBtn = el("button", { type: "button", class: "rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60" }, "Aplicar estado");
  const solveBtn = el("button", { type: "button", class: "rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60" }, "✓ Marcar como Solucionada");
  const msg = el("p", { class: "text-xs text-slate-400", role: "status", "aria-live": "polite" });

  async function apply(status, button) {
    applyBtn.disabled = true; solveBtn.disabled = true;
    setButtonLoading(button, true, "Enviando…");
    msg.textContent = "";
    try {
      const res = await api.updateIncidentStatus(inc, status, note.value.trim());
      if (status === "Solucionada") toast("Notificación de restablecimiento enviada", "success");
      else toast(`Estado actualizado a "${status}" (${res.updated.length} tickets)`, "success");
      if (res.failed.length) toast(`${res.failed.length} tickets no se pudieron actualizar; reintenta.`, "error");
      await refresh();
      const fresh = (state.incidents || []).find((i) => i.incident_id === inc.incident_id);
      if (fresh && state.selectedId === inc.incident_id) renderDrawer(fresh);
    } catch (err) {
      msg.textContent = `No se pudo actualizar: ${err.message}`;
      msg.className = "text-xs text-red-300";
      toast(`No se pudo actualizar el estado: ${err.message}`, "error");
    } finally {
      if (document.contains(button)) {
        setButtonLoading(button, false);
        applyBtn.disabled = false; solveBtn.disabled = false;
      }
    }
  }
  applyBtn.addEventListener("click", () => apply(select.value, applyBtn));
  solveBtn.addEventListener("click", () => apply("Solucionada", solveBtn));

  return section("Acciones del operador",
    el("div", { class: "space-y-2" }, [
      el("label", { for: "op-status", class: "block text-sm text-slate-300" }, "Nuevo estado"), select,
      el("label", { for: "op-note", class: "block text-sm text-slate-300" }, "Nota (opcional)"), note,
      el("div", { class: "flex flex-wrap gap-2 pt-1" }, [applyBtn, solveBtn]),
      msg,
    ]));
}

function historySection(inc) {
  const container = el("div", {}, stateBox("loading", "Cargando historial…", { dark: true }));
  const sec = section("Historial y tickets vinculados", container);
  const load = async () => {
    container.replaceChildren(stateBox("loading", "Cargando historial…", { dark: true }));
    try {
      const all = inc.geohash ? await api.getTickets({ geohash: inc.geohash }) : [];
      if (state.selectedId !== inc.incident_id) return; // el usuario cambió de incidente
      const tickets = all.filter((t) => !t.master_incident_id || t.master_incident_id === inc.incident_id);
      if (!tickets.length) {
        container.replaceChildren(stateBox("empty", "No hay tickets vinculados a este incidente.", { dark: true }));
        return;
      }
      // Agrupa cambios equivalentes de distintos tickets (mismo estado, autor y nota)
      const groups = new Map();
      for (const t of tickets) for (const h of t.history || []) {
        const key = `${h.old_status}|${h.new_status}|${h.changed_by}|${h.note}`;
        const g = groups.get(key);
        if (!g) groups.set(key, { ...h, n: 1 });
        else { g.n += 1; if (String(h.ts) > String(g.ts)) g.ts = h.ts; }
      }
      const entries = [...groups.values()].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || ""))).slice(0, 25);
      const ul = el("ul", { class: "space-y-2" }, entries.map((h) => el("li", { class: "border-l-2 border-sky-700 pl-3 text-sm" }, [
        el("p", { class: "font-medium" }, `${h.old_status ? `${h.old_status} → ` : ""}${h.new_status}${h.n > 1 ? ` (${h.n} tickets)` : ""}`),
        el("p", { class: "text-xs text-slate-400" }, `${formatDate(h.ts)} · ${h.changed_by || "Sistema"}`),
        h.note ? el("p", { class: "text-slate-300 break-words" }, h.note) : null,
      ])));
      const details = el("details", { class: "mt-3" }, [
        el("summary", { class: "cursor-pointer text-sm text-sky-300" }, `Ver ${tickets.length} tickets vinculados`),
        el("ul", { class: "mt-2 space-y-1" }, tickets.map((t) => el("li", { class: "rounded bg-slate-900 p-2 text-xs" }, [
          el("div", { class: "flex items-center gap-2" }, [el("span", { class: "font-mono font-semibold" }, t.ticket_id), statusBadge(t.status)]),
          el("p", { class: "mt-1 text-slate-300 break-words" }, `${PROBLEM_TYPES[t.problem_type] || t.problem_type || ""}: ${t.description || ""}`),
        ]))),
      ]);
      container.replaceChildren(ul, details);
    } catch (err) {
      if (state.selectedId !== inc.incident_id) return;
      container.replaceChildren(stateBox("error", `No se pudo cargar el historial: ${err.message}`, { dark: true, onRetry: load }));
    }
  };
  load();
  return sec;
}

// ---------- Arranque ----------
initMap();
setupChartDefaults();
renderAll();
refresh().then(() => {
  // Enlace directo: noc.html?incidente=INC-001 abre el panel de detalle
  const pre = new URLSearchParams(location.search).get("incidente");
  if (pre) openDrawer(pre);
  schedule();
});
