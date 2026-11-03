"""Loss autopsy: trace losses back to the factory.

Every sortie carries its airframe's serial, and the birth record says which
factory lot, ESC lot, motor lot and firmware build went into that serial. For
each value of each of those attributes, the autopsy compares the loss rate of
sorties flown on airframes with that value against sorties flown on all other
airframes in the same window.

Losses are compared within strata. For each sortie on an airframe with the
value, the expected chance of loss is the loss rate of all airframes of the same
variant in the same unit over the window. Summed, that gives the
expected losses; the test is the Poisson tail of seeing at least the observed
count. Stratifying matters: without it, a lot that by chance flew more of its
sorties in the most jammed unit looks bad for reasons that are not the lot. The
rate is pooled over the stratum, the value's own sorties included; leaving them
out understates what chance alone produces and, on the seeded worlds, raised
false alarms from about 2% to over 40%.

Every value of every attribute is a separate test, so the threshold is divided
by the number of tests (Bonferroni). A value is flagged only when it also clears
a minimum loss count and a minimum ratio of observed to expected losses.

The daily ``scan`` reruns the test on a trailing window and keeps each alert
raised from the first day it clears. The defaults (14-day window, family-wise
alpha 0.05) were chosen on seeded worlds; docs/eval/autopsy.md has the rates.

The autopsy finds association, not cause. A person approves every hold.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Callable, Hashable, Iterable, Sequence
from dataclasses import dataclass

from a2e.attrition.model import Airframe, Sortie

ATTRIBUTES: tuple[str, ...] = ("factory_lot", "esc_lot", "motor_lot", "firmware")


@dataclass(frozen=True)
class Finding:
    attribute: str
    value: str
    sorties: int
    losses: int
    rate: float
    baseline_rate: float
    ratio: float
    p_value: float
    flagged: bool
    top_cause: str
    top_cause_share: float
    in_service: tuple[str, ...]

    def as_dict(self, serial_limit: int = 12) -> dict[str, object]:
        return {
            "attribute": self.attribute,
            "value": self.value,
            "sorties": self.sorties,
            "losses": self.losses,
            "rate": round(self.rate, 4),
            "baseline_rate": round(self.baseline_rate, 4),
            "ratio": round(self.ratio, 2) if math.isfinite(self.ratio) else None,
            "p_value": float(f"{self.p_value:.3g}"),
            "flagged": self.flagged,
            "top_cause": self.top_cause,
            "top_cause_share": round(self.top_cause_share, 3),
            "in_service_count": len(self.in_service),
            "in_service_sample": list(self.in_service[:serial_limit]),
        }


def binom_sf(k: int, n: int, p: float) -> float:
    """P(X >= k) for X ~ Binomial(n, p), summed in log space."""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    lp, lq = math.log(p), math.log1p(-p)
    lg_n = math.lgamma(n + 1)
    terms = [
        lg_n - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq
        for i in range(k, n + 1)
    ]
    top = max(terms)
    return min(1.0, math.exp(top) * sum(math.exp(t - top) for t in terms))


def poisson_sf(k: int, mean: float) -> float:
    """P(X >= k) for X ~ Poisson(mean)."""
    if k <= 0:
        return 1.0
    if mean <= 0:
        return 0.0
    term = math.exp(-mean)
    cdf = term
    for i in range(1, k):
        term *= mean / i
        cdf += term
    return max(0.0, 1.0 - cdf) if cdf < 0.999 else _poisson_upper(k, mean)


def _poisson_upper(k: int, mean: float) -> float:
    """Upper tail summed directly, for when 1 - cdf would lose precision."""
    term = math.exp(-mean + k * math.log(mean) - math.lgamma(k + 1))
    total, i = 0.0, k
    while term > 1e-300 and (term > total * 1e-16 or i < mean):
        total += term
        i += 1
        term *= mean / i
    return min(1.0, total)


def autopsy(
    airframes: Sequence[Airframe],
    sorties: Iterable[Sortie],
    first_day: int,
    last_day: int,
    alpha: float = 0.05,
    min_losses: int = 5,
    min_ratio: float = 1.5,
    attributes: Sequence[str] = ATTRIBUTES,
    stratum: Callable[[Sortie], Hashable] = lambda s: (s.unit, s.variant),
) -> list[Finding]:
    """Test every attribute value over sorties in [first_day, last_day].

    Losses are compared within strata (unit and variant by default): a lot is
    only suspicious if it loses more than the same variant in the same unit, so a lot that happened to fly more sorties in
    the most jammed unit is not flagged for it.

    Returns findings sorted flagged first, then by p-value. ``in_service`` lists
    serials with that value that have not been lost by ``last_day``.
    """
    if first_day > last_day:
        raise ValueError("first_day is after last_day")
    by_serial = {a.serial: a for a in airframes}
    all_sorties = list(sorties)
    lost_by_end = {s.serial for s in all_sorties if s.outcome == "lost" and s.day <= last_day}
    window = [s for s in all_sorties if first_day <= s.day <= last_day]

    counts: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    cells: dict[tuple[str, str], dict[Hashable, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0])
    )
    causes: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    totals: dict[Hashable, list[int]] = defaultdict(lambda: [0, 0])
    for s in window:
        a = by_serial.get(s.serial)
        if a is None:
            raise ValueError(f"sortie on unknown serial {s.serial}")
        lost = int(s.outcome == "lost")
        st = stratum(s)
        totals[st][0] += 1
        totals[st][1] += lost
        for attr in attributes:
            key = (attr, getattr(a, attr))
            counts[key][0] += 1
            counts[key][1] += lost
            cells[key][st][0] += 1
            cells[key][st][1] += lost
            if lost:
                causes[key][s.cause] += 1

    tests = max(1, len(counts))
    threshold = alpha / tests
    out: list[Finding] = []
    for (attr, value), (n, k) in counts.items():
        # Expected losses if this value lost airframes at the same rate as the
        # rest of its variant in the same unit.
        # The rate is pooled over the whole stratum, this value included: under
        # the null the value is just more of the same airframes, and leaving its
        # own losses out of the rate would understate what to expect by chance.
        expected, compared = 0.0, 0
        for st, (cn, _ck) in cells[(attr, value)].items():
            if totals[st][0] - cn <= 0:
                continue
            expected += cn * totals[st][1] / totals[st][0]
            compared += cn
        rate = k / n if n else 0.0
        base = expected / compared if compared else 0.0
        if compared == 0:
            # No other airframe flew the same work: nothing to compare against.
            ratio, p = 1.0, 1.0
        else:
            ratio = k / expected if expected > 0 else (math.inf if k > 0 else 1.0)
            p = poisson_sf(k, expected) if expected > 0 else (0.0 if k > 0 else 1.0)
        flagged = p < threshold and k >= min_losses and ratio >= min_ratio
        top, share = ("", 0.0)
        if causes[(attr, value)]:
            top, top_n = causes[(attr, value)].most_common(1)[0]
            share = top_n / k
        serials = tuple(
            sorted(
                a.serial
                for a in airframes
                if getattr(a, attr) == value and a.serial not in lost_by_end
            )
        )
        out.append(Finding(attr, value, n, k, rate, base, ratio, p, flagged, top, share, serials))
    out.sort(key=lambda f: (not f.flagged, f.p_value, f.attribute, f.value))
    return out


@dataclass(frozen=True)
class Alert:
    """A value the daily scan flagged. Alerts stay raised until someone clears them."""

    raised_day: int
    finding: Finding


def scan(
    airframes: Sequence[Airframe],
    sorties: Sequence[Sortie],
    start: int,
    end: int,
    window: int = 14,
) -> list[Alert]:
    """Run the trailing-window autopsy each day in [start, end].

    Returns one alert per attribute value, at the first day it was flagged, in
    the order raised. Losses keep coming after a lot goes bad, so a value can
    clear the test one day and miss it a week later; the alert does not drop.
    """
    raised: dict[tuple[str, str], Alert] = {}
    for day in range(start, end + 1):
        for f in autopsy(airframes, sorties, max(0, day - window + 1), day):
            if f.flagged and (f.attribute, f.value) not in raised:
                raised[(f.attribute, f.value)] = Alert(day, f)
    return sorted(raised.values(), key=lambda a: (a.raised_day, a.finding.p_value))


def first_flag_day(
    airframes: Sequence[Airframe],
    sorties: Sequence[Sortie],
    attribute: str,
    value: str,
    start: int,
    end: int,
    window: int = 14,
) -> int | None:
    """First day in [start, end] on which a trailing window flags the value."""
    for day in range(start, end + 1):
        found = autopsy(airframes, sorties, max(0, day - window + 1), day)
        if any(f.flagged and f.attribute == attribute and f.value == value for f in found):
            return day
    return None
