# maps

Interactive maps, deployed to **maps.akguo.com** on Cloudflare Pages (auto-deploys from `main`).

## /london

Greater London with switchable, clickable boundary layers:

| Layer | Source |
|-------|--------|
| Greater London, boroughs | ONS Local Authority Districts, December 2024 (BGC) |
| Wards | ONS Wards, December 2024 (BGC) |
| Postcode areas / districts / sectors / units | Voronoi cells around OS Code-Point Open postcode centroids, clipped to land and dissolved upward. Approximate, not official boundaries. |
| Residents | Census 2021 usual residents by Output Area, summed by centroid |

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
python pipeline/build.py      # needs geopandas + shapely 2.1
bash pipeline/tiles.sh        # needs tippecanoe; writes public/london/data/
```

Tiles are static `z/x/y.pbf` directories rather than PMTiles because Pages doesn't serve byte
ranges. Missing tiles inside each tileset's bounds are written as empty files, so the map never
sees a 404.

### Local dev

```bash
echo "GOOGLE_MAPS_KEY=..." > .dev.vars
npm run dev
```
