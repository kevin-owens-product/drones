"""Operator-designated visual tracking, closed loop through PX4.

A PX4 SIH quad holds 25 m over a ground scene while a vehicle-sized target
drives a route with turns, passes under tree cover, and goes past parked
look-alikes. Each frame:

1. A downward, gimbal-stabilized camera image is rendered from the PX4
   ground-truth pose (HIL_STATE_QUATERNION). 60 degree field of view, rendered
   at 128x96 and box-filtered to the tracker's 64x48, with sensor noise and a
   slow brightness drift.
2. The C tracker in onboard/track (loaded with ctypes) updates its lock.
3. The pixel error becomes a ground-frame velocity setpoint, sent to PX4 in
   offboard mode with SET_POSITION_TARGET_LOCAL_NED.

The "operator" designates the target once, by clicking its true pixel at the
start. When the tracker drops the lock the vehicle holds position; nothing
re-designates for it.

The scene is a procedural texture, not a photoreal renderer. It is there to
put the real tracker and the real flight controller in one loop, with
occlusion, distractors, turns, and noise that a checkerboard test never has.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from harness import GLOBAL_POSITION_INT, HIL_STATE_QUATERNION, Link, Ned, Sih, to_ned

ROOT = Path(__file__).resolve().parents[2]
W, H = 64, 48
RW, RH = 128, 96
HFOV = math.radians(60)
ALT = 25.0
MPP = 0.25  # texture metres per pixel
TEX = 2048  # texture is TEX x TEX pixels, centred on the start point


class TrackMotion(ctypes.Structure):
    _fields_ = [
        ("n", ctypes.c_float),
        ("e", ctypes.c_float),
        ("vn", ctypes.c_float),
        ("ve", ctypes.c_float),
        ("anchor_n", ctypes.c_float),
        ("anchor_e", ctypes.c_float),
        ("anchor_age_s", ctypes.c_float),
        ("since_adopt_s", ctypes.c_float),
        ("refused_s", ctypes.c_float),
        ("filled", ctypes.c_int),
    ]


class TrackLock(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("misses", ctypes.c_int),
        ("locked", ctypes.c_int),
        ("templ", ctypes.c_uint8 * 64),
        # Fields below exist only in the adaptive tracker. The original
        # struct is a prefix of this one, so one layout serves both.
        ("anchor", ctypes.c_uint8 * 64),
        ("fx", ctypes.c_float),
        ("fy", ctypes.c_float),
        ("vx", ctypes.c_float),
        ("vy", ctypes.c_float),
        ("score", ctypes.c_float),
        ("anchor_score", ctypes.c_float),
        ("rot", ctypes.c_int),
        ("bank", ctypes.c_uint8 * (16 * 64)),
    ]


# The first tracker, before template adaptation and coasting, kept for comparison.
V1_COMMIT = "7371d42"


def load_tracker(version: str) -> ctypes.CDLL:
    build = ROOT / "onboard" / "track" / "build"
    build.mkdir(parents=True, exist_ok=True)
    if version == "v1":
        src_dir = build / "v1"
        (src_dir / "include").mkdir(parents=True, exist_ok=True)
        for rel, dst in (("src/track.c", "track.c"), ("include/track.h", "include/track.h")):
            text = subprocess.run(["git", "-C", str(ROOT), "show", f"{V1_COMMIT}:onboard/track/{rel}"],
                                  capture_output=True, text=True, check=True).stdout
            (src_dir / dst).write_text(text)
        src = src_dir / "track.c"
        inc = src_dir / "include"
        lib = build / "libtrack_v1.so"
    else:
        src = ROOT / "onboard" / "track" / "src" / "track.c"
        inc = src.parents[1] / "include"
        lib = build / "libtrack.so"
    newest = max(src.stat().st_mtime, (inc / "track.h").stat().st_mtime)
    if not lib.exists() or lib.stat().st_mtime < newest:
        subprocess.run(
            ["cc", "-std=c17", "-O2", "-shared", "-fPIC", "-I", str(inc), "-o", str(lib), str(src), "-lm"],
            check=True,
        )
    so = ctypes.CDLL(str(lib))
    so.track_init.argtypes = [ctypes.POINTER(TrackLock), ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    so.track_step.argtypes = [ctypes.POINTER(TrackLock), ctypes.c_void_p]
    so.track_step.restype = ctypes.c_int
    if version != "v1":
        so.track_motion_init.argtypes = [ctypes.POINTER(TrackMotion)]
        so.track_motion_keep.argtypes = [ctypes.POINTER(TrackMotion), ctypes.c_float, ctypes.c_float, ctypes.c_float]
        so.track_motion_keep.restype = ctypes.c_int
        so.track_motion_coast.argtypes = [ctypes.POINTER(TrackMotion), ctypes.c_float]
        so.track_motion_coast.restype = None
    return so


# --- scene -------------------------------------------------------------------------

def value_noise(rng: np.random.Generator, size: int, cell: int) -> np.ndarray:
    coarse = rng.random((size // cell + 2, size // cell + 2))
    ys = np.arange(size) / cell
    xs = np.arange(size) / cell
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = coarse[y0][:, x0]
    b = coarse[y0][:, x0 + 1]
    c = coarse[y0 + 1][:, x0]
    d = coarse[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


@dataclass
class Box:
    n: float
    e: float
    heading: float  # radians from north
    length: float
    width: float
    shade: int


@dataclass
class Tree:
    n: float
    e: float
    r: float


class Scene:
    def __init__(self, seed: int) -> None:
        rng = np.random.default_rng(seed)
        tex = 0.55 * value_noise(rng, TEX, 64) + 0.3 * value_noise(rng, TEX, 16) + 0.15 * value_noise(rng, TEX, 4)
        self.ground = (60 + 110 * tex).astype(np.float32)
        # Two roads crossing the route.
        mid = TEX // 2
        self.ground[mid - 12: mid + 12, :] = 95
        self.ground[:, mid + 120: mid + 144] = 95
        self.route = self._route(rng)
        self.trees = [Tree(float(n), float(e), float(r)) for n, e, r in (
            (60.0, 4.0, 4.0),  # on the route: a planned occlusion
            (130.0, 55.0, 5.0),
            *((rng.uniform(-150, 150), rng.uniform(-150, 150), rng.uniform(2.5, 5)) for _ in range(40)),
        )]
        self.parked = [Box(float(n), float(e), float(h), 4.5, 2.0, int(s)) for n, e, h, s in (
            (30.0, 6.0, 0.0, 185),   # a look-alike next to the route
            (95.0, 3.5, 0.0, 190),
            (120.0, 40.0, 1.57, 180),
            *((rng.uniform(-150, 150), rng.uniform(-150, 150), rng.uniform(0, 3.14), rng.integers(120, 200))
              for _ in range(25)),
        )]
        self.speed = 4.0

    @staticmethod
    def _route(rng: np.random.Generator) -> list[tuple[float, float]]:
        pts = [(0.0, 0.0), (90.0, 0.0), (130.0, 40.0), (130.0, 100.0), (60.0, 120.0), (10.0, 80.0)]
        return [(n + rng.uniform(-3, 3), e + rng.uniform(-3, 3)) for n, e in pts]

    def target(self, t: float) -> Box:
        """Position along the route; heading follows the chord over 6 m of
        travel, so the vehicle turns over about a second and a half instead of
        snapping 45 degrees in one frame."""
        here = self._along(max(0.0, t) * self.speed)
        ahead = self._along(max(0.0, t) * self.speed + 3.0)
        behind = self._along(max(0.0, max(0.0, t) * self.speed - 3.0))
        heading = math.atan2(ahead.e - behind.e, ahead.n - behind.n)
        if ahead.n == behind.n and ahead.e == behind.e:
            heading = here.heading
        return Box(here.n, here.e, heading, 4.5, 2.0, 200)

    def _along(self, s: float) -> Box:
        pts = self.route
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            leg = math.hypot(b[0] - a[0], b[1] - a[1])
            if s <= leg:
                f = s / leg
                return Box(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]),
                           math.atan2(b[1] - a[1], b[0] - a[0]), 4.5, 2.0, 200)
            s -= leg
        a, b = pts[-2], pts[-1]
        return Box(b[0], b[1], math.atan2(b[1] - a[1], b[0] - a[0]), 4.5, 2.0, 200)

    def render(self, cam: Ned, t: float, rng: np.random.Generator, gain: float) -> tuple[np.ndarray, Box, float]:
        half_w = (cam.d * -1) * math.tan(HFOV / 2)
        mpp_img = 2 * half_w / RW
        us = (np.arange(RW) - RW / 2 + 0.5) * mpp_img
        vs = (np.arange(RH) - RH / 2 + 0.5) * mpp_img
        e = cam.e + us[None, :]
        n = cam.n - vs[:, None]
        n, e = np.broadcast_arrays(n, e)
        col = np.clip((e / MPP + TEX / 2).astype(int), 0, TEX - 1)
        row = np.clip((TEX / 2 - n / MPP).astype(int), 0, TEX - 1)
        img = self.ground[row, col].copy()
        tgt = self.target(t)
        for box in (*self.parked, tgt):
            self._paint_box(img, box, n, e)
        for tree in self.trees:
            mask = (n - tree.n) ** 2 + (e - tree.e) ** 2 < tree.r ** 2
            if mask.any():
                img[mask] = 45 + 10 * np.sin(n[mask] * 3) * np.cos(e[mask] * 3)
        small = img.reshape(H, 2, W, 2).mean(axis=(1, 3))
        small = small * gain + rng.normal(0, 4, small.shape)
        return np.clip(small, 0, 255).astype(np.uint8), tgt, mpp_img * 2

    @staticmethod
    def _paint_box(img: np.ndarray, box: Box, n: np.ndarray, e: np.ndarray) -> None:
        dn = n - box.n
        de = e - box.e
        ch, sh = math.cos(box.heading), math.sin(box.heading)
        along = dn * ch + de * sh
        across = -dn * sh + de * ch
        body = (np.abs(along) < box.length / 2) & (np.abs(across) < box.width / 2)
        if not body.any():
            return
        img[body] = box.shade
        glass = body & (along > box.length * 0.1) & (along < box.length * 0.3)
        img[glass] = 40
        roof = body & (along < -box.length * 0.25)
        img[roof] = box.shade - 50


def target_pixel(cam: Ned, tgt: Box, mpp: float) -> tuple[float, float]:
    x = (tgt.e - cam.e) / mpp + W / 2
    y = -(tgt.n - cam.n) / mpp + H / 2
    return x, y


def target_hidden(scene: Scene, tgt: Box) -> bool:
    return any((tgt.n - tr.n) ** 2 + (tgt.e - tr.e) ** 2 < tr.r ** 2 for tr in scene.trees)


@dataclass
class Result:
    seed: int
    tracker: str
    duration_s: float = 0.0
    frames: int = 0
    on_target_frac: float = 0.0
    false_lock_frac: float = 0.0
    lost_at_s: float | None = None
    occluded_frames: int = 0
    coast_frames: int = 0
    gated_frames: int = 0
    reacquired: int = 0
    mean_px_err: float = 0.0
    mean_follow_err_m: float = 0.0
    track_us_p50: float = 0.0
    track_us_p99: float = 0.0
    keep_up: float = 0.0  # sim seconds processed per sim second elapsed; below 1 the harness fell behind
    note: str = ""


GATE_M = float(os.environ.get("A2E_GATE_M", 4.0))
REACQUIRE_FRAMES = 17  # about one second of camera frames
KF_ALPHA = float(os.environ.get("A2E_KF_ALPHA", 0.35))
KF_BETA = float(os.environ.get("A2E_KF_BETA", 0.05))
FOLLOW_GAIN = float(os.environ.get("A2E_FOLLOW_GAIN", 0.5))


def run(seed: int, *, tracker: str, speed: float, duration: float, instance: int,
        save_frames: Path | None) -> Result:
    so = load_tracker(tracker)
    scene = Scene(seed)
    rng = np.random.default_rng(seed + 1000)
    res = Result(seed=seed, tracker={"v1": "ncc-fixed", "v2": "ncc-rotation-bank-coast"}[tracker])
    sim = Sih(f"a2e-trk-{instance}", instance=instance, speed=speed)
    sim.start()
    lock = TrackLock()
    try:
        link = Link(sim.port)
        link.wait_heartbeat(60)
        time.sleep(2.0)
        for name, value in (("COM_RC_IN_MODE", 4), ("NAV_DLL_ACT", 0), ("NAV_RCL_ACT", 0), ("COM_OF_LOSS_T", 5)):
            sim.param(name, value)
        ref = None
        clock_usec = 0
        t0 = 0
        tick = 0
        armed = False
        start_t: float | None = None
        designated = False
        cam = Ned(0, 0, 0)
        kf_pos = [0.0, 0.0]
        kf_vel = [0.0, 0.0]
        motion = TrackMotion()
        gated_run = 0
        on = false = 0
        px_errs: list[float] = []
        follow: list[float] = []
        times: list[float] = []
        asked = 0.0
        deadline = time.monotonic() + (duration + 60) / speed + 90
        frames_dir = save_frames
        while time.monotonic() < deadline:
            msg = link.recv(2.0)
            if msg is None:
                continue
            kind = msg.get_msgId()
            bm = getattr(msg, "time_boot_ms", None)
            if bm:
                clock_usec = bm * 1000
            if kind == 0 and ref is None and time.monotonic() - asked > 1.0:
                asked = time.monotonic()
                link.interval(HIL_STATE_QUATERNION, 50)
                link.interval(GLOBAL_POSITION_INT, 10)
            if kind != HIL_STATE_QUATERNION or clock_usec == 0:
                continue
            if ref is None:
                ref = (msg.lat / 1e7, msg.lon / 1e7, msg.alt / 1e3)
                t0 = clock_usec
            cam = to_ned(msg.lat / 1e7, msg.lon / 1e7, msg.alt / 1e3, ref)
            sim_t = (clock_usec - t0) / 1e6
            boot_ms = clock_usec // 1000
            tick += 1
            if not armed:
                link.setpoint(boot_ms, Ned(0, 0, -ALT))
                if sim_t > 3 and tick % 50 == 0:
                    link.offboard()
                    link.arm()
                hb = link.m.messages.get("HEARTBEAT")
                if hb is not None and hb.base_mode & 128 and (hb.custom_mode >> 16) & 0xFF == 6:
                    armed = True
                continue
            if start_t is None:
                link.setpoint(boot_ms, Ned(0, 0, -ALT))
                if cam.d < -(ALT - 1.0):
                    start_t = sim_t
                    wall0 = time.monotonic()
                continue
            t = sim_t - start_t
            if t > duration:
                break
            if tick % 3:
                continue  # camera and tracker at about 17 Hz of sim time
            gain = 1.0 + 0.15 * math.sin(t / 7.0)
            frame, tgt, mpp = scene.render(cam, t, rng, gain)
            buf = np.ascontiguousarray(frame)
            tx, ty = target_pixel(cam, tgt, mpp)
            if not designated:
                # The operator clicks the target. The tracker gets the click, not the box.
                so.track_init(ctypes.byref(lock), buf.ctypes.data, int(round(tx)) - 4, int(round(ty)) - 4)
                if tracker == "v2":
                    so.track_motion_init(ctypes.byref(motion))
                designated = True
                kf_pos = [cam.n - (lock.y + 4 - H / 2) * mpp, cam.e + (lock.x + 4 - W / 2) * mpp]
                kf_vel = [0.0, 0.0]
            dt_f = 3 / 50.0  # three ground-truth ticks per frame
            gated_mode = tracker == "v2"
            if gated_mode:
                # Predict the target in the ground frame, then point the
                # tracker's search at that prediction. Image-frame velocity is
                # useless here because the camera is chasing the target.
                kf_pos[0] += kf_vel[0] * dt_f
                kf_pos[1] += kf_vel[1] * dt_f
                lock.fx = (kf_pos[1] - cam.e) / mpp + W / 2 - 4
                lock.fy = -(kf_pos[0] - cam.n) / mpp + H / 2 - 4
                lock.vx = 0.0
                lock.vy = 0.0
            t_a = time.perf_counter()
            hit = so.track_step(ctypes.byref(lock), buf.ctypes.data)
            times.append((time.perf_counter() - t_a) * 1e6)
            res.frames += 1
            hidden = target_hidden(scene, tgt)
            res.occluded_frames += int(hidden)
            accepted = bool(hit)
            rx, ry = lock.x + 4, lock.y + 4
            if gated_mode:
                pred_x = (kf_pos[1] - cam.e) / mpp + W / 2
                pred_y = -(kf_pos[0] - cam.n) / mpp + H / 2
                if hit:
                    meas_n = cam.n - (lock.y + 4 - H / 2) * mpp
                    meas_e = cam.e + (lock.x + 4 - W / 2) * mpp
                    rn, re_ = meas_n - kf_pos[0], meas_e - kf_pos[1]
                    # Innovation gate: a match that is not where a moving
                    # target could be is a look-alike, not the target.
                    if math.hypot(rn, re_) > GATE_M and gated_run < REACQUIRE_FRAMES:
                        accepted = False
                        gated_run += 1
                        res.gated_frames += 1
                        so.track_motion_coast(ctypes.byref(motion), dt_f)
                    elif (kept := so.track_motion_keep(ctypes.byref(motion), meas_n, meas_e, dt_f)) != 1:
                        accepted = False
                        res.gated_frames += 1
                        if kept < 0:
                            # Better to stop and ask the operator than follow a parked vehicle.
                            lock.locked = 0
                    else:
                        if gated_run >= REACQUIRE_FRAMES:
                            # The tracker has insisted for a second; trust it.
                            kf_pos = [meas_n, meas_e]
                            kf_vel = [0.0, 0.0]
                            rn = re_ = 0.0
                            res.reacquired += 1
                        gated_run = 0
                        kf_pos[0] += KF_ALPHA * rn
                        kf_pos[1] += KF_ALPHA * re_
                        kf_vel[0] += KF_BETA * rn / dt_f
                        kf_vel[1] += KF_BETA * re_ / dt_f
                        sp = math.hypot(*kf_vel)
                        if sp > 15:
                            kf_vel[0] *= 15 / sp
                            kf_vel[1] *= 15 / sp
                else:
                    so.track_motion_coast(ctypes.byref(motion), dt_f)
                if not accepted:
                    res.coast_frames += 1
                    rx, ry = pred_x, pred_y
            if lock.locked:
                err = math.hypot(rx - tx, ry - ty)
                if err <= 4.0:
                    on += 1
                    px_errs.append(err)
                elif accepted:
                    false += 1  # the tracker claims a match somewhere else
                if gated_mode:
                    # Follow the filtered target: feed-forward its velocity, close the offset.
                    off_n = kf_pos[0] - cam.n
                    off_e = kf_pos[1] - cam.e
                    vn = kf_vel[0] + FOLLOW_GAIN * off_n
                    ve = kf_vel[1] + FOLLOW_GAIN * off_e
                else:
                    # The first tracker: centre the target in the image.
                    off_n = -(ry - H / 2) * mpp
                    off_e = (rx - W / 2) * mpp
                    vn = FOLLOW_GAIN * 2 * off_n
                    ve = FOLLOW_GAIN * 2 * off_e
                vn = max(-10, min(10, vn))
                ve = max(-10, min(10, ve))
            else:
                if res.lost_at_s is None:
                    res.lost_at_s = round(t, 2)
                vn = ve = 0.0  # hold position: loiter on lock loss
            vd = 0.6 * (cam.d + ALT)
            link.velocity(boot_ms, vn, ve, -vd, 0.0)
            follow.append(math.hypot(tgt.n - cam.n, tgt.e - cam.e))
            if frames_dir is not None and res.frames % 4 == 0:
                save_pgm(frames_dir / f"f{res.frames:05d}.pgm", frame, lock, tx, ty)
        res.duration_s = round(duration, 1)
        if start_t is not None:
            # SIH free-runs at `speed`; if the harness reads truth slower than
            # that, frames go stale and the loop is no longer the one we mean.
            res.keep_up = round(min(1.0, duration / max(1e-6, (time.monotonic() - wall0) * speed)), 3)
        if res.frames:
            res.on_target_frac = round(on / res.frames, 3)
            res.false_lock_frac = round(false / res.frames, 3)
        if px_errs:
            res.mean_px_err = round(float(np.mean(px_errs)), 2)
        if follow:
            res.mean_follow_err_m = round(float(np.mean(follow)), 2)
        if times:
            res.track_us_p50 = round(float(np.percentile(times, 50)), 1)
            res.track_us_p99 = round(float(np.percentile(times, 99)), 1)
        if start_t is None:
            res.note = "did not take off"
    finally:
        sim.stop()
    return res


def save_pgm(path: Path, frame: np.ndarray, lock: TrackLock, tx: float, ty: float) -> None:
    img = frame.copy()
    if lock.locked:
        x0, y0 = lock.x, lock.y
        img[max(0, y0), max(0, x0): x0 + 8] = 255
        img[min(H - 1, y0 + 7), max(0, x0): x0 + 8] = 255
        img[max(0, y0): y0 + 8, max(0, x0)] = 255
        img[max(0, y0): y0 + 8, min(W - 1, x0 + 7)] = 255
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        fh.write(f"P5 {W} {H} 255\n".encode())
        fh.write(img.tobytes())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--seed-start", type=int, default=0)
    ap.add_argument("--speed", type=float, default=2.0)
    ap.add_argument("--duration", type=float, default=90.0)
    ap.add_argument("--instance", type=int, default=2)
    ap.add_argument("--frames", default="")
    ap.add_argument("--tracker", choices=("v1", "v2"), default="v2")
    ap.add_argument("--out", default=str(ROOT / "docs" / "eval" / "sitl_track.jsonl"))
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a") as fh:
        for seed in range(args.seed_start, args.seed_start + args.seeds):
            frames = Path(args.frames) / f"{args.tracker}-seed{seed}" if args.frames else None
            row = asdict(run(seed, tracker=args.tracker, speed=args.speed, duration=args.duration, instance=args.instance,
                             save_frames=frames))
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(json.dumps(row), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
