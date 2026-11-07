import { icon } from "/london/icons.js";
import { Sheet } from "/london/sheet.js";
import { buildNetwork, legKey, legsOf, odKey, resolveStation, routeLeg, summarize, weekOf } from "./routing.js";

const OFM = "https://tiles.openfreemap.org/styles";
// The flightlog Supabase project, used only for Google sign-in. The anon key is public by design.
const SUPABASE_URL = "https://ihkybryikwlkppqpfnly.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imloa3licnlpa3dsa3BwcXBmbmx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2OTEzMjQsImV4cCI6MjA5MDI2NzMyNH0.9ajw5k9zx4tUwrKZhyOgdJQ7JqLCjL9Fw3w9lTCXtZk";
const auth = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}).auth;

const BOUNDS_FALLBACK = [-0.55, 51.25, 0.3, 51.7];
// Read before the map writes its own position into the URL.
const OPENED_AT_POSITION = location.hash.includes("map=");
const NETWORK_KEY = "tfl-network-layer";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (p) => `£${(p / 100).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const state = {
  net: null, journeys: null, overrides: {}, cache: new Map(), meta: new Map(),
  filter: {}, summary: null, views: {}, tab: "overview", selected: null,
  byLine: true, network: lsGet(NETWORK_KEY) === "1",
  accessToken: null, email: null, editor: false,
  theme: document.documentElement.dataset.theme,
};

const sheet = new Sheet($("#sheet"), {});
const map = new maplibregl.Map({
  container: "map",
  style: `${OFM}/${state.theme === "dark" ? "fiord" : "positron"}`,
  bounds: OPENED_AT_POSITION ? undefined : BOUNDS_FALLBACK,
  fitBoundsOptions: { padding: fitPadding() },
  hash: "map",
  maxZoom: 18, minZoom: 6,
  attributionControl: { compact: true, customAttribution: 'Journeys from Oyster · Lines <a href="https://api.tfl.gov.uk">TfL</a> · Track <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  dragRotate: false, pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();

function fitPadding() {
  const wide = innerWidth >= 760;
  return wide ? { top: 40, bottom: 40, left: 420, right: 70 } : { top: 40, bottom: Math.round(innerHeight * 0.55), left: 24, right: 60 };
}

// ── Cross-filtering ─────────────────────────────────────────────────────────
// Each chart counts journeys under every filter except its own, so its other bars stay
// visible and can be picked. Stats, the map and the journey list take all of them.
const TESTS = {
  week: (m, v) => m.week === v,
  day: (m, v) => m.day === v,
  hour: (m, v) => m.hour === v,
  line: (m, v) => m.lines.has(v),
  hub: (m, v) => m.hubs.has(v),
  seg: (m, v) => m.segs.has(v),
};

function buildMeta() {
  state.meta = new Map(state.journeys.map((j) => {
    const lines = new Set(), hubs = new Set(), segs = new Set();
    if (j.kind === "rail") {
      for (const { leg, routed } of routedLegs(j)) {
        if (leg.from.hub) hubs.add(leg.from.hub);
        if (leg.to.hub) hubs.add(leg.to.hub);
        for (const l of routed.chosen?.legs ?? []) {
          lines.add(l.line);
          for (const r of l.rides) for (const s of state.net.rides[r].segs) segs.add(s);
        }
      }
    }
    const day = (new Date(`${j.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    return [j.id, { week: weekOf(j.date), day, hour: Number(j.start.slice(0, 2)), lines, hubs, segs }];
  }));
}

function view(skip) {
  const active = Object.entries(state.filter).filter(([dim]) => dim !== skip);
  return state.journeys.filter((j) => active.every(([dim, v]) => TESTS[dim](state.meta.get(j.id), v)));
}

function recompute() {
  buildMeta();
  applyFilter();
}

function applyFilter() {
  const { net, overrides } = state;
  state.summary = summarize(net, view(), overrides);
  state.views = {
    lines: summarize(net, view("line"), overrides).lines,
    stations: summarize(net, view("hub"), overrides).stations,
    weeks: countBy(view("week"), (j) => state.meta.get(j.id).week),
    days: countBy(view("day"), (j) => state.meta.get(j.id).day),
    hours: countBy(view("hour"), (j) => state.meta.get(j.id).hour),
  };
}

function countBy(journeys, key) {
  const out = new Map();
  for (const j of journeys) out.set(key(j), (out.get(key(j)) ?? 0) + 1);
  return out;
}

function setFilter(dim, value) {
  if (state.filter[dim] === value) delete state.filter[dim];
  else state.filter[dim] = value;
  applyFilter();
  refreshMap();
  render();
  if ((dim === "line" || dim === "hub") && state.summary.segs.length) fitAll();
}

function clearFilters() {
  state.filter = {};
  applyFilter();
  refreshMap();
  render();
}

function filterLabel(dim, v) {
  if (dim === "week") return `Week of ${fmtDay(v)}`;
  if (dim === "day") return DAYS[v];
  if (dim === "hour") return `${String(v).padStart(2, "0")}:00`;
  if (dim === "line") return state.net.lines[v].name;
  if (dim === "hub") return state.net.hubs.get(v)?.name ?? v;
  return "This track";
}

// ── Map data ────────────────────────────────────────────────────────────────
const fc = (features) => ({ type: "FeatureCollection", features });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function usedFeatures(summary) {
  const { net } = state;
  return summary.segs.map(([id, count, line]) => ({
    type: "Feature", id,
    properties: { count, line: net.lines[line].name, color: net.lines[line].color },
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

// Every track segment, in the colour of a TfL line where one uses it.
function networkFeatures() {
  const { net } = state;
  const owner = new Map();
  for (const r of net.rides) {
    const line = net.lines[r.line];
    for (const s of r.segs) {
      const cur = owner.get(s);
      if (!cur || (cur.mode === "national-rail" && line.mode !== "national-rail")) owner.set(s, line);
    }
  }
  return net.segs.map((coordinates, id) => ({
    type: "Feature", id,
    properties: { color: owner.get(id)?.color ?? css("--ink"), line: owner.get(id)?.name ?? "" },
    geometry: { type: "LineString", coordinates },
  }));
}

function allStopFeatures() {
  return [...state.net.hubs.values()].map((h) => ({
    type: "Feature",
    properties: { name: h.name, hub: h.id },
    geometry: { type: "Point", coordinates: [h.lon, h.lat] },
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

const maxCount = () => Math.max(1, ...(state.summary?.segs ?? []).map((s) => s[1]));

function widthExpr(pad = 0) {
  const max = Math.max(2, maxCount());
  const scale = (w) => ["interpolate", ["linear"], ["get", "count"], 1, w + pad, max, w * 4.5 + pad];
  return ["interpolate", ["linear"], ["zoom"], 8, scale(1.1), 12, scale(2.2), 16, scale(4)];
}

const colourExpr = () => (state.byLine ? ["get", "color"] : css("--accent"));
const vis = (on) => (on ? "visible" : "none");

function addLayers() {
  if (!state.net || map.getSource("net")) return;
  const round = { "line-cap": "round", "line-join": "round" };
  map.addSource("net", { type: "geojson", data: fc(networkFeatures()) });
  map.addSource("all-stops", { type: "geojson", data: fc(allStopFeatures()) });
  map.addSource("used", { type: "geojson", data: fc(usedFeatures(state.summary)) });
  map.addSource("stations", { type: "geojson", data: fc(stationFeatures(state.summary)) });
  map.addSource("route", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "net", type: "line", source: "net", layout: round,
    paint: { "line-color": css("--ink"), "line-opacity": 0.13, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 1.2] } });
  map.addLayer({ id: "net-colour", type: "line", source: "net", layout: { ...round, visibility: vis(state.network) },
    paint: { "line-color": ["get", "color"], "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 14, 2] } });
  map.addLayer({ id: "used-case", type: "line", source: "used", layout: { ...round, "line-sort-key": ["get", "count"] },
    paint: { "line-color": css("--surface-1"), "line-opacity": 0.75, "line-width": widthExpr(1.5) } });
  map.addLayer({ id: "used", type: "line", source: "used", layout: { ...round, "line-sort-key": ["get", "count"] },
    paint: { "line-color": colourExpr(), "line-width": widthExpr() } });
  map.addLayer({ id: "used-hit", type: "line", source: "used", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 18 } });
  map.addLayer({ id: "route-case", type: "line", source: "route", layout: round, paint: { "line-color": css("--surface-1"), "line-width": 8 } });
  map.addLayer({ id: "route", type: "line", source: "route", layout: round, paint: { "line-color": ["get", "color"], "line-width": 5 } });
  map.addLayer({ id: "all-stops", type: "circle", source: "all-stops", layout: { visibility: vis(state.network) },
    paint: { "circle-color": css("--surface-1"), "circle-stroke-color": css("--ink-muted"), "circle-stroke-width": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.2, 13, 4] } });
  map.addLayer({ id: "all-stop-labels", type: "symbol", source: "all-stops", minzoom: 12, layout: { visibility: vis(state.network),
    "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": css("--ink-muted"), "text-halo-color": css("--surface-1"), "text-halo-width": 1.2 } });
  map.addLayer({ id: "stations", type: "circle", source: "stations",
    paint: { "circle-color": css("--surface-1"), "circle-stroke-color": css("--ink"), "circle-stroke-width": 1.5,
      "circle-radius": ["interpolate", ["linear"], ["get", "visits"], 1, 3, 12, 7] } });
  map.addLayer({ id: "station-labels", type: "symbol", source: "stations", minzoom: 10,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": css("--ink"), "text-halo-color": css("--surface-1"), "text-halo-width": 1.4 } });
  applySelected();
}

function applySelected() {
  map.getSource("route")?.setData(fc(state.selected?.routes.flatMap(routeFeatures) ?? []));
}

function refreshMap() {
  map.getSource("used")?.setData(fc(usedFeatures(state.summary)));
  map.getSource("stations")?.setData(fc(stationFeatures(state.summary)));
  if (map.getLayer("used")) {
    map.setPaintProperty("used", "line-width", widthExpr());
    map.setPaintProperty("used-case", "line-width", widthExpr(1.5));
  }
}

function fitCoords(coords) {
  if (!coords.length) return;
  const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: fitPadding(), maxZoom: 14, duration: 500 });
}

function fitAll() {
  if (state.summary) fitCoords(state.summary.segs.flatMap(([id]) => state.net.segs[id]));
}

// ── Formatting ──────────────────────────────────────────────────────────────
const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtLongDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
const resolveLabel = (s) => s.replace(/\s*\[.*\]/, "");

// ── Charts ──────────────────────────────────────────────────────────────────
function pressed(dim, value) {
  const cur = state.filter[dim];
  if (cur === undefined) return "";
  return cur === value ? 'aria-pressed="true"' : 'aria-pressed="false" data-dim="1"';
}

function barRows(dim, items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars">${items.map((i) => `
    <button class="bar-row ${state.filter[dim] !== undefined && state.filter[dim] !== i.key ? "is-dim" : ""}" ${pressed(dim, i.key)}
      data-filter="${dim}:${esc(i.key)}" data-tip="${esc(i.label ?? i.value)}|${esc(i.name)}">
      <span class="bar-name">${i.color ? `<span class="line-dot" style="background:${i.color}"></span>` : ""}${esc(i.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="display:block;width:${(i.value / max) * 100}%;${i.color ? `background:${i.color}` : ""}"></span></span>
      <span class="bar-value tnum">${esc(i.label ?? i.value)}</span>
    </button>`).join("")}</div>`;
}

function columns(dim, items, axis, axisClass = "") {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="cols"><div class="col-bars">${items.map((i) => `
    <button class="col ${state.filter[dim] !== undefined && state.filter[dim] !== i.key ? "is-dim" : ""}" ${pressed(dim, i.key)}
      data-filter="${dim}:${esc(i.key)}" data-tip="${plural(i.value, "journey")}|${esc(i.name)}" aria-label="${esc(i.name)}: ${plural(i.value, "journey")}">
      <span style="height:${i.value ? Math.max(4, (i.value / max) * 100) : 0}%"></span></button>`).join("")}</div>
    <div class="col-axis ${axisClass}">${axis.map((a) => `<span>${esc(a)}</span>`).join("")}</div></div>`;
}

function weekItems() {
  const dates = state.journeys.map((j) => weekOf(j.date)).sort();
  if (!dates.length) return [];
  const out = [], end = new Date(`${dates[dates.length - 1]}T12:00:00Z`);
  for (const d = new Date(`${dates[0]}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ key, name: `Week of ${fmtDay(key)}`, value: state.views.weeks.get(key) ?? 0 });
  }
  return out;
}

const lineItems = (rows) => rows.map((l) => ({ key: l.line, name: state.net.lines[l.line].name, value: l.trips, color: state.net.lines[l.line].color }));
const stationItems = (rows) => rows.map((s) => ({ key: s.hub, name: s.name, value: s.visits }));

function renderOverview() {
  const t = state.summary.totals, { views } = state;
  if (!state.journeys.length) return `<div class="empty">No journeys published yet.</div>`;
  const weeks = weekItems();
  const days = DAYS.map((name, key) => ({ key, name, value: views.days.get(key) ?? 0 }));
  const hours = Array.from({ length: 24 }, (_, key) => ({ key, name: `${String(key).padStart(2, "0")}:00`, value: views.hours.get(key) ?? 0 }));
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
        <span>${plural(maxCount(), "trip")}</span></div></div>
    <div class="section"><div class="section-title">By week</div>${columns("week", weeks, weeks.length ? [fmtDay(weeks[0].key), fmtDay(weeks[weeks.length - 1].key)] : [])}</div>
    <div class="section"><div class="section-title">By weekday</div>${columns("day", days, DAYS, "days")}</div>
    <div class="section"><div class="section-title">By hour of touch-in</div>${columns("hour", hours, ["00", "06", "12", "18", "23"])}</div>
    <div class="section"><div class="section-title">Top lines</div>${barRows("line", lineItems(views.lines.slice(0, 6)))}</div>
    <div class="section"><div class="section-title">Top stations</div>${barRows("hub", stationItems(views.stations.slice(0, 6)))}</div>
    <p class="note">Tap any bar, station or piece of track to filter everything. Routes are inferred from touch times and snapped to OpenStreetMap track. Bus trips record only a route number, so they aren't on the map.</p>`;
}

function renderLines() {
  return `<div class="section-title">Trains boarded, by line</div>${barRows("line", lineItems(state.views.lines))}`;
}

function renderStations() {
  return `<div class="section-title">Touches, by station</div>${barRows("hub", stationItems(state.views.stations))}`;
}

function renderJourneys() {
  const list = view().slice().reverse();
  const rows = list.map((j) => {
    if (j.kind === "bus") {
      return `<div class="row no-glyph"><span class="text"><span class="title">Bus ${esc(j.route)}</span>
        <span class="sub">${fmtLongDay(j.date)}, ${esc(j.start)}</span></span></div>`;
    }
    const legs = routedLegs(j);
    const manual = legs.some((l) => l.routed.source === "manual");
    const unmatched = legs.some((l) => !l.routed.chosen);
    return `<button class="row no-glyph pressable" data-journey="${esc(j.id)}">
      <span class="text"><span class="title">${esc(resolveLabel(j.from))} → ${esc(resolveLabel(j.to))}</span>
      <span class="sub">${fmtLongDay(j.date)}, ${esc(j.start)} · ${[...state.meta.get(j.id).lines].map((ln) => `<span class="line-dot" style="background:${state.net.lines[ln].color}" title="${esc(state.net.lines[ln].name)}"></span>`).join("")}${manual ? ' <span class="badge">Edited</span>' : ""}${unmatched ? ' <span class="badge">Unmatched</span>' : ""}</span></span>
      <span class="trail">${icon("chevron", "icon icon-sm")}</span></button>`;
  }).join("");
  return `<div class="section-title">Journeys <span class="aside">${list.length}</span></div>
    ${rows ? `<div class="group">${rows}</div>` : `<div class="empty">No journeys match these filters.</div>`}
    ${authControls()}`;
}

function authControls() {
  if (!state.email) return `<div class="actions"><button id="sign-in" class="action pressable">Sign in with Google to edit routes</button></div>`;
  const note = state.editor ? `Signed in as ${esc(state.email)}.` : `${esc(state.email)} can't edit routes.`;
  return `<p class="note">${note}</p><div class="actions"><button id="sign-out" class="action pressable">Sign out</button></div>`;
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

function routeSummary(o) {
  return `<span class="route-lines">${routeNames(o)}</span>
    <span class="route-steps tnum" style="display:block">${esc(routeText(o))}. About ${Math.round(o.minutes)} min, ${o.km.toFixed(1)} km.</span>`;
}

function renderJourney(id) {
  const j = state.journeys.find((x) => x.id === id);
  const blocks = routedLegs(j).map(({ leg, i, routed }) => {
    const key = legKey(j.id, i);
    const heading = `<div class="section-title">${esc(leg.from.label)} → ${esc(leg.to.label)}
      <span class="aside tnum">${leg.observed !== null ? `${leg.observed} min touch to touch` : ""}</span></div>`;
    const none = `<div class="empty">Couldn't match these stations to the network.</div>`;
    if (!state.editor) {
      return `<div class="section">${heading}${routed.chosen ? `<div class="group"><div class="row no-glyph route-opt">${routeSummary(routed.chosen)}</div></div>` : none}
        ${routed.source === "manual" ? `<p class="note"><span class="badge">Edited</span> Route set by hand.</p>` : ""}</div>`;
    }
    const opts = routed.options.map((o) => `
      <button class="row no-glyph pressable route-opt ${routed.chosen?.sig === o.sig ? "is-active" : ""}" data-pick="${esc(o.sig)}" data-leg="${i}">${routeSummary(o)}</button>`).join("");
    return `<div class="section">${heading}
      ${routed.source === "manual" ? `<p class="note"><span class="badge">Edited</span> ${esc(routed.chosen ? routeText(routed.chosen) : "")}</p>` : ""}
      ${opts ? `<div class="group">${opts}</div>` : none}
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
    ${state.editor ? `<label class="tfl-check"><input type="checkbox" id="apply-all" checked> Apply my change to every trip between these stations</label>` : ""}
    ${blocks}
    ${state.editor ? `<datalist id="stop-names">${stops}</datalist>` : authControls()}`;
}

function renderHead() {
  const dates = state.journeys?.map((j) => j.date).sort() ?? [];
  const span = dates.length ? `Oyster, ${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])}` : "Oyster";
  const tabs = [["overview", "Overview"], ["lines", "Lines"], ["stations", "Stations"], ["journeys", "Journeys"]];
  const active = Object.entries(state.filter);
  $("#sheet-head").innerHTML = `
    <div class="tfl-title">TfL rail history</div>
    <div class="tfl-sub">${esc(span)}</div>
    <div class="chips tfl-tabs" role="tablist">${tabs.map(([id, name]) =>
      `<button class="chip small pressable" role="tab" data-tab="${id}" aria-pressed="${state.tab === id}">${name}</button>`).join("")}</div>
    ${active.length ? `<div class="chips filter-chips">${active.map(([dim, v]) =>
      `<button class="chip small filter pressable" data-unfilter="${dim}" aria-label="Remove filter ${esc(filterLabel(dim, v))}">${esc(filterLabel(dim, v))}${icon("xmark", "icon")}</button>`).join("")}
      ${active.length > 1 ? `<button class="chip small pressable" id="clear-filters">Clear all</button>` : ""}</div>` : ""}`;
}

function renderBody() {
  const body = $("#sheet-body");
  const top = body.scrollTop;
  if (!state.net) body.innerHTML = `<div class="empty">Loading…</div>`;
  else if (state.selected) body.innerHTML = renderJourney(state.selected.id);
  else body.innerHTML = { overview: renderOverview, lines: renderLines, stations: renderStations, journeys: renderJourneys }[state.tab]();
  body.scrollTop = top;
}

function render() {
  hideTip();
  renderHead();
  renderBody();
}

// ── Sign-in and editing ─────────────────────────────────────────────────────
async function setSession(session) {
  state.accessToken = session?.access_token ?? null;
  state.email = session?.user?.email ?? null;
  state.editor = false;
  if (state.accessToken) {
    const res = await fetch("/tfl/api/me", { headers: { Authorization: `Bearer ${state.accessToken}` } }).catch(() => null);
    state.editor = Boolean(res?.ok && (await res.json()).editor);
  }
  if (state.net) renderBody();
}

async function saveOverrides() {
  recompute();
  refreshMap();
  const res = await fetch("/tfl/api/overrides", {
    method: "PUT",
    headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(state.overrides),
  }).catch(() => null);
  toast(res?.ok ? "Saved" : "Couldn't save that change");
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

// ── Tooltip and toast ───────────────────────────────────────────────────────
function showTip(x, y, value, label) {
  const tip = $("#tip");
  tip.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = value;
  tip.append(strong);
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    tip.append(span);
  }
  tip.classList.remove("hidden");
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(x, innerWidth - w - 28)}px`;
  tip.style.top = `${Math.max(4, y - 44)}px`;
}

function hideTip() {
  $("#tip").classList.add("hidden");
}

function tipFromEl(el, x, y) {
  const [value, label] = el.dataset.tip.split("|");
  showTip(x, y, value, label);
}

const canHover = matchMedia("(hover: hover)").matches;
if (canHover) {
  $("#sheet-body").addEventListener("mousemove", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) tipFromEl(el, e.clientX, e.clientY);
    else hideTip();
  });
  $("#sheet-body").addEventListener("mouseleave", hideTip);
}
$("#sheet-body").addEventListener("focusin", (e) => {
  const el = e.target.closest("[data-tip]");
  if (el?.matches(":focus-visible")) {
    const r = el.getBoundingClientRect();
    tipFromEl(el, r.left, r.top);
  }
});
$("#sheet-body").addEventListener("focusout", hideTip);

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("is-hidden"), 2400);
}

// ── Events ──────────────────────────────────────────────────────────────────
$("#sheet-head").addEventListener("click", (e) => {
  const t = e.target;
  const dim = t.closest("[data-unfilter]")?.dataset.unfilter;
  if (dim) {
    setFilter(dim, state.filter[dim]);
    return;
  }
  if (t.closest("#clear-filters")) return clearFilters();
  const tab = t.closest("[data-tab]")?.dataset.tab;
  if (!tab) return;
  state.tab = tab;
  state.selected = null;
  applySelected();
  render();
  $("#sheet-body").scrollTop = 0;
  if (!sheet.wide && sheet.detent === "peek") sheet.set("half");
});

const NUMERIC = new Set(["day", "hour", "line", "seg"]);
$("#sheet-body").addEventListener("click", (e) => {
  const t = e.target;
  const f = t.closest("[data-filter]")?.dataset.filter;
  if (f) {
    const cut = f.indexOf(":");
    const dim = f.slice(0, cut), raw = f.slice(cut + 1);
    setFilter(dim, NUMERIC.has(dim) ? Number(raw) : raw);
    return;
  }
  const j = t.closest("[data-journey]")?.dataset.journey;
  if (j) return selectJourney(j);
  if (t.closest("#close-journey")) return clearJourney();
  const pick = t.closest("[data-pick]");
  if (pick) return setOverride(Number(pick.dataset.leg), { sig: pick.dataset.pick });
  const clear = t.closest("[data-clear]")?.dataset.clear;
  if (clear !== undefined) return setOverride(Number(clear), null);
  if (t.closest("#sign-in")) {
    auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    return;
  }
  if (t.closest("#sign-out")) auth.signOut();
});

$("#sheet-body").addEventListener("submit", (e) => {
  e.preventDefault();
  const leg = e.target.dataset.via;
  if (leg === undefined) return;
  const { hub } = resolveStation(state.net, e.target.querySelector("input").value);
  if (!hub) return toast("Couldn't find that station");
  setOverride(Number(leg), { via: [hub] });
});

// Map: tap a station or track to filter by it.
const mapLayers = () => ["stations", "all-stops", "used-hit"].filter((id) => map.getLayer(id));
map.on("click", (e) => {
  const f = map.queryRenderedFeatures(e.point, { layers: mapLayers() })[0];
  if (!f) return;
  if (f.layer.id === "used-hit") {
    setFilter("seg", f.id);
    return;
  }
  const { hub, name } = f.properties;
  const used = state.journeys.some((j) => state.meta.get(j.id).hubs.has(hub));
  if (used) setFilter("hub", hub);
  else toast(`${name}: no journeys`);
});
map.on("mousemove", (e) => {
  const f = map.queryRenderedFeatures(e.point, { layers: mapLayers() })[0];
  map.getCanvas().style.cursor = f ? "pointer" : "";
  if (!f || !canHover) return hideTip();
  const r = map.getContainer().getBoundingClientRect();
  const x = r.left + e.point.x, y = r.top + e.point.y;
  if (f.layer.id === "used-hit") showTip(x, y, plural(f.properties.count, "trip"), `Mostly ${f.properties.line}`);
  else if (f.layer.id === "stations") showTip(x, y, f.properties.name, plural(f.properties.visits, "touch").replace("touchs", "touches"));
  else showTip(x, y, f.properties.name, "");
});
map.on("mouseout", hideTip);
// isStyleLoaded() stays false while tiles load, so remember the event instead of polling it.
let styleReady = false;
map.on("style.load", () => {
  styleReady = true;
  addLayers();
});

$("#btn-network").innerHTML = icon("map");
$("#btn-colour").innerHTML = icon("layers");
$("#btn-fit").innerHTML = icon("zoom");
$("#btn-zoom-in").innerHTML = icon("plus");
$("#btn-zoom-out").innerHTML = icon("minus");
$("#btn-network").setAttribute("aria-pressed", state.network);
$("#btn-network").addEventListener("click", (e) => {
  state.network = !state.network;
  e.currentTarget.setAttribute("aria-pressed", state.network);
  lsSet(NETWORK_KEY, state.network ? "1" : "0");
  for (const id of ["net-colour", "all-stops", "all-stop-labels"]) map.setLayoutProperty(id, "visibility", vis(state.network));
  toast(state.network ? "Showing all track and stops" : "Hiding all track and stops");
});
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
  const [raw, data] = await Promise.all([
    fetch("/tfl/data/network.json").then((r) => r.json()),
    fetch("/tfl/api/journeys").then((r) => r.json()),
  ]);
  state.net = buildNetwork(raw);
  // The Northern line's black disappears on the dark basemap.
  if (state.theme === "dark") state.net.lines.find((l) => l.id === "northern").color = "#f5f5f7";
  state.journeys = data.journeys;
  state.overrides = data.overrides;
  recompute();
  if (styleReady) addLayers();
  render();
  if (state.journeys.length && !OPENED_AT_POSITION) fitAll();
  auth.onAuthStateChange((_event, session) => { setSession(session); });
}
boot();
