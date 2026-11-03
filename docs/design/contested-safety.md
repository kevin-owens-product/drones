# Contested spectrum and dense-airspace safety

This is the first slice of two bets: degrade gracefully when the link is jammed, and keep vehicles apart in dense airspace. It is onboard code and C tests only. The console is unchanged. Nothing here arms, releases, or commands anything from the ground; the policy chooses an onboard behavior when the ground cannot be heard.

## Lost-link policy

`onboard/failsafe/include/lostlink.h` adds a per-task lost-link machine next to the existing failsafe. After a 2 s grace period with the link down:

- Survey keeps flying its assigned cells for up to 180 s, then returns. A finished survey returns.
- Observe holds for 30 s, then returns.
- Transit returns at once.
- A return with no link for 300 s lands. Land stays land.
- Low energy (the reserve to fly home) returns from any state.
- Link restored goes back to nominal, so the operator is back in the loop.

`make -C onboard/failsafe test` walks each rule.

## Fleet under a jammer

`onboard/contested/test/fleet_test.c` reuses alloc (CBBA), link, mesh, failsafe and lostlink. Six vehicles start at the station. CBBA assigns twelve survey cells out to 1.6 km. A 250 m, 60 dB jammer sits on a different cell in each of 40 seeds. Each 0.5 s tick a vehicle tries the station directly; with mesh on it also tries a relay chain of 700 m hops through vehicles outside the jammer. The link outcome drives either the default failsafe (loiter, return, land) or the survey lost-link policy. A sortie counts only if the vehicle visits every assigned cell and gets home inside 1200 s.

Unit check, `make -C onboard/contested test`, 40 seeds, kinematic:

- No jammer, default failsafe: 1.000 of sorties completed (control).
- Jammer, default failsafe: 0.671 sorties, 0.735 of cells.
- Jammer, mesh only: 0.675 sorties, 0.735 of cells.
- Jammer, lost-link policy only: 1.000 sorties, 1.000 of cells.
- Jammer, mesh and policy: 1.000 sorties, 1.000 of cells.

`scenarios/contested_fleet.yaml` requires at least 0.9 with mesh and policy.

## Dense crossing

`onboard/contested/test/dense_test.c` puts eight vehicles on a 150 m ring flying to the opposite side at 5 m/s, so every path crosses the center. It runs `sep_step` with a 6 m radius and counts the minimum pair distance, losses of separation (a pair entering 4 m), and geofence breaches (leaving a 170 m half-width box).

Unit check: guided minimum 5.93 m, 0 losses of separation, 0 breaches, 8 of 8 arrived. Unguided, the same run has 28 losses and a 0.00 m minimum. `scenarios/dense_separation.yaml` and `scenarios/geofence.yaml` require 0 of each.

## Limits

- Kinematic only: point vehicles, constant speed, no wind, no PX4. Not a SITL or field result.
- The link model is the existing range plus circular jammer model. Real jammers are directional and frequency dependent.
- Mesh adds almost nothing in this geometry, because most failures are vehicles inside the jammer, which cannot relay or be relayed. A wider area or longer cells would test mesh harder.
- The 1.000 result says the policy finishes this layout; it does not say continuing blind is always safe. Separation while blind relies on onboard `sep_step`, which this fleet run does not include.
- CBBA runs once before launch; there is no re-plan under jamming.
- The geofence is a box checked in the test, not an enforced onboard fence.
