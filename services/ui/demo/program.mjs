// Program cockpit: how Neros is doing against the program it sells into.
//
// Why: Drone Dominance re-competes every phase against a falling price, and it
// rewards on-time accepted delivery, provenance and operator results. A
// Director of Product needs one page that joins the price ladder to what each
// drone costs to build, what a completed sortie costs the customer, acceptance
// against the program, delivery against orders, the demand that expenditure
// creates, and whether training moves results.
//
// Program figures are as reported by secondary trackers (labelled on each row;
// Phase III is conflicting). Costs, orders, sorties and rates are simulated
// (SIM). Prices are for the airframe alone; nothing here covers munitions or
// what a sortie did, only whether it completed (ADR-0016). Pure JavaScript.

import { CUSTOMERS, TODAY } from "./company.mjs";
import { bom, nameOf } from "./supply.mjs";
import { FCC_EXEMPTION_ENDS } from "./compliance.mjs";

export const PRICE_LADDER = [
  { phase: "Phase I (Gauntlet I)", drones: 30_000, price_usd: 5_000, note: "Planned average", source: "drone-warfare.com (secondary)" },
  { phase: "Phase II", drones: 60_000, price_usd: 3_500, note: "Close-quarters airframe; includes one GCS per 20 drones and six training sessions", source: "drone-warfare.com (secondary)" },
  { phase: "Phase III", drones: 100_000, price_usd: 3_000, note: "Conflicting: RFI plan says $3,000 average; the September solicitation reportedly $3,000 close-quarters", source: "Public Spend Forum, drone-warfare.com (secondary)" },
  { phase: "Phase IV", drones: 150_000, price_usd: 2_300, note: "Planned average; the program manager's goal is under $2,000", source: "Breaking Defense, drone-warfare.com (secondary)" },
];
export const PRICE_GOAL = 2_000;

/** @param {{ company: any, ops: any, thread: any }} deps */
export function createProgram({ company, ops, thread }) {
  const { serials, readiness, compliance } = thread;

  function completion(skus) {
    const shared = Object.keys(ops.sharing).filter((o) => ops.sharing[o]);
    return skus.map((sku) => {
      const recs = serials.records.filter((r) => r.sku === sku && shared.includes(r.org));
      const done = recs.filter((r) => r.outcome === "completed").length;
      return { sku, name: nameOf(sku), bom_usd: bom(sku).usd, sorties: recs.length, rate: recs.length ? done / recs.length : null };
    });
  }

  function expenditure() {
    const rows = [];
    for (const c of CUSTOMERS) {
      if (!ops.sharing[c.id]) continue;
      const acct = serials.accountability(c.id);
      for (const u of acct.units) {
        const open = ops.requests.filter((r) => r.org === c.id && r.unit === u.unit && r.kind === "replacement" && !["fulfilled", "declined", "cancelled"].includes(r.status));
        rows.push({ org: c.id, unit: u.unit, sku: u.sku, per_week: Number((u.per_day * 7).toFixed(1)), on_hand: u.in_store + u.issued, days_of_supply: u.days_of_supply, open_requests: open.map((r) => ({ id: r.id, qty: r.qty, status: r.status })) });
      }
    }
    return rows;
  }

  function view(holds, demand) {
    const plan = company.plan(holds, demand);
    const skus = ["ARCHER-5", "ARCHER-8", "ARCHER-10"];
    const effect = readiness.nerosView();
    const six = effect.effect.by_sessions.find((g) => g.label === "6 of 6");
    const few = effect.effect.by_sessions.find((g) => g.label === "3 or fewer");
    const orders = plan.orders.map((o) => ({ id: o.id, customer: o.customer, sku: o.sku, name: o.name, qty: o.qty, delivered: o.delivered + o.shipped, left: o.left, due: o.due, projected: o.projected, at_risk: o.at_risk, why: o.why }));
    const comp = compliance.view();
    return {
      source: "Program prices from secondary trackers (named per row). Costs, orders, sorties, acceptance and training records are simulated (SIM). Airframe prices only.",
      today: TODAY,
      ladder: PRICE_LADDER,
      price_goal: PRICE_GOAL,
      skus: completion(skus),
      training: { customers: effect.customers, operators: effect.operators, full: six ? { rate: six.rate, operators: six.operators } : null, few: few ? { rate: few.rate, operators: few.operators } : null, by_sessions: effect.effect.by_sessions },
      acceptance: serials.acceptanceStats(),
      orders,
      on_time: orders.length ? orders.filter((o) => !o.at_risk).length / orders.length : null,
      expenditure: expenditure(),
      compliance: { days_left: comp.days_left, fcc_exemption_ends: FCC_EXEMPTION_ENDS, gaps: comp.counts.gap, expiring: comp.counts.expiring, lots: comp.lots.length },
    };
  }

  return { view };
}
