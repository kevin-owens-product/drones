# Two workspaces: Neros operations and customer fleets

The Company view (`#company`) shows the whole chain from contract to field, but it is a read-out: it tells you ORD-A1 will ship late and does not let you do anything about it. Neros will run its own operations on this platform, and it will also offer the software to customers to run their own drone fleets. Those are two different users with different questions, so the console now has two workspaces on one data model.

| | Neros operations | Customer workspace |
|---|---|---|
| Who | Neros ops, supply chain, quality, production, logistics | A customer's commanders, maintainers and operators |
| Home | **Work queue** (`#ops`) | **Operate** (`#operate`) |
| Pages | Work queue, Company, Eval, Attrition (shared), Reports, Configure | Operate, Brief, Missions, Debrief, Fleet, **Supply & support** (`#supply`), Attrition, Reports, Denial map, Configure |
| Sees | Every customer's orders and requests; a customer's loss data only while that customer shares it | Its own units, orders, shipments and requests; nothing of Neros's suppliers, stock or other customers |

The demo account's `org` picks the workspace. `admin` and the new `ops` login are Neros; `commander`, `operator` and `maintainer` are Customer A. Neros staff get a **Neros ops / Customer** switch in the top bar, and the portal lets them preview Customer A, B or C. The real API has no `org` yet, so it shows every page as before.

## The work queue

`GET /v1/ops/queue` builds the queue from live state each time: customer requests, resupply proposals from shared loss data, order lines that can ship from stock, export lines waiting on a licence, builds the backlog needs, parts below reorder point with no PO, late and due POs, lots waiting on incoming inspection, held lots to disposition, SCARs ready to close, engineering changes in review and open work orders. Each item says why it matters and carries the action that clears it, ranked Now / Today / This week.

Actions (`POST /v1/ops/act`) change the state the next item reads: raise a PO → receive it at the dock → incoming inspection → the lot is released → the line can build → finished goods → ship an order line or a customer request. Holding a lot from Attrition opens a disposition item; returning it lets quality close the SCAR. Every action and every refusal goes to the audit log.

## The customer portal

`GET /v1/ops/portal` is scoped to the caller's own organisation; a customer asking for another `org` gets its own. It shows what needs the customer (Neros proposals, shipments to sign for, airframes waiting on an acceptance flight), each unit's days of supply from its own loss forecast, and the buttons to ask Neros for airframes, a spares pack, a course or a repair (RMA). Order dates come with a customer-safe reason ("waiting on a component") rather than Neros's supplier names.

## The loop between them

1. A customer asks for airframes, or Neros proposes them from shared loss data and the customer accepts.
2. The request lands in the Neros queue. Ops approves, builds if finished goods are short, and ships.
3. The customer signs for the shipment. The order line or request is delivered, the unit's count goes up, and each serial joins the customer's Fleet as **restricted** until its acceptance flight.
4. The customer marks the acceptance flights passed and the airframes are in service.

Sharing is the customer's choice. With it off, Neros sees no Attrition data and cannot propose resupply; the customer can still ask for anything.

## Rules kept

- **ADR-0016.** Strike SKUs never enter a build, a request or a shipment; `demo/ops.test.mjs` checks it.
- **Roles.** Neros actions need `org: neros` and the admin or `ops_lead` role. Customer requests and receipts need the mission commander, maintainer or admin role; operators can view. `ops_lead` is demo-only: the API's role enum is a Postgres type and is not changed here.
- **SIM.** Customers, requests, stock, POs and shipments are simulated and labelled. State lives in the browser tab: signing out and in keeps it, reloading the page starts the scenario over.
