"""Read a PX4 .ulg with pyulog. The series is what the debrief plot draws."""

from __future__ import annotations

import re
from pathlib import Path
from typing import TypedDict

from pyulog import ULog  # type: ignore[import-untyped]

from a2e.flight.fixtures import fixture_root

_NAME = re.compile(r"[A-Za-z0-9._-]+")
_FIXTURES = fixture_root("px4")


class Summary(TypedDict):
    duration_s: float
    messages: list[str]
    counts: dict[str, int]


def summarize(path: str | Path) -> Summary:
    log = ULog(str(path))
    names = sorted({item.name for item in log.data_list})
    duration_s = (log.last_timestamp - log.start_timestamp) / 1e6
    counts = {name: _count(log, name) for name in names}
    return {"duration_s": duration_s, "messages": names, "counts": counts}


def fixture_ulg(name: str) -> Path | None:
    if _NAME.fullmatch(name) is None:
        return None
    root = _FIXTURES.resolve()
    candidate = (root / name).resolve()
    if root != candidate and root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


def plot_series(path: str | Path) -> dict[str, list[float]]:
    """Local-position down axis and attitude quaternion, in seconds from log start."""
    log = ULog(str(path))
    start = log.start_timestamp
    local = log.get_dataset("vehicle_local_position")
    attitude = log.get_dataset("vehicle_attitude")
    return {
        "t_s": [float(t - start) / 1e6 for t in local.data["timestamp"]],
        "z_m": [float(v) for v in local.data["z"]],
        "attitude_t_s": [float(t - start) / 1e6 for t in attitude.data["timestamp"]],
        "q0": [float(v) for v in attitude.data["q[0]"]],
    }


def _count(log: ULog, name: str) -> int:
    data = log.get_dataset(name).data
    stamps = data.get("timestamp")
    if stamps is None:
        return 0
    return int(len(stamps))
