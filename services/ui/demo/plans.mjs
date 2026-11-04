// Plans and entitlements: what each tenant pays for, what it may open, and
// what it uses (docs/design/round-two.md, build 8).
//
// Why: if the government furnishes the control software, Neros earns on the
// record and the fleet software around every drone. Record is priced into
// each drone (about 2% of unit price); Fleet is priced per formation per year,
// because drones are expended and formations are not; Program adds allied
// releasability, sovereign hosting and the fix-loop partnership. A tier gates
// routes at the API, and usage is counted from the same records the pages use.
//
// Prices are planning assumptions to test with buyers (SIM), not Neros prices.
// Pure JavaScript.

import { TODAY } from "./company.mjs";

export const TIERS = [
  { id: "record", name: "Record", price: "About 2% of each drone's unit price", features: ["quote", "receiving", "accountability", "updates", "readiness"] },
  { id: "fleet", name: "Fleet", price: "$60,000 per formation per year", features: ["quote", "receiving", "accountability", "updates", "readiness", "mixed", "config", "stockpile"] },
  { id: "program", name: "Program", price: "$180,000 per formation per year", features: ["quote", "receiving", "accountability", "updates", "readiness", "mixed", "config", "stockpile", "release", "cases"] },
];

export const FEATURE_LABEL = { mixed: "All vendors", config: "Configuration", stockpile: "Stockpile health", release: "Allied releasability and sovereign hosting", cases: "Fix-loop partnership" };
export const RECORD_SHARE = 0.02;
const UNIT_USD = 3370; // typical kit price for the record share (SIM, matches the quote list for a thermal 5-inch)
const FORMATION_USD = { fleet: 60_000, program: 180_000 };

/** @param {{ serials: any, mixed: any, customers: { id: string, name: string }[] }} deps */
export function createPlans({ serials, mixed, customers }) {
  const tier = { "CUS-A": "fleet", "CUS-B": "record", "CUS-C": "program" };
  const requests = [];
  let reqSeq = 10;

  const tierOf = (org) => TIERS.find((t) => t.id === (tier[org] ?? "record"));
  const allows = (org, feature) => tierOf(org).features.includes(feature);
  const needs = (feature) => TIERS.find((t) => t.features.includes(feature));

  function usage(org) {
    const drones = [...serials.serials.values()].filter((s) => s.org === org && s.state !== "rejected").length;
    const formations = mixed.view(org).units.length;
    const t = tierOf(org);
    const record = Math.round(drones * UNIT_USD * RECORD_SHARE);
    const fleet = t.id === "record" ? 0 : formations * FORMATION_USD[t.id];
    return { drones, formations, record_usd: record, fleet_usd: fleet, annual_usd: record + fleet };
  }

  /** The refusal a gated route returns. */
  function gate(org, feature) {
    if (allows(org, feature)) return null;
    const t = tierOf(org);
    const n = needs(feature);
    return { status: 403, body: { detail: `${FEATURE_LABEL[feature] ?? feature} is part of ${n.name}; your plan is ${t.name}. Ask Neros to add it from Order.`, gated: { feature, tier: t.id, needs: n.id } } };
  }

  function mine(org) {
    const t = tierOf(org);
    return { org, tier: t.id, name: t.name, price: t.price, features: t.features, missing: Object.keys(FEATURE_LABEL).filter((f) => !t.features.includes(f)).map((f) => ({ feature: f, label: FEATURE_LABEL[f], needs: needs(f).name })), usage: usage(org), requests: requests.filter((r) => r.org === org) };
  }

  function view() {
    const rows = customers.map((c) => ({ org: c.id, name: c.name, tier: tierOf(c.id).id, tier_name: tierOf(c.id).name, usage: usage(c.id), open: requests.filter((r) => r.org === c.id && r.status === "requested") }));
    return {
      source: "Simulated: prices are planning assumptions to test with buyers, not Neros prices. Usage is counted from this demo's records.",
      today: TODAY, tiers: TIERS, labels: FEATURE_LABEL, customers: rows,
      totals: { annual_usd: rows.reduce((n, r) => n + r.usage.annual_usd, 0), drones: rows.reduce((n, r) => n + r.usage.drones, 0), formations: rows.reduce((n, r) => n + r.usage.formations, 0) },
      requests: requests.slice().reverse(),
    };
  }

  function act(org, action, a, actor) {
    if (action === "plans.request") {
      const t = TIERS.find((x) => x.id === a.tier);
      if (!t) return { error: "pick a plan", status: 400 };
      if (TIERS.indexOf(t) <= TIERS.indexOf(tierOf(org))) return { error: `You already have ${tierOf(org).name}`, status: 409 };
      if (requests.some((r) => r.org === org && r.status === "requested")) return { error: "A plan request is already with Neros", status: 409 };
      const r = { id: `PLN-${(reqSeq += 1)}`, org, from: tierOf(org).id, to: t.id, status: "requested", by: actor, at: TODAY };
      requests.push(r);
      return { ok: true, message: `${r.id}: asked Neros to move you to ${t.name}.` };
    }
    if (action === "plans.set") {
      const target = String(a.org ?? "");
      if (!customers.some((c) => c.id === target)) return { error: "no such customer", status: 404 };
      const t = TIERS.find((x) => x.id === a.tier);
      if (!t) return { error: "pick a plan", status: 400 };
      tier[target] = t.id;
      for (const r of requests.filter((x) => x.org === target && x.status === "requested")) r.status = r.to === t.id ? "granted" : "superseded";
      return { ok: true, message: `${target} is now on ${t.name}.` };
    }
    return { error: "unknown action", status: 400 };
  }

  function queueItems() {
    return requests.filter((r) => r.status === "requested").map((r) => ({
      id: `q-plan-${r.id}`, area: "Commercial", severity: "medium", org: r.org,
      title: `${r.org} asks to move from ${TIERS.find((t) => t.id === r.from).name} to ${TIERS.find((t) => t.id === r.to).name}`,
      detail: `Requested ${r.at} by ${r.by}.`,
      actions: [{ label: `Move to ${TIERS.find((t) => t.id === r.to).name}`, action: "market.plans.set", args: { org: r.org, tier: r.to }, primary: true }],
    }));
  }

  return { view, mine, act, gate, allows, usage, queueItems, tierOf };
}
