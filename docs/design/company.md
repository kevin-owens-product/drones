# Company view: contract to field on one thread

The console so far covered the field: Operate, Fleet, Attrition, Reports. A drone company runs on a longer chain. A contract becomes a build plan, the plan pulls parts from suppliers, the line builds and tests each serial, logistics ships kits to units, units fly and break them, and those losses come back as repairs, reorders and supplier problems. The Company page (`#company`) puts that chain on one screen, keyed by SKU and serial, so a loss in the field shows up the same day as a reorder, a late order or a supplier corrective action.

## What is real and what is simulated

| Data | Source |
|---|---|
| Product line: Archer 5″, 8″, 10″, the Strike variants, Archer AI, Crossbow, Flatbow, peripherals, MISSION Success courses | As Neros publishes it on neros.tech, the Archer 5″ product page, the MISSION Success page and the Archer Block 2 press release (9 Mar 2026). Each item links its source. |
| Archer 8″ and 10″ performance figures | **Not published by Neros**, and shown as "not published" rather than filled in. |
| Customers, orders, DPAS ratings, export licence, line rates, WIP | Simulated (generic Customer A, B, C) |
| Suppliers, part numbers, BOMs, part costs, lead times, lots, stock, purchase orders | Simulated (placeholder supplier names) |
| Units, field spares, operator and instructor counts, course bookings | Simulated |
| Birth records, EOL results, flagged lot ESC-2611, attrition shortfall | Same simulated sources as Fleet, Bench and Attrition |

Every screen carries a SIM tag and the source line says which is which.

## ADR-0016

The Strike variants appear in the catalogue and as sealed finished-goods counts only. They have no BOM, no build plan, no order line and no kit plan in this platform, and nothing models a payload, warhead, targeting or release. Archer AI lists GPS-denied position hold; Neros also lists terminal guidance, which is named and not modelled. `demo/company.test.mjs` fails if a Strike SKU gains a BOM, an order or a build plan.

## How the pieces connect

- **Products**: published specs, a simulated BOM with rolled-up material cost, and which parts the user can swap in the field (Neros says Block 2 arms, motors and props are user-swappable and sensors swap in minutes).
- **Orders and plan**: open orders in DPAS priority, then due date. Each draws on finished goods and then on *released* parts shared across SKUs, so one late flight controller PO shows up as a projected slip on the order it starves. An export order waits on its licence. The S&OP table adds Attrition's replacement demand to the order backlog.
- **Production**: EOL first-pass yield from the birth records, buildable count per model and the part that limits it, WIP by routing step (kit, assemble, flash, EOL bench, pack). The EOL bench step is `sim/bench`.
- **Supply chain**: MRP-style exceptions (below reorder point, late PO, quarantined lot), supplier scorecard with NDAA attestation, lots with where-used down to the tail. A hold placed on Attrition quarantines that lot's stock, opens a supplier corrective action (SCAR), cuts the buildable count and opens a quality-hold work order on each tail built from it.
- **Logistics**: Attrition's shortfall per unit becomes a kit plan for the model that unit flies: unpromised finished goods now, the rest released to the line, and a spares pack sized per airframe. Battery packs ship as lithium dangerous goods.
- **Sustainment**: work orders by tail. Closing one issues parts from the oldest released lots and, for a repair, returns the tail to service (NX-08). Both actions need `fleet.write` and land in the hash-chained audit log.
- **Training**: operators and AD-I instructors per unit against airframes held, with MISSION Success bookings.
- **Engineering change**: each ECO names the platform evidence behind it (Attrition, Field reports, Eval) and its effectivity by serial.

The Overview turns the day's state into a short chain of cause and follows one serial from order to sustainment.

## Why this shape

Neros's open roles (Nov 2026) point at the same chain: supply chain planning and systems (ERP/MRP, S&OP, BOMs, lead times, excess and obsolete), supplier quality, development and industrialization engineers, a manufacturing systems lead (MES work orders, serialization, genealogy, rework), a logistics manager (lithium dangerous goods, ITAR/EAR, DPAS), and a second site in Tennessee. The product question is what one record of a serial needs to carry so that each of those teams acts on the same fact.

## Limits

- It is a demo model in `services/ui/demo/supply.mjs` and `company.mjs`, served by the demo server and the hosted static build. The FastAPI control plane has no `/v1/company` endpoints and no tables for orders, lots or work orders yet.
- Planning is a single pass: no capacity calendar, no partial deliveries, no lead-time offsetting beyond "PO due date plus days already late".
- Supplier figures, prices and lead times are placeholders, not estimates of Neros's costs.
