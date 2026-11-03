"""Records shared by the ledger, the autopsy and the demand signal."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Outcome = Literal["effective", "aborted", "lost"]
OUTCOMES: tuple[Outcome, ...] = ("effective", "aborted", "lost")


@dataclass(frozen=True)
class Airframe:
    """What the birth record says about one serial, plus where it is now."""

    serial: str
    variant: str
    unit: str
    factory_lot: str
    esc_lot: str
    motor_lot: str
    firmware: str


@dataclass(frozen=True)
class Sortie:
    day: int
    serial: str
    unit: str
    variant: str
    mission: str
    outcome: Outcome
    cause: str
    operator_min: float


@dataclass(frozen=True)
class CostModel:
    """Unit costs in US dollars. Assumed for the demo, not Neros figures."""

    airframe_usd: dict[str, float]
    pack_cycle_usd: float = 6.0
    operator_hour_usd: float = 85.0

    def airframe(self, variant: str) -> float:
        try:
            return self.airframe_usd[variant]
        except KeyError as exc:
            raise ValueError(f"no airframe cost for variant {variant}") from exc
