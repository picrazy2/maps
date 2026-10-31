"""Write manifest.json for the tile directories and fill every missing tile inside
each tileset's bounds with an empty file, so MapLibre gets an empty tile (200)
instead of a 404 for areas with no features."""

import json
import math
import sys
import time
from pathlib import Path

dest = Path(sys.argv[1])


def tile_range(lon0, lat0, lon1, lat1, z):
    n = 2**z
    x = lambda lon: int((lon + 180) / 360 * n)
    y = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return range(x(lon0), x(lon1) + 1), range(y(lat1), y(lat0) + 1)


sources = {}
for d in sorted(p for p in dest.iterdir() if p.is_dir()):
    meta = json.loads((d / "metadata.json").read_text())
    b = [float(v) for v in meta["bounds"].split(",")]
    zmin, zmax = int(meta["minzoom"]), int(meta["maxzoom"])
    filled = 0
    for z in range(zmin, zmax + 1):
        xs, ys = tile_range(*b, z)
        for x in xs:
            for y in ys:
                f = d / str(z) / str(x) / f"{y}.pbf"
                if not f.exists():
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_bytes(b"")
                    filled += 1
    (d / "metadata.json").unlink()
    sources[d.name] = {"minzoom": zmin, "maxzoom": zmax, "bounds": [round(v, 5) for v in b]}
    print(f"{d.name}: z{zmin}-{zmax}, filled {filled} empty tiles")

(dest / "manifest.json").write_text(json.dumps({"v": str(int(time.time())), "sources": sources}, indent=1))
