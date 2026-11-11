# Changelog

What shipped, newest first, by release. Each line names the pull request. Everything in the hosted demo is simulated and says so; see `docs/eval/` for what was measured and how.

## Unreleased

- Physics check: every plan flown through line of sight over the range's real terrain (with an EW emitter), an electro-thermal pack model and thrust headroom in gusts; findings become fixes that re-plan the mission (relay site, altitude, band, preheat, airframe swap) and launch-check cautions
- Guided walk for a first visit, ⌘K finds tails and plans, axe accessibility gate in CI (#41)
- The demo's access rules as a generated matrix and a test; unknown routes answer 404; the ops lead can hold a lot from Attrition
- Every page except the two homes loads on first open: the console's entry script drops from 1.75 MB to 0.33 MB
- This changelog, and a What's new page in the help center

## Performance model (2026-11-04)

- One quadcopter performance model behind the sortie, launch checks, debrief energy, loadout planner and training (#40)
- Phone alert when the invite link is used or the note is read (#39)
- Site polish before it went to Neros (#38)

## Role-shaped rail (2026-11-04)

- Left rail grouped by job, trimmed per role, with counts of what needs you (#35), Operate keeps its width below 1600 px (#37)
- Quadcopter favicon on console and site pages (#36)
- User-visible branding renamed to Drone Mission Cloud (#34)
- Visual pages: flow map, cost curve, delivery timeline, lot scatter, fleet board (#33)
- Product site, help center and developer site (#32)

## Round two (2026-11-03)

- Wave 3: allied tenants and releasability, plans and entitlements, stockpile health (#31)
- Wave 2: surge planner, bid desk, fix loop (#30)
- Wave 1: listing and quote, mixed-vendor fleet, field configuration (#29)

## Digital thread (2026-11-03)

- Interop feeds (CoT, entities), controlled updates, program cockpit (#28)
- Provenance packets and operator readiness (#27)
- The serial record: acceptance packages, accountability, field-to-lot loop (#26)
- The 16 bugs from the live-site test pass (#25)

## Two workspaces (2026-11-03)

- Neros operations workspace and customer workspace, tenant scoping, Requests to Neros (#24)
- Brief, Missions, Debrief and Eval filled in the hosted demo (#21), confirmed outcomes audited (#22)
- Company view: product line, orders, production, supply chain, sustainment (#18)
- Admin menu cut to Fleet, Access and Audit (#17); hosted demo gated by sign-in with demo accounts (#16)

## Field loop (2026-11-03)

- End-of-line bench turning a flight-controller check into a birth record (#15)
- Brief: plain-words intent to a plan that waits for approval (#14)
- Mission configuration planner: variant, battery and band with margins (#13)
- Fleet-sourced GNSS denial map that reroutes around unbriefed spoofing (#12)
- Field reports: one-tap operator notes with pinned telemetry (#11)
- Attrition intelligence: cost per effective sortie, loss autopsy, demand signal (#10)

## Operate (2026-11-02 to 2026-11-03)

- 3D view and the static demo hosted on Render (#9); operating picture on the map (#8)
- First slices of the ten platform bets (#6); launch readiness (#5)
- Closed loop with PX4: GNSS-denied and tracking trials in SIH (#4)
- The console rebuilt around one Operate screen (#3)

## Foundations (2026-11-02)

- CBBA tasking over a lossy network, replacing the greedy auction (#2)
- Flight testbed: PX4 fleet, MAVLink gateway, CRSF parser, onboard C modules (#1)
