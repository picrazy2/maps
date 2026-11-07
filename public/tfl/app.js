import { icon } from "/london/icons.js";
import { Sheet } from "/london/sheet.js";
import { buildNetwork, legKey, legsOf, odKey, resolveStation, routeLeg, summarize } from "./routing.js";

const OFM = "https://tiles.openfreemap.org/styles";
const TOKEN_KEY = "tfl-admin-token";
const BOUNDS_FALLBACK = [-0.55, 51.25, 0.3, 51.7];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (p) => `£${(p / 100).toFixed(2)}`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

const state = {
  net: null, summary: null, tab: "overview", byLine: true, lineFilter: null, selected: null,
  token: lsGet(TOKEN_KEY), journeys: null, overrides: {}, cache: new Map(),
  theme: document.documentElement.dataset.theme,
};

const sheet = new Sheet($("#sheet"), {});
const map = new maplibregl.Map({
  container: "map",
  style: `${OFM}/${state.theme === "dark" ? "fiord" : "positron"}`,
  bounds: BOUNDS_FALLBACK,
  fitBoundsOptions: { padding: fitPadding() },
  maxZoom: 18, minZoom: 6,
  attributionControl: { compact: true, customAttribution: 'Journeys from Oyster · Lines <a href="https://api.tfl.gov.uk">TfL</a> · Track <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  dragRotate: false, pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();

function fitPadding() {
  const wide = innerWidth >= 760;
  return wide ? { top: 40, bottom: 40, left: 420, right: 70 } : { top: 40, bottom: Math.round(innerHeight * 0.55), left: 24, right: 60 };
}

// ── Map data ────────────────────────────────────────────────────────────────
function usedFeatures(summary) {
  const { net } = state;
  return summary.segs.map(([id, count, line]) => ({
    type: "Feature", id,
    properties: { count, line: net.lines[line].name, lineId: net.lines[line].id, color: net.lines[line].color },
    geometry: { type: "LineString", coordinates: net.segs[id] },
  }));
}

function stationFeatures(summary) {
  return summary.stations.filter((s) => s.lat).map((s) => ({
    type: "Feature",
    properties: { name: s.name, visits: s.visits, hub: s.hub },
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
  }));
}

function routeFeatures(route) {
  if (!route) return [];
  const { net } = state;
  return route.legs.flatMap((l) => l.rides.flatMap((r) => net.rides[r].segs.map((s) => ({
    type: "Feature",
    properties: { color: net.lines[l.line].color },
    geometry: { type: "LineString", coordinates: net.segs[s] },
  }))));
}

const fc = (features) => ({ type: "FeatureCollection", features });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function maxCount() {
  return Math.max(1, ...(state.summary?.segs ?? []).map((s) => s[1]));
}

function widthExpr(pad = 0) {
  const max = Math.max(2, maxCount());
  const scale = (w) => ["interpolate", ["linear"], ["get", "count"], 1, w + pad, max, w * 4.5 + pad];
  return ["interpolate", ["linear"], ["zoom"], 8, scale(1.1), 12, scale(2.2), 16, scale(4)];
}

function addLayers() {
  if (!state.net || map.getSource("net")) return;
  const { net } = state;
  map.addSource("net", { type: "geojson", data: fc(net.segs.map((coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }))) });
  map.addSource("used", { type: "geojson", data: fc(state.summary ? usedFeatures(state.summary) : []) });
  map.addSource("stations", { type: "geojson", data: fc(state.summary ? stationFeatures(state.summary) : []) });
  map.addSource("route", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "net", type: "line", source: "net", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": css("--ink"), "line-opacity": 0.13, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 1.2] } });
  map.addLayer({ id: "used-case", type: "line", source: "used", layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "count"] },
    paint: { "line-color": css("--surface-1"), "line-opacity": 0.75, "line-width": widthExpr(1.5) } });
  map.addLayer({ id: "used", type: "line", source: "used", layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "count"] },
    paint: { "line-color": colourExpr(), "line-width": widthExpr() } });
  map.addLayer({ id: "used-hit", type: "line", source: "used", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 18 } });
  map.addLayer({ id: "route-case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": css("--surface-1"), "line-width": 8 } });
  map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 5 } });
  map.addLayer({ id: "stations", type: "circle", source: "stations",
    paint: { "circle-color": css("--surface-1"), "circle-stroke-color": css("--ink"), "circle-stroke-width": 1.5,
      "circle-radius": ["interpolate", ["linear"], ["get", "visits"], 1, 3, 12, 7] } });
  map.addLayer({ id: "station-labels", type: "symbol", source: "stations", minzoom: 10,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": css("--ink"), "text-halo-color": css("--surface-1"), "text-halo-width": 1.4 } });
  applyLineFilter();
  applySelected();
}

function colourExpr() {
  return state.byLine ? ["get", "color"] : css("--accent");
}

function applyLineFilter() {
  if (!map.getLayer("used")) return;
  const { lineFilter, net } = state;
  let filter = null;
  if (lineFilter !== null) {
    const ids = [...new Set(net.rides.filter((r) => r.line === lineFilter).flatMap((r) => r.segs))];
    filter = ["in", ["id"], ["literal", ids]];
  }
  for (const id of ["used", "used-case", "used-hit"]) map.setFilter(id, filter);
}

function applySelected() {
  map.getSource("route")?.setData(fc(state.selected?.routes.flatMap(routeFeatures) ?? []));
}

function refreshMap() {
  map.getSource("used")?.setData(fc(usedFeatures(state.summary)));
  map.getSource("stations")?.setData(fc(stationFeatures(state.summary)));
  for (const id of ["used", "used-case"]) {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-width", id === "used" ? widthExpr() : widthExpr(1.5));
  }
}

function fitCoords(coords) {
  if (!coords.length) return;
  const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: fitPadding(), maxZoom: 14, duration: 500 });
}

function fitAll() {
  if (!state.summary) return;
  fitCoords(state.summary.segs.flatMap(([id]) => state.net.segs[id]));
}

// ── Sheet: head ─────────────────────────────────────────────────────────────
function renderHead() {
  const s = state.summary;
  const span = s?.weekFrom ? `Oyster, since the week of ${fmtDay(s.weekFrom)}` : "Oyster";
  const tabs = [["overview", "Overview"], ["lines", "Lines"], ["stations", "Stations"], ["journeys", "Journeys"]];
  $("#sheet-head").innerHTML = `
    <div class="tfl-title">TfL rail history</div>
    <div class="tfl-sub">${esc(span)}</div>
    <div class="chips tfl-tabs" role="tablist">${tabs.map(([id, name]) =>
      `<button class="chip small pressable" role="tab" data-tab="${id}" aria-pressed="${state.tab === id}">${name}</button>`).join("")}</div>`;
}

const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtLongDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);

// ── Sheet: views ────────────────────────────────────────────────────────────
function barRows(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars">${items.map((i) => `
    <button class="bar-row" ${i.attr ?? ""} title="${esc(i.name)}: ${esc(i.label ?? i.value)}">
      <span class="bar-name">${i.color ? `<span class="line-dot" style="background:${i.color}"></span>` : ""}${esc(i.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="display:block;width:${(i.value / max) * 100}%;${i.color ? `background:${i.color}` : ""}"></span></span>
      <span class="bar-value tnum">${esc(i.label ?? i.value)}</span>
    </button>`).join("")}</div>`;
}

function allWeeks(weeks) {
  if (!weeks.length) return [];
  const counts = new Map(weeks), out = [];
  const end = new Date(`${weeks[weeks.length - 1][0]}T12:00:00Z`);
  for (const d = new Date(`${weeks[0][0]}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const k = d.toISOString().slice(0, 10);
    out.push([k, counts.get(k) ?? 0]);
  }
  return out;
}

function weeksChart(weeks) {
  const all = allWeeks(weeks);
  const max = Math.max(1, ...all.map((w) => w[1]));
  return `<div class="weeks">
    <div class="week-bars">${all.map(([w, n]) => `<div class="week-bar" title="Week of ${fmtDay(w)}: ${n} journey${n === 1 ? "" : "s"}"><span style="height:${n ? Math.max(4, (n / max) * 100) : 0}%"></span></div>`).join("")}</div>
    <div class="week-axis"><span>${all.length ? fmtDay(all[0][0]) : ""}</span><span>Max ${max} a week</span><span>${all.length ? fmtDay(all[all.length - 1][0]) : ""}</span></div>
  </div>`;
}

function renderOverview() {
  const s = state.summary;
  if (!s) return `<div class="empty">No journeys published yet.</div>`;
  const t = s.totals, { net } = state;
  const lines = s.lines.slice(0, 5).map((l) => ({ name: net.lines[l.line].name, value: l.trips, color: net.lines[l.line].color, attr: `data-line="${l.line}"` }));
  const stations = s.stations.slice(0, 5).map((st) => ({ name: st.name, value: st.visits, attr: `data-hub="${esc(st.hub)}"` }));
  return `
    <div class="stats">
      <div class="stat"><div class="label">Rail journeys</div><div class="value tnum">${t.journeys}</div></div>
      <div class="stat"><div class="label">Distance</div><div class="value tnum">${t.km.toLocaleString("en-GB")} <small>km</small></div></div>
      <div class="stat"><div class="label">Time in the network</div><div class="value tnum">${fmtDuration(t.minutes)}</div></div>
      <div class="stat"><div class="label">Trains boarded</div><div class="value tnum">${t.trains}</div></div>
      <div class="stat"><div class="label">Spent</div><div class="value tnum">${money(t.spend)}</div></div>
      <div class="stat"><div class="label">Bus journeys</div><div class="value tnum">${t.bus}</div></div>
    </div>
    <div class="section"><div class="section-title">Busiest track</div>
      <div class="legend-scale"><span>1 trip</span>
        <svg viewBox="0 0 200 16" preserveAspectRatio="none" aria-hidden="true"><path class="legend-ink" d="M0 7.5 L200 3 L200 13 L0 8.5Z"/></svg>
        <span>${maxCount()} trips</span></div></div>
    <div class="section"><div class="section-title">Journeys by week</div>${weeksChart(s.weeks)}</div>
    <div class="section"><div class="section-title">Top lines</div>${barRows(lines)}</div>
    <div class="section"><div class="section-title">Top stations</div>${barRows(stations)}</div>
    <p class="note">Routes are inferred from touch times, then snapped to OpenStreetMap track. Shows counts only, with no journey times.</p>`;
}

function renderLines() {
  const s = state.summary;
  if (!s) return "";
  const { net } = state;
  const rows = s.lines.map((l) => ({ name: net.lines[l.line].name, value: l.trips, label: `${l.trips} · ${Math.round(l.km)} km`,
    color: net.lines[l.line].color, attr: `data-line="${l.line}" aria-pressed="${state.lineFilter === l.line}"` }));
  return `<div class="section-title">Trains boarded, by line</div>${barRows(rows)}<p class="note">Tap a line to show only its track on the map.</p>`;
}

function renderStations() {
  const s = state.summary;
  if (!s) return "";
  return `<div class="section-title">Touches, by station</div>${barRows(s.stations.map((st) => ({ name: st.name, value: st.visits, attr: `data-hub="${esc(st.hub)}"` })))}`;
}

function renderJourneys() {
  if (!state.token) {
    return `<div class="section-title">Private</div>
      <p class="note">Individual journeys and route editing need the admin token.</p>
      <form id="unlock" class="field"><input id="token" type="password" autocomplete="off" aria-label="Admin token" placeholder="Admin token">
      <button class="action primary pressable" type="submit">Unlock</button></form>`;
  }
  if (!state.journeys) return `<div class="empty">Loading journeys…</div>`;
  const rail = state.journeys.filter((j) => j.kind === "rail").slice().reverse();
  const rows = rail.map((j) => {
    const legs = routedLegs(j);
    const manual = legs.some((l) => l.routed.source === "manual");
    const unmatched = legs.some((l) => !l.routed.chosen);
    const lines = [...new Set(legs.flatMap((l) => l.routed.chosen?.legs ?? []).map((l) => l.line))];
    return `<button class="row no-glyph pressable" data-journey="${esc(j.id)}">
      <span class="text"><span class="title">${esc(resolveLabel(j.from))} → ${esc(resolveLabel(j.to))}</span>
      <span class="sub">${fmtLongDay(j.date)}, ${esc(j.start)} · ${lines.map((ln) => `<span class="line-dot" style="background:${state.net.lines[ln].color}" title="${esc(state.net.lines[ln].name)}"></span>`).join("")}${manual ? ' <span class="badge">Edited</span>' : ""}${unmatched ? ' <span class="badge">Unmatched</span>' : ""}</span></span>
      <span class="trail">${icon("chevron", "icon icon-sm")}</span></button>`;
  }).join("");
  return `<div class="section-title">When you travel</div>${heatmap()}
    <div class="section"><div class="section-title">Journeys <span class="aside">${rail.length}</span></div><div class="group">${rows}</div></div>
    <div class="actions"><button id="lock" class="action pressable">Forget token on this device</button></div>`;
}

const resolveLabel = (s) => s.replace(/\s*\[.*\]/, "");

function heatmap() {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const j of state.journeys) {
    const d = (new Date(`${j.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    grid[d][Number(j.start.slice(0, 2))]++;
  }
  const max = Math.max(1, ...grid.flat());
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cells = grid.map((row, d) => `<span class="heat-label">${days[d]}</span>${row.map((n, h) =>
    `<span class="heat-cell" title="${days[d]} ${String(h).padStart(2, "0")}:00: ${n}" ${n ? `style="background:color-mix(in srgb, var(--accent) ${25 + (n / max) * 75}%, var(--surface-2))"` : ""}></span>`).join("")}`).join("");
  return `<div class="heat">${cells}</div>`;
}

function routedLegs(j) {
  return legsOf(state.net, j).map((leg, i) => ({ leg, i, routed: routeLeg(state.net, leg, legKey(j.id, i), state.overrides, state.cache) }));
}

function routeText(route) {
  const { net } = state;
  return route.legs.map((l) => `${net.stops[l.stops[0]].name} to ${net.stops[l.stops[l.stops.length - 1]].name}`).join(", then ");
}

function routeNames(route) {
  const { net } = state;
  return route.legs.map((l) => `<span class="line-dot" style="background:${net.lines[l.line].color}"></span>${esc(net.lines[l.line].name)}`).join(" → ");
}

function renderJourney(id) {
  const j = state.journeys.find((x) => x.id === id);
  const legs = routedLegs(j);
  const blocks = legs.map(({ leg, i, routed }) => {
    const key = legKey(j.id, i);
    const opts = routed.options.map((o) => `
      <button class="row no-glyph pressable route-opt ${routed.chosen?.sig === o.sig ? "is-active" : ""}" data-pick="${esc(o.sig)}" data-leg="${i}">
        <span class="route-lines">${routeNames(o)}</span>
        <span class="route-steps tnum" style="display:block">${esc(routeText(o))}. About ${Math.round(o.minutes)} min, ${o.km.toFixed(1)} km.</span>
      </button>`).join("");
    return `<div class="section">
      <div class="section-title">${esc(leg.from.label)} → ${esc(leg.to.label)}
        <span class="aside tnum">${leg.observed !== null ? `${leg.observed} min touch to touch` : ""}</span></div>
      ${routed.source === "manual" ? `<p class="note"><span class="badge">Edited</span> ${esc(routed.chosen ? routeText(routed.chosen) : "")}</p>` : ""}
      ${opts ? `<div class="group">${opts}</div>` : `<div class="empty">Couldn't match these stations to the network.</div>`}
      <form class="field" data-via="${i}">
        <input type="text" list="stop-names" placeholder="Went via another station?" aria-label="Via station">
        <button class="action pressable" type="submit">Use</button>
      </form>
      ${state.overrides[key] || state.overrides[odKey(leg)] ? `<div class="actions"><button class="action pressable" data-clear="${i}">Reset to inferred</button></div>` : ""}
    </div>`;
  }).join("");
  const stops = [...state.net.hubs.values()].map((h) => `<option value="${esc(h.name)}"></option>`).join("");
  return `
    <div class="card-head"><div class="titles">
      <div class="card-title">${esc(resolveLabel(j.from))} → ${esc(resolveLabel(j.to))}</div>
      <div class="card-sub tnum">${fmtLongDay(j.date)}, ${esc(j.start)}–${esc(j.end ?? "?")} · ${money(j.fare)}${j.capped ? " (capped)" : ""}</div>
    </div><button class="close pressable" id="close-journey" aria-label="Back to journeys">${icon("xmark", "icon icon-sm")}</button></div>
    <label class="tfl-check"><input type="checkbox" id="apply-all" checked> Apply my change to every trip between these stations</label>
    ${blocks}
    <datalist id="stop-names">${stops}</datalist>`;
}

function renderBody() {
  const body = $("#sheet-body");
  if (state.selected) body.innerHTML = renderJourney(state.selected.id);
  else body.innerHTML = { overview: renderOverview, lines: renderLines, stations: renderStations, journeys: renderJourneys }[state.tab]();
}

function render() {
  renderHead();
  renderBody();
}

// ── Private data ────────────────────────────────────────────────────────────
function api(path, init = {}) {
  return fetch(`/tfl/api/${path}`, { ...init, headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json", ...init.headers } });
}

async function loadPrivate() {
  if (!state.token) return;
  const res = await api("journeys");
  if (res.status === 401) {
    state.token = null;
    lsSet(TOKEN_KEY, null);
    toast("That token wasn't accepted");
    render();
    return;
  }
  const data = await res.json();
  state.journeys = data.journeys;
  state.overrides = data.overrides;
  render();
}

async function saveOverrides() {
  state.summary = { ...summarize(state.net, state.journeys, state.overrides) };
  refreshMap();
  const [a, b] = await Promise.all([
    api("overrides", { method: "PUT", body: JSON.stringify(state.overrides) }),
    api("summary", { method: "PUT", body: JSON.stringify(state.summary) }),
  ]);
  toast(a.ok && b.ok ? "Saved" : "Couldn't save that change");
}

function selectJourney(id) {
  const j = state.journeys.find((x) => x.id === id);
  const routes = routedLegs(j).map((l) => l.routed.chosen).filter(Boolean);
  state.selected = { id, routes };
  applySelected();
  fitCoords(routeFeatures({ legs: routes.flatMap((r) => r.legs) }).flatMap((f) => f.geometry.coordinates));
  render();
  $("#sheet-body").scrollTop = 0;
  if (!sheet.wide) sheet.set("half");
}

function clearJourney() {
  state.selected = null;
  applySelected();
  render();
}

async function setOverride(legIndex, value) {
  const j = state.journeys.find((x) => x.id === state.selected.id);
  const leg = legsOf(state.net, j)[legIndex];
  const all = $("#apply-all")?.checked;
  delete state.overrides[legKey(j.id, legIndex)];
  delete state.overrides[odKey(leg)];
  if (value) state.overrides[all ? odKey(leg) : legKey(j.id, legIndex)] = value;
  selectJourney(j.id);
  await saveOverrides();
}

// ── Events ──────────────────────────────────────────────────────────────────
let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("is-hidden"), 2400);
}

$("#sheet-head").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]")?.dataset.tab;
  if (!tab) return;
  state.tab = tab;
  state.selected = null;
  applySelected();
  render();
  $("#sheet-body").scrollTop = 0;
  if (!sheet.wide && sheet.detent === "peek") sheet.set("half");
});

$("#sheet-body").addEventListener("click", (e) => {
  const t = e.target;
  const line = t.closest("[data-line]")?.dataset.line;
  if (line !== undefined) {
    const n = Number(line);
    state.lineFilter = state.lineFilter === n ? null : n;
    applyLineFilter();
    renderBody();
    return;
  }
  const hub = t.closest("[data-hub]")?.dataset.hub;
  if (hub) {
    const h = state.net.hubs.get(hub);
    if (h) map.flyTo({ center: [h.lon, h.lat], zoom: Math.max(map.getZoom(), 12.5) });
    if (!sheet.wide) sheet.set("peek");
    return;
  }
  const j = t.closest("[data-journey]")?.dataset.journey;
  if (j) return selectJourney(j);
  if (t.closest("#close-journey")) return clearJourney();
  const pick = t.closest("[data-pick]");
  if (pick) return setOverride(Number(pick.dataset.leg), { sig: pick.dataset.pick });
  const clear = t.closest("[data-clear]")?.dataset.clear;
  if (clear !== undefined) return setOverride(Number(clear), null);
  if (t.closest("#lock")) {
    state.token = null;
    state.journeys = null;
    lsSet(TOKEN_KEY, null);
    render();
  }
});

$("#sheet-body").addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "unlock") {
    state.token = $("#token").value.trim();
    lsSet(TOKEN_KEY, state.token);
    render();
    loadPrivate();
    return;
  }
  const leg = e.target.dataset.via;
  if (leg === undefined) return;
  const name = e.target.querySelector("input").value;
  const { hub } = resolveStation(state.net, name);
  if (!hub) return toast("Couldn't find that station");
  setOverride(Number(leg), { via: [hub] });
});

const hitLayers = () => (map.getLayer("used-hit") ? ["used-hit"] : []);
map.on("click", (e) => {
  const f = map.queryRenderedFeatures(e.point, { layers: hitLayers() })[0];
  if (!f) return;
  const tip = $("#tip");
  const { count, line } = f.properties;
  new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(e.lngLat)
    .setHTML(`<strong class="tnum">${count} trip${count === 1 ? "" : "s"}</strong><br>Mostly ${esc(line)}`).addTo(map);
  tip.classList.add("hidden");
});
map.on("mouseenter", "used-hit", () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "used-hit", () => { map.getCanvas().style.cursor = ""; });
// isStyleLoaded() stays false while tiles load, so remember the event instead of polling it.
let styleReady = false;
map.on("style.load", () => {
  styleReady = true;
  addLayers();
});

$("#btn-colour").innerHTML = icon("layers");
$("#btn-fit").innerHTML = icon("zoom");
$("#btn-zoom-in").innerHTML = icon("plus");
$("#btn-zoom-out").innerHTML = icon("minus");
$("#btn-colour").addEventListener("click", (e) => {
  state.byLine = !state.byLine;
  e.currentTarget.setAttribute("aria-pressed", state.byLine);
  map.setPaintProperty("used", "line-color", colourExpr());
  toast(state.byLine ? "Coloured by line" : "Single colour");
});
$("#btn-fit").addEventListener("click", fitAll);
$("#btn-zoom-in").addEventListener("click", () => map.zoomIn());
$("#btn-zoom-out").addEventListener("click", () => map.zoomOut());

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  state.theme = e.matches ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  map.setStyle(`${OFM}/${state.theme === "dark" ? "fiord" : "positron"}`);
});

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  render();
  sheet.set("half", false);
  const [raw, summary] = await Promise.all([
    fetch("/tfl/data/network.json").then((r) => r.json()),
    fetch("/tfl/api/summary").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  state.net = buildNetwork(raw);
  // The Northern line's black disappears on the dark basemap.
  if (state.theme === "dark") state.net.lines.find((l) => l.id === "northern").color = "#f5f5f7";
  state.summary = summary;
  if (styleReady) addLayers();
  render();
  if (summary) fitAll();
  loadPrivate();
}
boot();

