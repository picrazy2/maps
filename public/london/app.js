import { icon } from "./icons.js";
import { Sheet } from "./sheet.js";

const BASE = "/london";
const DATA = `${location.origin}${BASE}/data`;
const POSTCODES_IO = "https://api.postcodes.io";
const OFM = "https://tiles.openfreemap.org";
const GLYPHS = `${OFM}/fonts/{fontstack}/{range}.pbf`;
const LONDON_BOUNDS = [-0.5103, 51.2868, 0.334, 51.6919];
const ATTRIBUTION =
  'Boundaries <a href="https://geoportal.statistics.gov.uk/">ONS</a> · Postcodes <a href="https://www.ordnancesurvey.co.uk/products/code-point-open">OS Code-Point Open</a>: Contains OS data © Crown copyright and database right 2025; Royal Mail data © Royal Mail copyright and database right 2025; National Statistics data © Crown copyright 2025';

// Overlay layers, finest last in the legend. Colours mirror --l-* in styles.css.
const OVERLAYS = [
  { id: "gla", kind: "gla", name: "Greater London", src: "bounds", width: [8, 2, 14, 3.5], on: true },
  { id: "boroughs", kind: "borough", name: "Boroughs", src: "bounds", label: "borough_labels", field: "name",
    width: [8, 0.9, 14, 2.6], labelSize: [9, 10.5, 13, 15], bold: true, on: true },
  { id: "wards", kind: "ward", name: "Wards", src: "bounds", label: "ward_labels", field: "name", min: 9,
    labelMin: 12, width: [10, 0.5, 15, 1.6], labelSize: [12, 10.5, 16, 13] },
  { id: "pc_areas", kind: "pc_area", name: "Postcode areas", hint: "E, SW, N", src: "bounds", label: "pc_area_labels",
    field: "code", width: [8, 1.4, 14, 3], labelSize: [8, 14, 12, 22], bold: true, labelMax: 12.5 },
  { id: "pc_districts", kind: "pc_district", name: "Postcode districts", hint: "E1, SW1A", src: "bounds",
    label: "pc_district_labels", field: "code", min: 9, labelMin: 10, width: [9, 0.8, 15, 2.2],
    labelSize: [10, 11, 14, 17], bold: true },
  { id: "pc_sectors", kind: "pc_sector", name: "Postcode sectors", hint: "E1 6", src: "bounds",
    label: "pc_sector_labels", field: "code", min: 11, labelMin: 12.5, width: [11, 0.5, 16, 1.6],
    labelSize: [13, 10.5, 16, 13] },
  { id: "pc_units", kind: "pc_unit", name: "Full postcodes", hint: "E1 6AN, from street level", src: "units",
    label: "pc_units", field: "code", min: 13, labelMin: 16, width: [13, 0.3, 17, 1.2],
    labelSize: [16, 10, 18, 12] },
  { id: "msoas", kind: "msoa", name: "MSOAs", hint: "Middle layer super output areas", src: "census",
    label: "msoa_labels", field: "name", min: 9, labelMin: 11.5, width: [9, 0.6, 15, 1.8],
    labelSize: [11.5, 10.5, 15, 13] },
  { id: "lsoas", kind: "lsoa", name: "LSOAs", hint: "Lower layer super output areas", src: "census",
    label: "lsoa_labels", field: "name", min: 10, labelMin: 13.5, width: [10, 0.4, 16, 1.3],
    labelSize: [13.5, 10, 16, 12] },
  { id: "oas", kind: "oa", name: "Output areas", hint: "Smallest census areas, from street level", src: "census",
    label: "oas", field: "code", min: 12, labelMin: 16, width: [12, 0.3, 17, 1], labelSize: [16, 10, 18, 11] },
];
// How layers are grouped in the chips and the Choose Map card.
const GROUPS = [
  { id: "admin", name: "Administrative", short: "Admin", layers: ["gla", "boroughs", "wards"] },
  { id: "postcodes", name: "Postcodes", short: "Postcodes", layers: ["pc_areas", "pc_districts", "pc_sectors", "pc_units"] },
  { id: "census", name: "Census 2021", short: "Census", layers: ["msoas", "lsoas", "oas"] },
];
const BY_ID = Object.fromEntries(OVERLAYS.map((o) => [o.id, o]));
const BY_KIND = Object.fromEntries(OVERLAYS.map((o) => [o.kind, o]));
// Click picks the finest visible layer; this is that order.
const FINE = ["pc_units", "oas", "lsoas", "pc_sectors", "msoas", "wards", "pc_districts", "boroughs", "pc_areas", "gla"];
// Layers whose tiles only load while switched on (big tilesets); the rest are always hit-testable.
const lazy = (o) => o.src !== "bounds";
const KIND_LABEL = {
  gla: "Region", borough: "Borough", ward: "Ward", pc_area: "Postcode area",
  pc_district: "Postcode district", pc_sector: "Postcode sector", pc_unit: "Postcode", place: "Place",
  msoa: "MSOA", lsoa: "LSOA", oa: "Output area",
};
const KIND_ICON = {
  gla: "map", borough: "building", ward: "grid", pc_area: "envelope", pc_district: "envelope",
  pc_sector: "envelope", pc_unit: "envelope", place: "pin", msoa: "people", lsoa: "people", oa: "people",
};

const PALETTE = {
  light: { gla: "#1c1c1e", boroughs: "#0a84ff", wards: "#5e5ce6", pc_areas: "#ff9f0a", pc_districts: "#ff375f",
    pc_sectors: "#00a3a3", pc_units: "#bf5af2",
    msoas: "#a2845e", lsoas: "#28a745", oas: "#8e8e93", halo: "rgba(255,255,255,0.92)", glow: "rgba(255,255,255,0.7)" },
  dark: { gla: "#f5f5f7", boroughs: "#409cff", wards: "#7d7aff", pc_areas: "#ffb340", pc_districts: "#ff6482",
    pc_sectors: "#2dd4bf", pc_units: "#da8fff",
    msoas: "#c2a888", lsoas: "#30d158", oas: "#aeaeb2", halo: "rgba(0,0,0,0.75)", glow: "rgba(0,0,0,0.5)" },
};

const STYLES = {
  explore: { name: "Explore", light: `${OFM}/styles/liberty`, dark: `${OFM}/styles/dark` },
  muted: { name: "Muted", light: `${OFM}/styles/positron`, dark: `${OFM}/styles/fiord` },
  satellite: { name: "Satellite" },
};
const SATELLITE = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    sat: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};

// ── Small utilities ──────────────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nf = new Intl.NumberFormat("en-GB");
const fmtInt = (n) => nf.format(Math.round(n));
const fmtArea = (a) => (a < 10 ? a.toFixed(2) : a < 100 ? a.toFixed(1) : fmtInt(a));
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const compact = (s) => s.replace(/\s+/g, "").toUpperCase();
const RE_UNIT = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;
const RE_PARTIAL_UNIT = /^([A-Z]{1,2}\d[A-Z\d]?)\s+\d[A-Z]?$/;
const RE_POSTCODEISH = /^[A-Z]{1,2}\d/i;
const formatUnit = (s) => compact(s).replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");

const store = {
  get(k, d) {
    try { return JSON.parse(localStorage.getItem(`london-map:${k}`)) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(`london-map:${k}`, JSON.stringify(v)); } catch {}
  },
};

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("is-hidden"), 2200);
}

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  on: new Set(store.get("layers", OVERLAYS.filter((o) => o.on).map((o) => o.id))),
  style: store.get("style", "explore"),
  labels: store.get("labels", true),
  theme: document.documentElement.dataset.theme,
  view: "home",
  sel: null,
  query: "",
  recents: store.get("recents", []),
  openGroups: store.get("openGroups", ["admin", "postcodes", "census"]),
};
let index = [];
const byKey = new Map();
let manifest = { v: "0", sources: {} };

// ── Map ──────────────────────────────────────────────────────────────────────
const sheet = new Sheet($("#sheet"), { onChange: onSheetChange });
const hasHash = /[#&]map=/.test(location.hash);

const map = new maplibregl.Map({
  container: "map",
  style: baseStyle(),
  bounds: hasHash ? undefined : LONDON_BOUNDS,
  fitBoundsOptions: { padding: fitPadding() },
  hash: "map",
  maxZoom: 19,
  minZoom: 7,
  maxBounds: [[-1.6, 50.9], [1.4, 52.1]],
  attributionControl: { compact: true },
  dragRotate: true,
  pitchWithRotate: false,
  cooperativeGestures: false,
});
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
// OpenFreeMap styles reference a few icons their sprite lacks; stub them silently.
map.on("styleimagemissing", (e) => {
  if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
});
// Start the attribution collapsed to its (i) button, as Maps does.
map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
map.touchZoomRotate.enableRotation();

function palette() {
  return PALETTE[state.theme === "dark" || state.style === "satellite" ? "dark" : "light"];
}

function baseStyle() {
  const s = STYLES[state.style] ?? STYLES.explore;
  return state.style === "satellite" ? SATELLITE : s[state.theme];
}

function interp(stops) {
  const out = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < stops.length; i += 2) out.push(stops[i], stops[i + 1]);
  return out;
}

const selFilter = (o) => ["==", ["get", "code"], state.sel?.kind === o.kind ? state.sel.id : "\u0000"];
const vis = (on) => (on ? "visible" : "none");

function overlaySpec() {
  const c = palette();
  const sources = {};
  for (const [name, s] of Object.entries(manifest.sources)) {
    sources[`ov-${name}`] = {
      type: "vector",
      tiles: [`${DATA}/${name}/{z}/{x}/{y}.pbf?v=${manifest.v}`],
      minzoom: s.minzoom, maxzoom: s.maxzoom, bounds: s.bounds,
      promoteId: "code",
      attribution: ATTRIBUTION,
    };
  }
  // Drawn in passes, finest boundaries first, so larger ones sit on top where they
  // share an edge (a district line over its sectors, an area line over its districts).
  // Selection draws above every line; labels follow the same order, and the topmost
  // symbol layer wins collisions, so bigger boundaries keep their labels.
  const fills = [];
  const lines = [];
  const sels = [];
  const top = [];
  for (const o of FINE.map((id) => BY_ID[id])) {
    if (!manifest.sources[o.src]) continue;
    const src = { source: `ov-${o.src}`, "source-layer": o.id, ...(o.min ? { minzoom: o.min } : {}) };
    const on = state.on.has(o.id);
    // Transparent fill doubles as the hit target, so clicks find every layer (units only when on).
    fills.push({
      id: `${o.id}-fill`, type: "fill", ...src,
      layout: { visibility: lazy(o) ? vis(on) : "visible" },
      paint: {
        "fill-color": c[o.id],
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.13, 0],
      },
    });
    if (o.id === "gla") {
      lines.push({ id: "gla-glow", type: "line", ...src, layout: { visibility: vis(on), "line-join": "round" },
        paint: { "line-color": c.boroughs, "line-opacity": 0.16, "line-width": interp([8, 6, 14, 12]) } });
    }
    lines.push({
      id: `${o.id}-line`, type: "line", ...src,
      layout: { visibility: vis(on), "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c[o.id], "line-width": interp(o.width) },
    });
    sels.push({ id: `${o.id}-sel`, type: "fill", ...src, filter: selFilter(o),
      paint: { "fill-color": c[o.id], "fill-opacity": 0.2 } });
    sels.push({ id: `${o.id}-sel-line`, type: "line", ...src, filter: selFilter(o),
      layout: { "line-join": "round" },
      paint: { "line-color": c[o.id], "line-width": interp([8, 2.5, 16, 4.5]) } });
    if (o.label) {
      top.push({
        id: `${o.id}-label`, type: "symbol", source: `ov-${o.src}`, "source-layer": o.label,
        minzoom: o.labelMin ?? o.min ?? 0, ...(o.labelMax ? { maxzoom: o.labelMax } : {}),
        layout: {
          visibility: vis(on && state.labels),
          "text-field": ["get", o.field],
          "text-font": [o.bold ? "Noto Sans Bold" : "Noto Sans Regular"],
          "text-size": interp(o.labelSize),
          "text-max-width": 7,
          "text-padding": 4,
        },
        paint: {
          "text-color": o.id === "gla" ? c.gla : c[o.id],
          "text-halo-color": c.halo,
          "text-halo-width": 1.6,
          "text-halo-blur": 0.4,
        },
      });
    }
  }
  const below = [...fills, ...lines, ...sels];
  return { sources, below, top };
}

// Merge our overlays into whichever basemap is loaded: fills/lines above every
// basemap geometry layer (roads, bridges, 3D buildings), our labels on top. Some
// OpenFreeMap styles interleave symbol layers early, so "before the first symbol"
// would bury the boundaries under the road network.
function transformStyle(_prev, next) {
  const { sources, below, top } = overlaySpec();
  const at = next.layers.findLastIndex((l) => l.type !== "symbol") + 1;
  const layers = [...next.layers.slice(0, at), ...below, ...next.layers.slice(at), ...top];
  return { ...next, glyphs: next.glyphs ?? GLYPHS, sources: { ...next.sources, ...sources }, layers };
}

function applyStyle() {
  map.setStyle(baseStyle(), { transformStyle, diff: false });
}

function setOverlay(id, on, { quiet = false } = {}) {
  on ? state.on.add(id) : state.on.delete(id);
  store.set("layers", [...state.on]);
  const o = BY_ID[id];
  if (!map.getLayer(`${id}-line`)) return renderChips();
  map.setLayoutProperty(`${id}-line`, "visibility", vis(on));
  if (id === "gla") map.setLayoutProperty("gla-glow", "visibility", vis(on));
  if (lazy(o)) map.setLayoutProperty(`${id}-fill`, "visibility", vis(on));
  if (o.label) map.setLayoutProperty(`${id}-label`, "visibility", vis(on && state.labels));
  renderChips();
  renderMapCard();
  if (!quiet && on && o.min && map.getZoom() < o.min - 0.5) toast(`${o.name} appear from zoom ${o.min}. Zoom in to see them.`);
}

function setLabels(on) {
  state.labels = on;
  store.set("labels", on);
  for (const o of OVERLAYS) {
    if (o.label && map.getLayer(`${o.id}-label`)) {
      map.setLayoutProperty(`${o.id}-label`, "visibility", vis(on && state.on.has(o.id)));
    }
  }
  renderMapCard();
}

function updateSelectionLayers() {
  for (const o of OVERLAYS) {
    if (!map.getLayer(`${o.id}-sel`)) continue;
    map.setFilter(`${o.id}-sel`, selFilter(o));
    map.setFilter(`${o.id}-sel-line`, selFilter(o));
  }
}

function fitPadding() {
  if (sheet.wide) return { top: 60, bottom: 60, left: 384 + 48, right: 80 };
  const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0) + 70;
  return { top, bottom: sheet.heightFor("half") + 24, left: 28, right: 64 };
}

function fitTo(b, maxZoom = 16) {
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding(), maxZoom, duration: 900, essential: true });
}

function flyTo(c, zoom) {
  const p = fitPadding();
  map.flyTo({ center: c, zoom: Math.max(map.getZoom(), zoom), padding: p, duration: 1000, essential: true });
}

// ── Hit testing ──────────────────────────────────────────────────────────────
// Output areas aren't in the search index (26k of them); their stats ride in the tiles.
const oaProps = new Map();

// Index entry for a selection, or a stand-in for the kinds the index doesn't hold.
function entryFor(kind, id) {
  const e = byKey.get(`${kind}:${id}`);
  if (e) return e;
  if (kind === "oa") {
    const p = oaProps.get(id) ?? {};
    const lsoa = byKey.get(`lsoa:${p.lsoa}`);
    return { k: "oa", id, t: id, s: lsoa ? `Output area · ${lsoa.t}` : "Output area", p };
  }
  return null;
}

function hitsAt(point) {
  const layers = OVERLAYS.filter((o) => map.getLayer(`${o.id}-fill`) && (!lazy(o) || state.on.has(o.id)))
    .map((o) => `${o.id}-fill`);
  const found = new Map();
  for (const f of map.queryRenderedFeatures(point, { layers })) {
    const id = f.layer.id.slice(0, -5);
    if (!found.has(id)) found.set(id, f);
    if (id === "oas") oaProps.set(f.properties.code, f.properties);
  }
  return FINE.filter((id) => found.has(id)).map((id) => ({ overlay: id, kind: BY_ID[id].kind, f: found.get(id) }));
}

let hovered = null;
function setHover(h) {
  const key = h ? `${h.f.source}|${h.f.sourceLayer}|${h.f.id}` : null;
  if (key === hovered?.key) return;
  if (hovered) map.setFeatureState(hovered.ref, { hover: false });
  hovered = null;
  if (h && h.f.id != null) {
    const ref = { source: h.f.source, sourceLayer: h.f.sourceLayer, id: h.f.id };
    map.setFeatureState(ref, { hover: true });
    hovered = { key, ref };
  }
}

const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
map.on("mousemove", (e) => {
  if (!finePointer.matches) return;
  const h = hitsAt(e.point).find((x) => state.on.has(x.overlay));
  setHover(h);
  const tip = $("#tip");
  map.getCanvas().style.cursor = h ? "pointer" : "";
  if (!h) return tip.classList.add("hidden");
  const code = h.f.properties.code;
  const e1 = byKey.get(`${h.kind}:${code}`);
  tip.innerHTML = `${esc(e1?.t ?? code)} <span>${esc(KIND_LABEL[h.kind])}</span>`;
  tip.style.left = `${e.originalEvent.clientX}px`;
  tip.style.top = `${e.originalEvent.clientY}px`;
  tip.classList.remove("hidden");
});
map.on("mouseout", () => {
  setHover(null);
  $("#tip").classList.add("hidden");
});

map.on("click", (e) => {
  if (state.view === "search") {
    $("#q").blur();
    return showHome();
  }
  const hits = hitsAt(e.point);
  const main = hits.find((h) => state.on.has(h.overlay));
  if (!main) {
    if (state.sel) closeDetail();
    return;
  }
  const code = main.f.properties.code;
  const lngLat = [e.lngLat.lng, e.lngLat.lat];
  select({ kind: main.kind, id: code, point: lngLat, shared: main.f.properties.shared, hits }, { fly: false });
});

// Long-press (touch) or right-click drops a pin, like Maps.
map.on("contextmenu", (e) => dropPin([e.lngLat.lng, e.lngLat.lat]));
let pressTimer;
map.on("touchstart", (e) => {
  if (e.originalEvent.touches.length !== 1) return;
  clearTimeout(pressTimer);
  const ll = e.lngLat;
  pressTimer = setTimeout(() => dropPin([ll.lng, ll.lat]), 550);
});
for (const ev of ["touchend", "touchmove", "touchcancel", "movestart"]) map.on(ev, () => clearTimeout(pressTimer));

function dropPin(c) {
  select({ kind: "place", id: `pt:${c[0].toFixed(5)},${c[1].toFixed(5)}`, title: "Dropped Pin",
    sub: `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`, point: c }, { fly: false });
}

// ── Controls ─────────────────────────────────────────────────────────────────
$("#btn-layers").innerHTML = icon("map");
$("#btn-locate").innerHTML = icon("location");
$("#btn-zoom-in").innerHTML = icon("plus");
$("#btn-zoom-out").innerHTML = icon("minus");
$("#btn-compass").innerHTML = icon("compass", "icon");
$("#btn-zoom-in").onclick = () => map.zoomIn();
$("#btn-zoom-out").onclick = () => map.zoomOut();
$("#btn-compass").onclick = () => map.resetNorthPitch();
$("#btn-layers").onclick = () => toggleMapCard();
map.on("rotate", () => {
  const b = map.getBearing();
  $("#btn-compass").classList.toggle("is-hidden", Math.abs(b) < 0.5 && map.getPitch() < 1);
  $("#btn-compass svg").style.transform = `rotate(${-b}deg)`;
});

let meMarker;
$("#btn-locate").onclick = () => {
  if (!navigator.geolocation) return toast("Location isn't available in this browser");
  const btn = $("#btn-locate");
  btn.innerHTML = icon("locationFill");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const c = [pos.coords.longitude, pos.coords.latitude];
      btn.setAttribute("aria-pressed", "true");
      if (!meMarker) {
        const el = document.createElement("div");
        el.className = "me";
        meMarker = new maplibregl.Marker({ element: el });
      }
      meMarker.setLngLat(c).addTo(map);
      map.once("moveend", () =>
        select({ kind: "place", id: "me", title: "My Location", sub: "Approximate to " +
          `${Math.round(pos.coords.accuracy)} m`, point: c, noPin: true }, { fly: false, recent: false }));
      flyTo(c, 15);
    },
    () => {
      btn.innerHTML = icon("location");
      toast("Couldn't get your location");
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
};

// ── Choose-map card ──────────────────────────────────────────────────────────
function swatch(o, cls = "") {
  return `<span class="swatch ${cls}" style="--sw-c:var(--l-${o.id})"></span>`;
}

function renderMapCard() {
  const el = $("#mapcard");
  el.innerHTML = `
    <div class="card-head">
      <div class="titles"><h2 class="card-title" id="mapcard-title">Choose Map</h2></div>
      <button class="close focus-ring" data-action="close-mapcard" aria-label="Close">${icon("xmark", "icon icon-sm")}</button>
    </div>
    <div class="styles" role="radiogroup" aria-label="Map style">
      ${Object.entries(STYLES).map(([k, s]) => `
        <button class="style-opt pressable focus-ring" role="radio" aria-pressed="${state.style === k}" aria-checked="${state.style === k}" data-style="${k}">
          <span class="thumb ${k}"></span>${s.name}
        </button>`).join("")}
    </div>
    ${GROUPS.map((g) => {
      const open = state.openGroups.includes(g.id);
      const n = g.layers.filter((id) => state.on.has(id)).length;
      return `<div class="section">
        <button class="group-head focus-ring" aria-expanded="${open}" data-group-toggle="${g.id}">
          ${g.name}<span class="count">${n ? `${n} on` : "Off"}</span>${icon("chevron", "icon icon-sm chev")}
        </button>
        ${open ? `<div class="group">${g.layers.map((id) => layerRow(BY_ID[id], "switch")).join("")}</div>` : ""}
      </div>`;
    }).join("")}
    <div class="section">
      <div class="group">
        <button class="row no-glyph focus-ring" role="switch" aria-checked="${state.labels}" data-action="labels">
          <span class="text"><div class="title">Boundary labels</div></span>
          <span class="switch" aria-hidden="true"></span>
        </button>
      </div>
    </div>`;
}

// One layer row, used in the Choose Map card (switch) and the chip menus (checkmark).
function layerRow(o, mode) {
  const on = state.on.has(o.id);
  const trail = mode === "switch" ? `<span class="switch" aria-hidden="true"></span>`
    : `<span class="check">${on ? icon("check", "icon icon-sm") : ""}</span>`;
  return `<button class="row focus-ring" role="${mode === "switch" ? "switch" : "menuitemcheckbox"}" aria-checked="${on}" data-toggle="${o.id}">
    <span class="glyph">${swatch(o, o.width[3] < 2 ? "thin" : "")}</span>
    <span class="text"><div class="title">${o.name}</div>${o.hint ? `<div class="sub">${o.hint}</div>` : ""}</span>
    ${trail}</button>`;
}

function toggleMapCard(force) {
  const el = $("#mapcard");
  const open = force ?? el.classList.contains("is-hidden");
  if (open) renderMapCard();
  el.classList.toggle("is-hidden", !open);
  $("#btn-layers").setAttribute("aria-pressed", String(open));
}

$("#mapcard").addEventListener("click", (e) => {
  const t = e.target.closest("[data-style],[data-toggle],[data-action],[data-group-toggle]");
  if (!t) return;
  if (t.dataset.groupToggle) {
    const id = t.dataset.groupToggle;
    state.openGroups = state.openGroups.includes(id) ? state.openGroups.filter((g) => g !== id) : [...state.openGroups, id];
    store.set("openGroups", state.openGroups);
    renderMapCard();
  } else if (t.dataset.style) {
    state.style = t.dataset.style;
    store.set("style", state.style);
    applyStyle();
    renderMapCard();
  } else if (t.dataset.toggle) {
    setOverlay(t.dataset.toggle, !state.on.has(t.dataset.toggle));
  } else if (t.dataset.action === "labels") {
    setLabels(!state.labels);
  } else if (t.dataset.action === "close-mapcard") {
    toggleMapCard(false);
  }
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (menuGroup) return closeMenu();
  if (!$("#mapcard").classList.contains("is-hidden")) toggleMapCard(false);
  else if (state.view === "detail") closeDetail();
  else if (state.view === "search") showHome();
});
map.on("movestart", (e) => {
  if (e.originalEvent && !sheet.wide) toggleMapCard(false);
});

// ── Sheet: head (search / card title) and body views ─────────────────────────
const head = $("#sheet-head");
const body = $("#sheet-body");
head.innerHTML = `
  <div id="head-search">
    <div class="search-row">
      <label class="search">
        ${icon("search", "icon icon-sm")}
        <input id="q" type="search" placeholder="Search places, postcodes, wards" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search">
        <button class="clear hidden" id="q-clear" aria-label="Clear search">${icon("xcircle", "icon icon-sm")}</button>
      </label>
      <button class="cancel hidden" id="q-cancel">Cancel</button>
    </div>
    <div class="chips section" id="chips" style="margin-top:12px"></div>
  </div>
  <div id="head-detail" class="hidden"></div>`;

function renderChips() {
  $("#chips").innerHTML = GROUPS.map((g) => {
    const on = g.layers.filter((id) => state.on.has(id)).map((id) => BY_ID[id]);
    return `<button class="chip pressable focus-ring" aria-haspopup="menu" aria-expanded="${menuGroup === g.id}"
        aria-pressed="${on.length > 0}" style="--chip-c:var(--accent)" data-menu="${g.id}">
      ${g.short}${on.length ? `<span class="swatches">${on.map((o) => swatch(o)).join("")}</span>` : ""}
      ${icon("chevronDown", "icon icon-sm caret")}
    </button>`;
  }).join("");
  if (menuGroup) renderMenu();
}

// Dropdown under a group chip, listing that group's layers with checkmarks.
let menuGroup = null;
function renderMenu() {
  const g = GROUPS.find((x) => x.id === menuGroup);
  const chip = document.querySelector(`[data-menu="${menuGroup}"]`);
  const el = $("#menu");
  if (!g || !chip) return closeMenu();
  el.innerHTML = `<div class="menu-title">${g.name}</div>${g.layers.map((id) => layerRow(BY_ID[id], "check")).join("")}`;
  el.classList.remove("hidden");
  const r = chip.getBoundingClientRect();
  const w = Math.min(300, innerWidth - 32);
  el.style.width = `${w}px`;
  el.style.left = `${Math.max(16, Math.min(r.left, innerWidth - w - 16))}px`;
  const h = el.offsetHeight;
  const below = r.bottom + 8 + h < innerHeight - 8;
  el.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
  el.dataset.side = below ? "below" : "above";
}
function closeMenu() {
  menuGroup = null;
  $("#menu").classList.add("hidden");
  document.querySelectorAll("[data-menu]").forEach((c) => c.setAttribute("aria-expanded", "false"));
}
$("#menu").addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle]");
  if (t) setOverlay(t.dataset.toggle, !state.on.has(t.dataset.toggle));
});
document.addEventListener("pointerdown", (e) => {
  if (menuGroup && !e.target.closest("#menu,[data-menu]")) closeMenu();
});

function setView(view) {
  state.view = view;
  closeMenu();
  $("#head-search").classList.toggle("hidden", view === "detail");
  $("#head-detail").classList.toggle("hidden", view !== "detail");
  $("#chips").classList.toggle("hidden", view === "search");
  $("#q-cancel").classList.toggle("hidden", view !== "search");
  body.classList.remove("view-in");
  void body.offsetWidth;
  body.classList.add("view-in");
}

function showHome() {
  setView("home");
  $("#q").value = "";
  state.query = "";
  $("#q-clear").classList.add("hidden");
  renderHome();
  if (!sheet.wide && sheet.detent === "full") sheet.set("peek");
}

function rowHTML({ kind, title, sub, attrs, trail, glyph }) {
  const g = glyph ?? `<span class="glyph tinted ${kind}" style="background:var(--l-${BY_KIND[kind]?.id ?? "boroughs"})">${icon(KIND_ICON[kind] ?? "pin", "icon icon-sm")}</span>`;
  return `<button class="row focus-ring" ${attrs}>${g}
    <span class="text"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</span>
    <span class="trail">${trail ?? icon("chevron", "icon icon-sm")}</span></button>`;
}

const entryAttrs = (e) => `data-sel="${esc(e.k)}" data-id="${esc(e.id)}"`;

function renderHome() {
  const boroughs = index.filter((e) => e.k === "borough").sort((a, b) => a.t.localeCompare(b.t));
  const gla = byKey.get("gla:E12000007");
  const recents = state.recents.slice(0, 6);
  body.innerHTML = `
    ${recents.length ? `<div class="section">
      <div class="section-title">Recents <button class="aside" data-action="clear-recents">Clear</button></div>
      <div class="group">${recents.map((r) => rowHTML({
        kind: r.k, title: esc(r.t), sub: esc(r.s),
        glyph: `<span class="glyph">${icon("clock", "icon icon-sm")}</span>`,
        attrs: r.k === "place" ? `data-recent-place="${esc(r.id)}"` : entryAttrs(r),
      })).join("")}</div></div>` : ""}
    ${gla ? `<div class="section">
      <div class="section-title">Greater London</div>
      <div class="group">${rowHTML({ kind: "gla", title: "Greater London", attrs: entryAttrs(gla),
        sub: `${fmtInt(gla.p.population)} residents · ${gla.p.boroughs} boroughs · ${fmtInt(gla.p.wards)} wards` })}</div>
    </div>` : ""}
    <div class="section">
      <div class="section-title">Boroughs</div>
      <div class="group">${boroughs.map((e) => rowHTML({ kind: "borough", title: esc(e.t),
        sub: `${e.p.inner ? "Inner" : "Outer"} London · ${fmtInt(e.p.population)} residents`, attrs: entryAttrs(e) })).join("")
        || `<div class="row"><div class="skeleton" style="width:60%"></div></div>`}</div>
    </div>
    ${aboutNote()}`;
}

function aboutNote() {
  return `<p class="note">Boundaries: ONS Open Geography Portal (wards and local authorities, December 2024).
    Postcodes: OS Code-Point Open; areas, districts, sectors and unit shapes are approximations built from
    postcode centroids, not official boundaries. Census 2021 Output Areas, LSOAs and MSOAs: ONS, with
    MSOA names from the House of Commons Library. Residents: Census 2021, apportioned from Output Areas.
    Tap and hold the map to drop a pin. Contains OS data © Crown copyright and database right 2025;
    Royal Mail data © Royal Mail copyright and database right 2025; National Statistics data © Crown copyright 2025.</p>`;
}

// ── Search ───────────────────────────────────────────────────────────────────
const KIND_BOOST = { gla: 6, borough: 8, ward: 2, pc_area: 3, pc_district: 5, pc_sector: 1, msoa: 1, lsoa: -1 };

function searchLocal(q) {
  const nq = norm(q);
  if (!nq) return [];
  const cq = compact(q);
  const onsCode = /^[EW]\d{4,}$/i.test(cq);
  const pcish = !onsCode && RE_POSTCODEISH.test(q.trim());
  const scored = [];
  for (const e of index) {
    let s = 0;
    if (onsCode) {
      if (e.id.startsWith(cq)) s = 90 - (e.id.length - cq.length);
      else continue;
    } else if (e.k.startsWith("pc_")) {
      if (!pcish && e.k !== "pc_area") continue;
      const ce = compact(e.id);
      if (ce === cq) s = 100;
      else if (ce.startsWith(cq)) s = 70 - (ce.length - cq.length) * 2;
      else continue;
    } else {
      const t = e._n;
      if (t === nq) s = 100;
      else if (t.startsWith(nq)) s = 80 - (t.length - nq.length) * 0.2;
      else if (t.includes(` ${nq}`)) s = 60;
      else if (nq.length > 2 && t.includes(nq)) s = 40;
      else continue;
    }
    scored.push([s + (KIND_BOOST[e.k] ?? 0), e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 8).map((x) => x[1]);
}

function highlight(text, q) {
  const t = esc(text);
  const nq = q.trim();
  if (!nq) return t;
  const i = text.toLowerCase().indexOf(nq.toLowerCase());
  return i === -1 ? t : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + nq.length))}</mark>${esc(text.slice(i + nq.length))}`;
}

let session = newSession();
function newSession() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let searchSeq = 0;
let googleTimer;
const searchCache = new Map();

function onQuery() {
  const q = $("#q").value;
  state.query = q;
  $("#q-clear").classList.toggle("hidden", !q);
  const seq = ++searchSeq;
  const results = { local: searchLocal(q), units: [], places: null };
  const up = q.trim().toUpperCase();
  if (RE_UNIT.test(up)) results.units = [formatUnit(up)];
  renderResults(results);
  clearTimeout(googleTimer);
  if (!q.trim()) return;

  if (RE_PARTIAL_UNIT.test(up) && !RE_UNIT.test(up)) {
    getJSON(`${POSTCODES_IO}/postcodes/${encodeURIComponent(up)}/autocomplete?limit=8`)
      .then((d) => {
        if (seq !== searchSeq) return;
        results.units = d.result ?? [];
        renderResults(results);
      })
      .catch(() => {});
  }
  // Places: debounced, 3+ chars, and never for postcode-shaped queries (they're
  // answered locally or by postcodes.io, so they'd only waste Google calls).
  if (q.trim().length >= 3 && !RE_POSTCODEISH.test(q.trim())) {
    googleTimer = setTimeout(async () => {
      const key = norm(q);
      try {
        const places = searchCache.get(key) ??
          (await getJSON(`${BASE}/api/places/autocomplete?q=${encodeURIComponent(q.trim())}&session=${session}`)).places;
        searchCache.set(key, places);
        if (seq !== searchSeq) return;
        results.places = places;
        renderResults(results);
      } catch {
        if (seq === searchSeq) {
          results.places = [];
          renderResults(results);
        }
      }
    }, 380);
  }
}

function renderResults({ local, units, places }) {
  const q = state.query;
  if (!q.trim()) {
    body.innerHTML = state.recents.length
      ? `<div class="section"><div class="section-title">Recents</div><div class="group">${state.recents.map((r) => rowHTML({
          kind: r.k, title: esc(r.t), sub: esc(r.s), glyph: `<span class="glyph">${icon("clock", "icon icon-sm")}</span>`,
          attrs: r.k === "place" ? `data-recent-place="${esc(r.id)}"` : entryAttrs(r) })).join("")}</div></div>`
      : `<div class="empty">Try a borough, a ward, a postcode like <b>E1 6AN</b> or <b>SW1A</b>, or any place in London.</div>`;
    return;
  }
  const unitRows = units.map((pc) => rowHTML({ kind: "pc_unit", title: highlight(pc, q), sub: "Postcode",
    attrs: `data-pc="${esc(pc)}"` }));
  const localRows = local.map((e) => rowHTML({ kind: e.k, title: highlight(e.t, q), sub: esc(e.s), attrs: entryAttrs(e) }));
  const placeRows = (places ?? []).map((p) => rowHTML({ kind: "place", title: highlight(p.name, q), sub: esc(p.address),
    attrs: `data-place="${esc(p.id)}" data-name="${esc(p.name)}" data-address="${esc(p.address)}"` }));
  const showPlaces = q.trim().length >= 3 && !RE_POSTCODEISH.test(q.trim());
  body.innerHTML = `
    ${unitRows.length + localRows.length ? `<div class="section"><div class="section-title">Boundaries</div>
      <div class="group">${[...unitRows, ...localRows].join("")}</div></div>` : ""}
    ${showPlaces ? `<div class="section"><div class="section-title">Places</div>
      <div class="group">${placeRows.join("") || (places === null
        ? `<div class="row no-glyph"><div class="skeleton" style="width:55%"></div></div>`
        : `<div class="empty" style="padding:14px">No places found</div>`)}</div></div>` : ""}
    ${!showPlaces && !unitRows.length && !localRows.length ? `<div class="empty">No matches in London</div>` : ""}`;
}

const qEl = $("#q");
qEl.addEventListener("focus", () => {
  if (state.view !== "search") {
    setView("search");
    onQuery();
  }
  if (!sheet.wide) sheet.set("full");
});
qEl.addEventListener("input", onQuery);
qEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = body.querySelector("button.row");
    if (first) first.click();
  }
});
$("#q-clear").addEventListener("click", (e) => {
  e.preventDefault();
  qEl.value = "";
  onQuery();
  qEl.focus();
});
$("#q-cancel").addEventListener("click", () => {
  qEl.blur();
  showHome();
});

// ── Selection & detail card ──────────────────────────────────────────────────
let pin;
let detailSeq = 0;

function addRecent(r) {
  state.recents = [r, ...state.recents.filter((x) => !(x.k === r.k && x.id === r.id))].slice(0, 12);
  store.set("recents", state.recents);
}

// Same &-joined format MapLibre's hash uses, so its map= part is left untouched.
function writeHash(sel) {
  const parts = location.hash.slice(1).split("&").filter((p) => p && !p.startsWith("sel="));
  if (sel) parts.push(`sel=${encodeURIComponent(sel).replace(/%3A/g, ":").replace(/%2C/g, ",")}`);
  history.replaceState(null, "", `#${parts.join("&")}`);
}

async function select(sel, { fly = true, recent = true } = {}) {
  const seq = ++detailSeq;
  toggleMapCard(false);
  state.sel = sel;
  const ov = BY_KIND[sel.kind];
  if (ov && !state.on.has(ov.id)) setOverlay(ov.id, true, { quiet: true });
  updateSelectionLayers();

  pin?.remove();
  if (sel.kind === "place" && !sel.noPin) {
    const el = document.createElement("div");
    el.className = "pin";
    pin = new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [-4, 4] }).setLngLat(sel.point).addTo(map);
  }

  const entry = entryFor(sel.kind, sel.id);
  if (recent) {
    if (entry) addRecent({ k: entry.k, id: entry.id, t: entry.t, s: entry.s });
    else if (sel.kind === "pc_unit") addRecent({ k: "pc_unit", id: sel.id, t: sel.id, s: "Postcode" });
    else if (sel.kind === "place" && sel.id !== "me") {
      addRecent({ k: "place", id: `${sel.point[0]},${sel.point[1]},${sel.title}`, t: sel.title, s: sel.sub });
    }
  }
  writeHash(sel.kind === "place"
    ? sel.id === "me" ? null : `pt:${sel.point[0].toFixed(5)},${sel.point[1].toFixed(5)},${sel.title}`
    : `${sel.kind}:${sel.id}`);

  setView("detail");
  qEl.blur();
  renderDetail(sel, entry);
  if (!sheet.wide) sheet.set("half");

  if (fly) {
    if (entry) fitTo(entry.b, sel.kind === "pc_sector" ? 15.5 : 15);
    else if (sel.point) flyTo(sel.point, sel.kind === "pc_unit" ? 17 : 15.5);
  }

  // Async enrichment: postcodes.io for units, containing boundaries for points.
  if (sel.kind === "pc_unit") {
    try {
      sel.info = (await getJSON(`${POSTCODES_IO}/postcodes/${encodeURIComponent(sel.id)}`)).result;
    } catch {
      sel.info = false;
    }
    if (seq !== detailSeq) return;
    if (!sel.point && sel.info) {
      sel.point = [sel.info.longitude, sel.info.latitude];
      if (fly) flyTo(sel.point, 17);
    }
    renderDetail(sel, entry);
  }
  if (sel.kind === "place") {
    const settle = () => {
      if (seq !== detailSeq) return;
      sel.hits = hitsAt(map.project(sel.point));
      renderDetail(sel, entry);
    };
    if (fly) map.once("idle", settle);
    else settle();
    try {
      const d = await getJSON(`${POSTCODES_IO}/postcodes?lon=${sel.point[0]}&lat=${sel.point[1]}&radius=1000&limit=1`);
      sel.nearest = d.result?.[0] ?? null;
    } catch {
      sel.nearest = null;
    }
    if (seq === detailSeq) renderDetail(sel, entry);
  }
}

function closeDetail() {
  detailSeq++;
  state.sel = null;
  updateSelectionLayers();
  pin?.remove();
  writeHash(null);
  showHome();
  if (!sheet.wide) sheet.set("peek");
}

function stat(label, value, unit = "") {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}${unit ? ` <small>${unit}</small>` : ""}</div></div>`;
}

function popStats(p) {
  const out = [];
  // Census data is London-only, so straddling postcode shapes count their London part.
  const partial = p.in_london_pct != null && p.in_london_pct < 100;
  if (p.population != null) out.push(stat(partial ? "Residents in London" : "Residents", fmtInt(p.population)));
  if (p.area_km2 != null) out.push(stat("Area", fmtArea(p.area_km2), "km²"));
  if (p.population != null && p.area_km2 && !partial) out.push(stat("Density", fmtInt(p.population / p.area_km2), "/km²"));
  return out;
}

function entryRow(e, sub) {
  return rowHTML({ kind: e.k, title: esc(e.t), sub: esc(sub ?? KIND_LABEL[e.k]), attrs: entryAttrs(e) });
}

function chipList(title, kind, ids) {
  const items = ids.map((id) => byKey.get(`${kind}:${id}`) ?? null).filter(Boolean);
  if (!items.length) return "";
  const o = BY_KIND[kind];
  return `<div class="section"><div class="section-title">${title}</div><div class="chip-wrap">
    ${items.map((e) => `<button class="chip small pressable focus-ring" style="--chip-c:var(--l-${o.id})" ${entryAttrs(e)}>${esc(e.t)}</button>`).join("")}
  </div></div>`;
}

const boroughCodeByName = () => {
  const m = new Map();
  for (const e of index) if (e.k === "borough") m.set(e.t, e.id);
  return m;
};
let _bByName;

function parentsOf(kind, entry, id) {
  const get = (k, i) => byKey.get(`${k}:${i}`);
  const out = [];
  const add = (e) => e && out.push(e);
  if (kind === "ward") add(get("borough", entry.p.borough_code));
  if (kind === "ward" || kind === "borough") add(get("gla", "E12000007"));
  if (kind === "pc_unit") {
    const [outc, inc] = id.split(" ");
    add(get("pc_sector", `${outc} ${inc[0]}`));
    add(get("pc_district", outc));
    add(get("pc_area", outc.match(/^[A-Z]+/)[0]));
  }
  if (kind === "pc_sector") {
    add(get("pc_district", entry.p.district));
    add(get("pc_area", entry.p.district.match(/^[A-Z]+/)[0]));
  }
  if (kind === "pc_district") add(get("pc_area", entry.p.area));
  if (kind === "oa") add(get("lsoa", entry.p.lsoa));
  if (kind === "oa" || kind === "lsoa") add(get("msoa", (out.at(-1) ?? entry).p.msoa));
  if (["oa", "lsoa", "msoa"].includes(kind)) {
    add(get("borough", (out.at(-1) ?? entry).p.borough_code));
    add(get("gla", "E12000007"));
  }
  return out;
}

function hitRows(hits, exclude) {
  return hits
    .filter((h) => !(h.kind === exclude?.kind && h.f.properties.code === exclude?.id))
    .map((h) => entryFor(h.kind, h.f.properties.code) ?? (h.kind === "pc_unit"
      ? { k: "pc_unit", id: h.f.properties.code, t: h.f.properties.code, s: "Postcode" } : null))
    .filter(Boolean);
}

function renderDetail(sel, entry) {
  const p = entry?.p ?? {};
  let title = entry?.t ?? sel.title ?? sel.id;
  let sub = entry?.s ?? sel.sub ?? KIND_LABEL[sel.kind];
  if (sel.kind === "pc_unit") {
    title = sel.id;
    sub = sel.info ? `Postcode · ${[sel.info.admin_ward, sel.info.admin_district].filter(Boolean).join(", ")}` : "Postcode";
  }
  $("#head-detail").innerHTML = `
    <div class="card-head">
      <div class="titles"><h1 class="card-title">${esc(title)}</h1><div class="card-sub">${esc(sub)}</div></div>
      <button class="close focus-ring" data-action="close" aria-label="Close">${icon("xmark", "icon icon-sm")}</button>
    </div>`;

  const stats = [];
  let extra = "";
  if (sel.kind === "gla") {
    stats.push(...popStats(p), stat("Boroughs", p.boroughs), stat("Wards", fmtInt(p.wards)));
  } else if (sel.kind === "borough") {
    stats.push(...popStats(p), stat("Wards", p.wards));
    extra += chipList("Postcode districts", "pc_district", (p.districts || "").split(", ").filter(Boolean));
  } else if (sel.kind === "ward") {
    stats.push(...popStats(p));
    extra += chipList("Postcode districts", "pc_district", (p.districts || "").split(", ").filter(Boolean));
  } else if (sel.kind === "pc_area") {
    stats.push(stat("Postcodes", fmtInt(p.postcodes)), stat("Districts", p.districts), ...popStats(p));
  } else if (sel.kind === "pc_district" || sel.kind === "pc_sector") {
    stats.push(stat("Postcodes", fmtInt(p.postcodes)));
    if (p.sectors) stats.push(stat("Sectors", p.sectors));
    stats.push(...popStats(p));
    _bByName ??= boroughCodeByName();
    extra += chipList("Boroughs", "borough", (p.boroughs || "").split(", ").map((n) => _bByName.get(n)).filter(Boolean));
  }
  if (sel.kind === "msoa") stats.push(...popStats(p), stat("LSOAs", p.lsoas), stat("Output areas", p.oas));
  if (sel.kind === "lsoa") stats.push(...popStats(p), stat("Output areas", p.oas));
  if (sel.kind === "oa") stats.push(...popStats(p));
  if (["msoa", "lsoa", "oa"].includes(sel.kind)) {
    extra += `<p class="note">ONS code ${esc(sel.id)}${p.ons_name ? ` · ${esc(p.ons_name)}` : ""}.
      Census 2021 statistical geography; residents are usual residents on Census day.</p>`;
  }
  if (p.in_london_pct != null && p.in_london_pct < 100) {
    extra += `<p class="note">${p.in_london_pct}% of this ${KIND_LABEL[sel.kind].toLowerCase()} lies inside Greater London.</p>`;
  }

  // Unit details from postcodes.io.
  let details = "";
  if (sel.kind === "pc_unit") {
    const r = sel.info;
    if (r === undefined) {
      details = `<div class="section"><div class="group"><div class="row no-glyph"><div class="skeleton" style="width:70%"></div></div><div class="row no-glyph"><div class="skeleton" style="width:50%"></div></div></div></div>`;
    } else if (r) {
      const wardE = byKey.get(`ward:${r.codes?.admin_ward}`);
      const borE = byKey.get(`borough:${r.codes?.admin_district}`);
      const kv = (k, v, attrs) => v ? `<${attrs ? "button" : "div"} class="row no-glyph ${attrs ? "focus-ring" : ""}" ${attrs ?? ""}>
        <span class="text"><div class="sub">${k}</div><div class="title" style="white-space:normal">${esc(v)}</div></span>
        ${attrs ? `<span class="trail">${icon("chevron", "icon icon-sm")}</span>` : ""}</${attrs ? "button" : "div"}>` : "";
      details = `<div class="section"><div class="section-title">Details</div><div class="group">
        ${kv("Ward", r.admin_ward, wardE ? entryAttrs(wardE) : null)}
        ${kv("Borough", r.admin_district, borE ? entryAttrs(borE) : null)}
        ${kv("Parliamentary constituency", r.parliamentary_constituency_2024 ?? r.parliamentary_constituency)}
        ${kv("Lower layer super output area", r.lsoa)}
        ${kv("Middle layer super output area", r.msoa)}
        ${kv("Coordinates", `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`)}
        ${kv("OS grid reference", `${r.eastings} E, ${r.northings} N`)}
      </div></div>`;
      if (sel.shared) details += `<p class="note">This location is shared by ${esc(sel.shared)}.</p>`;
    } else {
      details = `<p class="note">Couldn't load details for this postcode. It may have been retired.</p>`;
    }
  }

  // Containment: hierarchy parents for boundaries; everything under the point for clicks/places.
  let containing = [];
  if (sel.hits) containing = hitRows(sel.hits, sel);
  else containing = parentsOf(sel.kind, entry, sel.id);
  if (sel.kind === "place" && sel.nearest && !containing.some((e) => e.k === "pc_unit")) {
    containing.unshift({ k: "pc_unit", id: sel.nearest.postcode, t: sel.nearest.postcode,
      s: `Nearest postcode · ${fmtInt(sel.nearest.distance)} m` });
  }
  const contRows = containing.map((e) => e.k === "pc_unit"
    ? rowHTML({ kind: "pc_unit", title: esc(e.t), sub: esc(e.s), attrs: `data-pc="${esc(e.id)}"` })
    : entryRow(e));
  const contTitle = sel.hits ? (sel.kind === "place" ? "At this location" : "Also here") : "Located in";

  const gmaps = sel.point
    ? `https://www.google.com/maps/search/?api=1&query=${sel.point[1]},${sel.point[0]}${sel.placeId ? `&query_place_id=${sel.placeId}` : ""}`
    : null;
  body.innerHTML = `
    <div class="actions">
      <button class="action primary pressable focus-ring" data-action="zoom">${icon("zoom")}Zoom to</button>
      <button class="action pressable focus-ring" data-action="share">${icon("share")}Share</button>
      ${sel.kind === "pc_unit" || sel.kind.startsWith("pc_") ? `<button class="action pressable focus-ring" data-action="copy">${icon("copy")}Copy</button>` : ""}
      ${gmaps && sel.kind === "place" ? `<a class="action pressable focus-ring" href="${gmaps}" target="_blank" rel="noopener">${icon("external")}Google Maps</a>` : ""}
    </div>
    ${stats.length ? `<div class="stats">${stats.join("")}</div>` : ""}
    ${details}
    ${contRows.length ? `<div class="section"><div class="section-title">${contTitle}</div><div class="group">${contRows.join("")}</div></div>` : ""}
    ${extra}
    ${sel.kind.startsWith("pc_") && sel.kind !== "pc_unit" ? `<p class="note">Postcode shapes are approximate: built from OS Code-Point Open centroids. Residents are from Census 2021.</p>` : ""}
  `;
}

// One delegated handler for everything clickable in the sheet.
$("#sheet").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-sel],[data-pc],[data-place],[data-recent-place],[data-toggle],[data-action],[data-menu]");
  if (!t) return;
  const d = t.dataset;
  if (d.menu) {
    if (menuGroup === d.menu) return closeMenu();
    menuGroup = d.menu;
    renderChips();
    return t.setAttribute("aria-expanded", "true");
  }
  if (d.toggle) return setOverlay(d.toggle, !state.on.has(d.toggle));
  if (d.sel) return select({ kind: d.sel, id: d.id });
  if (d.pc) return select({ kind: "pc_unit", id: d.pc });
  if (d.recentPlace) {
    const [lng, lat, ...rest] = d.recentPlace.split(",");
    const point = [Number(lng), Number(lat)];
    return select({ kind: "place", id: d.recentPlace, title: rest.join(","), sub: t.querySelector(".sub")?.textContent ?? "", point });
  }
  if (d.place) {
    try {
      const det = await getJSON(`${BASE}/api/places/details?id=${encodeURIComponent(d.place)}&session=${session}`);
      session = newSession();
      select({ kind: "place", id: d.place, placeId: d.place, title: d.name, sub: det.address || d.address,
        point: [det.lng, det.lat] }, { fly: true });
    } catch {
      toast("Couldn't load that place");
    }
    return;
  }
  const sel = state.sel;
  switch (d.action) {
    case "close":
      return closeDetail();
    case "clear-recents":
      state.recents = [];
      store.set("recents", []);
      return renderHome();
    case "zoom": {
      const entry = sel && byKey.get(`${sel.kind}:${sel.id}`);
      if (entry) fitTo(entry.b, sel.kind === "lsoa" ? 17 : 16);
      else if (sel?.point) flyTo(sel.point, sel.kind === "pc_unit" ? 17 : 16);
      if (!sheet.wide) sheet.set("peek");
      return;
    }
    case "share": {
      const url = location.href;
      try {
        if (navigator.share && !sheet.wide) await navigator.share({ title: document.title, url });
        else {
          await navigator.clipboard.writeText(url);
          toast("Link copied");
        }
      } catch {}
      return;
    }
    case "copy":
      try {
        await navigator.clipboard.writeText(sel.id);
        toast(`Copied ${sel.id}`);
      } catch {}
  }
});

function onSheetChange(s) {
  closeMenu();
  document.documentElement.style.setProperty("--sheet-visible", `${s.visibleHeight()}px`);
}

// ── Theme ────────────────────────────────────────────────────────────────────
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  state.theme = e.matches ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  applyStyle();
});

// ── Boot ─────────────────────────────────────────────────────────────────────
renderChips();
showHome();
sheet.set("peek", false);

async function boot() {
  [manifest, index] = await Promise.all([
    getJSON(`${DATA}/manifest.json`, { cache: "no-cache" }),
    getJSON(`${DATA}/search-index.json`, { cache: "no-cache" }),
  ]);
  for (const e of index) {
    e._n = norm(e.t);
    byKey.set(`${e.k}:${e.id}`, e);
  }
  applyStyle();
  if (state.view === "home") renderHome();

  const sel = new URLSearchParams(location.hash.slice(1)).get("sel");
  if (sel) {
    const [kind, ...rest] = sel.split(":");
    const id = rest.join(":");
    const fly = !hasHash;
    if (kind === "pt") {
      const [lng, lat, ...name] = id.split(",");
      select({ kind: "place", id: sel, title: name.join(",") || "Dropped Pin",
        sub: `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`, point: [Number(lng), Number(lat)] }, { fly, recent: false });
    } else if (kind === "pc_unit" || byKey.has(`${kind}:${id}`)) {
      map.once("idle", () => select({ kind, id }, { fly, recent: false }));
    }
  }
}
boot().catch((err) => {
  console.error(err);
  toast("Couldn't load map data");
});
