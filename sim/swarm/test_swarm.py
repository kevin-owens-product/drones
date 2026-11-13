"""Unit checks for the swarm geometry and the bridge's HTTP and command logic, with no simulator.

    python3 -m pytest sim/swarm -q      (or: python3 -m unittest discover sim/swarm)
"""

from __future__ import annotations

import json
import math
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from itertools import pairwise
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge
import plan


class Geometry(unittest.TestCase):
    def test_line_is_abreast_and_evenly_spaced(self) -> None:
        slots = plan.formation_slots("line", 4, 10, heading_deg=0)
        self.assertTrue(all(abs(n) < 1e-9 for n, _ in slots))
        es = sorted(e for _, e in slots)
        self.assertEqual([round(b - a, 6) for a, b in pairwise(es)], [10.0, 10.0, 10.0])
        self.assertAlmostEqual(sum(es), 0.0)

    def test_heading_rotates_the_formation(self) -> None:
        # A line flying east lies north-south.
        slots = plan.formation_slots("line", 3, 10, heading_deg=90)
        self.assertTrue(all(abs(e) < 1e-9 for _, e in slots))

    def test_circle_keeps_neighbours_at_the_spacing(self) -> None:
        slots = plan.formation_slots("circle", 6, 12)
        for a, b in zip(slots, slots[1:] + slots[:1]):
            self.assertAlmostEqual(math.hypot(a[0] - b[0], a[1] - b[1]), 12, places=6)

    def test_every_shape_keeps_vehicles_apart(self) -> None:
        for shape in plan.SHAPES:
            slots = plan.formation_slots(shape, 7, 8)
            gaps = [math.hypot(a[0] - b[0], a[1] - b[1]) for i, a in enumerate(slots) for b in slots[i + 1:]]
            self.assertGreaterEqual(min(gaps), 8 * 0.99, shape)

    def test_assignment_avoids_crossing(self) -> None:
        starts = [(0.0, -10.0), (0.0, 10.0)]
        goals = [(50.0, 10.0), (50.0, -10.0)]
        self.assertEqual(plan.assign(starts, goals), [1, 0])

    def test_assignment_is_a_permutation_above_eight(self) -> None:
        starts = [(float(i), 0.0) for i in range(10)]
        goals = [(float(9 - i), 5.0) for i in range(10)]
        self.assertEqual(sorted(plan.assign(starts, goals)), list(range(10)))

    def test_sweep_covers_the_area_once(self) -> None:
        lanes = plan.sweep_lanes(3, 120, 80, 20)
        self.assertEqual(len(lanes), 3)
        es = sorted({round(e, 6) for path in lanes for _, e in path})
        self.assertEqual(len(es), 6)  # six lanes, 20 m apart, two per vehicle
        self.assertAlmostEqual(es[0], -50)
        self.assertAlmostEqual(es[-1], 50)
        for path in lanes:
            self.assertTrue(all(abs(n) == 40 for n, _ in path))

    def test_ref_round_trip(self) -> None:
        ref = plan.Ref(35.7392, -120.7654)
        lat, lon = ref.to_ll(120.0, -80.0)
        n, e = ref.to_ne(lat, lon)
        self.assertAlmostEqual(n, 120.0, places=4)
        self.assertAlmostEqual(e, -80.0, places=4)

    def test_px4_mode_names(self) -> None:
        self.assertEqual(bridge.px4_mode((4 << 16) | (4 << 24)), "MISSION")
        self.assertEqual(bridge.px4_mode((4 << 16) | (3 << 24)), "HOLD")
        self.assertEqual(bridge.px4_mode(3 << 16), "POSCTL")


class FakeLink:
    """Answers every command with an accept, the way PX4 does, without a socket."""

    endpoint = "fake"

    def __init__(self) -> None:
        self.sent: list[tuple] = []
        self.vehicle: bridge.Vehicle | None = None

    def recv(self, timeout: float) -> None:
        threading.Event().wait(timeout)

    def _src(self) -> int:
        assert self.vehicle is not None
        return self.vehicle.sysid

    def heartbeat(self) -> None:
        self.sent.append(("heartbeat",))

    def _ack(self, cmd: int) -> None:
        assert self.vehicle is not None
        self.vehicle.handle(SimpleNamespace(get_type=lambda: "COMMAND_ACK", get_srcSystem=self._src, command=cmd, result=0))

    def command_long(self, target: int, cmd: int, *params: float) -> None:
        self.sent.append(("long", cmd, params))
        self._ack(cmd)

    def command_int(self, target: int, cmd: int, frame: int, *rest: float) -> None:
        self.sent.append(("int", cmd, rest))
        self._ack(cmd)

    def param_set(self, *args: object) -> None:
        self.sent.append(("param",) + args)

    def mission_count(self, target: int, count: int) -> None:
        self.sent.append(("count", count))
        assert self.vehicle is not None
        for seq in range(count):
            self.vehicle.handle(SimpleNamespace(get_type=lambda: "MISSION_REQUEST_INT", get_srcSystem=self._src, seq=seq))
        self.vehicle.handle(SimpleNamespace(get_type=lambda: "MISSION_ACK", get_srcSystem=self._src, type=0))

    def mission_item(self, target: int, seq: int, cmd: int, lat: float, lon: float, alt: float) -> None:
        self.sent.append(("item", seq, cmd, lat, lon, alt))


def heard(v: bridge.Vehicle, sysid: int, lat: float, lon: float, airborne: bool) -> None:
    v.sysid = sysid
    s = v.state
    s.lat, s.lon, s.alt_amsl, s.rel_alt = lat, lon, 100.0 + (20 if airborne else 0), 20.0 if airborne else 0.0
    s.armed, s.landed, s.fix, s.battery_pct = airborne, not airborne, 3, 90.0
    s.last_rx = __import__("time").time()


class BridgeApi(unittest.TestCase):
    def setUp(self) -> None:
        self.links = [FakeLink() for _ in range(3)]
        self.swarm = bridge.Swarm(self.links)
        for i, (link, v) in enumerate(zip(self.links, self.swarm.vehicles)):
            link.vehicle = v
            heard(v, i + 1, 35.7387 + i * 1e-5, -120.7399, airborne=True)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.make_handler(self.swarm))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def req(self, path: str, body: dict | None = None, origin: str | None = None) -> tuple[int, dict, dict]:
        headers = {"content-type": "application/json"}
        if origin:
            headers["Origin"] = origin
        data = None if body is None else json.dumps(body).encode()
        r = urllib.request.Request(self.base + path, data=data, headers=headers, method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, json.load(resp), dict(resp.headers)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e), dict(e.headers)

    def test_vehicles_come_out_in_the_console_shape(self) -> None:
        status, body, _ = self.req("/v1/live/vehicles")
        self.assertEqual(status, 200)
        self.assertEqual([p["tail_number"] for p in body["items"]], ["PX4-01", "PX4-02", "PX4-03"])
        p = body["items"][0]
        for key in ("lat", "lon", "alt_m", "battery_pct", "mode", "armed", "gnss_trusted", "time", "source", "link"):
            self.assertIn(key, p)
        self.assertEqual(p["source"], "px4-sitl")
        self.assertEqual(len(body["platforms"]), 3)

    def test_cors_allows_the_console_and_refuses_other_sites(self) -> None:
        status, _, headers = self.req("/v1/live/health", origin="https://drones.productexec.co")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://drones.productexec.co")
        status, _, _ = self.req("/v1/live/health", origin="http://localhost:4173")
        self.assertEqual(status, 200)
        status, _, _ = self.req("/v1/live/swarm", {"task": "rtl"}, origin="https://evil.example")
        self.assertEqual(status, 403)

    def test_formation_sends_each_vehicle_to_its_own_slot_and_height(self) -> None:
        status, body, _ = self.req("/v1/live/swarm", {"task": "formation", "shape": "line", "spacing_m": 10, "alt_m": 25})
        self.assertEqual(status, 200, body)
        slots = body["swarm"]["slots"]
        self.assertEqual(len({(s["lat"], s["lon"]) for s in slots}), 3)
        self.assertEqual(sorted(s["alt_m"] for s in slots), [25.0, 28.0, 31.0])
        for link in self.links:
            self.assertTrue(any(m[0] == "int" and m[1] == bridge.MAV_CMD_DO_REPOSITION for m in link.sent))

    def test_sweep_uploads_a_mission_ending_in_return_to_launch(self) -> None:
        status, body, _ = self.req("/v1/live/swarm", {"task": "sweep", "width_m": 90, "height_m": 60, "lane_m": 15})
        self.assertEqual(status, 200, body)
        for link in self.links:
            items = [m for m in link.sent if m[0] == "item"]
            self.assertEqual(items[-1][2], bridge.MAV_CMD_NAV_RETURN_TO_LAUNCH)
            self.assertTrue(all(m[2] == bridge.MAV_CMD_NAV_WAYPOINT for m in items[:-1]))
            self.assertTrue(any(m[0] == "long" and m[1] == bridge.MAV_CMD_MISSION_START for m in link.sent))

    def test_launch_arms_then_takes_off_only_the_vehicles_on_the_ground(self) -> None:
        heard(self.swarm.vehicles[0], 1, 35.7387, -120.7399, airborne=False)
        status, body, _ = self.req("/v1/live/swarm", {"task": "launch", "alt_m": 15})
        self.assertEqual(status, 200, body)
        cmds = [m[1] for m in self.links[0].sent if m[0] == "long"]
        self.assertEqual(cmds[:2], [bridge.MAV_CMD_COMPONENT_ARM_DISARM, bridge.MAV_CMD_NAV_TAKEOFF])
        self.assertFalse([m for m in self.links[1].sent if m[0] == "long"])

    def test_a_cut_link_stops_heartbeats_and_commands(self) -> None:
        status, body, _ = self.req("/v1/live/command", {"tail": "PX4-02", "action": "link", "on": False})
        self.assertEqual(status, 200)
        v = self.swarm.vehicles[1]
        before = len(self.links[1].sent)
        v.heartbeat()
        self.assertEqual(len(self.links[1].sent), before)
        status, body, _ = self.req("/v1/live/command", {"tail": "PX4-02", "action": "rtl"})
        self.assertEqual(status, 409)
        self.assertIn("cut", body["detail"])

    def test_unknown_things_are_refused_plainly(self) -> None:
        self.assertEqual(self.req("/v1/live/command", {"tail": "NX-01", "action": "rtl"})[0], 409)
        self.assertEqual(self.req("/v1/live/swarm", {"task": "strike"})[0], 409)
        self.assertEqual(self.req("/v1/live/command", {"tail": "PX4-01", "action": "goto"})[0], 409)


if __name__ == "__main__":
    unittest.main()
