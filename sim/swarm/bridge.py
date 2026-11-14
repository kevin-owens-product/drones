"""Live sim bridge: PX4 vehicles over MAVLink in, the console's JSON out.

Each PX4 vehicle (SIH in Docker, or real hardware on a telemetry radio) is one
MAVLink link. The bridge holds the newest state per vehicle, turns operator
commands into MAVLink, and runs two swarm tasks (a formation and an area
sweep) by giving each vehicle its own goal or mission.

    python3 sim/swarm/bridge.py --count 4                      # the SIH swarm (deploy/swarm)
    python3 sim/swarm/bridge.py --vehicles serial:/dev/ttyUSB0:57600,serial:/dev/ttyUSB1:57600

HTTP on 127.0.0.1:8765 (see docs/design/live-sim.md):
    GET  /v1/live/health            is the bridge up, how many vehicles
    GET  /v1/live/vehicles          positions and state in the console's LivePoint shape, the
                                    registry rows, the swarm task and the event log
    POST /v1/live/command           {"tail": "PX4-01", "action": "launch" | "goto" | "hold" | "rtl" | "land" | "link", ...}
    POST /v1/live/swarm             {"task": "launch" | "formation" | "sweep" | "hold" | "rtl" | "land", ...}

The same code flies real PX4 hardware on a telemetry radio; only the endpoint
list changes. It never sends a command the operator did not ask for,
except the PX4 parameters it sets on connect (listed in PARAMS_ON_CONNECT).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import queue
import struct
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

os.environ.setdefault("MAVLINK20", "1")  # PX4 speaks MAVLink 2; pymavlink defaults to 1
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan

# Parameters the bridge sets on every vehicle when it first hears it. Names and
# meanings are PX4's; values are this demo's choices, not Neros settings.
PARAMS_ON_CONNECT: dict[str, tuple[float, str]] = {
    # Lost ground link: return to launch after COM_DL_LOSS_T seconds (default 10 s).
    "NAV_DLL_ACT": (2, "int"),
    # Simulated pack: about 15 minutes from full to the floor, floor at 20%.
    # PX4 ignores these on real hardware.
    "SIM_BAT_DRAIN": (900, "float"),
    "SIM_BAT_MIN_PCT": (20, "float"),
    # Cruise for missions, go-to and return: 12 m/s (PX4's default is 5), so a plan's
    # search area a couple of kilometres from the pad is minutes away, not ten.
    "MPC_XY_CRUISE": (12, "float"),
}

PX4_MAIN = {1: "MANUAL", 2: "ALTCTL", 3: "POSCTL", 4: "AUTO", 5: "ACRO", 6: "OFFBOARD", 7: "STABILIZED", 8: "RATTITUDE"}
PX4_AUTO = {1: "READY", 2: "TAKEOFF", 3: "HOLD", 4: "MISSION", 5: "RTL", 6: "LAND", 8: "FOLLOW", 9: "PRECLAND"}
SEVERITY = {0: "alert", 1: "alert", 2: "alert", 3: "alert", 4: "warn", 5: "info", 6: "info", 7: "info"}

MAV_CMD_NAV_WAYPOINT = 16
MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
MAV_CMD_NAV_LAND = 21
MAV_CMD_NAV_TAKEOFF = 22
MAV_CMD_DO_SET_MODE = 176
MAV_CMD_DO_REPOSITION = 192
MAV_CMD_MISSION_START = 300
MAV_CMD_COMPONENT_ARM_DISARM = 400
MAV_FRAME_GLOBAL = 0
MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6
MAV_FRAME_MISSION = 2
MAV_RESULT = {0: "accepted", 1: "temporarily rejected", 2: "denied", 3: "unsupported", 4: "failed", 5: "in progress", 6: "cancelled"}
LINK_LOST_AFTER_S = 3.0
SEPARATION_H_M = 4.0
SEPARATION_V_M = 2.5
NAN = float("nan")


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def px4_mode(custom_mode: int) -> str:
    main = (custom_mode >> 16) & 0xFF
    sub = (custom_mode >> 24) & 0xFF
    if main == 4:
        return PX4_AUTO.get(sub, "AUTO")
    return PX4_MAIN.get(main, f"MODE {main}")


@dataclass
class State:
    lat: float | None = None
    lon: float | None = None
    alt_amsl: float | None = None
    rel_alt: float | None = None
    vn: float = 0.0
    ve: float = 0.0
    vd: float = 0.0
    heading: float | None = None
    roll: float | None = None
    pitch: float | None = None
    battery_pct: float | None = None
    pack_v: float | None = None
    armed: bool = False
    mode: str = "—"
    landed: bool = True
    fix: int = 0
    eph_m: float | None = None
    home: tuple[float, float, float] | None = None
    last_rx: float = 0.0
    mission_seq: int = -1


@dataclass
class Task:
    kind: str = "idle"
    detail: str = ""
    waypoints: int = 0
    goal: tuple[float, float, float] | None = None  # lat, lon, rel alt


class Link:
    """The MAVLink side of one vehicle. Swappable so the HTTP layer tests without PX4."""

    def __init__(self, endpoint: str) -> None:
        from pymavlink import mavutil

        self.mavutil = mavutil
        self.endpoint = endpoint
        self.m = mavutil.mavlink_connection(endpoint, source_system=255, source_component=190, autoreconnect=True)
        self.lock = threading.Lock()

    def recv(self, timeout: float) -> Any:
        return self.m.recv_match(blocking=True, timeout=timeout)

    def heartbeat(self) -> None:
        with self.lock:
            # MAV_TYPE_GCS, MAV_AUTOPILOT_INVALID: we are a ground station.
            self.m.mav.heartbeat_send(6, 8, 0, 0, 4)

    def command_long(self, target: int, cmd: int, *params: float) -> None:
        p = list(params) + [0.0] * (7 - len(params))
        with self.lock:
            self.m.mav.command_long_send(target, 1, cmd, 0, *p)

    def command_int(self, target: int, cmd: int, frame: int, p1: float, p2: float, p3: float, p4: float, lat: float, lon: float, alt: float) -> None:
        with self.lock:
            self.m.mav.command_int_send(target, 1, frame, cmd, 0, 0, p1, p2, p3, p4, int(lat * 1e7), int(lon * 1e7), alt)

    def param_set(self, target: int, name: str, value: float, kind: str) -> None:
        if kind == "int":
            # PX4 reads integer params bytewise from the float field.
            raw = struct.unpack("<f", struct.pack("<i", int(value)))[0]
            ptype = 6  # MAV_PARAM_TYPE_INT32
        else:
            raw, ptype = float(value), 9  # MAV_PARAM_TYPE_REAL32
        with self.lock:
            self.m.mav.param_set_send(target, 1, name.encode(), raw, ptype)

    def mission_count(self, target: int, count: int) -> None:
        with self.lock:
            self.m.mav.mission_count_send(target, 1, count, 0)

    def mission_item(self, target: int, seq: int, cmd: int, lat: float, lon: float, alt: float) -> None:
        # A waypoint is a place (height above home); return-to-launch has no place.
        frame = MAV_FRAME_GLOBAL_RELATIVE_ALT_INT if cmd == MAV_CMD_NAV_WAYPOINT else MAV_FRAME_MISSION
        with self.lock:
            self.m.mav.mission_item_int_send(
                # Hold 0 s, acceptance radius and pass radius left to PX4, yaw unchanged.
                target, 1, seq, frame, cmd, 0, 1,
                0, 0, 0, NAN, int(lat * 1e7), int(lon * 1e7), alt, 0,
            )


class Vehicle:
    def __init__(self, tail: str, link: Any, on_event: Callable[[str, str, str], None]) -> None:
        self.tail = tail
        self.link = link
        self.sysid = 0
        self.state = State()
        self.task = Task()
        self.link_cut = False
        self.lost = False
        # Parameters not yet confirmed by a PARAM_VALUE echo, and when we last sent them.
        self.params_pending = dict(PARAMS_ON_CONNECT)
        self.params_at = 0.0
        self.on_event = on_event
        self.acks: dict[int, tuple[int, float]] = {}
        self.ack_cv = threading.Condition()
        self.mission_q: queue.Queue[Any] = queue.Queue()
        self.uploading = False
        self.stop = threading.Event()

    # ---- receive ----
    def run(self) -> None:
        while not self.stop.is_set():
            try:
                msg = self.link.recv(0.25)
            except OSError:
                time.sleep(0.5)
                continue
            if msg is None:
                self._check_lost()
                continue
            if self.link_cut:
                continue
            self.handle(msg)
            self._check_lost()

    def _check_lost(self) -> None:
        s = self.state
        if s.last_rx and not self.lost and time.time() - s.last_rx > LINK_LOST_AFTER_S:
            self.lost = True
            # The vehicle may have rebooted while we could not hear it: set the parameters again.
            self.params_pending = dict(PARAMS_ON_CONNECT)
            if not self.link_cut:
                self.on_event(self.tail, "alert", "Link lost")

    def handle(self, msg: Any) -> None:
        kind = msg.get_type()
        if kind == "BAD_DATA":
            return
        src = msg.get_srcSystem()
        if kind == "HEARTBEAT":
            if msg.type == 6:  # another ground station
                return
            if self.sysid == 0:
                self.sysid = src
                self.on_event(self.tail, "info", f"Link up: PX4 system {src} on {getattr(self.link, 'endpoint', 'link')}")
            if src != self.sysid:
                return
            armed = bool(msg.base_mode & 128)
            mode = px4_mode(msg.custom_mode)
            s = self.state
            if armed != s.armed and s.last_rx:
                self.on_event(self.tail, "info", "Armed" if armed else "Disarmed")
            if mode != s.mode and s.mode != "—":
                self.on_event(self.tail, "info", f"Mode {s.mode} → {mode}")
            s.armed, s.mode = armed, mode
            # Set (and keep setting until PX4 echoes them) the demo's parameters.
            if self.params_pending and time.time() - self.params_at > 2:
                self.params_at = time.time()
                for name, (value, ptype) in list(self.params_pending.items()):
                    self.link.param_set(self.sysid, name, value, ptype)
            self._rx()
            return
        if self.sysid and src != self.sysid:
            return
        s = self.state
        if kind == "GLOBAL_POSITION_INT":
            s.lat, s.lon = msg.lat / 1e7, msg.lon / 1e7
            s.alt_amsl, s.rel_alt = msg.alt / 1000, msg.relative_alt / 1000
            s.vn, s.ve, s.vd = msg.vx / 100, msg.vy / 100, msg.vz / 100
            s.heading = None if msg.hdg == 65535 else msg.hdg / 100
            self._rx()
        elif kind == "ATTITUDE":
            s.roll, s.pitch = math.degrees(msg.roll), math.degrees(msg.pitch)
        elif kind == "SYS_STATUS":
            if msg.battery_remaining >= 0:
                s.battery_pct = float(msg.battery_remaining)
            if msg.voltage_battery not in (0, 65535):
                s.pack_v = msg.voltage_battery / 1000
        elif kind == "GPS_RAW_INT":
            s.fix = msg.fix_type
            s.eph_m = None if msg.eph == 65535 else msg.eph / 100
        elif kind == "EXTENDED_SYS_STATE":
            was = s.landed
            s.landed = msg.landed_state in (0, 1)
            if was != s.landed and s.last_rx:
                self.on_event(self.tail, "info", "Airborne" if not s.landed else "Landed")
                if s.landed and self.task.kind in ("rtl", "land", "sweep"):
                    self.task = Task("idle", "Landed")
        elif kind == "HOME_POSITION":
            s.home = (msg.latitude / 1e7, msg.longitude / 1e7, msg.altitude / 1000)
        elif kind == "MISSION_CURRENT":
            s.mission_seq = msg.seq
        elif kind == "STATUSTEXT":
            text = msg.text.strip() if isinstance(msg.text, str) else str(msg.text)
            if text:
                self.on_event(self.tail, SEVERITY.get(msg.severity, "info"), f"PX4: {text}")
        elif kind == "PARAM_VALUE":
            name = msg.param_id.rstrip("\x00") if isinstance(msg.param_id, str) else str(msg.param_id)
            want = self.params_pending.get(name)
            if want:
                got = struct.unpack("<i", struct.pack("<f", msg.param_value))[0] if want[1] == "int" else msg.param_value
                if abs(float(got) - want[0]) < 1e-3:
                    del self.params_pending[name]
        elif kind == "COMMAND_ACK":
            with self.ack_cv:
                self.acks[msg.command] = (msg.result, time.time())
                self.ack_cv.notify_all()
        elif kind in ("MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK") and self.uploading:
            self.mission_q.put(msg)

    def _rx(self) -> None:
        self.state.last_rx = time.time()
        if self.lost:
            self.lost = False
            self.on_event(self.tail, "info", "Link restored")

    # ---- send ----
    def heartbeat(self) -> None:
        if not self.link_cut:
            self.link.heartbeat()

    def _ack(self, cmd: int, since: float, timeout: float = 3.0) -> int | None:
        end = time.time() + timeout
        with self.ack_cv:
            while time.time() < end:
                got = self.acks.get(cmd)
                if got and got[1] >= since:
                    return got[0]
                self.ack_cv.wait(0.1)
        return None

    def command(self, cmd: int, *params: float, label: str, wait: bool = True) -> tuple[bool, str]:
        if not self.sysid:
            return False, f"{self.tail} has not been heard yet"
        if self.link_cut:
            return False, f"{self.tail}'s link is cut"
        since = time.time()
        result: int | None = None
        for _ in range(3):
            self.link.command_long(self.sysid, cmd, *params)
            if not wait:
                return True, f"{label} sent"
            result = self._ack(cmd, since, 1.0)
            if result is not None:
                break
        if result is None:
            return False, f"{label}: no answer from {self.tail}"
        ok = result in (0, 5)
        return ok, f"{label}: {MAV_RESULT.get(result, str(result))}"

    def set_mode_hold(self) -> tuple[bool, str]:
        return self.command(MAV_CMD_DO_SET_MODE, 1, 4, 3, label="Hold")

    def home_amsl(self) -> float:
        s = self.state
        if s.home:
            return s.home[2]
        if s.alt_amsl is not None and s.rel_alt is not None:
            return s.alt_amsl - s.rel_alt
        return 0.0

    def launch(self, alt_m: float) -> tuple[bool, str]:
        s = self.state
        if s.armed and not s.landed:
            return self.goto(s.lat or 0, s.lon or 0, alt_m)
        ok, text = self.command(MAV_CMD_COMPONENT_ARM_DISARM, 1, label="Arm")
        if not ok:
            return ok, text
        ok, text = self.command(MAV_CMD_NAV_TAKEOFF, 0, 0, 0, NAN, NAN, NAN, self.home_amsl() + alt_m, label=f"Take off to {alt_m:.0f} m")
        if ok:
            self.task = Task("launch", f"Climbing to {alt_m:.0f} m", goal=(s.lat or 0, s.lon or 0, alt_m))
        return ok, text

    def goto(self, lat: float, lon: float, alt_m: float, why: str = "Go to") -> tuple[bool, str]:
        if not self.sysid:
            return False, f"{self.tail} has not been heard yet"
        if self.link_cut:
            return False, f"{self.tail}'s link is cut"
        if not self.state.armed or self.state.landed:
            return False, f"{self.tail} is on the ground: launch it first"
        since = time.time()
        result = None
        for _ in range(3):
            # Ground speed default, change mode to hold-at-target, yaw unchanged.
            self.link.command_int(self.sysid, MAV_CMD_DO_REPOSITION, MAV_FRAME_GLOBAL, -1, 1, 0, NAN, lat, lon, self.home_amsl() + alt_m)
            result = self._ack(MAV_CMD_DO_REPOSITION, since, 1.0)
            if result is not None:
                break
        if result is None:
            return False, f"{why}: no answer from {self.tail}"
        ok = result in (0, 5)
        if ok:
            self.task = Task("goto", why, goal=(lat, lon, alt_m))
        return ok, f"{why}: {MAV_RESULT.get(result, str(result))}"

    def fly_mission(self, points: list[tuple[float, float]], alt_m: float, then: str, label: str) -> tuple[bool, str]:
        if not self.sysid:
            return False, f"{self.tail} has not been heard yet"
        if not self.state.armed or self.state.landed:
            return False, f"{self.tail} is on the ground: launch it first"
        items = [(MAV_CMD_NAV_WAYPOINT, lat, lon, alt_m) for lat, lon in points]
        if then == "rtl":
            items.append((MAV_CMD_NAV_RETURN_TO_LAUNCH, 0.0, 0.0, 0.0))
        self.uploading = True
        while not self.mission_q.empty():
            self.mission_q.get_nowait()
        try:
            self.link.mission_count(self.sysid, len(items))
            end = time.time() + 8
            while time.time() < end:
                try:
                    msg = self.mission_q.get(timeout=1.0)
                except queue.Empty:
                    self.link.mission_count(self.sysid, len(items))
                    continue
                if msg.get_type() == "MISSION_ACK":
                    if msg.type != 0:
                        return False, f"{label}: PX4 refused the mission (MISSION_ACK {msg.type})"
                    break
                seq = msg.seq
                if 0 <= seq < len(items):
                    cmd, lat, lon, alt = items[seq]
                    self.link.mission_item(self.sysid, seq, cmd, lat, lon, alt)
            else:
                return False, f"{label}: mission upload timed out"
        finally:
            self.uploading = False
        # PX4 checks a new mission's feasibility after it acks the upload; a start
        # sent in that window is denied as "no valid mission", so try a few times.
        ok, text = False, f"{label}: not started"
        for _ in range(6):
            time.sleep(0.5)
            ok, text = self.command(MAV_CMD_MISSION_START, 0, 0, label=label)
            if ok:
                break
        if ok:
            self.task = Task("sweep", label, waypoints=len(points))
        return ok, text

    def rtl(self) -> tuple[bool, str]:
        ok, text = self.command(MAV_CMD_NAV_RETURN_TO_LAUNCH, label="Return to launch")
        if ok:
            self.task = Task("rtl", "Returning to launch")
        return ok, text

    def land(self) -> tuple[bool, str]:
        ok, text = self.command(MAV_CMD_NAV_LAND, 0, 0, 0, NAN, NAN, NAN, NAN, label="Land here")
        if ok:
            self.task = Task("land", "Landing")
        return ok, text

    def hold(self) -> tuple[bool, str]:
        ok, text = self.set_mode_hold()
        if ok:
            self.task = Task("hold", "Holding")
        return ok, text

    # ---- out ----
    def point(self) -> dict[str, Any] | None:
        s = self.state
        if s.lat is None or s.lon is None:
            return None
        progress = None
        if self.task.kind == "sweep" and self.task.waypoints:
            progress = max(0, min(100, round(100 * max(0, s.mission_seq) / self.task.waypoints)))
        mode = "STANDBY" if s.landed and not s.armed else s.mode
        return {
            "tail_number": self.tail,
            "lat": round(s.lat, 7),
            "lon": round(s.lon, 7),
            "alt_m": round(s.rel_alt or 0.0, 1),
            "classification": "UNCLASSIFIED",
            "time": iso(s.last_rx),
            "airworthiness": "airworthy",
            "heading_deg": None if s.heading is None else round(s.heading, 1),
            "ground_mps": round(math.hypot(s.vn, s.ve), 2),
            "climb_mps": round(-s.vd, 2),
            "battery_pct": s.battery_pct,
            "pack_v": s.pack_v,
            "mode": mode,
            "armed": s.armed,
            "nav_source": "gnss" if s.fix >= 3 else "none",
            "gnss_trusted": s.fix >= 3,
            "pos_sigma_m": s.eph_m,
            "roll_deg": None if s.roll is None else round(s.roll, 1),
            "pitch_deg": None if s.pitch is None else round(s.pitch, 1),
            "airframe": "PX4 SIH quad (SIM)",
            "source": "px4-sitl",
            "landed": s.landed,
            "link": "cut" if self.link_cut else ("lost" if self.lost else "ok"),
            "task": {"kind": self.task.kind, "detail": self.task.detail, "progress": progress, "goal": self.task.goal},
        }


class Swarm:
    def __init__(self, links: list[Any], prefix: str = "PX4") -> None:
        self.events: list[dict[str, Any]] = []
        self.event_id = 0
        self.ev_lock = threading.Lock()
        self.vehicles = [Vehicle(f"{prefix}-{i + 1:02d}", link, self.event) for i, link in enumerate(links)]
        self.task: dict[str, Any] = {"task": "idle"}
        self.near: dict[tuple[str, str], float] = {}

    def event(self, tail: str, level: str, text: str) -> None:
        with self.ev_lock:
            self.event_id += 1
            self.events.append({"id": self.event_id, "at": time.time() * 1000, "tail": tail, "level": level, "text": text})
            del self.events[:-300]

    def start(self) -> None:
        for v in self.vehicles:
            threading.Thread(target=v.run, daemon=True, name=f"rx-{v.tail}").start()
        threading.Thread(target=self._beat, daemon=True, name="heartbeat").start()

    def _beat(self) -> None:
        while True:
            for v in self.vehicles:
                try:
                    v.heartbeat()
                except OSError:
                    pass
            self.check_separation()
            time.sleep(0.5)

    def check_separation(self) -> None:
        """Alert when two airborne vehicles come inside the separation box."""
        up = [v for v in self.vehicles if v.state.lat is not None and not v.state.landed and not v.link_cut and (v.state.rel_alt or 0) > 2]
        now = time.time()
        for i, a in enumerate(up):
            ref = plan.Ref(a.state.lat or 0, a.state.lon or 0)
            for b in up[i + 1:]:
                n, e = ref.to_ne(b.state.lat or 0, b.state.lon or 0)
                h = math.hypot(n, e)
                dv = abs((a.state.rel_alt or 0) - (b.state.rel_alt or 0))
                key = (a.tail, b.tail)
                if h < SEPARATION_H_M and dv < SEPARATION_V_M:
                    if now - self.near.get(key, 0) > 15:
                        self.event(a.tail, "alert", f"Separation: {a.tail} and {b.tail} {h:.0f} m apart, {dv:.0f} m vertically")
                    self.near[key] = now

    def find(self, tail: str) -> Vehicle | None:
        return next((v for v in self.vehicles if v.tail == tail), None)

    def snapshot(self, since: int = 0) -> dict[str, Any]:
        items = [p for p in (v.point() for v in self.vehicles) if p]
        # Everyone heard is down and disarmed: whatever the swarm was doing is over.
        if self.task.get("task") != "idle" and items and all(p["landed"] and not p["armed"] for p in items):
            self.task = {"task": "idle"}
        platforms = [
            {
                "id": v.tail,
                "tail_number": v.tail,
                "designation": "PX4 SIH quad · live sim",
                "group_size": "Group 1",
                "portion_mark": "(U)",
                "airworthiness": "airworthy",
                "classification": "UNCLASSIFIED",
            }
            for v in self.vehicles
        ]
        with self.ev_lock:
            events = [e for e in self.events if e["id"] > since]
        return {"items": items, "platforms": platforms, "swarm": self.task, "events": events, "heard": sum(1 for v in self.vehicles if v.sysid)}

    def centroid(self, vs: list[Vehicle]) -> tuple[float, float]:
        pts = [(v.state.lat, v.state.lon) for v in vs if v.state.lat is not None]
        if not pts:
            raise ValueError("no vehicle has a position yet")
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)  # type: ignore[misc]

    def pick(self, tails: list[str] | None) -> list[Vehicle]:
        vs = [v for v in self.vehicles if v.sysid and not v.link_cut]
        if tails:
            vs = [v for v in vs if v.tail in tails]
        return vs

    # ---- swarm tasks ----
    def run_task(self, body: dict[str, Any]) -> dict[str, Any]:
        task = str(body.get("task", ""))
        vs = self.pick(body.get("tails"))
        if not vs:
            return {"ok": False, "detail": "No vehicle on the link to task"}
        results: list[dict[str, Any]] = []

        def each(fn: Callable[[Vehicle], tuple[bool, str]], targets: list[Vehicle]) -> None:
            out: dict[str, tuple[bool, str]] = {}

            def one(v: Vehicle) -> None:
                out[v.tail] = fn(v)

            threads = [threading.Thread(target=one, args=(v,)) for v in targets]
            for t in threads:
                t.start()
            for t in threads:
                t.join(20)
            for v in targets:
                ok, text = out.get(v.tail, (False, "no answer"))
                results.append({"tail": v.tail, "ok": ok, "detail": text})
                self.event(v.tail, "info" if ok else "warn", f"Swarm {task}: {text}")

        alt = float(body.get("alt_m", 20))
        if task == "launch":
            ground = [v for v in vs if v.state.landed or not v.state.armed]
            each(lambda v: v.launch(plan.stagger(vs.index(v), alt)), ground)
            self.task = {"task": "launch", "alt_m": alt}
        elif task in ("hold", "rtl", "land"):
            fn = {"hold": Vehicle.hold, "rtl": Vehicle.rtl, "land": Vehicle.land}[task]
            each(fn, [v for v in vs if not v.state.landed])
            self.task = {"task": task}
        elif task == "formation":
            air = [v for v in vs if v.state.armed and not v.state.landed]
            if not air:
                return {"ok": False, "detail": "Launch the swarm before a formation"}
            shape = str(body.get("shape", "line"))
            spacing = float(body.get("spacing_m", 10))
            heading = float(body.get("heading_deg", 0))
            clat, clon = (float(body["lat"]), float(body["lon"])) if "lat" in body and "lon" in body else self.centroid(air)
            ref = plan.Ref(clat, clon)
            slots = plan.formation_slots(shape, len(air), spacing, heading)
            starts = [ref.to_ne(v.state.lat or clat, v.state.lon or clon) for v in air]
            order = plan.assign(starts, slots)
            goals = {v.tail: (ref.to_ll(*slots[order[i]]), plan.stagger(i, alt)) for i, v in enumerate(air)}
            each(lambda v: v.goto(goals[v.tail][0][0], goals[v.tail][0][1], goals[v.tail][1], f"Formation {shape}"), air)
            self.task = {"task": "formation", "shape": shape, "spacing_m": spacing, "heading_deg": heading, "lat": clat, "lon": clon, "alt_m": alt,
                         "slots": [{"tail": t, "lat": g[0][0], "lon": g[0][1], "alt_m": g[1]} for t, g in goals.items()]}
        elif task == "sweep":
            air = [v for v in vs if v.state.armed and not v.state.landed]
            if not air:
                return {"ok": False, "detail": "Launch the swarm before a sweep"}
            width = float(body.get("width_m", 160))
            height = float(body.get("height_m", 120))
            lane = float(body.get("lane_m", 20))
            heading = float(body.get("heading_deg", 0))
            then = str(body.get("then", "rtl"))
            clat, clon = (float(body["lat"]), float(body["lon"])) if "lat" in body and "lon" in body else self.centroid(air)
            ref = plan.Ref(clat, clon)
            lanes = plan.sweep_lanes(len(air), width, height, lane, heading)
            # Give each vehicle the strip whose first point is nearest, minimising the longest transit.
            starts = [ref.to_ne(v.state.lat or clat, v.state.lon or clon) for v in air]
            order = plan.assign(starts, [lanes[k][0] for k in range(len(lanes))])
            paths = {v.tail: [ref.to_ll(n, e) for n, e in lanes[order[i]]] for i, v in enumerate(air)}
            alts = {v.tail: plan.stagger(i, alt) for i, v in enumerate(air)}
            each(lambda v: v.fly_mission(paths[v.tail], alts[v.tail], then, "Area sweep"), air)
            self.task = {"task": "sweep", "lat": clat, "lon": clon, "width_m": width, "height_m": height, "lane_m": lane, "heading_deg": heading, "alt_m": alt,
                         "corners": [ref.to_ll(*plan._rotate(n, e, heading)) for n, e in ((height / 2, -width / 2), (height / 2, width / 2), (-height / 2, width / 2), (-height / 2, -width / 2))],
                         "paths": [{"tail": t, "points": p} for t, p in paths.items()]}
        else:
            return {"ok": False, "detail": f"Unknown swarm task {task!r}"}
        ok = all(r["ok"] for r in results) and bool(results)
        return {"ok": ok, "detail": "; ".join(f"{r['tail']} {r['detail']}" for r in results) or "Nothing to do", "results": results, "swarm": self.task}

    def run_command(self, body: dict[str, Any]) -> dict[str, Any]:
        v = self.find(str(body.get("tail", "")))
        if not v:
            return {"ok": False, "detail": "No such vehicle on the bridge"}
        action = str(body.get("action", ""))
        alt = float(body.get("alt_m", 20))
        if action == "launch":
            ok, text = v.launch(alt)
        elif action == "goto":
            try:
                lat, lon = float(body["lat"]), float(body["lon"])
            except (KeyError, TypeError, ValueError):
                return {"ok": False, "detail": "goto needs lat and lon"}
            ok, text = v.goto(lat, lon, float(body.get("alt_m", v.state.rel_alt or 20)))
        elif action == "hold":
            ok, text = v.hold()
        elif action == "rtl":
            ok, text = v.rtl()
        elif action == "land":
            ok, text = v.land()
        elif action == "link":
            on = bool(body.get("on", True))
            v.link_cut = not on
            if on:
                v.lost = True  # the next message announces "Link restored"
            ok, text = True, "Link restored by the operator" if on else "Link cut by the operator: PX4 should return to launch after about 10 s"
        else:
            return {"ok": False, "detail": f"Unknown action {action!r}"}
        self.event(v.tail, "info" if ok else "warn", text)
        return {"ok": ok, "detail": text}


ALLOWED_ORIGINS = ("http://localhost", "http://127.0.0.1", "https://drones.productexec.co")


def origin_ok(origin: str | None) -> bool:
    if not origin:
        return True  # curl, scripts, the demo server's proxy
    u = urlparse(origin)
    base = f"{u.scheme}://{u.hostname}"
    if base in ALLOWED_ORIGINS:
        return True
    # Render pull request previews of the hosted demo.
    return u.scheme == "https" and bool(u.hostname) and u.hostname.startswith("drones-demo") and u.hostname.endswith(".onrender.com")


def make_handler(swarm: Swarm) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "a2e-live-bridge/1"

        def log_message(self, fmt: str, *args: Any) -> None:  # quiet: the console polls every second
            if os.environ.get("A2E_BRIDGE_VERBOSE"):
                super().log_message(fmt, *args)

        def _cors(self) -> bool:
            origin = self.headers.get("Origin")
            if not origin_ok(origin):
                return False
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "content-type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                # Chrome's private/local network access preflight for a public page calling localhost.
                self.send_header("Access-Control-Allow-Private-Network", "true")
            return True

        def _json(self, status: int, body: Any) -> None:
            raw = json.dumps(body, allow_nan=False, default=str).encode()
            self.send_response(status)
            if not self._cors():
                pass
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self) -> None:
            if not origin_ok(self.headers.get("Origin")):
                self.send_response(403)
                self.end_headers()
                return
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self) -> None:
            if not origin_ok(self.headers.get("Origin")):
                return self._json(403, {"detail": "origin not allowed"})
            u = urlparse(self.path)
            if u.path == "/v1/live/health":
                return self._json(200, {"ok": True, "vehicles": len(swarm.vehicles), "heard": sum(1 for v in swarm.vehicles if v.sysid), "sim": "PX4 SIH"})
            if u.path == "/v1/live/vehicles":
                since = 0
                for part in u.query.split("&"):
                    if part.startswith("since="):
                        try:
                            since = int(part[6:])
                        except ValueError:
                            since = 0
                return self._json(200, clean(swarm.snapshot(since)))
            return self._json(404, {"detail": "not found"})

        def do_POST(self) -> None:
            if not origin_ok(self.headers.get("Origin")):
                return self._json(403, {"detail": "origin not allowed"})
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                return self._json(415, {"detail": "send application/json"})
            try:
                length = min(int(self.headers.get("Content-Length") or 0), 1 << 16)
                body = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(body, dict):
                    raise TypeError("body must be an object")
            except (ValueError, TypeError):
                return self._json(400, {"detail": "bad json"})
            u = urlparse(self.path)
            try:
                if u.path == "/v1/live/command":
                    out = swarm.run_command(body)
                elif u.path == "/v1/live/swarm":
                    out = swarm.run_task(body)
                else:
                    return self._json(404, {"detail": "not found"})
            except ValueError as error:
                return self._json(400, {"ok": False, "detail": str(error)})
            return self._json(200 if out.get("ok") else 409, clean(out))

    return Handler


def clean(value: Any) -> Any:
    """JSON has no NaN: send null instead."""
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    return value


def endpoints(raw: str, count: int) -> list[str]:
    """One pymavlink endpoint per vehicle. The SIH swarm sends vehicle i to UDP 14550+i."""
    if raw:
        return [e.strip() for e in raw.split(",") if e.strip()]
    return [f"udpin:0.0.0.0:{14550 + i}" for i in range(count)]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vehicles", default=os.environ.get("A2E_LIVE_VEHICLES", ""),
                    help="comma-separated pymavlink endpoints, e.g. serial:/dev/ttyUSB0:57600 for a radio (default: udpin on 14550+i)")
    ap.add_argument("--count", type=int, default=int(os.environ.get("SWARM_COUNT", "4")))
    ap.add_argument("--listen", default=os.environ.get("A2E_BRIDGE_LISTEN", "127.0.0.1:8765"))
    ap.add_argument("--prefix", default="PX4")
    args = ap.parse_args(argv)
    links = [Link(e) for e in endpoints(args.vehicles, args.count)]
    swarm = Swarm(links, args.prefix)
    swarm.start()
    host, _, port = args.listen.rpartition(":")
    server = ThreadingHTTPServer((host or "127.0.0.1", int(port)), make_handler(swarm))
    print(f"live sim bridge: {len(links)} vehicles, http://{args.listen}/v1/live/vehicles", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
