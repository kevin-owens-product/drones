"""Readiness and resupply forecasting: how many airframes a unit can put up tomorrow.

Two inputs drive it. Battery packs wear: state of health (SoH) is measured
capacity over rated capacity, and the fade per cycle so far predicts how many
cycles a pack has left before it falls below the retirement floor. Airframes
are lost or grounded at some rate per sortie, estimated from the unit's own
history with a Wilson interval so a short history gives a wide range.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

SOH_FLOOR = 0.80
CYCLE_LIMIT = 300
_Z90 = 1.645


@dataclass(frozen=True)
class Pack:
    serial: str
    cycles: int
    capacity_mah: float
    rated_mah: float


@dataclass(frozen=True)
class PackHealth:
    soh: float
    fade_per_cycle: float
    cycles_left: int
    usable: bool


def pack_health(p: Pack, floor: float = SOH_FLOOR, limit: int = CYCLE_LIMIT) -> PackHealth:
    if p.rated_mah <= 0 or p.cycles < 0 or p.capacity_mah < 0:
        raise ValueError(f"pack {p.serial}: bad capacity or cycle count")
    soh = min(1.0, p.capacity_mah / p.rated_mah)
    fade = (1.0 - soh) / p.cycles if p.cycles > 0 else 0.0
    by_limit = max(0, limit - p.cycles)
    by_fade = math.floor((soh - floor) / fade + 1e-9) if fade > 0 else by_limit
    left = max(0, min(by_limit, by_fade))
    return PackHealth(soh, fade, left, soh >= floor and p.cycles < limit)


def attrition_rate(losses: int, sorties: int) -> tuple[float, float, float]:
    """Losses per sortie: point estimate and a 90% Wilson interval."""
    if sorties <= 0 or not 0 <= losses <= sorties:
        raise ValueError("need 0 <= losses <= sorties and sorties > 0")
    p = losses / sorties
    z2 = _Z90 * _Z90
    centre = (p + z2 / (2 * sorties)) / (1 + z2 / sorties)
    half = (
        _Z90 * math.sqrt(p * (1 - p) / sorties + z2 / (4 * sorties * sorties)) / (1 + z2 / sorties)
    )
    return p, max(0.0, centre - half), min(1.0, centre + half)


@dataclass(frozen=True)
class Forecast:
    unit: str
    expected: float
    low: int
    high: int
    limited_by: str


def ready_tomorrow(
    unit: str,
    airframes_ready: int,
    packs: list[Pack],
    sorties_per_airframe: int,
    losses: int,
    sorties: int,
    packs_per_airframe: int = 2,
) -> Forecast:
    """Airframes ready at start of tomorrow, after today's planned sorties.

    Each sortie uses one cycle on one pack; cycles are spread evenly over the
    usable packs. A pack still counts tomorrow if it has cycles left after today.
    """
    if airframes_ready < 0 or sorties_per_airframe < 0 or packs_per_airframe < 1:
        raise ValueError("counts must be non-negative")
    _, r_lo, r_hi = attrition_rate(losses, sorties)
    r = losses / sorties
    s = sorties_per_airframe
    expected = airframes_ready * (1 - r) ** s
    low = math.floor(airframes_ready * (1 - r_hi) ** s + 1e-9)
    high = math.floor(airframes_ready * (1 - r_lo) ** s + 1e-9)

    usable = [h for h in (pack_health(p) for p in packs) if h.usable]
    today = math.ceil(airframes_ready * s / len(usable)) if usable else 0
    pack_cap = sum(1 for h in usable if h.cycles_left > today) // packs_per_airframe
    limited = "packs" if pack_cap < high else "attrition"
    return Forecast(unit, min(expected, pack_cap), min(low, pack_cap), min(high, pack_cap), limited)
