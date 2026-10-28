"""Synchronize telemetry, tracks, and KLV cues onto one timeline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Cue:
    time_us: int
    kind: str
    payload: dict[str, Any]


def build_timeline(*groups: list[Cue]) -> list[Cue]:
    merged = [cue for group in groups for cue in group]
    return sorted(merged, key=lambda cue: cue.time_us)
