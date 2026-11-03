"""Cost per effective sortie.

An effective sortie finished the task it was flown for. Its cost is everything
spent to get it: airframes lost, pack wear on every sortie flown (effective,
aborted or lost), and operator time. Dividing by effective sorties, not all
sorties, is what makes a cheap airframe that is lost often look as expensive as
it really is.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from a2e.attrition.model import CostModel, Sortie


@dataclass(frozen=True)
class LedgerRow:
    key: str
    sorties: int
    effective: int
    aborted: int
    lost: int
    airframe_usd: float
    packs_usd: float
    operator_usd: float

    @property
    def total_usd(self) -> float:
        return self.airframe_usd + self.packs_usd + self.operator_usd

    @property
    def loss_rate(self) -> float:
        return self.lost / self.sorties if self.sorties else 0.0

    @property
    def cost_per_effective(self) -> float | None:
        """None when nothing was effective: the cost is unbounded, not zero."""
        return self.total_usd / self.effective if self.effective else None

    def as_dict(self) -> dict[str, object]:
        cpe = self.cost_per_effective
        return {
            "key": self.key,
            "sorties": self.sorties,
            "effective": self.effective,
            "aborted": self.aborted,
            "lost": self.lost,
            "loss_rate": round(self.loss_rate, 4),
            "airframe_usd": round(self.airframe_usd),
            "packs_usd": round(self.packs_usd),
            "operator_usd": round(self.operator_usd),
            "total_usd": round(self.total_usd),
            "cost_per_effective_usd": None if cpe is None else round(cpe, 2),
        }


def ledger(
    sorties: Iterable[Sortie], costs: CostModel, key: Callable[[Sortie], str]
) -> list[LedgerRow]:
    """One row per key, sorted by key."""
    acc: dict[str, list[float]] = defaultdict(lambda: [0, 0, 0, 0, 0.0, 0.0, 0.0])
    for s in sorties:
        a = acc[key(s)]
        a[0] += 1
        if s.outcome == "effective":
            a[1] += 1
        elif s.outcome == "aborted":
            a[2] += 1
        elif s.outcome == "lost":
            a[3] += 1
            a[4] += costs.airframe(s.variant)
        else:
            raise ValueError(f"unknown outcome {s.outcome}")
        a[5] += costs.pack_cycle_usd
        a[6] += s.operator_min / 60.0 * costs.operator_hour_usd
    return [
        LedgerRow(k, int(a[0]), int(a[1]), int(a[2]), int(a[3]), a[4], a[5], a[6])
        for k, a in sorted(acc.items())
    ]


def total(sorties: Iterable[Sortie], costs: CostModel) -> LedgerRow:
    rows = ledger(sorties, costs, key=lambda _s: "all")
    return rows[0] if rows else LedgerRow("all", 0, 0, 0, 0, 0.0, 0.0, 0.0)


def week_of(day: int) -> str:
    return f"W{day // 7 + 1}"
