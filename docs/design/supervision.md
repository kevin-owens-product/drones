# One operator, many vehicles (supervision scale sim)

## What it is

`sim/scale/fleet.py` is a fast kinematic fleet sim for Bet 1: how many survey vehicles can
one operator supervise before missions start to fail. It has no PX4, no Docker and no
network. Vehicles fly straight lines at 10 m/s and survey each task cell for a fixed time.

Exception events (link lost, GNSS rejected, low battery, task conflict) arrive per vehicle
as Poisson processes. A vehicle with an open exception holds and makes no progress. One
operator clears exceptions one at a time, earliest deadline first, with a random service
time. If an exception passes its deadline unseen, the onboard failsafe acts: for link,
GNSS and battery the vehicle leaves the mission; for a task conflict it drops its current
task. Orphaned tasks are re-allocated to live vehicles.

The console only monitors and advises (ADR 0016). Clearing an exception is modelled as an
acknowledgement and a supervisory decision. The sim has no flight-command, arming or
payload model.

## Allocation

`onboard/alloc` is limited to 8 agents and 16 tasks, so it cannot run N=100. `greedy_cbba`
is a Python port of the assignment CBBA reaches on a fully connected lossless network: the
same discounted score (`reward * 0.98^s`), best-insertion marginal gain, bid warping and
lower-index tie break. Unit check: `test_scale.py` builds `onboard/alloc/src/cbba.c` as a
shared library and compares winners on 200 random worlds (2-6 agents, 3-12 tasks); all 200
matched. Re-allocation after a loss keeps each live vehicle's current path and inserts the
orphaned tasks.

## How to run

- `make test-scale` runs the unit checks (about 2 s here). It is part of `make test`.
- `make scale` runs the sweep (N in 5, 10, 20, 30, 40, 50, 100; 20 seeds; about 15 s).
- `python3 sim/scale/fleet.py --n 10,50 --seeds 5 --rate-scale 2` for other settings.

## What it measures

Per N: mission success (all tasks done in the 40 min window), fraction of tasks done,
exceptions and interventions per vehicle-hour, failsafe timeouts and vehicles lost per run,
operator busy fraction, and effective sorties per operator-hour. Results are in
`docs/eval/scale.md`, labelled Sim (kinematic).

## Limits

- Event rates, service times and deadlines are assumptions, not field data. The knee moves
  with them; rerun with `--rate-scale` before quoting a ratio.
- One operator, no fatigue, no handoff, no batching of similar exceptions, no UI latency.
- Kinematics only: no wind, no battery drain model, no airspace separation.
- Allocation is the converged full-network CBBA result; consensus rounds, message loss and
  re-plan latency are not modelled here (see docs/design/cbba.md).
- Exceptions are independent per vehicle; correlated events such as area-wide GNSS
  interference are not modelled.
- Seeded and deterministic, but 20 seeds per N is a small sample; treat 80% vs 45% as a
  trend, not a precise rate.
