"""Attrition intelligence: ledger arithmetic, autopsy statistics, demand signal."""

from __future__ import annotations

import math

import pytest

from a2e.attrition.autopsy import autopsy, binom_sf
from a2e.attrition.demand import build_order, poisson_quantile, supply
from a2e.attrition.ledger import ledger, total
from a2e.attrition.model import Airframe, CostModel, Sortie
from a2e.attrition.report import build_report
from a2e.attrition.seed import make_world

COSTS = CostModel(
    airframe_usd={"A": 1000.0, "B": 2000.0}, pack_cycle_usd=10.0, operator_hour_usd=60.0
)


def sortie(
    serial: str = "A1",
    outcome: str = "effective",
    day: int = 0,
    unit: str = "U",
    variant: str = "A",
    cause: str = "",
) -> Sortie:
    return Sortie(day, serial, unit, variant, "survey", outcome, cause, 30.0)  # type: ignore[arg-type]


def test_cost_per_effective_counts_every_sortie_flown() -> None:
    rows = [sortie(), sortie(), sortie(outcome="aborted"), sortie(outcome="lost")]
    t = total(rows, COSTS)
    # One airframe lost, four pack cycles, two operator hours, two effective sorties.
    assert (t.airframe_usd, t.packs_usd, t.operator_usd) == (1000.0, 40.0, 120.0)
    assert t.cost_per_effective == pytest.approx(580.0)
    assert t.loss_rate == 0.25


def test_no_effective_sorties_is_unbounded_not_zero() -> None:
    assert total([sortie(outcome="lost")], COSTS).cost_per_effective is None
    assert total([], COSTS).sorties == 0


def test_ledger_groups_and_rejects_unknown_costs() -> None:
    rows = ledger(
        [sortie(variant="A"), sortie(variant="B", outcome="lost")], COSTS, key=lambda s: s.variant
    )
    assert [r.key for r in rows] == ["A", "B"]
    assert rows[1].airframe_usd == 2000.0
    with pytest.raises(ValueError):
        total([sortie(variant="C", outcome="lost")], COSTS)


def test_binomial_tail_matches_closed_forms() -> None:
    assert binom_sf(0, 10, 0.3) == 1.0
    assert binom_sf(11, 10, 0.3) == 0.0
    assert binom_sf(10, 10, 0.5) == pytest.approx(0.5**10)
    assert binom_sf(1, 5, 0.2) == pytest.approx(1 - 0.8**5)


def _fleet() -> list[Airframe]:
    out = []
    for i in range(40):
        esc = "BAD" if i < 10 else f"OK{i % 3}"
        out.append(Airframe(f"S{i:02d}", "A", "U", "F1", esc, "M1", "1.0"))
    return out


def test_autopsy_flags_the_bad_lot_and_lists_serials_still_flying() -> None:
    fleet = _fleet()
    rows = []
    for day in range(7):
        for a in fleet:
            lost = a.esc_lot == "BAD" and day in (1, 3) and a.serial in ("S00", "S01", "S02", "S03")
            lost |= a.serial == "S20" and day == 2
            rows.append(
                sortie(
                    a.serial,
                    "lost" if lost else "effective",
                    day,
                    cause="power / ESC" if lost else "",
                )
            )
    found = autopsy(fleet, rows, 0, 6, min_losses=3)
    top = found[0]
    assert (top.attribute, top.value, top.flagged) == ("esc_lot", "BAD", True)
    assert top.top_cause == "power / ESC"
    assert "S00" not in top.in_service and "S09" in top.in_service
    assert [f for f in found if f.flagged and f.value != "BAD"] == []


def test_autopsy_needs_enough_losses_and_a_valid_window() -> None:
    fleet = _fleet()
    rows = [sortie(a.serial) for a in fleet] + [sortie("S00", "lost")]
    assert not any(f.flagged for f in autopsy(fleet, rows, 0, 0))
    with pytest.raises(ValueError):
        autopsy(fleet, rows, 3, 1)
    with pytest.raises(ValueError):
        autopsy(fleet, [sortie("nope")], 0, 0)


def test_poisson_quantile() -> None:
    assert poisson_quantile(0, 0.9) == 0
    assert poisson_quantile(1.0, 0.5) == 1
    assert poisson_quantile(10.0, 0.9) == 14
    with pytest.raises(ValueError):
        poisson_quantile(1.0, 1.0)


def test_supply_orders_shortest_first_and_builds_the_shortfall() -> None:
    rows = [sortie(unit="Hot", outcome="lost", day=d) for d in range(14)]
    rows += [sortie(unit="Cold", outcome="lost", day=13)]
    out = supply(rows, {("Hot", "A"): 3, ("Cold", "A"): 10, ("Idle", "B"): 5}, last_day=13)
    assert [r.unit for r in out] == ["Hot", "Cold", "Idle"]
    hot = out[0]
    assert hot.per_day == 1.0 and hot.days_of_supply == 3.0 and hot.trend == 1.0
    assert hot.short == hot.need_high - 3 > 0
    assert out[2].days_of_supply is None
    assert build_order(out)["A"] == hot.short
    with pytest.raises(ValueError):
        supply(rows, {}, 13, window=1)


def test_seeded_world_is_deterministic_and_finds_its_plant() -> None:
    a, b = make_world(seed=7), make_world(seed=7)
    assert a.sorties == b.sorties
    report = build_report(a)
    assert report["source"].startswith("Simulated")
    flagged = {(f["attribute"], f["value"]) for f in report["autopsy"]["alerts"]}
    assert ("esc_lot", "ESC-2611") in flagged
    assert report["planted"]["days_to_flag"] is not None
    variants = {r["key"]: r for r in report["by_variant"]}
    # The dearer variant is cheaper per effective sortie in this world.
    assert variants["B"]["cost_per_effective_usd"] < variants["A"]["cost_per_effective_usd"]
    assert report["demand"]["rows"][0]["unit"] == "Alpha"
    assert all(math.isfinite(r["total_usd"]) for r in report["by_unit"])


def test_poisson_tail() -> None:
    from a2e.attrition.autopsy import poisson_sf

    assert poisson_sf(0, 3.0) == 1.0
    assert poisson_sf(1, 3.0) == pytest.approx(1 - math.exp(-3.0))
    assert poisson_sf(3, 0.0) == 0.0
    # Deep tail stays positive and small instead of cancelling to zero.
    assert 0 < poisson_sf(40, 2.0) < 1e-20
