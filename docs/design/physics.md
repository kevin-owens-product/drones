# One performance model for the demo

Until now the demo's vehicles were points on rails: constant ground speed, instant corners, a
battery that lost a percent every 90 seconds, a link that faded with the square of distance.
Every page that needed a number about flight made up its own. `services/ui/demo/physics.mjs`
replaces that with one model, and four places draw from it:

| Where | What it takes from the model |
| --- | --- |
| Live sortie (`demo/scenario.mjs`, Operate) | Each named vehicle flies its plan through `flyPlan()` once per loop at 1 Hz. Telemetry carries airspeed, wind, bank, pitch, power, pack voltage, minutes left, minutes home, bingo, link margin and RSSI. |
| Flight display and detail (`src/operate/Hud.tsx`, `Operate.tsx`, `vehicle.ts`) | Attitude horizon, wind arrow, power and energy readout. A vehicle whose energy will not survive the flight home is an alert ("Bingo"), one that is close is a warning ("Energy tight"). |
| Plans (`demo/missions.mjs`) | A new launch check flies the plan through the model: energy needed against the pack's usable energy at the forecast temperature, in the range wind. The debrief's battery trace and VIO error come from the same equations. |
| Loadout planner (`demo/configure.mjs`) | `cruiseWatts()` is now the shared power curve, so the planner's margin and the sortie's battery agree. |
| Supervision sweep (`sim/scale/fleet.py`) | A Python port of the same constants and equations. Low battery stopped being a Poisson event: it happens when the energy model says so, and the vehicle comes home for a crew swap. |

## The model

Everything is textbook or an assumption written out in `ASSUMED`, so it can be argued with.
Nothing is a measured Neros figure.

- **Airframes** by SKU: Archer 5 (0.92 kg, 6S 1300 mAh LiPo, 28.9 Wh), Archer 8 (1.45 kg,
  6S 4000 mAh Li-ion, 88.8 Wh), Archer 10 (2.2 kg, two of those packs, 177.6 Wh), each with a
  cruise speed, an airspeed limit, a drag area and a bank limit. Pack and mass are assumptions
  that give the endurance class small quadcopters of each size actually have.
- **Power.** Hover power follows the rule the planner has always used, 95 W per kg^1.5.
  In forward flight the induced power falls as the rotors see more air (Glauert's relation,
  solved by fixed point), parasite power rises with the cube of airspeed through the drag area,
  profile power is a fixed share of hover, climb costs weight times rate and descent returns a
  third of it. An Archer 5 hovers at 90 W and flies 16 to 19 minutes; an Archer 8 hovers at 172 W, cruises
  at 150 W, is most efficient near 16 m/s and flies about 30 minutes; an Archer 10 about 35.
- **Wind.** A steady vector at 10 m, three slow sinusoids for gusts (smooth, repeatable, never
  a step), direction wander, and a power-law profile with height. The range wind is 5 m/s from
  290°, about 7 m/s at 100 m with gusts.
- **Guidance.** The vehicle flies toward a lookahead point on its path, holds a commanded
  ground speed where the wind allows and slows on the upwind leg when the airspeed cap bites,
  turns at the rate its bank limit allows (corners are arcs), and crabs into the wind so the
  nose is not the track. Roll comes from the turn rate, pitch from the drag it is pushing.
- **Pack.** State of charge from integrated energy; a LiPo open-circuit curve (4.2 V full, a
  knee near 3.5 V) with sag from current through an internal resistance that rises in the cold;
  85% usable depth and a 7.5% per 10 °C cold derating, as before.
- **Bingo.** Every second the vehicle prices the flight home at the best-range airspeed for the
  headwind it would face (faster into a headwind, as any pilot flies it). When usable energy minus that is under the 20% reserve it turns for the station, slows
  to best-range speed, descends over the pad and lands. If the usable energy runs out short of
  home it lands where it is and the console says so. In the demo NX-06 comes back from the
  culvert at 38%, calls bingo on its first sample and lands at the station with about 22%.
- **Position error.** On GNSS, 1.2 m 1-sigma, worse near the jammer's edge. On VIO, 1% of
  distance flown plus a random walk of 0.25 m per root metre, combined in quadrature.
- **Link.** A 900 MHz budget (142 dB) against a log-distance path loss (112 dB at 1 km, exponent
  2.3 for clutter), a low-altitude penalty for the ground reflection, 12 dB less for the mesh
  radios. Quality on the map is the margin against 25 dB; the detail shows margin and RSSI.

`GET /v1/physics` returns the assumptions and each airframe's hover and cruise power, best-range
speed, endurance and still-air range.

## What changed in the numbers

- Seeded plans were longer than the packs allow. They were resized to 12 to 20 minute sorties,
  and the launch checks now say so for any plan that is not: M-1034 (30-minute loiters on
  Archer 5s) reads "the 38-minute plan needs 51 Wh; the pack gives 23 Wh usable".
- The supervision sweep (`docs/eval/scale.md`) now runs on a 60-minute window with one pack swap
  per vehicle; its knee moved from 30 to 40 vehicles per operator, and Wh per task rises with
  fleet size because transits lengthen.
- The loadout planner's cold test moved from -10 °C to -20 °C: with the shared curve the 2200 mAh
  pack still clears the reserve at -10 °C on the 3 km mission.

## Limits

- Coefficients are assumptions. The first flight log from a real airframe should replace
  `hover_w_at_1kg`, `drag_area_m2` and `cell_r_ohm`, and the bench (`sim/bench`) is where to measure them.
- No terrain in the link model (the heightmap exists but is not sampled), no rotor downwash, no
  battery temperature rise, no motor saturation. Gusts are deterministic sinusoids, not turbulence.
- The synthetic swarm (`?fleet=300`) keeps closed-form paths and only takes its battery drain from
  the power curve, so it stays cheap in the browser.
- The debrief holds the planned ground track and prices it; it does not re-fly the plan through
  the guidance loop the way the live sortie does.
