#!/usr/bin/env bash
# Turn pipeline/out/*.geojson into static z/x/y.pbf tile directories for the web app.
# Directories rather than PMTiles because Cloudflare Pages doesn't serve byte ranges.
set -euo pipefail
cd "$(dirname "$0")"
OUT=out
DEST=../public/london/data
mkdir -p "$DEST"

# Uncompressed: Pages compresses on the fly, and pre-gzipped .pbf without a
# Content-Encoding header would break MapLibre.
# -r1: keep every label point at every zoom (the default thins points out at low zooms).
tc() { tippecanoe --force --quiet --no-tile-compression -r1 --detect-shared-borders \
  --coalesce-densest-as-needed --extend-zooms-if-still-dropping "$@"; }

# Boundaries: GLA, boroughs, wards, postcode areas, districts, sectors.
rm -rf "$DEST/bounds"
tc -e "$DEST/bounds" -Z7 -z14 --simplification=4 \
  -L gla:$OUT/gla.geojson \
  -L boroughs:$OUT/boroughs.geojson -L borough_labels:$OUT/boroughs_labels.geojson \
  -L '{"layer":"wards","file":"'$OUT'/wards.geojson","minzoom":9}' \
  -L '{"layer":"ward_labels","file":"'$OUT'/wards_labels.geojson","minzoom":11}' \
  -L pc_areas:$OUT/pc_areas.geojson -L pc_area_labels:$OUT/pc_areas_labels.geojson \
  -L '{"layer":"pc_districts","file":"'$OUT'/pc_districts.geojson","minzoom":9}' \
  -L '{"layer":"pc_district_labels","file":"'$OUT'/pc_districts_labels.geojson","minzoom":10}' \
  -L '{"layer":"pc_sectors","file":"'$OUT'/pc_sectors.geojson","minzoom":11}' \
  -L '{"layer":"pc_sector_labels","file":"'$OUT'/pc_sectors_labels.geojson","minzoom":12}'

# Full postcode units: only rendered close in.
rm -rf "$DEST/units"
tc -e "$DEST/units" -Z13 -z15 --simplification=2 --no-tiny-polygon-reduction \
  -L pc_units:$OUT/pc_units.geojson

python3 fill_tiles.py "$DEST"
cp $OUT/search-index.json "$DEST/search-index.json"
echo "tiles: $(find "$DEST" -name '*.pbf' | wc -l | tr -d ' ') files, $(du -sh "$DEST" | cut -f1)"
