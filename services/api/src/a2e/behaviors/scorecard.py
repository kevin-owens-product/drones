"""Behavior scorecard against a regression baseline."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Scorecard:
    coverage_pct: float
    custody_pct: float
    energy: float
    violations: int
    replans: int


@dataclass(frozen=True)
class Baseline:
    coverage_pct: float
    custody_pct: float
    energy: float
    violations: int
    replans: int
    energy_slack: float = 0.05
    coverage_slack: float = 1.0


def compare(actual: Scorecard, baseline: Baseline) -> list[str]:
    failures: list[str] = []
    if actual.coverage_pct + baseline.coverage_slack < baseline.coverage_pct:
        failures.append("coverage_regressed")
    if actual.custody_pct + baseline.coverage_slack < baseline.custody_pct:
        failures.append("custody_regressed")
    if actual.energy > baseline.energy * (1.0 + baseline.energy_slack):
        failures.append("energy_regressed")
    if actual.violations > baseline.violations:
        failures.append("violations_regressed")
    if actual.replans > baseline.replans:
        failures.append("replans_regressed")
    return failures
