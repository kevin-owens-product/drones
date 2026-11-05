# Supervision scale sweep

Sim (energy model). One operator, N survey vehicles, 20 seeds per N. Produced by `make scale`
(`python3 sim/scale/fleet.py --seeds 20`) on 2026-11-05. No PX4, no hardware, no field data.

Model inputs are assumptions, not measurements. Exceptions arrive at 1.5 per vehicle-hour in
total (link lost 0.6, GNSS rejected 0.4, task conflict 0.5), mean operator service 45 / 60 / 40 s
(exponential), failsafe deadlines 120 / 90 / 240 s. Low battery is no longer a Poisson event:
every vehicle flies the performance model in `services/ui/demo/physics.mjs` (ported to Python in
`sim/scale/fleet.py`), an Archer 8 class airframe (1.45 kg, 88.8 Wh Li-ion pack, 16 m/s cruise) in a
5 m/s wind from 290°. Power comes from the power curve at the airspeed each leg needs, and when
the energy left would not get the vehicle home with the 20% reserve it calls bingo, flies to the
station at best-range speed and waits for ground crew (one per five vehicles, 150 s mean per swap)
before going back out. Four 300 s survey tasks per vehicle at 10 m/s over 0.4 km² per vehicle,
60 min mission window. Mission success means every task was surveyed inside the window.

## Sim (energy model) results

| Vehicles per operator | Runs | Mission success | Tasks done | Exceptions / veh-h | Interventions / veh-h | Pack swaps / vehicle | Wh / task | Failsafe timeouts / run | Vehicles lost / run | Operator busy | Effective sorties / operator-h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 20 | 100% | 100.0% | 1.85 | 1.85 | 1.0 | 14.7 | 0.0 | 0.0 | 9% | 5.0 |
| 10 | 20 | 100% | 100.0% | 2.11 | 2.09 | 1.0 | 15.2 | 0.1 | 0.1 | 18% | 9.9 |
| 20 | 20 | 100% | 100.0% | 1.67 | 1.63 | 1.0 | 15.8 | 0.3 | 0.3 | 25% | 19.6 |
| 30 | 20 | 90% | 99.9% | 1.85 | 1.72 | 1.0 | 16.2 | 1.8 | 1.6 | 42% | 28.4 |
| 40 | 20 | 85% | 99.9% | 1.74 | 1.54 | 1.0 | 16.7 | 3.7 | 2.5 | 48% | 37.5 |
| 50 | 20 | 60% | 99.6% | 1.78 | 1.50 | 1.0 | 16.9 | 6.8 | 5.1 | 54% | 44.9 |
| 100 | 20 | 0% | 97.9% | 1.65 | 1.05 | 1.0 | 18.5 | 30.6 | 22.2 | 72% | 77.8 |

Knee: success first falls more than 10 points below the N=5 value at N=40 vehicles per operator.

"Interventions" are exceptions the operator cleared. Exceptions the operator did not reach
before the deadline became failsafe timeouts instead; a lost-link or GNSS timeout takes the
vehicle out of the mission and CBBA re-allocates its tasks. "Pack swaps / vehicle" is how many
times each vehicle came home on bingo for a fresh pack. "Wh / task" is electrical energy spent
per task surveyed, transits and the flights home included. "Effective sorties / operator-h"
counts vehicles that finished without a failsafe exit, per hour of operator shift (the 60 min
window). "Operator busy" is the fraction of elapsed sim time spent serving exceptions; pack
swaps are crew time, not operator time.

## Reading

Sim (energy model): mission success is 100% up to 20 vehicles per operator, 90% at 30, 85% at
40, 60% at 50 and 0% at 100. The knee moved from 30 (kinematic sweep) to 40, mostly because the
window is now 60 minutes rather than 40: the same exception rate has more slack to recover in.
The drop still starts with the operator under half busy (42% at N=30) because exceptions cluster
and the shortest deadline is 90 s.

The energy model adds what the kinematic sweep could not see. A four-task plan needs about
60 Wh of flying against an 88.8 Wh pack with a 20% reserve, so every vehicle comes home exactly
once for a pack swap, and the larger the range the more each task costs: Wh per task climbs from
15 at N=5 to 19 at N=100 because transits lengthen and more of them are upwind. With the smaller
48.8 Wh LiPo the same sweep needed two swaps per vehicle and at N=100 missed the window even
with no exceptions at all, which is why the Archer 8 carries the Li-ion pack in the demo.
Effective sorties per operator-hour keep rising with N even as mission success falls, so the
useful ratio depends on whether a failsafe exit is acceptable for the mission.

Earlier result (2026-11-03, kinematic, 40 min window, low battery as a Poisson event at 0.3 per
vehicle-hour): 100% to N=20, 80% at 30 and 40, 45% at 50, 0% at 100, knee at 30.
