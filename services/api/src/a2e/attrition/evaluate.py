"""How often the autopsy finds a planted bad lot, and how often it cries wolf.

    python -m a2e.attrition.evaluate [worlds] > ../../docs/eval/autopsy.md

For each seed, one world has a planted ESC lot and an otherwise identical seed
has none. Detection: the planted value is flagged by a trailing 7-day window
on some day of the daily scan (days 13 to 27). False alarm: any value is flagged
on any day of the scan in the same seed with nothing planted. These are rates over simulated worlds, not
field results.
"""

from __future__ import annotations

import statistics
import sys
from dataclasses import dataclass

from a2e.attrition.autopsy import scan
from a2e.attrition.seed import DEFAULT_PLANT, Plant, make_world


@dataclass(frozen=True)
class Result:
    multiplier: float
    worlds: int
    detected: int
    days_to_flag: list[int]
    wrong_value_flags: int
    false_alarms: int


def run(worlds: int, multiplier: float, seed0: int = 1000, scan_from: int = 13) -> Result:
    plant = Plant(DEFAULT_PLANT.attribute, DEFAULT_PLANT.value, DEFAULT_PLANT.start_day, multiplier)
    target = (plant.attribute, plant.value)
    detected, wrong, alarms = 0, 0, 0
    lags: list[int] = []
    for i in range(worlds):
        w = make_world(seed=seed0 + i, plant=plant)
        last = w.days - 1
        alerts = scan(w.airframes, w.sorties, scan_from, last)
        hit = [a for a in alerts if (a.finding.attribute, a.finding.value) == target]
        if hit:
            detected += 1
            lags.append(hit[0].raised_day - plant.start_day)
        wrong += sum(1 for a in alerts if (a.finding.attribute, a.finding.value) != target)
        clean = make_world(seed=seed0 + i, plant=None)
        if scan(clean.airframes, clean.sorties, scan_from, last):
            alarms += 1
    return Result(multiplier, worlds, detected, lags, wrong, alarms)


def markdown(results: list[Result]) -> str:
    lines = [
        "# Loss autopsy: detection on seeded worlds",
        "",
        "Simulated. Each world is four units, 760 airframes and 28 days of sorties from",
        "`a2e.attrition.seed`. One ESC lot (about 1 in 6 airframes) is made worse from day 14;",
        "the autopsy is not told which. A trailing 14-day window is tested every day from day 13,",
        "within unit and variant, Bonferroni-corrected at family-wise alpha 0.05 across the 18",
        "lot and build values, with at least 5 losses and 1.5x the expected losses. An alert",
        "stays raised once a day's test clears.",
        "",
        "| Bad lot loss multiplier | Worlds | Bad lot alerted | Median days from going bad to alert | Alerts on other values | Same seeds, nothing planted: worlds with any alert |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        med = f"{statistics.median(r.days_to_flag):.0f}" if r.days_to_flag else "n/a"
        lines.append(
            f"| {r.multiplier:g}x | {r.worlds} | {r.detected} ({100 * r.detected / r.worlds:.0f}%) | {med} "
            f"| {r.wrong_value_flags} | {r.false_alarms} ({100 * r.false_alarms / r.worlds:.0f}%) |"
        )
    lines += [
        "",
        "The last column is the false-alarm rate per 15-day scan of a fleet with no bad lot.",
        "At 2x the trailing window often holds too few losses to clear the correction; that",
        "is the price of keeping false alarms rare. A real fleet would stratify by unit and",
        "mission before an alert grounds anything, and a person approves every hold.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    worlds = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    sys.stdout.write(markdown([run(worlds, m) for m in (2.0, 3.0, 4.0)]))


if __name__ == "__main__":
    main()
