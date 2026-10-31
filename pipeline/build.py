"""Build the London map layers.

Inputs (pipeline/raw/, gitignored; see pipeline/README.md for sources):
  wards_london.geojson   ONS Wards (Dec 2024) BGC, London boroughs only
  lads_region.geojson    ONS Local Authority Districts (Dec 2024) BGC around London
  codepoint/Data/CSV/*.csv  OS Code-Point Open postcode centroids
  oa_population.geojson  Census 2021 Output Areas (London) with usual residents
  oa_2021_england.geojson  ONS OA (2021) boundaries; only the OA → LSOA code/name lookup is used
  msoa_names.csv         House of Commons Library MSOA names (msoa21cd, msoa21nm, msoa21hclnm)

Outputs (pipeline/out/): one GeoJSON per layer plus label points, then
tiles.sh turns them into PMTiles under public/london/data/.

Postcode polygons are Voronoi cells around each postcode centroid, clipped to land
(the generalised LAD boundaries, so the tidal Thames is excluded), then dissolved
upward into sectors (E1 6), districts (E1) and areas (E).
"""

import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import MultiPoint

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)
BNG = "EPSG:27700"
WGS = "EPSG:4326"

OA_POP = Path(sys.argv[1]) if len(sys.argv) > 1 else RAW / "oa_population.geojson"

# London Government Act 1963 inner boroughs (the statutory definition).
INNER = {
    "Camden", "City of London", "Greenwich", "Hackney", "Hammersmith and Fulham",
    "Islington", "Kensington and Chelsea", "Lambeth", "Lewisham", "Southwark",
    "Tower Hamlets", "Wandsworth", "Westminster",
}

AREA_NAMES = {
    "AL": "St Albans", "BR": "Bromley", "CM": "Chelmsford", "CR": "Croydon",
    "DA": "Dartford", "E": "London E", "EC": "London EC", "EN": "Enfield",
    "GU": "Guildford", "HA": "Harrow", "HP": "Hemel Hempstead", "IG": "Ilford",
    "KT": "Kingston upon Thames", "ME": "Medway", "N": "London N", "NW": "London NW",
    "RH": "Redhill", "RM": "Romford", "SE": "London SE", "SL": "Slough",
    "SM": "Sutton", "SS": "Southend-on-Sea", "SW": "London SW", "TN": "Tonbridge",
    "TW": "Twickenham", "UB": "Southall", "W": "London W", "WC": "London WC",
    "WD": "Watford",
}


def log(msg):
    print(msg, flush=True)


def km2(g):
    return round(g.area / 1e6, 3)


def write(gdf, name, cols):
    gdf = gdf[cols + ["geometry"]].to_crs(WGS)
    gdf.to_file(OUT / f"{name}.geojson", driver="GeoJSON", COORDINATE_PRECISION=6)
    # Label anchor: a point guaranteed inside the polygon, for symbol layers.
    lab = gdf.copy()
    lab["geometry"] = shapely.point_on_surface(
        shapely.make_valid(lab.geometry.to_crs(BNG).values)
    )
    lab = lab.set_crs(BNG, allow_override=True).to_crs(WGS)
    lab.to_file(OUT / f"{name}_labels.geojson", driver="GeoJSON", COORDINATE_PRECISION=6)
    print(f"{name}: {len(gdf)} features")


def pop_join(polys, oa, key):
    """Census residents apportioned by area share of each Output Area. Centroid
    assignment leaves tiny units (City of London wards) with zero."""
    a = polys[[key, "geometry"]].rename(columns={key: "_k"})
    inter = gpd.overlay(oa[["population", "oa_area", "geometry"]], a, how="intersection", keep_geom_type=True)
    inter["w"] = inter.population * inter.area / inter.oa_area
    return inter.groupby("_k")["w"].sum().round().astype(int)


def overlaps(polys, key, other, okey, min_share=0.05):
    """For each poly, the `other` names covering >= min_share of its area, largest first."""
    a = polys[[key, "geometry"]].rename(columns={key: "_a"})
    b = other[[okey, "geometry"]].rename(columns={okey: "_b"})
    inter = gpd.overlay(a, b, how="intersection", keep_geom_type=True)
    inter["area"] = inter.area
    tot = inter.groupby("_a")["area"].transform("sum")
    inter = inter[inter["area"] / tot >= min_share].sort_values("area", ascending=False)
    return inter.groupby("_a")["_b"].agg(lambda s: ", ".join(dict.fromkeys(s)))


# ── Admin boundaries ──────────────────────────────────────────────────────────
wards = gpd.read_file(RAW / "wards_london.geojson").to_crs(BNG)
wards["geometry"] = shapely.make_valid(wards.geometry.values)
lads = gpd.read_file(RAW / "lads_region.geojson").to_crs(BNG)
lads["geometry"] = shapely.make_valid(lads.geometry.values)

boroughs = lads[lads.LAD24CD.str.startswith("E09")].copy()
gla_geom = shapely.union_all(boroughs.geometry.values)
land = shapely.union_all(lads.geometry.values)

log("admin loaded")
oa = gpd.read_file(OA_POP).to_crs(BNG)
oa["geometry"] = shapely.make_valid(oa.geometry.values)
oa["oa_area"] = oa.area

wards["population"] = wards.WD24CD.map(pop_join(wards, oa, "WD24CD")).fillna(0).astype(int)
wards["area_km2"] = km2(wards.geometry)
wards = wards.rename(columns={"WD24CD": "code", "WD24NM": "name", "LAD24CD": "borough_code",
                              "LAD24NM": "borough"})

boroughs["population"] = boroughs.LAD24CD.map(pop_join(boroughs, oa, "LAD24CD")).fillna(0).astype(int)
boroughs["area_km2"] = km2(boroughs.geometry)
boroughs["wards"] = boroughs.LAD24CD.map(wards.groupby("borough_code").size()).fillna(0).astype(int)
boroughs = boroughs.rename(columns={"LAD24CD": "code", "LAD24NM": "name"})
boroughs["inner"] = boroughs.name.isin(INNER).astype(int)

gla = gpd.GeoDataFrame(
    {"name": ["Greater London"], "code": ["E12000007"],
     "population": [int(boroughs.population.sum())], "area_km2": [round(gla_geom.area / 1e6, 1)],
     "boroughs": [len(boroughs)], "wards": [len(wards)]},
    geometry=[gla_geom], crs=BNG)

# ── Census 2021 output geographies: OA → LSOA → MSOA (they nest exactly) ───────
look = gpd.read_file(RAW / "oa_2021_england.geojson", ignore_geometry=True,
                     columns=["OA21CD", "LSOA21CD", "LSOA21NM"])
hcl = pd.read_csv(RAW / "msoa_names.csv", encoding="utf-8-sig")
oas = oa.merge(look, on="OA21CD")
oas["lad"] = oas.LSOA21NM.str.rsplit(" ", n=1).str[0]
oas = oas[oas.lad.isin(set(boroughs.name))].copy()
oas["msoa_nm"] = oas.LSOA21NM.str[:-1]
oas = oas.merge(hcl[["msoa21cd", "msoa21nm", "msoa21hclnm"]], left_on="msoa_nm", right_on="msoa21nm", how="left")
oas = gpd.GeoDataFrame(oas, geometry="geometry", crs=BNG)
b_code = dict(zip(boroughs.name, boroughs.code))
oas["code"] = oas.OA21CD
oas["lsoa"] = oas.LSOA21CD
oas["area_km2"] = km2(oas.geometry)
log(f"census: {len(oas)} OAs, {oas.msoa21cd.isna().sum()} without an MSOA match")


def census_dissolve(key, extra):
    g = oas.dissolve(by=key, method="coverage", aggfunc={"population": "sum", "OA21CD": "count", **extra})
    g = g.reset_index().rename(columns={key: "code", "OA21CD": "oas"})
    g["geometry"] = shapely.make_valid(g.geometry.values)
    g["area_km2"] = km2(g.geometry)
    g["borough_code"] = g.lad.map(b_code)
    return g


lsoas = census_dissolve("LSOA21CD", {"LSOA21NM": "first", "msoa21cd": "first", "msoa21hclnm": "first", "lad": "first"})
lsoas = lsoas.rename(columns={"LSOA21NM": "name", "msoa21cd": "msoa", "msoa21hclnm": "msoa_name", "lad": "borough"})
msoas = census_dissolve("msoa21cd", {"msoa21nm": "first", "msoa21hclnm": "first", "lad": "first", "LSOA21CD": "nunique"})
msoas = msoas.rename(columns={"msoa21hclnm": "name", "msoa21nm": "ons_name", "lad": "borough", "LSOA21CD": "lsoas"})
log(f"census: {len(lsoas)} LSOAs, {len(msoas)} MSOAs")

# ── Postcodes ─────────────────────────────────────────────────────────────────
csvs = sorted((RAW / "codepoint").rglob("Data/CSV/*.csv"))
cols = ["pc", "pqi", "e", "n", "country", "nhs_r", "nhs_ha", "county", "district", "ward"]
pcs = pd.concat([pd.read_csv(f, header=None, names=cols, usecols=[0, 1, 2, 3, 8]) for f in csvs])
pcs = pcs[(pcs.e > 0) & (pcs.n > 0)]
pcs["pc"] = pcs.pc.str.replace(r"\s+", "", regex=True)
pcs["out"] = pcs.pc.str[:-3]
pcs["inw"] = pcs.pc.str[-3:]
pcs["pc"] = pcs.out + " " + pcs.inw
pcs["sector"] = pcs.out + " " + pcs.inw.str[0]
pcs["area"] = pcs.out.str.extract(r"^([A-Z]+)")[0]

london_districts = set(pcs.loc[pcs.district.str.startswith("E09", na=False), "out"])
minx, miny, maxx, maxy = shapely.bounds(gla_geom)
pad = 8000
ctx = pcs[(pcs.e.between(minx - pad, maxx + pad)) & (pcs.n.between(miny - pad, maxy + pad))]
pts = pd.concat([pcs[pcs.out.isin(london_districts)], ctx]).drop_duplicates("pc")
log(f"postcodes: {len(pts)} points, {len(london_districts)} London districts")

# Postcodes sharing a coordinate share one Voronoi cell.
pts = pts.assign(xy=list(zip(pts.e, pts.n)))
uniq = np.unique(pts[["e", "n"]].to_numpy(dtype=float), axis=0)
x0, y0 = uniq.min(axis=0)
x1, y1 = uniq.max(axis=0)
env = shapely.box(x0 - 5000, y0 - 5000, x1 + 5000, y1 + 5000)
cells = list(shapely.voronoi_polygons(MultiPoint(uniq), extend_to=env, ordered=True).geoms)
cell_of = {tuple(xy): cell for xy, cell in zip(uniq, cells)}

pts["geometry"] = [cell_of[xy] for xy in pts.xy]
pts["xyk"] = pts.e.astype(str) + "," + pts.n.astype(str)
units = gpd.GeoDataFrame(pts.drop(columns=["xy"]), geometry="geometry", crs=BNG)
log("voronoi done")
# Clip to land, but only the cells that actually cross the coast / outer edge.
shapely.prepare(land)
geoms = units.geometry.values
inside = shapely.contains_properly(land, geoms)
cross = ~inside
geoms[cross] = shapely.intersection(geoms[cross], land)
units["geometry"] = geoms
units = units[~units.geometry.is_empty]
log(f"clipped {cross.sum()} edge cells")

keep = units[units.out.isin(london_districts)].copy()


def dissolve(df, key):
    # One cell per distinct location, so shared cells don't double up in the union.
    g = df.drop_duplicates("xyk").dissolve(by=key, method="coverage")[["geometry"]]
    g["postcodes"] = df.groupby(key).size()
    g = g.reset_index()
    g["geometry"] = shapely.make_valid(g.geometry.values)
    return g


# Unit layer: one feature per distinct cell; shared cells list every postcode.
cell_units = keep.sort_values("pc").copy()
cell_units["postcodes"] = cell_units.groupby("xyk")["pc"].transform(" · ".join)
cell_units = cell_units.drop_duplicates("xyk")
cell_units["code"] = cell_units.pc
cell_units["district"] = cell_units.out
cell_units["sector"] = cell_units.sector

log(f"{len(keep)} London-district units")
sectors = dissolve(keep, "sector")
log("sectors dissolved")
sectors["district"] = sectors.sector.str.split(" ").str[0]
districts = dissolve(keep, "out").rename(columns={"out": "code"})
areas = dissolve(keep, "area").rename(columns={"area": "code"})
sectors = sectors.rename(columns={"sector": "code"})

for g in (sectors, districts, areas):
    g["population"] = g.code.map(pop_join(g, oa, "code")).fillna(0).astype(int)
    g["area_km2"] = km2(g.geometry)
    g["in_london_pct"] = (shapely.area(shapely.intersection(g.geometry.values, gla_geom))
                          / g.geometry.area * 100).round().astype(int)

districts["boroughs"] = districts.code.map(overlaps(districts, "code", boroughs, "name")).fillna("")
sectors["boroughs"] = sectors.code.map(overlaps(sectors, "code", boroughs, "name")).fillna("")
districts["sectors"] = districts.code.map(sectors.groupby("district").size()).fillna(0).astype(int)
districts["area"] = districts.code.str.extract(r"^([A-Z]+)")[0]
areas["name"] = areas.code.map(AREA_NAMES).fillna(areas.code)
areas["districts"] = areas.code.map(districts.groupby("area").size()).fillna(0).astype(int)

wards["districts"] = wards.code.map(overlaps(wards, "code", districts, "code")).fillna("")
boroughs["districts"] = boroughs.code.map(overlaps(boroughs, "code", districts, "code", 0.01)).fillna("")

# ── Write tiles: geometry + code/name only. Stats live in the search index. ─────
for gdf, name in [(gla, "gla"), (boroughs, "boroughs"), (wards, "wards")]:
    write(gdf, name, ["code", "name"])
for gdf, name in [(areas, "pc_areas"), (districts, "pc_districts"), (sectors, "pc_sectors")]:
    write(gdf, name, ["code"])
write(msoas, "msoas", ["code", "name"])
write(lsoas, "lsoas", ["code", "name"])
# OAs aren't in the search index (26k of them), so their tiles carry the card stats.
write(oas, "oas", ["code", "lsoa", "population", "area_km2"])
cell_units["shared"] = np.where(cell_units.postcodes.str.contains("·"), cell_units.postcodes, "")
cell_units.to_crs(WGS)[["code", "shared", "geometry"]].to_file(
    OUT / "pc_units.geojson", driver="GeoJSON", COORDINATE_PRECISION=6)
print(f"pc_units: {len(cell_units)} cells")


# ── Search index (also the info-card database). Units resolve via postcodes.io. ─
def nat_key(code):
    m = re.match(r"([A-Z]+)(\d+)([A-Z]?)\s*(\d?)", code)
    return (m.group(1), int(m.group(2)), m.group(3), m.group(4)) if m else (code, 0, "", "")


def idx(gdf, kind, title, sub, props):
    w = gdf.to_crs(WGS)
    w = w.iloc[sorted(range(len(w)), key=lambda i: nat_key(str(w.code.iloc[i])))]
    b = w.geometry.bounds.round(5)
    c = shapely.point_on_surface(w.geometry.values)
    out = []
    for r, p, bb in zip(w.to_dict("records"), c, b.itertuples()):
        out.append({"k": kind, "id": r["code"], "t": title(r), "s": sub(r),
                    "c": [round(p.x, 5), round(p.y, 5)],
                    "b": [bb.minx, bb.miny, bb.maxx, bb.maxy],
                    "p": {k: (v.item() if hasattr(v, "item") else v) for k, v in r.items() if k in props}})
    return out


first = lambda s: s.split(",")[0] if s else ""
index = (
    idx(gla, "gla", lambda r: r["name"], lambda r: "Region", ["population", "area_km2", "boroughs", "wards"])
    + idx(boroughs, "borough", lambda r: r["name"],
          lambda r: "London borough" + (" · Inner London" if r["inner"] else " · Outer London"),
          ["population", "area_km2", "wards", "inner", "districts"])
    + idx(wards, "ward", lambda r: r["name"], lambda r: f"Ward · {r['borough']}",
          ["borough", "borough_code", "population", "area_km2", "districts"])
    + idx(areas, "pc_area", lambda r: r["code"], lambda r: f"Postcode area · {r['name']}",
          ["name", "postcodes", "districts", "population", "area_km2", "in_london_pct"])
    + idx(districts, "pc_district", lambda r: r["code"], lambda r: f"Postcode district · {first(r['boroughs'])}",
          ["area", "postcodes", "sectors", "population", "area_km2", "in_london_pct", "boroughs"])
    + idx(msoas, "msoa", lambda r: r["name"], lambda r: f"MSOA · {r['ons_name']} · {r['borough']}",
          ["ons_name", "borough", "borough_code", "population", "area_km2", "lsoas", "oas"])
    + idx(lsoas, "lsoa", lambda r: r["name"], lambda r: f"LSOA · {r['msoa_name']}",
          ["msoa", "borough_code", "population", "area_km2", "oas"])
    + idx(sectors, "pc_sector", lambda r: r["code"], lambda r: f"Postcode sector · {first(r['boroughs'])}",
          ["district", "postcodes", "population", "area_km2", "in_london_pct", "boroughs"])
)
(OUT / "search-index.json").write_text(json.dumps(index, separators=(",", ":")))
print(f"search index: {len(index)} entries")
