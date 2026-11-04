# Round two: the record and the sale around any drone

Plan: [What to build next, round two](https://claude.ai/artifact/BgV5aN6GaJ39Hu3KvmaM7s) (4 Nov 2026).

The government now furnishes the control software (Drone Dominance Phase III, the Army's C2 call into NGC2) and units buy
from a storefront (the Army UAS Marketplace). Neros's screen stops being the moat; the platform earns its place by keeping
the record and running the sale around every drone, from any vendor, for any allied buyer. Nine builds in three waves,
all in `services/ui/demo/` behind one router, `market.mjs`.

| # | Build | Module | Page | What proves it |
|---|---|---|---|---|
| 1 | Listing and quote | `quote.mjs` | `#quote` (customer: Quote and order; Neros: Quotes) | Price equals its lines; sortie cost from end-of-flight records; Neros cannot commit a date before the fastest the factory can make |
| 2 | Mixed fleet | `mixedfleet.mjs` | `#mixed` (All vendors) | Readiness across vendors; imports check every row; other vendors carry no birth record and say why |
| 3 | Field configuration | `config.mjs` | `#config` | A mismatched swap is refused; a conversion holds the airframe from ready until its parameter set loads |
| 4 | Surge planner | `surge.mjs` | `#surge` | The plain date never beats the slowest part; expediting and a second shift are never later and show their cost |
| 5 | Bid desk | `biddesk.mjs` | `#bid` | Every "met" row links to a record that exists; ADR-0016 rows read out of scope |
| 6 | Fix loop | `cases.mjs` | `#cases` | A case closes only with a measured cohort-against-control effect |
| 7 | Allied tenants | `release.mjs` | `#release` | An allied session never receives a field its releasability rules withhold |
| 8 | Plans and entitlements | `plans.mjs` | `#plans` | A tenant's tier gates its routes; usage counts match the records |
| 9 | Stockpile health | `stockpile.mjs` | `#stockpile` | An over-age pack holds its airframe from ready; rotating restores it |

Rules carried over: every number is SIM unless sourced; other vendors appear under generic program labels, never real
product names; outcomes stay neutral (completed, aborted, lost) with no target, strike or damage fields (ADR-0016); the
console sends feeds out and accepts no commands back.

Pricing in the demo (Record share about 2% of unit price, Fleet per formation per year, interfaces free) is a planning
assumption to test with buyers, not a Neros price.
