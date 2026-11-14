# Changelog

What shipped, newest first, by release. Each line names the pull request. Everything in the hosted demo is simulated and says so; see `docs/eval/` for what was measured and how.

## Unreleased

- First responder pages lead with a picture of their decision: Respond gets an at-a-glance strip (calls waiting, in the air, docks ready, wind against the waiver on a dial, the shift clock), a harbor map with each dock's charge ring and 90-second reach, pulsing calls, aircraft on their routes and a compass and scale, flight phase steps, and a shift timeline of every call; Flight records shows the evidence chain as linked blocks; Pilots and roster a 14-day roster calendar and a currency grid; Report and invoice the month day by day (payable, held, not payable, unstaffed), with a day picking its invoice line
- Live sim: fly a swarm of PX4 quads from Operate. `make swarm-up` runs four PX4 v1.18 vehicles in SIH and a MAVLink bridge; `?live=1` puts them in Operate beside (or instead of) the scripted fleet, with launch checks that gate Launch, formations to a clicked point, an area sweep split into one strip per vehicle, go-to, hold, return, land, and a lost-link test that PX4 answers by coming home. Checked end to end against PX4 SIH (`make swarm-check`); opt-in, so the hosted demo is unchanged; hardware notes in docs/design/live-sim.md
- Product, help and developer sites cover the first responder program: a Public safety section on the product page (a call from dispatch to the invoice, who decides at each step, four new screenshots), help's What's new, Getting started and walkthrough links, and the `/v1/dfr` routes, the supervisor, pilot and contractor personas and the split launch authority in the developer explorer
- First responder program, phase 3: Report and invoice (the monthly activity report and the invoice built from the signed shift logs; unstaffed hours and hours a pilot worked while not current are not payable, shifts with unfiled records are held; contractor submits, program manager approves or returns); a weekly battery and aircraft care log that grounds a failed pack and cautions an overdue check; retention by record type and legal holds; records requests with redaction and a hash manifest; a `contractor` seat that sees its pilots and its invoice, never the console or incident records
- First responder program, phase 2: start-of-shift checks before anything launches, discrepancies reported to the supervisor, a shift log built from the shift's records and signed into the evidence chain at hand-off; Pilots and roster with a 14-day console roster, each pilot's currency file (certificate, recurrent training, hours, TWIC, CJIS, supervised time) and the program manager's solo sign-off; a mishap clock (verbal at once, written within 24 hours, FAA reportable or not); crane rows, stacks and bridge towers on the map and in the pre-flight (#56)
- First responder program, phase 1: a public safety customer (Customer D, a harbor police program, SIM) on the same platform in its own operating mode. Respond: calls from a simulated dispatch feed, supervisor approval for every launch, the nearest ready dock picked by flight time, pre-flight checks, a pilot decline or termination that no role can override, release and stop-observation for the supervisor. Flight records: prefilled from the flight, filed once by the pilot, corrected only by a new version sealed into a hash chain; requests not flown and why. New `supervisor` and `pilot` logins; the admin's workspace menu opens the program as Neros (#55)
- Documentation rebuilt against the current build: README, help center (Missions and launch checks, a Loadout planner guide, physics on Operate, Brief, Airframes, Stockpile and the Denial map), the product page's Plan tab and screenshots, the developer explorer's Physics routes, and a script that retakes every screenshot (`services/ui/e2e/docs/shots.mjs`)

## Physics in the pages (2026-11-12)

- Persona journey swarm: a bot per demo account walks the site, sign-in and every button on every page at laptop and phone widths; its findings fixed (a customer no longer sees other customers on Releasability, an allied tenant sees its fleet as its own, role-refused buttons are disabled with the reason, empty tables link to the next step, drawers and the palette close with Esc, the guided walk can fold) (#52)
- Wind over terrain on Missions (a Wind view on the plan map, wind direction in the conditions, findings that offer a height or a bigger pack); camera height on Brief (what each camera sees of each task by height, filed before approval); wear by flight load on Airframes (bearing life per motor, arm fatigue from hard landings, ground for a check) (#51)
- Physics in Operate (station links over terrain, a Radio shadow layer), Debrief (where each tail's energy went, link margin over the flown track) and Stockpile health (calendar ageing per stored pack, what a storage charge or a cooler store buys) (#50)
- The physics check moves into the pages where its decisions are made: conditions, findings with fixes, the video link over the terrain and packs and thrust on each plan in Missions; packs and the thrust envelope in the Loadout planner; control and video coverage on the Denial map; the next sortie on Airframes. `#physics` now opens Missions (#49)
- Physics check: plans flown through line of sight over the range's real terrain with an EW emitter, an electro-thermal pack model and thrust headroom in gusts; findings become fixes that re-plan the mission (#48)

## Tracker, bid and demo state (2026-11-09)

- Second closed-loop tracker rerun with the motion gate: v2 still ends on a parked look-alike in 2 of 5 runs, recorded as an open problem (#47)
- The hosted demo keeps your actions across a reload; a new tab or ⌘K "Reset the demo data" starts fresh (#46)
- PostGIS image build retries serially when the parallel make races (#45)
- Army Drone Marketplace CSO solution brief and submission plan (#44)
- Tracker motion gate: refuse a match that stops or jumps while the target is moving, and hand back to the operator (#23)

## Enhancement sweep (2026-11-05)

- Guided walk for a first visit, ⌘K finds tails and plans, axe accessibility gate in CI (#41)
- The demo's access rules as a generated matrix and a test; unknown routes answer 404; the ops lead can hold a lot from Attrition (#42)
- Every page except the two homes loads on first open: the console's entry script drops from 1.75 MB to 0.33 MB; this changelog, and a What's new page in the help center (#43)

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
