# One record per serial, factory to field

Wave 1 of the plan that came out of the November 2026 competitor research. The
research found no vendor joining a drone's build genealogy to its field
outcome, its operator and its supplier lot, while the Drone Dominance rules now
reward on-time acceptance, provenance at every tier and low operator workload.
Gauntlet I accepted only 57% of shipped drones across all vendors a month past
the deadline (secondary tracker). The full report is in the project files at
`research/neros-competitors-and-drone-software-market.md`.

## What it does

| Page | Workspace | Job |
| --- | --- | --- |
| Receiving | Customer | Open a delivery lot's package: every serial's component lots, firmware and bench results, checked automatically. Accept the lot, reject failing serials with a reason. |
| Accountability | Customer | Issue airframes by lot and count, like ammunition. See in store, issued and ended by unit and lot, and days of supply. Ground stations write an end-of-flight record when each sortie ends and sync it later. |
| Quality | Neros | Acceptance against the program, lots waiting at customers, rejected serials to replace, field faults by component lot, a supplier scorecard, corrective actions, and whether field evidence supports moving end-of-line flight test to sampling. |

Each serial's history is one hash-chained list of events (born, packed, shipped,
accepted or rejected, issued, flew, ended), opened from any page.

## Data

`services/ui/demo/serials.mjs` holds the seeded, deterministic population: seven
delivery lots (two waiting on the customer), about 690 serials, and 28 days of
end-of-flight records from four units. ESC lot ESC-2611 has a raised fault rate
in the sim so the loop has something to find. `demo/thread.mjs` routes
`/v1/thread/*` and checks roles.

| Record | Fields | Owner |
| --- | --- | --- |
| Delivery lot | id, customer, unit, model, serials, shipped, decision, rejected serials with reasons | Neros builds it; the customer decides |
| Serial | component lots, firmware hash, bench record, state | Neros until acceptance, then the customer |
| End-of-flight record | serial, unit, operator, ground station, day, outcome class, recovered, jamming, last link, nav source, battery, fault codes, firmware | Customer |
| Supplier corrective action | lot, part, supplier, evidence, state | Neros |

## Guardrails

- **ADR-0016.** Outcome classes are neutral: completed, aborted, lost link, lost
  navigation, hardware fault, battery, unknown. No record has a target, strike,
  damage or payload field, and a unit test fails if one appears.
- **Tenancy.** A customer sees only its own lots, serials and records. Neros sees
  end-of-flight records only while the customer shares them, and then only the
  outcome fields (no operator, unit, station or day flown). Turning sharing off
  empties the Quality loop.
- **Roles.** Accepting, issuing and syncing need the mission commander or
  maintainer role; Neros actions need the ops lead or admin role. Every attempt,
  refused or not, is in the audit log.
- **Honest numbers.** Every figure is simulated and labelled SIM, except the
  program acceptance rate and the 250-a-day line rate, which cite their sources.

## The rules the loop uses

- A fault counts against a component lot when its code points at that part.
- A lot is out of family with at least 5 faults, at least 1.5 times the other
  lots of that part, and p under 0.01 on a one-sided Poisson test.
- Sampling is recommended only for builds whose lots are all clean, with at
  least 200 clean sorties and a 95% upper bound on the fault rate under 7%.

## Next

The real API needs the same five tables with row-level security by tenant and
the gateway writing the end-of-flight record when a vehicle's session closes.
Wave 2 adds the compliance ledger and operator readiness on top of this record.

## Wave 2: provenance packets and operator readiness

**Compliance (Neros).** From Drone Dominance Phase II no covered-country content is allowed at any tier, from Phase III firmware may not be hosted in a covered country, and the FCC's Blue List and domestic-product exemptions end on 1 January 2027. Compliance becomes evidence per lot. `demo/compliance.mjs` keeps sub-component origins by tier for each component lot the serial record uses, rolls them up into a packet per delivery lot, and shows what is missing before the deadline. Neros requests evidence from a supplier (EVR request, due in 10 days) and records the document; recording a covered country is refused and points to a Quality hold. Open gaps go to the work queue.

**Packets (customer).** Receiving shows each delivery lot's packet status, and the packet downloads as JSON. Customers get it without supplier names; another customer's lot is a 404.

**Readiness (customer).** `demo/readiness.mjs` joins each operator's training record (course, bundled sessions out of six, the Operate simulator qualification) to the outcomes of their sorties in the last 28 days. It flags who is not current, who has not passed qualification, and who has unused bundled sessions, and books a refresher. The page also shows completed-sortie rate by sessions taken and by simulator pass. Operators are designators, never names.

**What Neros sees.** `/v1/thread/training-effect` returns only aggregates, and only from customers that share. Everything here is simulated (SIM).
