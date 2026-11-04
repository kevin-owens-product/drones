// Listing and quote: how a unit buys from the storefront, and how Neros
// commits a price and a date it can keep (build 1).
//
// Why: Army units now buy through the UAS Marketplace (opened 24 Mar 2026,
// over $750M of sales by August), which compares listings and builds a package
// of platform, payloads, accessories and training. This is Neros's listing:
// configure a Block 2 kit, see the unit price, what a completed sortie really
// costs from the unit's own records, a delivery date from the surge planner,
// and the evidence badges. A request lands in the Neros work queue; Neros
// prices it and cannot promise a date the factory cannot make.
//
// Prices, the Record share, the Fleet subscription and sortie costs are SIM
// planning assumptions, not Neros prices. Airframe prices only (ADR-0016).

import { CUSTOMERS, TODAY } from "./company.mjs";
import { addDays } from "./serials.mjs";
import { nameOf } from "./supply.mjs";

export const LIST_USD = { "ARCHER-5": 2_950, "ARCHER-8": 3_400, "ARCHER-10": 3_900 };
export const SENSOR_USD = { day: 0, thermal: 420, down: 90, illum: 510 };
export const SENSOR_NAME = { day: "Day FPV camera", thermal: "Thermal and FPV", down: "Down camera and FPV", illum: "EO/IR illuminator and thermal" };
export const COURSE_USD = { "TRN-ADO": 4_800, "TRN-ADI": 6_200 };
export const RECORD_SHARE = 0.02;
export const FLEET_USD = { battalion: 60_000, brigade: 180_000 };
export const PROGRAM_PRICE = { label: "Drone Dominance Phase II close-quarters airframe", usd: 3_500, source: "drone-warfare.com (secondary)" };

/**
 * @param {{ company: any, serials: any, compliance: any, surge: ReturnType<import("./surge.mjs").createSurge> }} deps
 */
export function createQuote({ company, serials, compliance, surge }) {
  const quotes = [];
  let seq = 310;

  /** Drones expended per completed sortie, from end-of-flight records (the customer's own, else all shared). */
  function sortieCost(sku, org, unitUsd) {
    let recs = serials.records.filter((r) => r.sku === sku && r.org === org);
    let basis = "your own end-of-flight records";
    if (recs.length < 20) {
      recs = serials.records.filter((r) => r.sku === sku);
      basis = "all customers' shared records";
    }
    const completed = recs.filter((r) => r.outcome === "completed").length;
    const expended = recs.filter((r) => !r.recovered).length;
    if (!completed) return { usd: null, basis, completed: 0, expended };
    const per = expended / completed;
    return { usd: Math.round(unitUsd * per), drones_per_completed: Number(per.toFixed(2)), completion: completed / recs.length, basis, sorties: recs.length };
  }

  function price(c) {
    const sku = String(c.sku ?? "ARCHER-5");
    if (!LIST_USD[sku]) return { error: `${nameOf(sku)} is not on the listing`, status: 400 };
    const sensor = SENSOR_USD[c.sensor] != null ? String(c.sensor) : "day";
    const qty = Math.round(Number(c.qty ?? 0));
    if (!Number.isFinite(qty) || qty < 1 || qty > 20_000) return { error: "quantity must be 1 to 20,000", status: 400 };
    const seats = Math.max(0, Math.min(200, Math.round(Number(c.seats ?? 0)) || 0));
    const fleet = ["none", "battalion", "brigade"].includes(c.fleet) ? String(c.fleet) : "none";
    const unit = LIST_USD[sku] + SENSOR_USD[sensor];
    const lines = [
      { item: `${nameOf(sku)}, ${SENSOR_NAME[sensor]}`, qty, each: unit, usd: unit * qty },
      { item: "Serial record: birth record, acceptance package, end-of-flight records (included)", qty, each: Math.round(unit * RECORD_SHARE), usd: 0, included: true },
    ];
    if (seats) lines.push({ item: "Operator course (AD-O), per seat", qty: seats, each: COURSE_USD["TRN-ADO"], usd: COURSE_USD["TRN-ADO"] * seats });
    if (fleet !== "none") lines.push({ item: `Fleet software, one ${fleet}, first year`, qty: 1, each: FLEET_USD[fleet], usd: FLEET_USD[fleet] });
    const total = lines.reduce((s, l) => s + l.usd, 0);
    return { sku, sensor, qty, seats, fleet, unit_usd: unit, lines, total_usd: total };
  }

  function evidence() {
    const acc = serials.acceptanceStats();
    const comp = compliance.view();
    return [
      { label: "Accepted on delivery", value: acc.rate == null ? "—" : `${(acc.rate * 100).toFixed(1)}%`, detail: `${acc.accepted} of ${acc.serials} serials; program-wide ${Math.round(acc.program.rate * 100)}% (${acc.program.label})` },
      { label: "Provenance packet per lot", value: comp.counts.gap ? `${comp.counts.gap} gap${comp.counts.gap === 1 ? "" : "s"} open` : "Complete", detail: `FCC exemptions end ${comp.fcc_exemption_ends ?? "2027-01-01"}; ${comp.days_left} days left` },
      { label: "Interfaces", value: "Open", detail: "CoT, Lattice and MAVLink-M feeds included at no charge" },
    ];
  }

  /** What the customer sees before asking: the configured kit, its price, sortie cost, date and evidence. */
  function preview(org, c) {
    const p = price(c);
    if (p.error) return p;
    const date = surge.earliest(p.sku, p.qty);
    const fast = surge.earliest(p.sku, p.qty, { expedite: true });
    return {
      ...p,
      sortie: sortieCost(p.sku, org, p.unit_usd),
      program_price: PROGRAM_PRICE,
      delivery: { date: date.date, fastest: fast.date, binding: date.binding.why },
      evidence: evidence(),
    };
  }

  function view(org, neros, c = {}) {
    const mine = quotes.filter((q) => neros || q.org === org).slice().reverse();
    return {
      source: "Simulated: prices, the Record share, Fleet subscription and training prices are planning assumptions, not Neros prices. Delivery dates come from the surge planner; sortie costs from end-of-flight records.",
      today: TODAY,
      options: { skus: Object.keys(LIST_USD).map((s) => ({ sku: s, name: nameOf(s), usd: LIST_USD[s] })), sensors: Object.entries(SENSOR_USD).map(([id, usd]) => ({ id, name: SENSOR_NAME[id], usd })), fleet: FLEET_USD, course_usd: COURSE_USD["TRN-ADO"] },
      preview: preview(org, { sku: "ARCHER-5", sensor: "thermal", qty: 120, seats: 10, fleet: "battalion", ...c }),
      quotes: mine,
    };
  }

  function act(org, action, a, actor, neros) {
    if (action === "quote.request") {
      if (neros) return { error: "Customers request quotes; Neros prices them.", status: 403 };
      const p = preview(org, a);
      if (p.error) return p;
      const q = { id: `Q-${(seq += 1)}`, org, org_name: CUSTOMERS.find((c) => c.id === org)?.name ?? org, unit: String(a.unit ?? "") || null, ...p, status: "requested", requested: TODAY, by: actor, committed: null };
      quotes.push(q);
      return { ok: true, id: q.id, message: `${q.id} sent to Neros: ${p.qty} × ${nameOf(p.sku)}, about $${p.total_usd.toLocaleString("en-US")}, earliest ${p.delivery.date}.` };
    }
    const q = quotes.find((x) => x.id === String(a.id ?? ""));
    if (!q || (!neros && q.org !== org)) return { error: "no such quote", status: 404 };
    if (action === "quote.price") {
      if (!neros) return { error: "Only Neros prices a quote.", status: 403 };
      if (q.status !== "requested") return { error: `quote is ${q.status}`, status: 409 };
      const fastest = surge.earliest(q.sku, q.qty, { expedite: true, second_shift: true });
      const plain = surge.earliest(q.sku, q.qty);
      const date = String(a.date ?? plain.date);
      if (date < fastest.date) return { error: `Refused: the factory cannot ship ${q.qty} × ${nameOf(q.sku)} before ${fastest.date}, even expedited on two shifts (${fastest.binding.why}).`, status: 409 };
      const discount = Math.max(0, Math.min(0.15, Number(a.discount ?? 0) || 0));
      q.committed = { date, total_usd: Math.round(q.total_usd * (1 - discount)), discount, by: actor, at: TODAY, needs_expedite: date < plain.date };
      q.status = "quoted";
      return { ok: true, message: `${q.id} priced at $${q.committed.total_usd.toLocaleString("en-US")}, delivery committed for ${date}${q.committed.needs_expedite ? " (needs expediting: see Surge)" : ""}.` };
    }
    if (action === "quote.accept") {
      if (neros) return { error: "The customer accepts a quote.", status: 403 };
      if (q.status !== "quoted") return { error: `quote is ${q.status}`, status: 409 };
      q.status = "ordered";
      const order = { id: `ORD-${q.id}`, customer: q.org, sku: q.sku, qty: q.qty, delivered: 0, shipped: 0, due: q.committed.date, dpas: "DO", export: CUSTOMERS.find((c) => c.id === q.org)?.country === "US" ? null : { license: "DSP-5", status: "pending" } };
      company.orders.push(order);
      return { ok: true, message: `${q.id} accepted: order ${order.id} for ${q.qty} × ${nameOf(q.sku)}, due ${order.due}${order.export ? "; export license pending" : ""}.` };
    }
    if (action === "quote.decline") {
      if (q.status === "ordered") return { error: "already ordered", status: 409 };
      q.status = "declined";
      return { ok: true, message: `${q.id} declined.` };
    }
    return { error: "unknown action", status: 400 };
  }

  function queueItems() {
    return quotes.filter((q) => q.status === "requested").map((q) => ({
      id: `q-quote-${q.id}`, area: "Quotes", severity: q.requested < addDays(TODAY, -2) ? "high" : "medium",
      title: `${q.org_name.split(":")[0]} asks for ${q.qty} × ${nameOf(q.sku)}`,
      detail: `List $${q.total_usd.toLocaleString("en-US")}; earliest honest date ${q.delivery.date} (${q.delivery.binding}).`,
      org: q.org,
      actions: [{ label: `Price and commit ${q.delivery.date}`, action: "market.quote.price", args: { id: q.id, date: q.delivery.date }, primary: true }],
    }));
  }

  return { view, preview, act, queueItems, quotes };
}
