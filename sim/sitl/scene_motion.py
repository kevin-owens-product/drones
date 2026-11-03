"""Tracker on the rendered scene, camera chasing the track.

This is not the PX4 loop. The camera is a point at 25 m that moves toward the
filtered track. A swap onto a parked vehicle pulls the camera off the true
target, which is the failure the motion gate is meant to refuse.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass
from pathlib import Path

# harness imports pymavlink at load, and this scene does not talk MAVLink.
if "pymavlink" not in sys.modules:
    stub = types.ModuleType("pymavlink")
    stub.mavutil = types.ModuleType("pymavlink.mavutil")  # type: ignore[attr-defined]
    sys.modules["pymavlink"] = stub
    sys.modules["pymavlink.mavutil"] = stub.mavutil

import numpy as np

from harness import Ned
from track_loop import H, W, TrackLock, TrackMotion, load_tracker, target_hidden, target_pixel
from track_loop import Scene


@dataclass
class SceneResult:
    seed: int
    frames: int
    on_target: int
    false_lock: int
    gated: int
    lost: int


def run_seed(seed: int, duration_s: float) -> SceneResult:
    so = load_tracker("v2")
    scene = Scene(seed)
    rng = np.random.default_rng(seed + 1000)
    lock = TrackLock()
    motion = TrackMotion()
    so.track_motion_init(motion)
    designated = False
    dt = 3 / 50.0
    frames = on = false = gated = lost = 0
    cam_n = scene.target(0).n
    cam_e = scene.target(0).e
    filt_n = cam_n
    filt_e = cam_e
    vel_n = 0.0
    vel_e = 0.0
    t = 0.0
    while t < duration_s:
        tgt = scene.target(t)
        cam = Ned(cam_n, cam_e, -25.0)
        frame, tgt, mpp = scene.render(cam, t, rng, 1.0)
        buf = np.ascontiguousarray(frame)
        tx, ty = target_pixel(cam, tgt, mpp)
        if not designated:
            so.track_init(lock, buf.ctypes.data, int(round(tx)) - 4, int(round(ty)) - 4)
            so.track_motion_init(motion)
            designated = True
        hit = so.track_step(lock, buf.ctypes.data)
        frames += 1
        adopted = False
        if not lock.locked:
            lost += 1
        elif hit:
            meas_n = cam.n - (lock.y + 4 - H / 2) * mpp
            meas_e = cam.e + (lock.x + 4 - W / 2) * mpp
            if not so.track_motion_keep(motion, meas_n, meas_e, dt):
                gated += 1
            else:
                adopted = True
                filt_n = meas_n
                filt_e = meas_e
                vel_n = motion.vn
                vel_e = motion.ve
                err = ((lock.x + 4 - tx) ** 2 + (lock.y + 4 - ty) ** 2) ** 0.5
                if err <= 4.0:
                    on += 1
                elif not target_hidden(scene, tgt):
                    false += 1
        speed = (vel_n * vel_n + vel_e * vel_e) ** 0.5
        if speed > 8.0:
            vel_n *= 8.0 / speed
            vel_e *= 8.0 / speed
        cam_n += (vel_n + 0.5 * (filt_n - cam_n)) * dt
        cam_e += (vel_e + 0.5 * (filt_e - cam_e)) * dt
        t += dt
    return SceneResult(seed, frames, on, false, gated, lost)


def main() -> None:
    duration = 30.0
    seeds = (1, 2, 3)
    print("scene_camera track_chase duration_s", duration)
    for seed in seeds:
        result = run_seed(seed, duration)
        print(
            f"scene_seed {result.seed} frames {result.frames} on_target {result.on_target} "
            f"false_lock {result.false_lock} motion_gated {result.gated} lost {result.lost}"
        )


if __name__ == "__main__":
    main()
