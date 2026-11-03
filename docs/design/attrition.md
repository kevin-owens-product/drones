# Attrition intelligence

A company that sells drones built to be lost wins on what each completed task costs, and on how fast it learns from the airframes it loses. This feature puts both on one page, **Attrition**, from one sortie record. Everything on it is simulated and says so.

## What it shows

- **Cost per effective sortie.** An effective sortie finished its task. Its cost is every airframe lost, pack wear on every sortie flown and operator time, divided by effective sorties only. Shown by variant, unit, mission and week (`a2e.attrition.ledger`).
- **Loss autopsy.** Each loss is joined to its airframe's birth record: factory lot, ESC lot, motor lot and firmware build. Each value is tested against the expected losses for the same variant in the same unit, and a value that stands out becomes a quality alert listing the airframes from it still in service (`a2e.attrition.autopsy`).
- **Demand signal.** Losses per unit and variant over 14 days become a daily rate, days of supply against spares on hand, a 14-day need at the 90% Poisson bound, and a build order for the shortfall (`a2e.attrition.demand`).
- **Hold.** An operator can hold the airframes behind an alert. It is a fleet record (not airworthy pending inspection). Nothing is sent to a vehicle, per ADR-0016. In the demo the hold lives in memory; persisting it in the API needs a migration and is not done yet.

## The seeded world

`a2e.attrition.seed` flies four units with a mixed fleet of two variants (760 airframes) for 28 days. Variant B is priced 19% higher and its link is assumed to hold up better under jamming. Units differ in jamming exposure, and Alpha's tempo doubles in the last week. Lots and builds are drawn independently of the unit. One ESC lot, ESC-2611, is made to fail at 3x the normal rate from day 14. The autopsy is not told which.

Prices, rates and the jamming effect are assumptions picked to be plausible. None are Neros figures or field data.

## What the numbers say, and how far to trust them

On seed 7 the page shows variant B about 16% cheaper per effective sortie despite the higher price, the ESC-2611 alert, and Alpha out of variant A spares in about 6 days. Those follow from the assumptions above; the point is the decision the page supports, not the values.

The autopsy's detection and false-alarm rates over 100 seeded worlds are in [docs/eval/autopsy.md](../eval/autopsy.md). Two things moved those numbers while building it:

- Comparing a lot against the *rest* of the fleet, with its own losses left out, flagged something in 43% of worlds that had no bad lot. Pooling the expected rate over the stratum, lot included, brought that to 3%.
- That cost sensitivity. With a 7-day window most 3x lots went unflagged, so the window is 14 days and the family-wise alpha is 0.05. A 2x lot is still usually missed.

The autopsy finds association, not cause. A real deployment would add mission and environment strata and look at the failure data itself before grounding anything, and a person approves every hold.

## Running it

```
cd services/api
python -m pytest tests/unit/test_attrition.py
python -m a2e.attrition.report > ../ui/demo/assets/attrition.json   # CI checks this file matches
python -m a2e.attrition.evaluate 100 > ../../docs/eval/autopsy.md
```

The API serves the same report at `GET /v1/attrition` (`fleet.read`). The demo console serves the baked file at the same path, and the page is at `#attrition`.
