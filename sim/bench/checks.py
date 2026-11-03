"""End-of-line bench checks on a captured MAVLink stream.

Everything here is pure: it takes a ``Capture`` (what the flight controller
said during a few seconds on the bench) and a profile (what this variant is
supposed to say), and returns a list of ``Check`` results. No I/O, no
pymavlink, so the logic is unit tested without hardware.

The bench never arms the vehicle (ADR-0016). One of the checks is that the
flight controller reported itself disarmed for the whole capture.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import asdict, dataclass, field
from typing import Any

MAV_MODE_FLAG_SAFETY_ARMED = 128
# SYS_STATUS sensor bits the bench requires present, enabled and healthy.
SENSORS = {"gyro": 1, "accel": 2, "mag": 4, "baro": 8}


@dataclass
class Capture:
    """What the flight controller sent during one bench capture."""

    duration_s: float
    heartbeats: list[dict[str, int]] = field(default_factory=list)  # autopilot, type, base_mode
    flight_sw_version: int | None = None
    sys_status: dict[str, int] | None = None  # present, enabled, health bitmasks
    params: dict[str, float] = field(default_factory=dict)
    imu: list[tuple[float, float, float, float, float, float]] = field(default_factory=list)  # gx gy gz ax ay az
    attitude_count: int = 0
    attitude_window_s: float = 0.0  # time the attitude count covers, after stream warm-up
    seq_lost: int = 0
    seq_total: int = 0


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    value: float | None = None
    low: float | None = None
    high: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def decode_px4_version(v: int) -> str:
    """PX4 packs flight_sw_version as major<<24 | minor<<16 | patch<<8 | type."""
    return f"{(v >> 24) & 0xFF}.{(v >> 16) & 0xFF}.{(v >> 8) & 0xFF}"


def imu_stats(imu: list[tuple[float, float, float, float, float, float]]) -> dict[str, float]:
    """Noise is the worst axis standard deviation; bias the worst axis mean gyro rate."""
    cols = list(zip(*imu, strict=True))
    gyro, accel = cols[:3], cols[3:]
    mag = [math.sqrt(ax * ax + ay * ay + az * az) for ax, ay, az in zip(*accel, strict=True)]
    return {
        "gyro_noise_rad_s": max(statistics.pstdev(c) for c in gyro),
        "gyro_bias_rad_s": max(abs(statistics.fmean(c)) for c in gyro),
        "accel_noise_m_s2": max(statistics.pstdev(c) for c in accel),
        "accel_gravity_m_s2": statistics.fmean(mag),
    }


def _in(value: float, lo: float, hi: float) -> bool:
    return lo <= value <= hi


def run(cap: Capture, profile: dict[str, Any]) -> list[Check]:
    out: list[Check] = []

    if not cap.heartbeats:
        return [Check("heartbeat", False, "no heartbeat: check the cable, port and baud rate")]
    hb = cap.heartbeats[0]
    ok = hb["autopilot"] == profile["autopilot"] and hb["type"] == profile["vehicle_type"]
    out.append(Check("heartbeat", ok, f"autopilot {hb['autopilot']}, vehicle type {hb['type']}" + ("" if ok else f"; expected {profile['autopilot']}, {profile['vehicle_type']}")))

    armed = sum(1 for h in cap.heartbeats if h["base_mode"] & MAV_MODE_FLAG_SAFETY_ARMED)
    out.append(Check("disarmed", armed == 0, "disarmed for the whole capture" if armed == 0 else f"reported ARMED in {armed} heartbeats; stop and check the bench"))

    # Packet loss comes before the content checks: a lossy link makes them fail as a consequence.
    loss = cap.seq_lost / cap.seq_total if cap.seq_total else 1.0
    out.append(Check("link loss", loss <= profile["link_loss_max"], f"{loss:.2%} of {cap.seq_total} packets", round(loss, 4), 0, profile["link_loss_max"]))

    if cap.flight_sw_version is None:
        out.append(Check("firmware", False, "no AUTOPILOT_VERSION reply"))
    else:
        got = decode_px4_version(cap.flight_sw_version)
        out.append(Check("firmware", got == profile["firmware"], f"{got}" + ("" if got == profile["firmware"] else f"; expected {profile['firmware']}")))

    if cap.sys_status is None:
        out.append(Check("sensors", False, "no SYS_STATUS"))
    else:
        bad = [n for n, bit in SENSORS.items() if not (cap.sys_status["present"] & cap.sys_status["enabled"] & cap.sys_status["health"] & bit)]
        out.append(Check("sensors", not bad, "gyro, accel, mag and baro healthy" if not bad else f"unhealthy: {', '.join(bad)}"))

    for name, rule in profile["params"].items():
        if name not in cap.params:
            out.append(Check(f"param {name}", False, f"missing ({rule['why']})"))
            continue
        v = cap.params[name]
        if "eq" in rule:
            ok = math.isclose(v, rule["eq"], abs_tol=1e-6)
            out.append(Check(f"param {name}", ok, f"{v:g}" + ("" if ok else f"; expected {rule['eq']:g} ({rule['why']})"), v, rule["eq"], rule["eq"]))
        else:
            ok = _in(v, rule["min"], rule["max"])
            out.append(Check(f"param {name}", ok, f"{v:g}" + ("" if ok else f"; expected {rule['min']:g} to {rule['max']:g} ({rule['why']})"), v, rule["min"], rule["max"]))

    if len(cap.imu) < 50:
        out.append(Check("imu", False, f"only {len(cap.imu)} IMU samples"))
    else:
        for name, value in imu_stats(cap.imu).items():
            lo, hi = profile["imu"][name]
            out.append(Check(f"imu {name}", _in(value, lo, hi), f"{value:.4f}", round(value, 5), lo, hi))

    window = cap.attitude_window_s or cap.duration_s
    hz = cap.attitude_count / window if window > 0 else 0.0
    out.append(Check("attitude rate", hz >= profile["attitude_hz_min"], f"{hz:.1f} Hz", round(hz, 1), profile["attitude_hz_min"], None))

    return out


def passed(checks: list[Check]) -> bool:
    return all(c.passed for c in checks)


def first_failure(checks: list[Check]) -> str:
    bad = next((c for c in checks if not c.passed), None)
    return f"{bad.name}: {bad.detail}" if bad else ""
