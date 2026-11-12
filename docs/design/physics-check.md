# Physics check: the three things that end small-drone sorties

The performance model (`physics.md`) answers "is there enough energy?". Small drones are mostly
lost to other physics: the radio link at low altitude, a battery that collapses in the cold before
it is empty, and running out of thrust in a gust. The physics check (`GET
/v1/missions/{id}/physics`) flies a plan through all three before launch and turns every finding
into a fix the planner can put into the plan.

## Where it shows

There is no separate physics page: each piece sits where the decision it informs is made.

- **Missions**, on the selected plan. *Conditions at launch* sets the air temperature, wind, gusts
  and EW emitter (a what-if until a planner saves it). Findings and their fixes are rows in *Launch
  checks*, each with Apply or Add to launch tasks. The plan map switches between routes and the
  video link coloured over the terrain, with the worst terrain profile and a per-tail link table.
  *Packs and thrust* shows each tail's cell voltage through the sortie, preheat advice, thrust in
  hand and the airframe's envelope. `#physics` links land here.
- **Loadout planner**: *Packs and thrust* for every airframe in the planner's temperature and wind
  (`GET /v1/envelope`): cold climb-out voltage, preheat time, cutoff on a standard sortie, thrust in
  a gust, strongest go wind, spare lift and the envelope grid.
- **Denial map** (was GNSS denial map): Control link and Video link layers beside the GNSS layer
  (`GET /v1/coverage`), the margin from the GCS mast to every 200 m cell at a chosen height, band
  and emitter state.
- **Airframes**: the selected tail's *Next sortie*, what its next plan needs on the pad (preheat,
  link, thrust) with a link to the plan.
- **Operate**: each vehicle's station link quality is the terrain margin (`rf.mjs`), not distance
  alone, and a *Radio shadow* map layer shades where control at 100 m is thin or lost.
- **Debrief**: *Where the energy went* splits each tail's watt-hours with `powerParts`
  (induced, profile, parasite, climb, avionics) plus what the wind, the cold derate and an early
  return added; the vehicle panel plots control and video margin over the terrain along the flown
  track, and a finding says whether a recorded link loss matches a terrain shadow.
- **Stockpile health**: `demo/aging.mjs` models calendar ageing (loss ∝ √t, Arrhenius in
  temperature, exponential in state of charge) so each stored pack shows capacity today and a
  two-year projection as stored, at storage charge, and in a cool store.

## 1. Line of sight over real terrain, with jamming (`demo/rf.mjs`)

At 100 m and a few kilometres, a 1 W 900 MHz C2 link has 30 dB or more over free space. Range is
not the problem: terrain is. The model:

- Samples the range's real ground heights (SRTM/NED via `demo/terrain-grid.mjs`, 80 m cells, made by
  `demo/terrain_grid.py` from the same tiles as the 3D view) every 40 m along each path, adding the
  4/3-Earth bulge.
- Prices obstructions as Bullington's equivalent knife edge (ITU-R P.526 §4.5) with the standard
  knife-edge loss J(ν). Clear of 60% of the first Fresnel zone costs nothing; grazing costs 6 dB.
  (Deygout was tried first; on rolling hills it priced each 40 m sample as its own ridge.)
- Carries two links per airframe: C2 (900 MHz, 2.4 or 5.8 GHz, budgets from the loadout planner)
  and a 5.8 GHz digital video downlink that needs ~20 dB more. The same ridge leaves C2 thin and
  takes the picture away first: the vehicle flies but the mission does not happen.
- Treats the range's EW emitter (E1, at the J1 trailer, 5 W ERP on 900 MHz and 2.4 GHz, none at
  5.8 GHz) as interference: what reaches the receiver, minus 20 dB of hopping rejection, plus 3 dB
  required SNR, raises the floor. The check says whether a drop-out is terrain or jamming by
  pricing the worst point again with the emitter off.
- Relays decode and forward: a sample's margin is the best of direct and, for each relay airborne
  then, the weaker of its two hops.

Fixes: the lowest altitude per leg (10 m steps to 150 m) that holds video and 10 dB of C2; a relay
site found by searching a 300 m grid over the area for the best worst-case video margin, excluding
the GNSS jamming zone (a relay needs GNSS to hold station), flown by the spare airframe with the most
endurance; under EW, a C2 band the emitter does not reach.

On the demo range this reproduces what the seeded plans already assumed: the Ridge (T3) has clear
line of sight to the GCS and is the relay site the search finds; Areas A to C and the Culvert are
behind terrain.

## 2. The pack as an electro-thermal system (`demo/pack.mjs`)

- One RC equivalent circuit per cell: OCV by chemistry (LiPo plateau, Li-ion slope), R0 with an
  Arrhenius temperature dependence (B = 2400 K, about 3x at -10 °C), polarisation R1 = 0.5 R0, τ 30 s,
  and 0.4%/°C of capacity unreachable below 25 °C.
- Current is solved from the power demanded (r I² − e I + P = 0). Asking for more than e²/4r
  collapses the voltage: the pack cannot deliver it at any current.
- Lumped thermal mass with I²R heating and conductance to air that grows with √airspeed.
- The flight ends at the flight controller's load-voltage cutoff (3.3 V LiPo, 3.0 V Li-ion), not
  at an energy fraction. "Full climb" is 80% of available thrust, priced by momentum theory.

What it shows: the dangerous moment is the climb-out, peak power on the coldest pack. Preheating
fixes that; the pack's thermal mass gives the heat back within about ten minutes, and the current
then warms it anyway, so a cutoff late in the flight is a reserve problem, not a preheat problem.
The advice is a launch task, not a plan change: warm to X °C (minutes in a 40 °C warmer, from the
pack's thermal time constant), launch within 5 minutes, with a 5 °C margin for the core lagging the
skin.

## 3. Thrust in hand (`demo/envelope.mjs`)

- Air density from ISA pressure at the site elevation and the actual temperature; density altitude.
- Maximum thrust = thrust-to-weight by class (Archer 5: 4.0, 8: 2.6, 10: 2.2) × density ratio ×
  (loaded cell voltage / 3.8 V)², because motor speed follows voltage and thrust follows speed².
- Holding station needs tilt against rotor H-force (linear in airspeed) plus body drag. Gusts are
  the low-altitude Dryden intensities (MIL-F-8785C), design gust 3σ or the forecast peak.
- Go needs 30% of thrust in hand and gust tilt within the 35° attitude limit.

A cold pack closes the envelope faster than heat does: on Li-ion the voltage loss outweighs the
denser air. The envelope grid on the page shows it.

## How it is used

- **Launch checks** carry the findings as cautions with "the physics check has a fix". They do not
  block launch: the planner decides.
- **Fixes** that change the plan (altitude, relay, band, swap) send a plan in review or approved back
  to draft, with a history line, so a second person sees the change. Only planners and mission
  commanders can apply them.
- **What-if forecasts** (temperature, wind, gusts, emitter on) re-run the check without touching
  the plan; "Save to plan" makes them the plan's forecast for its launch checks.

Seeded stories: M-1035 dawn survey at -10 °C (terrain, cold Li-ion packs, relay and preheat
fixes), M-1032 culvert check (video lost behind terrain, altitude or relay), M-1033 EW rehearsal
(jamming at the road junction, move C2 to 5.8 GHz), M-1029 (look back at NX-11's sag).

## Limits

- Coefficients are assumptions, not Neros data. The bench (`sim/bench`) should measure R0, thermal
  mass and thrust; a field log with RSSI should calibrate the radio budgets and fade allowance.
- 80 m terrain without buildings or trees; no ducting, no multipath beyond a fixed fade allowance.
- One emitter with a fixed ERP and an omni pattern; the downlink to the GCS is not jammed.
- The live sortie still uses the earlier distance-only link and flat cold derate.
