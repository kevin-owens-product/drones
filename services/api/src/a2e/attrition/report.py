"""One JSON document for the console: ledger, autopsy and demand together.

    python -m a2e.attrition.report > ../ui/demo/assets/attrition.json

The demo console serves the baked file, and the API serves the same document
built live, so both show the numbers this code computes.
"""

from __future__ import annotations

import json
import sys
from dataclasses import replace
from typing import Any

from a2e.attrition.autopsy import Alert, Finding, autopsy, scan
from a2e.attrition.demand import build_order, supply
from a2e.attrition.ledger import ledger, total, week_of
from a2e.attrition.seed import World, make_world


def _current(alert: Alert, latest: list[Finding]) -> Finding:
    """The alert's finding as raised, with serials still in service as of today."""
    now = next(
        f
        for f in latest
        if (f.attribute, f.value) == (alert.finding.attribute, alert.finding.value)
    )
    return replace(alert.finding, in_service=now.in_service)


def build_report(world: World, autopsy_window: int = 14) -> dict[str, Any]:
    last = world.days - 1
    s, c = world.sorties, world.costs
    findings = autopsy(world.airframes, s, max(0, last - autopsy_window + 1), last)
    alerts = scan(world.airframes, s, autopsy_window - 1, last, autopsy_window)
    detect = None
    if world.plant:
        p = world.plant
        hit = [
            a for a in alerts if (a.finding.attribute, a.finding.value) == (p.attribute, p.value)
        ]
        day = hit[0].raised_day if hit else None
        detect = {
            "attribute": p.attribute,
            "value": p.value,
            "start_day": p.start_day,
            "multiplier": p.multiplier,
            "first_flag_day": day,
            "days_to_flag": None if day is None else day - p.start_day,
        }
    rows = supply(s, world.spares, last)
    return {
        "source": world.source,
        "seed": world.seed,
        "days": world.days,
        "assumptions": {
            "airframe_usd": c.airframe_usd,
            "pack_cycle_usd": c.pack_cycle_usd,
            "operator_hour_usd": c.operator_hour_usd,
        },
        "total": total(s, c).as_dict(),
        "by_variant": [r.as_dict() for r in ledger(s, c, key=lambda x: x.variant)],
        "by_unit": [r.as_dict() for r in ledger(s, c, key=lambda x: x.unit)],
        "by_mission": [r.as_dict() for r in ledger(s, c, key=lambda x: x.mission)],
        "by_week": [r.as_dict() for r in ledger(s, c, key=lambda x: week_of(x.day))],
        "by_week_variant": [
            r.as_dict() for r in ledger(s, c, key=lambda x: f"{week_of(x.day)}/{x.variant}")
        ],
        "autopsy": {
            "window_days": autopsy_window,
            "first_day": max(0, last - autopsy_window + 1),
            "last_day": last,
            "tests": len(findings),
            "alerts": [
                {"raised_day": a.raised_day, **_current(a, findings).as_dict()} for a in alerts
            ],
            "top": [f.as_dict(serial_limit=0) for f in findings[:8]],
        },
        "planted": detect,
        "demand": {
            "window_days": 14,
            "horizon_days": 14,
            "rows": [r.as_dict() for r in rows],
            "build_order": build_order(rows),
        },
    }


def main() -> None:
    json.dump(build_report(make_world()), sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
