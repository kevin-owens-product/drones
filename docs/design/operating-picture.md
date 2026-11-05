# Operating picture on the Operate map

## Why

The map used to show where each vehicle was and nothing about what it was doing. A
supervisor of many vehicles needs the work (what is covered, what is next), the hazards
(where GNSS can't be trusted, and by how much each position is off) and the network (who
can hear whom, and what the fleet did when a vehicle dropped out). It also needs to rewind
when something happened while it was looking elsewhere.

## What is drawn

| Layer | Source | Notes |
| --- | --- | --- |
| Smooth motion | `/v1/telemetry/live` at 1 Hz | Each glyph glides to its newest sample over one poll interval, so the picture runs about a second behind the last report and never extrapolates ahead of it. Jumps over 400 m snap. Off with `prefers-reduced-motion`. |
| Trails | Received history | Fade from old to new. Rebuilt from the replay buffer, so live and replay draw the same way. |
| Position error | `pos_sigma_m` on each live point (optional) | Drawn as a 95% circle (2.45 sigma) when GNSS is rejected. On PX4 the source would be the EKF's horizontal error, `eph`. The gateway does not send it yet. |
| Attention pulses | Timeline events | A new warning or alert pulses its vehicle on the map, its row in the list and its dot on the timeline together. |
| Terrain | `basemap` in the picture | One baked image per site, so it works air-gapped. The demo's is built by `services/ui/demo/terrain.py` from AWS Terrain Tiles (SRTM, USGS NED). |
| Coverage, planned paths | `areas`, `routes` | Survey boxes fill in as the swath is flown, with percent covered. The path still to fly is dashed. |
| Jamming zone | `zones` | Hazard areas. |
| Links | `links` | Station and mesh links coloured by quality; a link that is down blinks. |
| Tasks | `tasks` | A line from each task to its owner. When the owner changes, the new line draws bright for a few seconds and the timeline logs the re-plan. |
| Density | Fleet size | Above 60 live vehicles, nominal vehicles go into a hex density field and only exceptions and the selected vehicle are drawn as glyphs. |
| 3D view | Same picture plus the heightmap | Three.js, loaded only when the operator presses 3D. Terrain in relief from `basemap.heightmap`, vehicles at reported height above ground with a line to the ground, jamming zone as a dome, error disc, links and task lines. Heights are exaggerated ×2 and the view says so. |
| Replay | Received history | Drag the timeline strip (or arrow keys on it) to show the fleet as this console received it, up to ten minutes back. Events and readiness keep running on live data underneath. Esc returns to live. |

Everything but motion, trails, pulses, density and replay comes from
`GET /v1/operations/picture`. The API does not serve it yet; when it is missing, the console
leaves those layers and their switches off.

## What is simulated

In the demo, every picture layer comes from the scenario in `services/ui/demo/server.mjs`,
and the map says so with a `SIM` tag:

- The jamming zone and the VIO error growth (assumed: 1% of distance flown plus a random walk, `physics.mjs`). Not measured.
- Link quality is a range model, not radio data.
- Task allocation is the assignment CBBA converges to on a connected, lossless network
  (sequential greedy with `onboard/alloc`'s score, as in `sim/scale`), computed from orbit
  centres. It is not the onboard allocator running over a lossy mesh.
- `A2E_DEMO_FLEET=N` adds N synthetic vehicles with seeded exception windows. It shows how
  the view holds up at scale. It is not evidence of how many vehicles one operator can
  supervise; for that see [supervision](supervision.md).

## How to check

- `npm run build && npm run demo`, then `A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173 npx playwright test e2e/operate.spec.ts`.
- For the density test, also run `A2E_DEMO_FLEET=300 PORT=4174 npm run demo` and set
  `A2E_DEMO_SCALE_ORIGIN=http://localhost:4174`.
