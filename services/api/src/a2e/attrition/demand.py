"""Demand signal: field losses turned into what the factory builds next.

For each unit and airframe variant, the loss rate over a trailing window gives
an expected number of airframes lost per day. Over the planning horizon that
becomes a need with a Poisson upper bound, the spares on hand become days of
supply, and anything the upper bound needs beyond the spares becomes the build
order for that variant. Units are listed shortest days of supply first, which
is the order the factory should ship in.

A Poisson rate from two weeks of losses is a crude forecast. The point is the
loop from field to factory, not the accuracy of the number.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from a2e.attrition.model import Sortie


def poisson_quantile(mean: float, q: float) -> int:
    """Smallest k with P(X <= k) >= q for X ~ Poisson(mean)."""
    if mean < 0 or not 0 < q < 1:
        raise ValueError("need mean >= 0 and 0 < q < 1")
    if mean == 0:
        return 0
    k, term = 0, math.exp(-mean)
    cdf = term
    while cdf < q:
        k += 1
        term *= mean / k
        cdf += term
        if k > 10 * mean + 100:
            break
    return k


@dataclass(frozen=True)
class Supply:
    unit: str
    variant: str
    losses: int
    per_day: float
    trend: float | None
    spares: int
    days_of_supply: float | None
    need_expected: float
    need_high: int
    short: int

    def as_dict(self) -> dict[str, object]:
        return {
            "unit": self.unit,
            "variant": self.variant,
            "losses": self.losses,
            "per_day": round(self.per_day, 2),
            "trend": None if self.trend is None else round(self.trend, 2),
            "spares": self.spares,
            "days_of_supply": None
            if self.days_of_supply is None
            else round(self.days_of_supply, 1),
            "need_expected": round(self.need_expected, 1),
            "need_high": self.need_high,
            "short": self.short,
        }


def supply(
    sorties: Iterable[Sortie],
    spares: Mapping[tuple[str, str], int],
    last_day: int,
    window: int = 14,
    horizon: int = 14,
    q: float = 0.9,
) -> list[Supply]:
    """One row per (unit, variant) that has spares or losses, shortest supply first.

    ``trend`` is the loss rate over the last half of the window divided by the
    first half; None when the first half had no losses.
    """
    if window < 2 or horizon < 1:
        raise ValueError("window must be at least 2 days and horizon at least 1")
    first = last_day - window + 1
    mid = first + window // 2
    early: dict[tuple[str, str], int] = defaultdict(int)
    late: dict[tuple[str, str], int] = defaultdict(int)
    for s in sorties:
        if s.outcome != "lost" or not first <= s.day <= last_day:
            continue
        (late if s.day >= mid else early)[(s.unit, s.variant)] += 1
    keys = set(spares) | set(early) | set(late)
    rows: list[Supply] = []
    for unit, variant in keys:
        e, la = early[(unit, variant)], late[(unit, variant)]
        k = e + la
        rate = k / window
        trend = (la / (window - window // 2)) / (e / (window // 2)) if e else None
        on_hand = int(spares.get((unit, variant), 0))
        dos = on_hand / rate if rate > 0 else None
        mean = rate * horizon
        high = poisson_quantile(mean, q)
        rows.append(
            Supply(unit, variant, k, rate, trend, on_hand, dos, mean, high, max(0, high - on_hand))
        )
    rows.sort(
        key=lambda r: (
            math.inf if r.days_of_supply is None else r.days_of_supply,
            r.unit,
            r.variant,
        )
    )
    return rows


def build_order(rows: Iterable[Supply]) -> dict[str, int]:
    """Airframes to build per variant to cover every unit's high case."""
    out: dict[str, int] = defaultdict(int)
    for r in rows:
        out[r.variant] += r.short
    return dict(sorted(out.items()))
