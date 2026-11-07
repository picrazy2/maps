# maps

Interactive maps, deployed to **maps.akguo.com** on Cloudflare Pages (auto-deploys from `main`).

## /london

Greater London with switchable, clickable boundary layers:

| Layer | Source |
|-------|--------|
| Greater London, boroughs | ONS Local Authority Districts, December 2024 (BGC) |
| Wards | ONS Wards, December 2024 (BGC) |
| Postcode areas / districts / sectors / units | Voronoi cells around OS Code-Point Open postcode centroids, clipped to land and dissolved upward. Approximate, not official boundaries. |
| Output Areas, LSOAs, MSOAs | ONS Census 2021 OAs, dissolved upward (they nest exactly); MSOA names from the [House of Commons Library](https://houseofcommonslibrary.github.io/msoanames/) |
| Residents | Census 2021 usual residents by Output Area, apportioned to other layers by area share |

Unit details (ward, constituency, LSOA and so on) come live from [postcodes.io](https://postcodes.io).
Place search uses Google Places Autocomplete (New) through `functions/london/api/places/*`, so
the key stays server-side.

Stack: no build step. `public/` is static (MapLibre GL from jsdelivr, OpenFreeMap basemaps,
Esri imagery for satellite); `functions/` are Pages Functions.

### Rebuilding the data

```bash
# inputs go in pipeline/raw/ (gitignored)
#  wards_london.geojson, lads_region.geojson   ONS ArcGIS FeatureServer queries (see build.py)
#  codepoint/                                  unzipped OS Code-Point Open (CSV)
#  oa_population.geojson                       Census 2021 OAs (London) with a `population` column
#  oa_2021_england.geojson                     ONS OA 2021 boundaries (for the OA → LSOA lookup)
#  msoa_names.csv                              HoCL MSOA names
python pipeline/build.py      # needs geopandas + shapely 2.1
bash pipeline/tiles.sh        # needs tippecanoe; writes public/london/data/
```

Tiles are static `z/x/y.pbf` directories rather than PMTiles because Pages doesn't serve byte
ranges. Missing tiles inside each tileset's bounds are written as empty files, so the map never
sees a 404.

## /tfl

Rail journeys from an Oyster card, snapped to OpenStreetMap track, with busier track drawn thicker.

| Data | Source | Where it lives |
|------|--------|----------------|
| Lines and stopping patterns | [TfL Unified API](https://api.tfl.gov.uk) `Line/{id}/Route/Sequence` | `public/tfl/data/network.json` (public) |
| Track geometry | OSM, via the Geofabrik England extract | `public/tfl/data/network.json` (public) |
| Public summary: counts by track, line, station and week, with no journey times | Computed from journeys | KV `TFL`, `GET /tfl/api/summary` |
| Journeys and route overrides | Oyster | KV `TFL`, behind `TFL_ADMIN_TOKEN` |

Raw journeys never go in this repo. `public/tfl/routing.js` parses journeys, infers routes and
builds the summary, and runs both in the browser and in node. Touch-in and touch-out pairs split a
charged journey into the trains actually taken; each is routed over TfL stopping patterns and
ranked by how well it fits the touch times. Edit a route under the Journeys tab after unlocking it
with the admin token.

### Getting journeys

Oyster has no JSON API: `oyster.tfl.gov.uk` is server-rendered, so `pipeline/tfl/oyster_extract.js`
reads the journey table. History goes back eight weeks, so a run at least that often loses nothing.

The website session can't support unattended collection. It expired within about 10 idle minutes
when measured, and signing in again then needed the password. So:

```bash
npm run tfl -- --login   # opens Chrome, sign in by hand, uploads and refreshes the summary
```

### Rebuilding the network

```bash
curl -LO --output-dir pipeline/raw/tfl https://download.geofabrik.de/europe/united-kingdom/england-latest.osm.pbf
cd pipeline/raw/tfl
osmium extract -b -1.15,50.95,0.95,52.1 england-latest.osm.pbf -o oyster_zone.osm.pbf
osmium tags-filter oyster_zone.osm.pbf w/railway=rail,subway,light_rail,tram,narrow_gauge r/route=train,subway,light_rail,tram -o rail.osm.pbf
python3 -m venv .venv && .venv/bin/pip install osmium shapely
cd ../../..
TFL_APP_KEY=... npm run tfl:network
```

### Local dev

```bash
printf "GOOGLE_MAPS_KEY=...\nTFL_ADMIN_TOKEN=...\n" > .dev.vars
npm run dev
```
