# Fleet-sourced GNSS denial map

Every vehicle navigating on VIO already knows where its GNSS fix dropped out, or where the fix and VIO disagreed by more than 15 m. Shared across the fleet, those samples make a map of where GNSS cannot be trusted, and the next route can bend around places nobody briefed. The page is **Denial map** (`#denial`), and the logic is `demo/denial.mjs`.

## How it works

- **Samples.** Each scout pass is sampled every 25 m. A sample counts as denied when there is no fix or the GNSS–VIO residual is over 15 m.
- **Map.** Samples fall into 200 m cells. Each cell keeps a Beta(1,1) estimate of how often GNSS was denied there.
- **Planner.** A* runs on the grid, with each step's cost being distance × (1 + 25 × risk). A cell with 3 or more samples uses its map estimate. A cell with fewer uses the brief: 0.9 inside a briefed zone, 0.1 anywhere else. A cell next to a mapped denied cell takes 60% of that cell's risk, because a zone seen at its edge usually extends past where anyone flew.

## The scenario

Jamming zone J1 was in the brief. Spoofing zone S1 was not, and it sits across the straight route from the GCS to task T1. Planned from the brief alone, the route avoids J1 but crosses 242 m of S1. After two scout passes S1 is mapped and the route goes around it, about 8% longer. Across 100 seeds, four passes kept both zones off the route every time, and cell precision and recall stayed at or above 85% (`demo/denial.test.mjs`).

## Limits

- The zones are circles, the spoof offset is a simple ramp and the noise model is assumed. Real jamming and spoofing are patchier and change over time. Cells should also decay with age, which this slice does not do.
- A clever spoofer keeps the GNSS–VIO residual small. This map catches the crude cases; the onboard spoof detector (`onboard/spoof`) is the first line.
- Today the map lives in the demo. In the platform it would sync over the edge link like other fleet state (ADR-0019), and nothing in it commands a vehicle.
