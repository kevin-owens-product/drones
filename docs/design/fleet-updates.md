# Signed, staged fleet updates

Bet 6, first slice. `services/api/src/a2e/rollout.py` moves one software build across the fleet in stages and stops it when the canary gets worse.

## What it is

A build ships as a `Manifest`: build id, version, artifact SHA-256, target. The manifest is signed with Ed25519 over its canonical JSON (`a2e.chain.canonical_json`). A `Rollout` verifies the signature before it creates any vehicle state. A tampered field or a different signing key raises `RolloutError`.

Vehicles are ordered by a hash of build id and tail, so each build gets a different canary. Cohorts are cumulative: 1%, 10%, 50%, 100%.

Each vehicle moves one step per reconcile tick: pending, staged (downloaded), applied (installed), verified (post-install check reported). A halted rollout moves staged, applied, and verified vehicles to rolled_back.

The health gate takes lower-is-better metrics, such as failsafe rate and EKF resets per hour. Once 80% of the current cohort has verified, it compares the cohort mean to the baseline. A metric regresses when the mean is above baseline times 1.10 plus 0.01. Any regression halts the rollout at that stage. No vehicle outside the current cohort is touched.

Offline vehicles keep their state. They advance, or roll back, on the first tick their link is up. The rollout is complete only when every vehicle has verified.

This module moves software only. It never arms, launches, or sends flight commands (ADR 0016). It does not replace the cosign check on behavior images (ADR 0018). It is the fleet-side half of the same idea.

## How to run it

```
cd services/api
pip install -e .[dev]
python -m pytest tests/unit/test_rollout.py -q
```

## What it measures

Unit check, `tests/unit/test_rollout.py`, 1,000 simulated tails, seeded:

- Good build, 15% of tails offline on each tick: complete in 19 ticks, 1,000 verified, 0 rolled back.
- Bad build (failsafe rate 0.09 against a 0.02 baseline): halted at the 1% stage on tick 3. 10 canary tails rolled back, 990 still pending, 0 beyond the canary.
- A canary tail that drops its link mid-stage stays staged through the halt and rolls back when it reconnects.
- A straggler offline through all four stages catches up to verified when it returns.
- A manifest with a changed artifact hash, or signed by another key, is refused.

These are logic checks on a synthetic fleet. They are not field or SITL results.

## Limits

- Metrics come from a callback. Nothing yet wires PX4 or gateway telemetry into the gate.
- The baseline is a fixed number passed in. It is not drawn from tails still on the old build.
- The gate uses means only. There is no sample-size or significance test, so a 10-tail canary can miss a rare fault.
- One tick per state step stands in for download and install time.
- State is in memory. There is no persistence, API route, or UI yet.
- Key distribution and revocation are out of scope.
