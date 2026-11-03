"""Capture a few seconds of MAVLink from a flight controller on the bench.

The bench talks to the flight controller the way a ground station would, over
USB serial or UDP, and only ever asks for data. ``SafeSender`` is the single
path for outgoing messages and allows exactly four: a ground-station
heartbeat, a parameter list request, a single parameter read, and the two
commands that set a stream rate or request one message. Arming, mode changes,
actuator tests and parameter writes are not on the list, so the bench cannot
send them (ADR-0016).
"""

from __future__ import annotations

import time
from typing import Any

from checks import Capture

MAV_CMD_SET_MESSAGE_INTERVAL = 511
MAV_CMD_REQUEST_MESSAGE = 512
ALLOWED_COMMANDS = frozenset({MAV_CMD_SET_MESSAGE_INTERVAL, MAV_CMD_REQUEST_MESSAGE})
MSG_ATTITUDE = 30
MSG_HIGHRES_IMU = 105
MSG_AUTOPILOT_VERSION = 148
MAV_TYPE_GCS = 6
MAV_AUTOPILOT_INVALID = 8


class Refused(RuntimeError):
    """The bench tried to send something outside its read-only allow-list."""


class SafeSender:
    """The only way the bench sends MAVLink. Read-only by construction."""

    def __init__(self, mav: Any, target_system: int = 1, target_component: int = 1) -> None:
        self._mav = mav
        self.ts = target_system
        self.tc = target_component

    def heartbeat(self) -> None:
        self._mav.heartbeat_send(MAV_TYPE_GCS, MAV_AUTOPILOT_INVALID, 0, 0, 0)

    def param_request_list(self) -> None:
        self._mav.param_request_list_send(self.ts, self.tc)

    def param_request_read(self, name: str) -> None:
        self._mav.param_request_read_send(self.ts, self.tc, name.encode(), -1)

    def command(self, cmd: int, *params: float) -> None:
        if cmd not in ALLOWED_COMMANDS:
            raise Refused(f"command {cmd} is not on the bench allow-list")
        p = list(params) + [0.0] * (7 - len(params))
        self._mav.command_long_send(self.ts, self.tc, cmd, 0, *p)

    def stream(self, msg_id: int, hz: float) -> None:
        self.command(MAV_CMD_SET_MESSAGE_INTERVAL, msg_id, 1e6 / hz)

    def request(self, msg_id: int) -> None:
        self.command(MAV_CMD_REQUEST_MESSAGE, msg_id)

    def __getattr__(self, name: str) -> Any:
        raise Refused(f"{name} is not on the bench allow-list")


def _name(raw: Any) -> str:
    return (raw.decode(errors="ignore") if isinstance(raw, bytes) else str(raw)).rstrip("\x00")


def capture(connect: str, baud: int, seconds: float, want_params: list[str], heartbeat_timeout: float = 10.0) -> Capture:
    """Connect, ask for what the checks need, and record for ``seconds``."""
    from pymavlink import mavutil

    m = mavutil.mavlink_connection(connect, baud=baud, source_system=255, source_component=190)
    try:
        if m.wait_heartbeat(timeout=heartbeat_timeout) is None:
            return Capture(duration_s=0.0)
        tx = SafeSender(m.mav, m.target_system, m.target_component or 1)
        tx.heartbeat()
        tx.request(MSG_AUTOPILOT_VERSION)
        tx.stream(MSG_ATTITUDE, 50)
        tx.stream(MSG_HIGHRES_IMU, 100)
        tx.param_request_list()

        warmup = min(1.0, seconds / 4)
        cap = Capture(duration_s=seconds, attitude_window_s=seconds - warmup)
        last_seq: dict[tuple[int, int], int] = {}
        start = time.monotonic()
        next_hb = start + 1.0
        reread_at = start + seconds * 0.7
        reread = False
        while (now := time.monotonic()) - start < seconds:
            if now >= next_hb:
                tx.heartbeat()
                next_hb += 1.0
            if not reread and now >= reread_at:
                for p in want_params:
                    if p not in cap.params:
                        tx.param_request_read(p)
                reread = True
            msg = m.recv_match(blocking=True, timeout=0.1)
            if msg is None:
                continue
            kind = msg.get_type()
            if kind == "BAD_DATA":
                continue
            key = (msg.get_srcSystem(), msg.get_srcComponent())
            if key == (m.target_system, m.target_component or 1):
                seq = msg.get_seq()
                if key in last_seq:
                    cap.seq_lost += (seq - last_seq[key] - 1) % 256
                cap.seq_total += 1 + ((seq - last_seq[key] - 1) % 256 if key in last_seq else 0)
                last_seq[key] = seq
            if kind == "HEARTBEAT" and msg.get_srcComponent() == (m.target_component or 1):
                cap.heartbeats.append({"autopilot": msg.autopilot, "type": msg.type, "base_mode": msg.base_mode})
            elif kind == "AUTOPILOT_VERSION":
                cap.flight_sw_version = msg.flight_sw_version
            elif kind == "SYS_STATUS":
                cap.sys_status = {
                    "present": msg.onboard_control_sensors_present,
                    "enabled": msg.onboard_control_sensors_enabled,
                    "health": msg.onboard_control_sensors_health,
                }
            elif kind == "PARAM_VALUE":
                cap.params[_name(msg.param_id)] = float(msg.param_value)
            elif kind == "HIGHRES_IMU":
                cap.imu.append((msg.xgyro, msg.ygyro, msg.zgyro, msg.xacc, msg.yacc, msg.zacc))
            elif kind == "ATTITUDE" and now - start >= warmup:
                cap.attitude_count += 1
        return cap
    finally:
        m.close()
