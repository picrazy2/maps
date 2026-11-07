// Journey parsing, route inference and aggregation. Runs in the browser and in node
// (pipeline/tfl/publish.mjs), so it must stay free of DOM and network access.

const norm = (s) => s.toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[()'.,]/g, " ")
  .replace(/\b(underground|rail|dlr|tram|station|stop)\b/g, " ")
  .replace(/^\s*london\s+/, "")
  .replace(/\s+/g, " ")
  .trim();

// Oyster's names where they differ from TfL's own stop names.
const ALIASES = {
  "heathrow t 2 and 3": "heathrow terminals 2 and 3",
  "heathrow terminals 123": "heathrow terminals 2 and 3",
  "heathrow t4": "heathrow terminal 4",
  "heathrow t5": "heathrow terminal 5",
  "kings cross": "king s cross",
  "kings cross st pancras": "king s cross st pancras",
  "st james park": "st james s park",
  "shepherds bush": "shepherd s bush",
};

const HINTS = [
  [/national rail/i, ["national-rail", "overground", "elizabeth-line"]],
  [/london underground/i, ["tube"]],
  [/elizabeth line/i, ["elizabeth-line", "national-rail"]],
  [/overground/i, ["overground", "national-rail"]],
  [/dlr/i, ["dlr"]],
  [/tram/i, ["tram"]],
];

export function buildNetwork(raw) {
  const net = {
    lines: raw.lines,
    stops: raw.stops,
    segs: raw.segs.map((d) => {
      const out = [];
      let x = 0, y = 0;
      for (let i = 0; i < d.length; i += 2) {
        x += d[i];
        y += d[i + 1];
        out.push([x / 1e5, y / 1e5]);
      }
      return out;
    }),
    rides: raw.rides.map(([line, a, b, minutes, km, segs]) => ({ line, a, b, minutes, km, segs })),
    adj: raw.stops.map(() => []),
    hubs: new Map(),
    names: new Map(),
  };
  net.rides.forEach((r, i) => {
    net.adj[r.a].push({ to: r.b, line: r.line, ride: i });
    net.adj[r.b].push({ to: r.a, line: r.line, ride: i });
  });
  raw.stops.forEach((s, i) => {
    if (!net.hubs.has(s.hub)) net.hubs.set(s.hub, { id: s.hub, name: s.name, stops: [], lat: s.lat, lon: s.lon });
    net.hubs.get(s.hub).stops.push(i);
    net.names.set(norm(s.name), s.hub);
  });
  return net;
}

export function resolveStation(net, label) {
  const hint = label.match(/\[(.*)\]/)?.[1];
  const key = norm(label.replace(/\[.*\]/, ""));
  const name = ALIASES[key] ?? key;
  let hub = net.names.get(name);
  if (!hub) {
    for (const [n, h] of net.names) {
      if (n.startsWith(`${name} `)) { hub = h; break; }
    }
  }
  const modes = hint ? [...new Set(HINTS.flatMap(([re, m]) => (re.test(hint) ? m : [])))] : null;
  return { hub: hub ?? null, modes: modes?.length ? modes : null, label: label.replace(/\s*\[.*\]/, "").trim() };
}

const clock = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const pence = (s) => Math.round(parseFloat((s ?? "0").replace(/[^0-9.]/g, "") || 0) * 100);
const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

// Takes the journey table as "cell | cell | cell" lines and returns journeys oldest first.
export function parseRows(text) {
  const out = [];
  let date = null, cur = null;
  const finish = () => {
    if (!cur) return;
    cur.touches.reverse();
    out.push(cur);
    cur = null;
  };
  for (const line of text.split("\n")) {
    const cells = line.split(" | ").map((c) => c.trim());
    if (cells.length < 2) continue;
    const day = cells[0].match(/^\w+, (\d{2}) (\w+) (\d{4})/);
    if (day) {
      finish();
      date = `${day[3]}-${String(MONTHS[day[2]]).padStart(2, "0")}-${day[1]}`;
      continue;
    }
    const span = cells[0].match(/^(\d\d:\d\d)\s*-\s*(\d\d:\d\d|--)?/);
    if (span && cells[1].includes(" to ")) {
      finish();
      const capped = /capped/i.test(cells[1]);
      const route = cells[1].replace(/^.*?capped fare\s*/i, "");
      const [from, to] = route.split(" to ");
      cur = { id: `${date}T${span[1]}`, kind: "rail", date, start: span[1], end: span[2] && span[2] !== "--" ? span[2] : null,
        from: from.trim(), to: to.trim(), fare: pence(cells[2]), capped, touches: [] };
      continue;
    }
    const time = cells[0].match(/^\d\d:\d\d$/)?.[0];
    if (!time) continue;
    const bus = cells[1].match(/^Bus journey, route (.+)$/);
    if (bus) {
      finish();
      out.push({ id: `${date}T${time}B`, kind: "bus", date, start: time, route: bus[1], fare: pence(cells[2]) });
      continue;
    }
    const touch = cells[1].match(/^Touch (in|out), (.+)$/);
    if (touch && cur) cur.touches.push({ t: time, type: touch[1], station: touch[2] });
  }
  finish();
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Touch pairs split one charged journey into the trains actually taken. A touch out and back in
// between two services is a real interchange, so it pins the route to that station.
export function legsOf(net, j) {
  const pairs = [];
  let open = null;
  for (const t of j.touches ?? []) {
    if (t.type === "in") open = t;
    else if (open) { pairs.push([open, t]); open = null; }
  }
  const raw = pairs.length
    ? pairs.map(([a, b]) => ({ from: a.station, to: b.station, start: a.t, end: b.t }))
    : [{ from: j.from, to: j.to, start: j.start, end: j.end }];
  return raw.map((l) => {
    const from = resolveStation(net, l.from), to = resolveStation(net, l.to);
    let observed = l.end ? clock(l.end) - clock(l.start) : null;
    if (observed !== null && observed < 0) observed += 1440;
    return { ...l, from, to, observed };
  }).filter((l) => !l.from.hub || !l.to.hub || l.from.hub !== l.to.hub);
}

const TRANSFER = 6, BOARD = 2, ACCESS = 6;

function toRoute(net, result) {
  const legs = [];
  for (let i = 1; i < result.path.length; i++) {
    const [s, line] = result.path[i].split("|").map(Number);
    const step = result.prev.get(result.path[i]);
    if (step.ride === null) continue;
    const r = net.rides[step.ride];
    const fromStop = r.a === s ? r.b : r.a;
    let leg = legs[legs.length - 1];
    if (!leg || leg.line !== line) {
      leg = { line, mode: net.lines[line].mode, stops: [fromStop], rides: [] };
      legs.push(leg);
    }
    leg.stops.push(s);
    leg.rides.push(step.ride);
  }
  return decorate(net, legs);
}

function decorate(net, legs) {
  const rides = legs.flatMap((l) => l.rides);
  const minutes = rides.reduce((a, r) => a + net.rides[r].minutes, 0) + TRANSFER * Math.max(0, legs.length - 1);
  const km = rides.reduce((a, r) => a + net.rides[r].km, 0);
  return { legs, minutes, km, sig: legs.map((l) => net.lines[l.line].id).join(">"), transfers: legs.length - 1 };
}

// Up to `k` distinct line sequences between two hubs, found by penalising lines already used.
export function candidates(net, fromHub, toHub, fromModes, toModes, k = 5) {
  const penalty = new Map(), seen = new Map();
  for (let i = 0; i < k + 3 && seen.size < k; i++) {
    const res = dijkstra(net, fromHub, toHub, fromModes, toModes, penalty);
    if (!res) break;
    const route = toRoute(net, res);
    if (route.legs.length && !seen.has(route.sig)) seen.set(route.sig, route);
    for (const l of route.legs) penalty.set(l.line, (penalty.get(l.line) ?? 1) * 1.6);
  }
  return [...seen.values()];
}

function dijkstra(net, fromHub, toHub, fromModes, toModes, penalty) {
  const allowed = (i, modes) => !modes || net.stops[i].modes.some((m) => modes.includes(m));
  const lineAllowed = (ln, modes) => !modes || modes.includes(net.lines[ln].mode);
  const goal = new Set(net.hubs.get(toHub).stops.filter((i) => allowed(i, toModes)));
  const dist = new Map(), prev = new Map(), heap = [];
  const up = () => {
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const relax = (key, cost, from) => {
    if (cost < (dist.get(key) ?? Infinity)) {
      dist.set(key, cost);
      prev.set(key, from);
      heap.push([cost, key]);
      up();
    }
  };
  for (const s of net.hubs.get(fromHub).stops) {
    if (!allowed(s, fromModes)) continue;
    for (const e of net.adj[s]) {
      if (lineAllowed(e.line, fromModes)) relax(`${s}|${e.line}`, BOARD, null);
    }
  }
  while (heap.length) {
    const [cost, key] = pop();
    if (cost > dist.get(key)) continue;
    const [s, line] = key.split("|").map(Number);
    if (goal.has(s) && lineAllowed(line, toModes)) {
      const path = [];
      let k = key;
      while (k) {
        path.push(k);
        k = prev.get(k)?.key ?? null;
      }
      return { path: path.reverse(), prev };
    }
    for (const e of net.adj[s]) {
      if (e.line !== line) continue;
      relax(`${e.to}|${line}`, cost + net.rides[e.ride].minutes * (penalty.get(line) ?? 1), { key, ride: e.ride });
    }
    // No change of line before the first ride, or it would dodge the touch-in's mode hint.
    if (prev.get(key) === null) continue;
    for (const t of net.hubs.get(net.stops[s].hub).stops) {
      for (const e of net.adj[t]) {
        if (e.line !== line) relax(`${t}|${e.line}`, cost + TRANSFER, { key, ride: null });
      }
    }
  }
  return null;
}

// Touch times include walking and waiting, so a route faster than the trip is normal and costs
// little, while one slower than the trip is close to impossible. Changes are the tie-breaker.
function score(route, observed) {
  const fit = observed === null ? 0
    : Math.max(0, route.minutes - observed) * 2 + Math.max(0, observed - route.minutes - ACCESS) * 0.35;
  // TfL services get a slight edge where a TOC has a rare call at the same stations, because
  // Oyster riders nearly always mean the regular service.
  const toc = route.legs.filter((l) => l.mode === "national-rail").length;
  return fit + route.transfers * 5 + route.minutes * 0.1 + toc * 2.5;
}

export const odKey = (leg) => `${leg.from.hub}|${leg.to.hub}`;
export const legKey = (journeyId, i) => `${journeyId}#${i}`;

// Routes for one leg: options ranked by fit against the touch times, plus the chosen one.
// `overrides` maps "journey#leg" or "fromHub|toHub" to { sig } or { via: [hubId] }.
export function routeLeg(net, leg, key, overrides = {}, cache = new Map()) {
  if (!leg.from.hub || !leg.to.hub) return { options: [], chosen: null, source: "unmatched" };
  // Only the touch-in constrains the line. Exit gates at a shared station say nothing about the
  // train: Underground riders can often leave through the National Rail gateline.
  const cacheKey = `${odKey(leg)}|${leg.from.modes}`;
  if (!cache.has(cacheKey)) cache.set(cacheKey, candidates(net, leg.from.hub, leg.to.hub, leg.from.modes, null));
  const options = [...cache.get(cacheKey)].sort((a, b) => score(a, leg.observed) - score(b, leg.observed));
  const ov = overrides[key] ?? overrides[odKey(leg)];
  let chosen = options[0] ?? null, source = "inferred";
  if (ov?.sig) {
    const hit = options.find((o) => o.sig === ov.sig);
    if (hit) { chosen = hit; source = "manual"; }
  } else if (ov?.via?.length) {
    const hubs = [leg.from.hub, ...ov.via, leg.to.hub];
    const parts = [];
    for (let i = 0; i + 1 < hubs.length; i++) {
      const part = candidates(net, hubs[i], hubs[i + 1], i === 0 ? leg.from.modes : null, null, 1)[0];
      if (!part) { parts.length = 0; break; }
      parts.push(part);
    }
    if (parts.length) {
      chosen = decorate(net, parts.flatMap((p) => p.legs));
      source = "manual";
    }
  }
  return { options, chosen, source };
}

// Public aggregate. No journey times or dates finer than a week.
export function summarize(net, journeys, overrides = {}) {
  const cache = new Map();
  const segs = new Map(), lines = new Map(), stations = new Map(), weeks = new Map();
  const totals = { journeys: 0, trains: 0, km: 0, minutes: 0, spend: 0, bus: 0, unmatched: 0 };
  const visit = (hub, label) => {
    if (!hub) return;
    const h = net.hubs.get(hub);
    const s = stations.get(hub) ?? { hub, name: h?.name ?? label, lat: h?.lat, lon: h?.lon, visits: 0 };
    s.visits++;
    stations.set(hub, s);
  };
  for (const j of journeys) {
    totals.spend += j.fare ?? 0;
    const week = weekOf(j.date);
    if (j.kind === "bus") {
      totals.bus++;
      continue;
    }
    totals.journeys++;
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
    legsOf(net, j).forEach((leg, i) => {
      visit(leg.from.hub, leg.from.label);
      visit(leg.to.hub, leg.to.label);
      const { chosen } = routeLeg(net, leg, legKey(j.id, i), overrides, cache);
      if (!chosen) {
        totals.unmatched++;
        return;
      }
      totals.minutes += leg.observed ?? chosen.minutes;
      totals.km += chosen.km;
      for (const l of chosen.legs) {
        totals.trains++;
        const stat = lines.get(l.line) ?? { line: l.line, trips: 0, km: 0 };
        stat.trips++;
        for (const rideIdx of l.rides) {
          const ride = net.rides[rideIdx];
          stat.km += ride.km;
          for (const s of ride.segs) {
            const seg = segs.get(s) ?? { n: 0, by: new Map() };
            seg.n++;
            seg.by.set(l.line, (seg.by.get(l.line) ?? 0) + 1);
            segs.set(s, seg);
          }
        }
        lines.set(l.line, stat);
      }
    });
  }
  const dated = journeys.map((j) => j.date).sort();
  return {
    v: 1,
    weekFrom: dated.length ? weekOf(dated[0]) : null,
    weekTo: dated.length ? weekOf(dated[dated.length - 1]) : null,
    totals: { ...totals, km: Math.round(totals.km), minutes: Math.round(totals.minutes) },
    segs: [...segs].map(([id, s]) => [id, s.n, [...s.by].sort((a, b) => b[1] - a[1])[0][0]]),
    lines: [...lines.values()].map((l) => ({ line: l.line, trips: l.trips, km: Math.round(l.km * 10) / 10 })).sort((a, b) => b.trips - a.trips),
    stations: [...stations.values()].sort((a, b) => b.visits - a.visits),
    weeks: [...weeks].sort(),
  };
}

// Monday of the journey's week, as an ISO date.
export function weekOf(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
