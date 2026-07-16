#!/usr/bin/env python3
"""Download 2025 Belgian GP (Spa) race telemetry from the OpenF1 API
and preprocess it into compact JSON files for the dashboard.

Usage: python3 fetch_data.py
Output: public/data/meta.json, public/data/locations.json
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://api.openf1.org/v1"
SESSION_KEY = 9939  # 2025 Belgian GP, Race
CHUNK_MINUTES = 10
THROTTLE_S = 0.5
DOWNSAMPLE_MS = 450  # keep ~2 samples/second
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data")


def get(path, retries=6):
    url = f"{BASE}/{path}"
    delay = 2.0
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                return json.load(resp)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            code = getattr(e, "code", None)
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} after error ({code or e}) for {url}")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def parse_date(s):
    return datetime.fromisoformat(s)


def iso_z(dt):
    return dt.astimezone(timezone.utc).isoformat()


def fetch_intervals(chunks, offset_ms):
    """Per-driver gap-to-leader time series: {num: {"t": [...], "g": [...]}}.
    Gap values are seconds (float), a string like "+1 LAP", or null (leader).
    """
    intervals = {}
    for c0, c1 in chunks:
        time.sleep(THROTTLE_S)
        rows = get(
            f"intervals?session_key={SESSION_KEY}"
            f"&date>{c0.strftime('%Y-%m-%dT%H:%M:%S')}"
            f"&date<{c1.strftime('%Y-%m-%dT%H:%M:%S')}"
        )
        for r in rows:
            d = intervals.setdefault(str(r["driver_number"]), {"t": [], "g": []})
            d["t"].append(offset_ms(parse_date(r["date"])))
            d["g"].append(r["gap_to_leader"])
    n = sum(len(d["t"]) for d in intervals.values())
    print(f"  {n} interval rows for {len(intervals)} drivers")
    return intervals


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Fetching drivers...")
    drivers_raw = get(f"drivers?session_key={SESSION_KEY}")
    drivers = sorted(
        (
            {
                "number": d["driver_number"],
                "acronym": d["name_acronym"],
                "name": d["full_name"],
                "team": d["team_name"],
                "color": "#" + (d["team_colour"] or "888888"),
            }
            for d in drivers_raw
        ),
        key=lambda d: d["number"],
    )
    print(f"  {len(drivers)} drivers")

    print("Fetching laps...")
    laps_raw = get(f"laps?session_key={SESSION_KEY}")
    lap1_starts = [
        parse_date(l["date_start"])
        for l in laps_raw
        if l["lap_number"] == 1 and l.get("date_start")
    ]
    lap_ends = [
        parse_date(l["date_start"]) + timedelta(seconds=l["lap_duration"])
        for l in laps_raw
        if l.get("date_start") and l.get("lap_duration")
    ]
    race_start = min(lap1_starts) - timedelta(seconds=60)
    race_end = max(lap_ends) + timedelta(seconds=30)
    print(f"  race window {iso_z(race_start)} -> {iso_z(race_end)}")

    def offset_ms(dt):
        return int((dt - race_start).total_seconds() * 1000)

    # Lap start offsets per driver, for the lap counter.
    laps = {}
    for l in laps_raw:
        if not l.get("date_start"):
            continue
        laps.setdefault(str(l["driver_number"]), []).append(
            [l["lap_number"], offset_ms(parse_date(l["date_start"]))]
        )
    for v in laps.values():
        v.sort()

    print("Fetching positions...")
    pos_raw = get(f"position?session_key={SESSION_KEY}")
    positions = sorted(
        [offset_ms(parse_date(p["date"])), p["driver_number"], p["position"]]
        for p in pos_raw
    )

    # Time chunks shared by the intervals and location fetches, to stay under
    # API response limits.
    chunks = []
    t = race_start
    while t < race_end:
        t2 = min(t + timedelta(minutes=CHUNK_MINUTES), race_end)
        chunks.append((t, t2))
        t = t2

    print("Fetching intervals (gap to leader)...")
    intervals = fetch_intervals(chunks, offset_ms)

    total_laps = max(l["lap_number"] for l in laps_raw)
    meta = {
        "session_key": SESSION_KEY,
        "title": "2025 Belgian Grand Prix — Spa-Francorchamps",
        "race_start": iso_z(race_start),
        "duration_ms": offset_ms(race_end),
        "total_laps": total_laps,
        "drivers": drivers,
        "laps": laps,
        "positions": positions,
        "intervals": intervals,
    }
    with open(os.path.join(OUT_DIR, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print(f"  wrote data/meta.json ({total_laps} laps)")

    locations = {}
    for i, d in enumerate(drivers):
        num = d["number"]
        ts, xs, ys = [], [], []
        last_kept = -10**9
        for c0, c1 in chunks:
            time.sleep(THROTTLE_S)
            rows = get(
                f"location?session_key={SESSION_KEY}&driver_number={num}"
                f"&date>{c0.strftime('%Y-%m-%dT%H:%M:%S')}"
                f"&date<{c1.strftime('%Y-%m-%dT%H:%M:%S')}"
            )
            for r in rows:
                t_ms = offset_ms(parse_date(r["date"]))
                if t_ms - last_kept < DOWNSAMPLE_MS:
                    continue
                if r["x"] == 0 and r["y"] == 0:  # telemetry dropout
                    continue
                last_kept = t_ms
                ts.append(t_ms)
                xs.append(r["x"])
                ys.append(r["y"])
        locations[str(num)] = {"t": ts, "x": xs, "y": ys}
        print(f"  [{i + 1}/{len(drivers)}] #{num} {d['acronym']}: {len(ts)} points")

    with open(os.path.join(OUT_DIR, "locations.json"), "w") as f:
        json.dump(locations, f, separators=(",", ":"))
    size_mb = os.path.getsize(os.path.join(OUT_DIR, "locations.json")) / 1e6
    print(f"Done. data/locations.json = {size_mb:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
