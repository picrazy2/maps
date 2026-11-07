#!/usr/bin/env python3
"""Snap TfL line patterns to OSM track and write public/tfl/data/network.json.

Inputs (pipeline/raw/tfl, gitignored):
  api/          TfL Route/Sequence responses, from fetch_tfl.py
  rail.osm.pbf  OSM rail ways and route relations for the Oyster area

Every pair of consecutive stops on a line is a "ride". Each ride is routed over the OSM
track graph, preferring ways in that line's own route relation. Rides are undirected, and
ways already used by another ride get a small discount, so both directions and parallel
services converge on one strand. That shared strand is what lets the map thicken with use.
"""
import heapq, json, math, re, sys
from collections import defaultdict
from pathlib import Path

import osmium
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "pipeline/raw/tfl"
OUT = ROOT / "public/tfl/data/network.json"

# Generous box around the Oyster and contactless area: Reading to Southend, Gatwick to Stansted.
W, S, E, N = -1.15, 50.95, 0.95, 52.1
# Heathrow Express does not accept Oyster, so no Oyster journey can have used it.
SKIP_LINES = {"scotrail", "merseyrail", "island-line", "transport-for-wales", "northern-rail", "heathrow-express"}
COLORS = {
    "bakerloo": "#a45a2a", "central": "#da291c", "circle": "#ffcd00", "district": "#007a33",
    "hammersmith-city": "#e89cae", "jubilee": "#7c878e", "metropolitan": "#840b55",
    "northern": "#1c1c1e", "piccadilly": "#10069f", "victoria": "#00a3e0", "waterloo-city": "#6eceb2",
    "elizabeth": "#6950a1", "dlr": "#00afad", "tram": "#5fb526", "liberty": "#676767",
    "lioness": "#f1b41c", "mildmay": "#437ec1", "suffragette": "#39b97a", "weaver": "#972861",
    "windrush": "#ef4d5e",
}
NR_COLOR = "#5b6472"
SPEED_KMH = {"tube": 33, "dlr": 30, "overground": 40, "elizabeth-line": 55, "tram": 22, "national-rail": 58}
# Name fragments that tie an OSM route relation to a TfL line id.
RELATION_MATCH = {
    "bakerloo": "bakerloo", "central": "central line", "circle": "circle line", "district": "district line",
    "hammersmith-city": "hammersmith", "jubilee": "jubilee", "metropolitan": "metropolitan line",
    "northern": "northern line", "piccadilly": "piccadilly", "victoria": "victoria line",
    "waterloo-city": "waterloo", "elizabeth": "elizabeth", "dlr": "docklands|dlr", "tram": "tramlink|london trams",
    "liberty": "liberty", "lioness": "lioness", "mildmay": "mildmay", "suffragette": "suffragette",
    "weaver": "weaver", "windrush": "windrush", "thameslink": "thameslink", "southern": "southern",
    "southeastern": "southeastern", "great-northern": "great northern", "south-western-railway": "south western",
    "c2c": "c2c", "greater-anglia": "greater anglia", "great-western-railway": "great western|gwr",
    "chiltern-railways": "chiltern", "gatwick-express": "gatwick express", "heathrow-express": "heathrow express",
    "avanti-west-coast": "avanti", "london-north-eastern-railway": "london north eastern|lner",
    "east-midlands-railway": "east midlands", "west-midlands-trains": "west midlands|london northwestern",
}


def metres(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540)


def load_osm():
    ways, way_lines = {}, defaultdict(set)
    fp = osmium.FileProcessor(str(RAW / "rail.osm.pbf")).with_locations()
    for o in fp:
        if o.is_way():
            kind = o.tags.get("railway")
            if kind not in {"rail", "subway", "light_rail", "tram", "narrow_gauge"}:
                continue
            pts = [(n.ref, n.lon, n.lat) for n in o.nodes if n.location.valid()]
            if len(pts) > 1:
                ways[o.id] = dict(
                    kind=kind, service=o.tags.get("service", ""), usage=o.tags.get("usage", ""),
                    pts=pts,
                )
        elif o.is_relation():
            text = " ".join(o.tags.get(k, "") for k in ("name", "network", "operator", "ref")).lower()
            hits = [lid for lid, pat in RELATION_MATCH.items() if re.search(pat, text)]
            for m in o.members:
                if m.type == "w":
                    way_lines[m.ref].update(hits)
    return ways, way_lines


def build_graph(ways, way_lines):
    coord, adj = {}, defaultdict(list)
    for wid, w in ways.items():
        lines = frozenset(way_lines.get(wid, ()))
        for (a, ax, ay), (b, bx, by) in zip(w["pts"], w["pts"][1:]):
            coord[a], coord[b] = (ax, ay), (bx, by)
            d = metres((ax, ay), (bx, by))
            info = (w["kind"], w["service"], w["usage"], lines)
            adj[a].append((b, d, info))
            adj[b].append((a, d, info))
    return coord, adj


class Grid:
    """Coarse spatial index over graph nodes (about 1 km cells)."""
    def __init__(self, coord):
        self.cells, self.coord = defaultdict(list), coord
        for n, (x, y) in coord.items():
            self.cells[(int(x * 70), int(y * 110))].append(n)

    def near(self, x, y, radius):
        cx, cy, r = int(x * 70), int(y * 110), int(radius / 1000) + 1
        out = []
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for n in self.cells.get((i, j), ()):
                    d = metres((x, y), self.coord[n])
                    if d <= radius:
                        out.append((n, d))
        return out


def factor(line, mode, info, used):
    kind, service, usage, lines = info
    f = 0.6 if line in lines else (1.15 if lines else 1.3)
    if mode == "tube":
        f *= {"subway": 1, "rail": 1.2}.get(kind, 6)
    elif mode == "dlr":
        f *= {"light_rail": 1}.get(kind, 6)
    elif mode == "tram":
        f *= {"tram": 1}.get(kind, 6)
    else:
        f *= {"rail": 1}.get(kind, 6)
    if service in {"yard", "siding", "spur"}:
        f *= 5
    elif service == "crossover":
        f *= 2
    if usage == "freight":
        f *= 2
    return f * (0.88 if used else 1)


def route(adj, coord, sources, targets, line, mode, used, limit):
    """Multi-source Dijkstra. Station offsets cost double, so paths start close to the platform."""
    target_cost = {n: d * 2 for n, d in targets}
    dist, prev, heap = {}, {}, []
    for n, d in sources:
        c = d * 2
        if c < dist.get(n, math.inf):
            dist[n] = c
            heapq.heappush(heap, (c, n))
    best, best_node = math.inf, None
    while heap:
        c, n = heapq.heappop(heap)
        if c > dist.get(n, math.inf):
            continue
        if c >= best or c > limit:
            break
        if n in target_cost and c + target_cost[n] < best:
            best, best_node = c + target_cost[n], n
        for m, d, info in adj[n]:
            key = (n, m) if n < m else (m, n)
            nc = c + d * factor(line, mode, info, key in used)
            if nc < dist.get(m, math.inf):
                dist[m], prev[m] = nc, n
                heapq.heappush(heap, (nc, m))
    if best_node is None:
        return None
    path = [best_node]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    return path[::-1]


def load_lines():
    stops, lines, rides = {}, {}, {}
    meta = json.loads((RAW / "api/lines.json").read_text())
    parents = {}
    for l in meta:
        if l["id"] in SKIP_LINES:
            continue
        for direction in ("outbound", "inbound"):
            f = RAW / f"api/{l['id']}.{direction}.json"
            if not f.exists():
                continue
            d = json.loads(f.read_text())
            # Route patterns list platform-level ids, which only stopPointSequences has;
            # "stations" often holds the HUB id instead.
            for seq in d.get("stopPointSequences", []):
                for sp in seq.get("stopPoint", []):
                    parents[sp["id"]] = sp.get("topMostParentId") or sp.get("parentId") or sp["id"]
                    if W <= sp["lon"] <= E and S <= sp["lat"] <= N:
                        stops.setdefault(sp["id"], dict(
                            id=sp["id"], name=sp["name"], lat=sp["lat"], lon=sp["lon"],
                            zone=sp.get("zone", ""), modes=set(),
                        ))["modes"].add(l["mode"])
            for r in d.get("orderedLineRoutes", []):
                ids = r.get("naptanIds", [])
                for a, b in zip(ids, ids[1:]):
                    if a in stops and b in stops and a != b:
                        rides[(l["id"], *sorted((a, b)))] = l["mode"]
        if any(k[0] == l["id"] for k in rides):
            lines[l["id"]] = l
    for sid, s in stops.items():
        s["hub"] = parents.get(sid, sid)
    return stops, lines, rides


def clean_name(n):
    n = re.sub(r"\s+(Underground|Rail|DLR|Tram|Elizabeth line|Overground)?\s*(Station|Stop)\s*$", "", n)
    return n.strip()


def merge_hubs(stops):
    """TfL leaves some interchanges unlinked. Merge same-named stops within 500 m."""
    by_name = defaultdict(list)
    for s in stops.values():
        by_name[clean_name(s["name"]).replace("London ", "")].append(s)
    for group in by_name.values():
        for a in group:
            for b in group:
                if a["hub"] != b["hub"] and metres((a["lon"], a["lat"]), (b["lon"], b["lat"])) < 500:
                    old, new = b["hub"], a["hub"]
                    for s in stops.values():
                        if s["hub"] == old:
                            s["hub"] = new


def main():
    ways, way_lines = load_osm()
    coord, adj = build_graph(ways, way_lines)
    grid = Grid(coord)
    stops, lines, rides = load_lines()
    merge_hubs(stops)
    print(f"{len(ways)} ways, {len(coord)} nodes, {len(stops)} stops, {len(lines)} lines, {len(rides)} rides", flush=True)

    # Short rides first, so long express rides reuse the track the stopping services settled on.
    order = sorted(rides, key=lambda k: metres(
        (stops[k[1]]["lon"], stops[k[1]]["lat"]), (stops[k[2]]["lon"], stops[k[2]]["lat"])))
    used, paths, straight = set(), {}, []
    for key in order:
        line, a, b = key
        mode = rides[key]
        sa, sb = stops[a], stops[b]
        gap = metres((sa["lon"], sa["lat"]), (sb["lon"], sb["lat"]))
        path = None
        for radius in (250, 600):
            src, dst = grid.near(sa["lon"], sa["lat"], radius), grid.near(sb["lon"], sb["lat"], radius)
            if src and dst:
                path = route(adj, coord, src, dst, line, mode, used, gap * 4 + 4000)
                if path:
                    break
        if not path or len(path) < 2:
            straight.append(key)
            continue
        paths[key] = path
        for p, q in zip(path, path[1:]):
            used.add((p, q) if p < q else (q, p))
    print(f"snapped {len(paths)}, straight fallback {len(straight)}", flush=True)

    # Split into shared segments at path ends and at junctions in the used network.
    neighbours = defaultdict(set)
    breaks = set()
    for path in paths.values():
        breaks.update((path[0], path[-1]))
        for p, q in zip(path, path[1:]):
            neighbours[p].add(q)
            neighbours[q].add(p)
    breaks.update(n for n, s in neighbours.items() if len(s) != 2)

    seg_ids, seg_coords = {}, []

    def seg_id(nodes):
        fwd = tuple(nodes)
        rev = fwd[::-1]
        if fwd in seg_ids:
            return seg_ids[fwd]
        if rev in seg_ids:
            return seg_ids[rev]
        seg_ids[fwd] = len(seg_coords)
        line = LineString([coord[n] for n in nodes]).simplify(0.00004)
        seg_coords.append([[round(x * 1e5), round(y * 1e5)] for x, y in line.coords])
        return seg_ids[fwd]

    stop_list = sorted(stops.values(), key=lambda s: s["id"])
    stop_idx = {s["id"]: i for i, s in enumerate(stop_list)}
    line_list = sorted(lines.values(), key=lambda l: l["id"])
    line_idx = {l["id"]: i for i, l in enumerate(line_list)}

    out_rides = []
    for key, mode in rides.items():
        line, a, b = key
        sa, sb = stops[a], stops[b]
        segs, km = [], metres((sa["lon"], sa["lat"]), (sb["lon"], sb["lat"])) / 1000 * 1.1
        path = paths.get(key)
        if path:
            km = sum(metres(coord[p], coord[q]) for p, q in zip(path, path[1:])) / 1000
            cut = [i for i, n in enumerate(path) if n in breaks or i in (0, len(path) - 1)]
            segs = [seg_id(path[i:j + 1]) for i, j in zip(cut, cut[1:])]
        minutes = km / SPEED_KMH[mode] * 60 + (1.0 if mode == "national-rail" else 0.6)
        out_rides.append([line_idx[line], stop_idx[a], stop_idx[b], round(minutes, 1), round(km, 2), segs])

    def encode(c):
        out, px, py = [], 0, 0
        for x, y in c:
            out += [x - px, y - py]
            px, py = x, y
        return out

    network = dict(
        lines=[dict(id=l["id"], name=l["name"], mode=l["mode"], color=COLORS.get(l["id"], NR_COLOR)) for l in line_list],
        stops=[dict(id=s["id"], name=clean_name(s["name"]), hub=s["hub"], lat=round(s["lat"], 5), lon=round(s["lon"], 5),
                    zone=s["zone"], modes=sorted(s["modes"])) for s in stop_list],
        rides=out_rides,
        segs=[encode(c) for c in seg_coords],
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(network, separators=(",", ":")))
    print(f"{len(seg_coords)} segments, {OUT.stat().st_size / 1e6:.1f} MB", flush=True)
    for key in straight[:30]:
        print("  straight:", key[0], stops[key[1]]["name"], "-", stops[key[2]]["name"], file=sys.stderr)


if __name__ == "__main__":
    main()
