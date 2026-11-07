#!/usr/bin/env python3
"""Cache TfL Unified API line and stop data in pipeline/raw/tfl/api/. Needs TFL_APP_KEY."""
import json, os, sys, time, urllib.request, urllib.parse
from pathlib import Path
RAW = Path(__file__).resolve().parents[1] / "raw/tfl/api"
RAW.mkdir(parents=True, exist_ok=True)
KEY = os.environ.get("TFL_APP_KEY", "")
MODES = "tube,dlr,overground,elizabeth-line,tram,national-rail"
def get(path, **params):
    if KEY: params["app_key"] = KEY
    url = f"https://api.tfl.gov.uk{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "maps-pipeline/1.0 (+https://maps.akguo.com)", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 3: raise
            time.sleep(2 ** attempt + 1)
lines = get(f"/Line/Mode/{MODES}")
(RAW / "lines.json").write_text(json.dumps([{"id": l["id"], "name": l["name"], "mode": l["modeName"]} for l in lines]))
for l in lines:
    for d in ("outbound", "inbound"):
        out = RAW / f"{l['id']}.{d}.json"
        if out.exists(): continue
        try:
            out.write_text(json.dumps(get(f"/Line/{l['id']}/Route/Sequence/{d}", serviceTypes="Regular,Night", excludeCrowding="true")))
            print(l["id"], d, flush=True)
        except Exception as e:
            print("FAILED", l["id"], d, e, file=sys.stderr)
        time.sleep(0.25)
