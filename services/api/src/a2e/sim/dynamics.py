"""Point-mass vehicle step with wind. Group 1–3 navigation only."""

from __future__ import annotations

import math
from dataclasses import dataclass

METERS_PER_DEG_LAT = 111_320.0


@dataclass(frozen=True)
class KinematicState:
    lat: float
    lon: float
    alt_m: float
    vn: float
    ve: float
    vd: float


@dataclass(frozen=True)
class Wind:
    vn: float = 0.0
    ve: float = 0.0
    vd: float = 0.0


def step(state: KinematicState, wind: Wind, dt: float) -> KinematicState:
    if dt < 0:
        raise ValueError("dt must be non-negative")
    lat = state.lat + (state.vn + wind.vn) * dt / METERS_PER_DEG_LAT
    meters_per_deg_lon = METERS_PER_DEG_LAT * max(0.2, abs(math.cos(math.radians(state.lat))))
    lon = state.lon + (state.ve + wind.ve) * dt / meters_per_deg_lon
    alt = max(0.0, state.alt_m + (-state.vd - wind.vd) * dt)
    return KinematicState(lat, lon, alt, state.vn, state.ve, state.vd)


def energy_used(state: KinematicState, dt: float) -> float:
    speed = float((state.vn**2 + state.ve**2 + state.vd**2) ** 0.5)
    return speed * dt
