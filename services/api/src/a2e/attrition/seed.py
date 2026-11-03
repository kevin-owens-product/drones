"""The synthetic world behind the attrition demo. Simulated, seeded, labelled.

Four units fly a mixed fleet of two airframe variants for four weeks. Variant B
costs more but its radio is assumed to hold up better under jamming. Units see
different amounts of jamming. Every airframe has a birth record with a factory
lot, an ESC lot, a motor lot and a firmware build, drawn independently of its
unit so a lot is not confused with a unit's exposure.

``plant`` makes one attribute value worse from a given day: sorties on those
airframes are lost at ``multiplier`` times the normal rate, and the extra
losses are logged as power or ESC failures. The autopsy is never told which
value was planted; ``evaluate`` measures how often it finds it.

Every rate and price here is an assumption chosen to be plausible, not a
measurement.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from a2e.attrition.model import Airframe, CostModel, Outcome, Sortie

SOURCE = "Simulated (seeded synthetic data; costs and rates are assumptions)"

UNITS: dict[str, float] = {"Alpha": 1.6, "Bravo": 1.0, "Charlie": 1.25, "Delta": 0.7}
"""Unit name to relative jamming exposure."""

VARIANTS: dict[str, float] = {"A": 1.0, "B": 0.45}
"""Variant to relative susceptibility of its link and navigation to jamming."""

COSTS = CostModel(airframe_usd={"A": 1800.0, "B": 2150.0})

MISSIONS: dict[str, tuple[float, float, float]] = {
    # name: (base loss probability, operator minutes, share of sorties)
    "survey": (0.020, 22.0, 0.45),
    "observe": (0.030, 18.0, 0.35),
    "relay": (0.012, 35.0, 0.20),
}
ABORT = 0.07

FACTORY_LOTS = ("F-2609", "F-2610", "F-2611", "F-2612")
ESC_LOTS = ("ESC-2607", "ESC-2608", "ESC-2609", "ESC-2610", "ESC-2611", "ESC-2612")
MOTOR_LOTS = ("MOT-31", "MOT-32", "MOT-33", "MOT-34", "MOT-35")
FIRMWARE = ("4.5.1", "4.5.2", "4.6.0")

_CAUSES_JAM = (("link loss", 0.40), ("GNSS spoof or drift", 0.25))
_CAUSES_OTHER = (("power / ESC", 0.10), ("crash on landing", 0.15), ("unknown", 0.10))


@dataclass(frozen=True)
class Plant:
    attribute: str
    value: str
    start_day: int
    multiplier: float


DEFAULT_PLANT = Plant("esc_lot", "ESC-2611", start_day=14, multiplier=3.0)


@dataclass
class World:
    seed: int
    days: int
    airframes: list[Airframe]
    sorties: list[Sortie]
    spares: dict[tuple[str, str], int]
    plant: Plant | None
    costs: CostModel = field(default_factory=lambda: COSTS)
    source: str = SOURCE


def _cause(rng: random.Random, jam: float) -> str:
    weights = [(c, w * jam) for c, w in _CAUSES_JAM] + list(_CAUSES_OTHER)
    pick = rng.random() * sum(w for _, w in weights)
    for c, w in weights:
        pick -= w
        if pick <= 0:
            return c
    return weights[-1][0]


def make_world(
    seed: int = 7,
    days: int = 28,
    per_unit: dict[str, int] | None = None,
    sorties_per_day: int = 32,
    plant: Plant | None = DEFAULT_PLANT,
    resupply: int = 6,
) -> World:
    """``resupply`` airframes per unit and variant arrive at the start of each week."""
    rng = random.Random(seed)
    mix = per_unit or {"A": 130, "B": 60}
    airframes: list[Airframe] = []
    n = 0
    for unit in UNITS:
        for variant, count in mix.items():
            for _ in range(count):
                n += 1
                airframes.append(
                    Airframe(
                        serial=f"{variant}{n:05d}",
                        variant=variant,
                        unit=unit,
                        factory_lot=rng.choice(FACTORY_LOTS),
                        esc_lot=rng.choice(ESC_LOTS),
                        motor_lot=rng.choice(MOTOR_LOTS),
                        firmware=rng.choice(FIRMWARE),
                    )
                )

    spares = {(u, v): rng.randint(18, 40) for u in UNITS for v in mix}
    alive: dict[str, list[Airframe]] = {u: [a for a in airframes if a.unit == u] for u in UNITS}
    names = list(MISSIONS)
    shares = [MISSIONS[m][2] for m in names]
    sorties: list[Sortie] = []
    for day in range(days):
        if day and day % 7 == 0:
            for key in spares:
                spares[key] += resupply
        for unit, exposure in UNITS.items():
            # Alpha's tempo doubles in the last week, which the demand signal should see.
            tempo = sorties_per_day * (2 if unit == "Alpha" and day >= days - 7 else 1)
            for _ in range(tempo):
                pool = alive[unit]
                if not pool:
                    break
                a = rng.choice(pool)
                mission = rng.choices(names, weights=shares)[0]
                base, op_min, _ = MISSIONS[mission]
                jam = exposure * VARIANTS[a.variant]
                p = base * (0.5 + 0.7 * jam)
                bad = (
                    plant is not None
                    and day >= plant.start_day
                    and getattr(a, plant.attribute) == plant.value
                )
                p_bad = p * plant.multiplier if bad and plant else p
                u = rng.random()
                outcome: Outcome
                if u < p:
                    outcome, cause = "lost", _cause(rng, jam)
                elif u < p_bad:
                    outcome, cause = "lost", "power / ESC"
                elif rng.random() < ABORT:
                    outcome, cause = "aborted", ""
                else:
                    outcome, cause = "effective", ""
                minutes = op_min * rng.uniform(0.8, 1.2)
                sorties.append(
                    Sortie(day, a.serial, unit, a.variant, mission, outcome, cause, minutes)
                )
                if outcome == "lost":
                    pool.remove(a)
                    key = (unit, a.variant)
                    spares[key] = max(0, spares[key] - 1)
    return World(seed, days, airframes, sorties, spares, plant)
