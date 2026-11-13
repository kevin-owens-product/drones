"""Fly the running swarm through every task over the bridge's HTTP API and check each one.

    make swarm-up && python3 sim/swarm/fly_check.py

Launch, line formation, wedge on a new heading, a cut link (PX4 should turn
for home on its own), an area sweep that takes everyone back, then everyone
home and landed. Prints one line per
step and exits non-zero on the first failure. Uses only the standard library.
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
R = 6_378_137.0


def get() -> dict:
    with urllib.request.urlopen(f"{BASE}/v1/live/vehicles", timeout=5) as r:
        return json.load(r)


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return json.load(e)


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    n = math.radians(b[0] - a[0]) * R
    e = math.radians(b[1] - a[1]) * R * math.cos(math.radians(a[0]))
    return math.hypot(n, e)


def wait(label: str, pred, timeout: float) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        snap = get()
        if pred(snap):
            print(f"  ok   {label} ({time.time() - t0:.0f} s)")
            return snap
        time.sleep(1)
    snap = get()
    for p in snap["items"]:
        print(f"       {p['tail_number']} {p['mode']} alt {p['alt_m']} m armed {p['armed']} task {p['task']}")
    print(f"  FAIL {label}: not within {timeout:.0f} s")
    sys.exit(1)


def by_tail(snap: dict) -> dict[str, dict]:
    return {p["tail_number"]: p for p in snap["items"]}


def main() -> None:
    snap = wait("every vehicle heard with a position", lambda s: s["heard"] == len(s["platforms"]) and len(s["items"]) == len(s["platforms"]), 60)
    n = len(snap["items"])
    print(f"  {n} vehicles")
    wait("GNSS fix on every vehicle", lambda s: all(p["gnss_trusted"] for p in s["items"]), 60)

    out = post("/v1/live/swarm", {"task": "launch", "alt_m": 20})
    print(f"  sent launch: {out['detail']}")
    if not out["ok"]:
        sys.exit(1)
    wait("all airborne at 20 m or above (staggered)", lambda s: all(p["armed"] and p["alt_m"] > 18 for p in s["items"]), 60)

    out = post("/v1/live/swarm", {"task": "formation", "shape": "line", "spacing_m": 12, "heading_deg": 0, "alt_m": 25})
    print(f"  sent line formation: {out['ok']}")
    slots = {s["tail"]: (s["lat"], s["lon"]) for s in out["swarm"]["slots"]}

    def in_slots(s: dict) -> bool:
        return all(dist((p["lat"], p["lon"]), slots[p["tail_number"]]) < 2.5 for p in s["items"])

    wait("every vehicle within 2.5 m of its line slot", in_slots, 90)

    centre = out["swarm"]["lat"], out["swarm"]["lon"]
    north = (centre[0] + 60 / R * 180 / math.pi, centre[1])
    out = post("/v1/live/swarm", {"task": "formation", "shape": "wedge", "spacing_m": 12, "heading_deg": 45, "lat": north[0], "lon": north[1], "alt_m": 25})
    slots = {s["tail"]: (s["lat"], s["lon"]) for s in out["swarm"]["slots"]}
    wait("wedge 60 m north, pointing north-east", in_slots, 90)

    first = snap["items"][0]["tail_number"]
    out = post("/v1/live/command", {"tail": first, "action": "link", "on": False})
    print(f"  cut {first}'s link while it holds in the wedge: {out['detail']}")
    time.sleep(16)
    post("/v1/live/command", {"tail": first, "action": "link", "on": True})
    wait(f"{first} back on the link and in RTL on its own (PX4 lost-link action)", lambda s: by_tail(s)[first]["mode"] == "RTL" and by_tail(s)[first]["link"] == "ok", 30)

    out = post("/v1/live/swarm", {"task": "sweep", "width_m": 120, "height_m": 80, "lane_m": 20, "alt_m": 25, "then": "rtl"})
    print(f"  sent sweep: {out['ok']} {out['detail'][:120]}")
    if not out["ok"]:
        sys.exit(1)
    wait("sweep under way in mission mode", lambda s: all(p["mode"] == "MISSION" for p in s["items"]), 20)
    wait("sweep at least half done on every vehicle", lambda s: all((p["task"].get("progress") or 0) >= 50 for p in s["items"] if p["task"]["kind"] == "sweep"), 240)

    wait("everyone home and landed after the sweep", lambda s: all(p["landed"] and not p["armed"] for p in s["items"]), 360)
    for p in get()["items"]:
        print(f"       {p['tail_number']} battery {p['battery_pct']}%")
    print("  all steps passed")


if __name__ == "__main__":
    main()
