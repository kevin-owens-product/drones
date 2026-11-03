"""The motion gate the tracker harness calls. No PX4 process and no numpy.

TrackMotion must stay the same layout as the class in track_loop.py.
"""

from __future__ import annotations

import ast
import ctypes
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class TrackMotion(ctypes.Structure):
    _fields_ = [
        ("n", ctypes.c_float),
        ("e", ctypes.c_float),
        ("vn", ctypes.c_float),
        ("ve", ctypes.c_float),
        ("filled", ctypes.c_int),
    ]


def load() -> ctypes.CDLL:
    src = ROOT / "onboard" / "track" / "src" / "track.c"
    inc = ROOT / "onboard" / "track" / "include"
    lib = ROOT / "onboard" / "track" / "build" / "libtrack.so"
    lib.parent.mkdir(parents=True, exist_ok=True)
    newest = max(src.stat().st_mtime, (inc / "track.h").stat().st_mtime)
    if not lib.exists() or lib.stat().st_mtime < newest:
        subprocess.run(
            ["cc", "-std=c17", "-O2", "-shared", "-fPIC", "-I", str(inc), "-o", str(lib), str(src), "-lm"],
            check=True,
        )
    so = ctypes.CDLL(str(lib))
    so.track_motion_init.argtypes = [ctypes.POINTER(TrackMotion)]
    so.track_motion_keep.argtypes = [ctypes.POINTER(TrackMotion), ctypes.c_float, ctypes.c_float, ctypes.c_float]
    so.track_motion_keep.restype = ctypes.c_int
    return so


def harness_fields() -> list[str]:
    tree = ast.parse((Path(__file__).parent / "track_loop.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "TrackMotion":
            for item in node.body:
                if isinstance(item, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_fields_" for t in item.targets):
                    return [elt.elts[0].value for elt in item.value.elts]  # type: ignore[attr-defined]
    raise AssertionError("TrackMotion is missing from track_loop.py")


class MotionGate(unittest.TestCase):
    def test_harness_layout_matches(self) -> None:
        self.assertEqual(harness_fields(), [name for name, _typ in TrackMotion._fields_])

    def test_a_stop_does_not_replace_a_moving_track(self) -> None:
        so = load()
        motion = TrackMotion()
        so.track_motion_init(motion)
        kept = 0
        for i in range(12):
            kept += so.track_motion_keep(motion, 0.0, 0.8 * i, 0.2)
        rejected = 0
        for _ in range(6):
            rejected += so.track_motion_keep(motion, 0.0, 0.8 * 11, 0.2) == 0
        speed = (motion.vn * motion.vn + motion.ve * motion.ve) ** 0.5
        self.assertEqual(kept, 12)
        self.assertEqual(rejected, 6)
        self.assertAlmostEqual(speed, 3.92, delta=0.05)


if __name__ == "__main__":
    unittest.main()
