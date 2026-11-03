# Supervision scale sweep

Sim (kinematic). One operator, N survey vehicles, 20 seeds per N. Produced by `make scale`
(`python3 sim/scale/fleet.py --seeds 20`) on 2026-11-03. No PX4, no hardware, no field data.

Model inputs are assumptions, not measurements: exceptions at 1.8 per vehicle-hour in total
(link lost 0.6, GNSS rejected 0.4, low battery 0.3, task conflict 0.5), mean operator service
45 / 60 / 30 / 40 s (exponential), failsafe deadlines 120 / 90 / 180 / 240 s. Four 300 s
survey tasks per vehicle, 10 m/s, 0.4 km² per vehicle, 40 min mission window. Mission
success means every task was surveyed inside the window.

## Sim (kinematic) results

| Vehicles per operator | Runs | Mission success | Tasks done | Exceptions / veh-h | Interventions / veh-h | Failsafe timeouts / run | Vehicles lost / run | Operator busy | Effective sorties / operator-h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 20 | 100% | 100.0% | 1.73 | 1.73 | 0.0 | 0.0 | 11% | 7.5 |
| 10 | 20 | 100% | 100.0% | 2.12 | 2.12 | 0.0 | 0.0 | 24% | 15.0 |
| 20 | 20 | 100% | 100.0% | 1.74 | 1.71 | 0.2 | 0.2 | 32% | 29.6 |
| 30 | 20 | 80% | 99.8% | 1.85 | 1.70 | 1.8 | 1.4 | 44% | 42.8 |
| 40 | 20 | 80% | 99.8% | 1.76 | 1.48 | 4.5 | 3.3 | 53% | 55.0 |
| 50 | 20 | 45% | 99.6% | 1.84 | 1.53 | 6.3 | 5.3 | 60% | 67.0 |
| 100 | 20 | 0% | 98.3% | 1.75 | 1.04 | 29.5 | 21.5 | 81% | 117.8 |

Knee: success first falls more than 10 points below the N=5 value at N=30 vehicles per operator.

"Interventions" are exceptions the operator cleared. Exceptions the operator did not reach
before the deadline became failsafe timeouts instead; a lost-link, GNSS or battery timeout
takes the vehicle out of the mission and CBBA re-allocates its tasks. "Effective sorties /
operator-h" counts vehicles that finished without a failsafe exit, per hour of operator
shift (the 40 min window). "Operator busy" is the fraction of elapsed sim time spent serving.

## Reading

Sim (kinematic): mission success is 100% up to 20 vehicles per operator, then 80% at 30
and 40, 45% at 50 and 0% at 100. The drop starts with the operator about 44% busy, well
before saturation, because exceptions cluster and the shortest deadline is 90 s.
Interventions per vehicle-hour fall at high N only because more exceptions time out unseen.
Effective sorties per operator-hour keep rising with N even as mission success falls, so
the useful ratio depends on whether a failsafe exit is acceptable for the mission.
