"""GNSS jamming and spoofing against real PX4 EKF2, closed loop.

One PX4 SIH quad takes off and flies a 200 m x 100 m box at 5 m/s in
offboard mode. Two position sources feed EKF2 over MAVLink, as on a real
companion computer:

* GNSS as NMEA on a serial line at 5 Hz, read by PX4's own gps driver
  (nmea_bridge.py). The simulator's GPS is stopped, so this is the only GNSS
  EKF2 sees. Faults are applied here.
* Visual-inertial odometry as VISION_POSITION_ESTIMATE and
  VISION_SPEED_ESTIMATE at 25 Hz.

The VIO is **emulated**: ground truth integrated with a velocity scale error,
a small heading misalignment, a random-walk bias, and white noise, sized to
the roughly 1% of distance travelled that open VIO stacks report on
public drone datasets. It is not OpenVINS on rendered images.

The spoof gate is the C code in onboard/spoof, loaded with ctypes. When it
trips, GNSS stops being forwarded to PX4. Without the gate, every GNSS
sample is forwarded and EKF2's own checks are the only defence.

Each trial reports estimate-minus-truth error from GLOBAL_POSITION_INT (EKF2
output) against HIL_STATE_QUATERNION (SIH ground truth).
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import random
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from harness import GLOBAL_POSITION_INT, HIL_STATE_QUATERNION, Link, Ned, Sih, to_lla, to_ned

ROOT = Path(__file__).resolve().parents[2]
DEBUG = bool(__import__("os").environ.get("A2E_SITL_DEBUG"))
FAULTS = ("none", "loss", "drag", "step", "multipath")


# --- onboard/spoof through ctypes -------------------------------------------------

class Vec3(ctypes.Structure):
    _fields_ = [("n", ctypes.c_double), ("e", ctypes.c_double), ("d", ctypes.c_double)]


class Gate(ctypes.Structure):
    _fields_ = [
        ("gnss_used", ctypes.c_int),
        ("reject_run", ctypes.c_int),
        ("agree_run", ctypes.c_int),
        ("detections", ctypes.c_int),
        ("false_checks", ctypes.c_int),
        ("gate", ctypes.c_double),
        ("reject_need", ctypes.c_int),
        ("recover_need", ctypes.c_int),
        ("last_d2", ctypes.c_double),
    ]


class Decision(ctypes.Structure):
    _fields_ = [
        ("gnss_used", ctypes.c_int),
        ("dropped_now", ctypes.c_int),
        ("recovered_now", ctypes.c_int),
        ("d2", ctypes.c_double),
    ]


def load_gate() -> ctypes.CDLL:
    lib = ROOT / "onboard" / "spoof" / "build" / "libspoof.so"
    src = ROOT / "onboard" / "spoof" / "src" / "spoof.c"
    header = src.parents[1] / "include" / "spoof.h"
    if not lib.exists() or lib.stat().st_mtime < max(src.stat().st_mtime, header.stat().st_mtime):
        lib.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["cc", "-std=c17", "-O2", "-shared", "-fPIC", "-I", str(src.parents[1] / "include"), "-o", str(lib), str(src)],
            check=True,
        )
    so = ctypes.CDLL(str(lib))
    so.spoof_gate_init.argtypes = [ctypes.POINTER(Gate)]
    so.spoof_gate_update.argtypes = [ctypes.POINTER(Gate), Vec3, Vec3, ctypes.c_double]
    so.spoof_gate_update.restype = Decision
    return so


# --- sensor models ---------------------------------------------------------------

class EmulatedVio:
    """Truth plus the error terms that dominate real VIO drift."""

    def __init__(self, rng: random.Random, start: Ned) -> None:
        self.rng = rng
        self.scale = rng.gauss(0, 0.007)
        self.yaw = math.radians(rng.gauss(0, 0.4))
        self.bias = [0.0, 0.0, 0.0]
        self.rw = 0.003  # m/s per sqrt(s)
        self.white = 0.05
        self.pos = [start.n, start.e, start.d]

    def step(self, v: Ned, dt: float) -> tuple[Ned, Ned]:
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        k = 1 + self.scale
        vn = k * (c * v.n - s * v.e) + self.bias[0]
        ve = k * (s * v.n + c * v.e) + self.bias[1]
        vd = k * v.d + self.bias[2]
        self.pos[0] += vn * dt
        self.pos[1] += ve * dt
        self.pos[2] += vd * dt
        for i in range(3):
            self.bias[i] += self.rng.gauss(0, self.rw * math.sqrt(dt))
        noisy = Ned(*(p + self.rng.gauss(0, self.white) for p in self.pos))
        return noisy, Ned(vn, ve, vd)


class Gnss:
    """Truth plus receiver noise, plus the fault once it starts."""

    def __init__(self, rng: random.Random, fault: str, t_fault: float) -> None:
        self.rng = rng
        self.fault = fault
        self.t_fault = t_fault
        self.walk = [0.0, 0.0]
        self.drag_mps = 0.5
        self.step_m = 50.0
        self.multipath_m = 3.0

    def sample(self, t: float, truth: Ned, v: Ned, dt: float) -> tuple[Ned, Ned] | None:
        for i in range(2):
            self.walk[i] = 0.98 * self.walk[i] + self.rng.gauss(0, 0.08)
        p = Ned(truth.n + self.walk[0], truth.e + self.walk[1], truth.d + self.rng.gauss(0, 0.8))
        vel = Ned(v.n + self.rng.gauss(0, 0.1), v.e + self.rng.gauss(0, 0.1), v.d + self.rng.gauss(0, 0.1))
        if t < self.t_fault or self.fault == "none":
            return p, vel
        age = t - self.t_fault
        if self.fault == "loss":
            return None
        if self.fault == "drag":
            # A coherent spoofer: position walks away and velocity agrees with it.
            p.n += self.drag_mps * age
            vel.n += self.drag_mps
        elif self.fault == "step":
            p.e += self.step_m
        elif self.fault == "multipath":
            p.n += self.rng.gauss(0, self.multipath_m)
            p.e += self.rng.gauss(0, self.multipath_m)
        return p, vel


# --- the trial -------------------------------------------------------------------

@dataclass
class Trial:
    fault: str
    mode: str
    seed: int
    t_fault: float = 0.0
    detect_s: float | None = None
    false_drops: int = 0
    err_at_fault_m: float = 0.0
    err_end_m: float = 0.0
    err_max_m: float = 0.0
    err_rmse_m: float = 0.0
    drift_m_per_min: float = 0.0
    denied_s: float = 0.0
    completed: bool = False
    note: str = ""
    series: list[list[float]] = field(default_factory=list)


def route(t: float, speed: float = 5.0, alt: float = 20.0) -> Ned:
    """A 200 m x 100 m box, flown counter-clockwise from the origin."""
    corners = [(0.0, 0.0), (200.0, 0.0), (200.0, 100.0), (0.0, 100.0)]
    perimeter = 600.0
    s = (t * speed) % perimeter
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        leg = math.hypot(b[0] - a[0], b[1] - a[1])
        if s <= leg:
            f = s / leg
            return Ned(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), -alt)
        s -= leg
    return Ned(0, 0, -alt)


MODES = ("gnss_only", "fused", "gated")


def run(fault: str, mode: str, seed: int, *, speed: float, fault_after: float, denied: float,
        instance: int) -> Trial:
    rng = random.Random(seed * 7919 + FAULTS.index(fault))
    gate_on = mode == "gated"
    vio_on = mode != "gnss_only"
    trial = Trial(fault=fault, mode=mode, seed=seed)
    sim = Sih(f"a2e-sih-{instance}", instance=instance, speed=speed)
    so = load_gate()
    gate = Gate()
    so.spoof_gate_init(ctypes.byref(gate))
    sim.start()
    try:
        link = Link(sim.port)
        link.wait_heartbeat(60)
        # Let PX4 finish booting before touching parameters.
        time.sleep(2.0)
        sim.start_nmea_gnss()
        for name, value in (
            ("EKF2_EV_CTRL", 5 if vio_on else 0),  # horizontal position and velocity from vision
            ("EKF2_EV_NOISE_MD", 1),
            ("EKF2_EVP_NOISE", 0.15),
            ("EKF2_EVV_NOISE", 0.1),
            ("EKF2_EV_DELAY", 0),
            ("COM_ARM_WO_GPS", 1),
            ("COM_OF_LOSS_T", 5),
            ("COM_RC_IN_MODE", 4),
            ("NAV_DLL_ACT", 0),
            ("NAV_RCL_ACT", 0),
        ):
            sim.param(name, value)
        link.interval(HIL_STATE_QUATERNION, 50)
        link.interval(GLOBAL_POSITION_INT, 50)

        ref: tuple[float, float, float] | None = None
        vio: EmulatedVio | None = None
        gnss = Gnss(rng, fault, 1e9)
        last_usec = 0
        t0_usec = 0
        tick = 0
        truth = Ned(0, 0, 0)
        armed_at: float | None = None
        fly_start: float | None = None
        offset = [0.0, 0.0, 0.0]
        errs: list[float] = []
        deadline = time.monotonic() + (fault_after + denied + 120) / max(speed, 0.1) + 60
        sim_t = 0.0
        asked = time.monotonic()
        shown = 0.0
        clock_usec = 0
        shown = 0.0
        while time.monotonic() < deadline:
            msg = link.recv(2.0)
            if msg is None:
                continue
            kind = msg.get_msgId()
            if kind == 253 and DEBUG:
                print("text", msg.text, flush=True)
            if kind == 0 and ref is None and time.monotonic() - asked > 1.0:
                # The interval request can be lost while PX4 is still starting.
                asked = time.monotonic()
                link.interval(HIL_STATE_QUATERNION, 50)
                link.interval(GLOBAL_POSITION_INT, 50)
            if DEBUG and kind == 0 and time.monotonic() - shown > 2.0:
                shown = time.monotonic()
                print("hb", round(sim_t, 1), msg.base_mode, (msg.custom_mode >> 16) & 0xFF, armed_at, fly_start, round(truth.d, 1), flush=True)
            boot_ms = getattr(msg, "time_boot_ms", None)
            if boot_ms:
                clock_usec = boot_ms * 1000
            if kind == HIL_STATE_QUATERNION:
                # PX4 leaves time_usec at zero here, so use the newest boot clock.
                usec = msg.time_usec or clock_usec
                if usec == 0:
                    continue
                if ref is None:
                    ref = (msg.lat / 1e7, msg.lon / 1e7, msg.alt / 1e3)
                    t0_usec = usec
                truth = to_ned(msg.lat / 1e7, msg.lon / 1e7, msg.alt / 1e3, ref)
                v = Ned(msg.vx / 100, msg.vy / 100, msg.vz / 100)
                sim_t = (usec - t0_usec) / 1e6
                dt = 0.0 if last_usec == 0 else max(0.0, (usec - last_usec) / 1e6)
                last_usec = max(last_usec, usec)
                if vio is None:
                    vio = EmulatedVio(rng, truth)
                vp, vv = vio.step(v, dt)
                tick += 1
                boot_ms = int(sim_t * 1000)
                if vio_on and tick % 2 == 0:
                    link.vision(usec, vp, 0.0, vv, 0.15**2, 0.1**2)
                if tick % 10 == 0:
                    sample = gnss.sample(sim_t, truth, v, 0.2)
                    if sample is None:
                        # Jammed: the receiver keeps talking but reports no fix.
                        sim.send_fix(0, 0, 0, 0, 0, 99.0, fix=0)
                    else:
                        gp, gv = sample
                        forward = True
                        if gate_on:
                            res = so.spoof_gate_update(
                                ctypes.byref(gate),
                                Vec3(gp.n - offset[0], gp.e - offset[1], gp.d - offset[2]),
                                Vec3(vp.n, vp.e, vp.d),
                                2.5,
                            )
                            if res.dropped_now:
                                if fault in ("drag", "step", "multipath") and sim_t >= gnss.t_fault:
                                    if trial.detect_s is None:
                                        trial.detect_s = round(sim_t - gnss.t_fault, 2)
                                else:
                                    trial.false_drops += 1
                            forward = bool(res.gnss_used)
                            if forward:
                                # Re-anchor VIO to GNSS slowly while GNSS is trusted (tau 60 s).
                                a = 0.2 / 60.0
                                offset[0] += a * ((gp.n - vp.n) - offset[0])
                                offset[1] += a * ((gp.e - vp.e) - offset[1])
                                offset[2] += a * ((gp.d - vp.d) - offset[2])
                        if forward:
                            lat, lon, alt = to_lla(gp, ref)
                            sim.send_fix(lat, lon, alt, gv.n, gv.e, 0.8)
                # Flight plan in sim time.
                if armed_at is None:
                    link.setpoint(boot_ms, Ned(0, 0, -20))
                    if sim_t > 3 and tick % 50 == 0:
                        link.offboard()
                        link.arm()
                    hb = link.m.messages.get("HEARTBEAT")
                    if hb is not None and hb.base_mode & 128 and hb.custom_mode >> 16 & 0xFF == 6:
                        armed_at = sim_t
                elif fly_start is None:
                    link.setpoint(boot_ms, Ned(0, 0, -20))
                    if truth.d < -18.5:
                        fly_start = sim_t
                        gnss.t_fault = fly_start + fault_after
                        trial.t_fault = round(gnss.t_fault, 2)
                else:
                    link.setpoint(boot_ms, route(sim_t - fly_start))
                    if sim_t >= gnss.t_fault + denied:
                        trial.completed = True
                        break
            elif kind == GLOBAL_POSITION_INT and ref is not None and fly_start is not None:
                est = to_ned(msg.lat / 1e7, msg.lon / 1e7, msg.alt / 1e3, ref)
                err = math.hypot(est.n - truth.n, est.e - truth.e)
                if sim_t >= gnss.t_fault:
                    errs.append(err)
                    if not trial.err_at_fault_m and len(errs) == 1:
                        trial.err_at_fault_m = round(err, 2)
                if tick % 25 == 0:
                    trial.series.append([round(sim_t, 2), round(truth.n, 2), round(truth.e, 2),
                                         round(est.n, 2), round(est.e, 2), int(gate.gnss_used)])
        if errs:
            trial.err_end_m = round(sum(errs[-25:]) / len(errs[-25:]), 2)
            trial.err_max_m = round(max(errs), 2)
            trial.err_rmse_m = round(math.sqrt(sum(e * e for e in errs) / len(errs)), 2)
            trial.denied_s = round(denied, 1)
            trial.drift_m_per_min = round((trial.err_end_m - trial.err_at_fault_m) / (denied / 60.0), 2)
        hb = link.m.messages.get("HEARTBEAT")
        if hb is not None and (hb.custom_mode >> 16) & 0xFF != 6:
            trial.note = f"PX4 left offboard (main mode {(hb.custom_mode >> 16) & 0xFF})"
        if not trial.completed:
            trial.note = (trial.note + "; " if trial.note else "") + "did not reach the end of the fault window"
    finally:
        sim.stop()
    return trial


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--faults", default="loss,drag,step,multipath,none")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--seed-start", type=int, default=0)
    ap.add_argument("--speed", type=float, default=4.0)
    ap.add_argument("--fault-after", type=float, default=20.0)
    ap.add_argument("--denied", type=float, default=120.0)
    ap.add_argument("--modes", default=",".join(MODES))
    ap.add_argument("--out", default=str(ROOT / "docs" / "eval" / "sitl_gnss.jsonl"))
    ap.add_argument("--instance", type=int, default=0)
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a") as fh:
        for fault in args.faults.split(","):
            for seed in range(args.seed_start, args.seed_start + args.seeds):
                for mode in args.modes.split(","):
                    trial = run(fault, mode, seed, speed=args.speed, fault_after=args.fault_after,
                                denied=args.denied, instance=args.instance)
                    row = asdict(trial)
                    fh.write(json.dumps(row) + "\n")
                    fh.flush()
                    summary = {k: v for k, v in row.items() if k != "series"}
                    print(json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
