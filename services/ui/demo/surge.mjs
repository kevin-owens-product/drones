// Surge planner: "can we build N of a SKU by date D, and what does it cost to
// beat the date?" (docs/design/round-two.md, build 4).
//
// Why: Drone Dominance Phase III asks for production in the thousands within
// weeks, and every quote a unit requests needs a date Neros can defend. The
// answer joins released stock (after open orders take their share), open
// purchase orders, part lead times and the line rate, and names the binding
// part. Expediting and a second shift are the two levers; each has a cost.
//
// Everything here is SIM: stock, lead times, line rates, the expedite premium
// and the second-shift factor are demo assumptions. Pure JavaScript.

import { LINE_RATE, TODAY } from "./company.mjs";
import { BOMS, PARTS, nameOf } from "./supply.mjs";
import { addDays } from "./serials.mjs";

export const ASSUME = {
  expedite_days_min: 5, // fastest a supplier ships with premium freight
  expedite_share: 0.4, // expedited lead time as a share of the normal one
  expedite_premium: 0.12, // premium freight, share of part cost (same as supply.mjs)
  second_shift: 1.6, // line output with a second shift, as a multiple
  second_shift_usd_per_day: 9_500, // overtime and staffing, per working day
  pack_ship_days: 3, // EOL bench, pack and transit after the last unit is built
};

const partOf = (pn) => PARTS.find((p) => p.pn === pn);
const calDays = (working) => Math.ceil((working * 7) / 5);
const later = (a, b) => (a > b ? a : b);

/** @param {{ company: ReturnType<import("./company.mjs").createCompany>, holds: () => object[] }} deps */
export function createSurge({ company, holds }) {
  let shift = false;
  const raised = [];

  // Released stock after open orders take theirs, and the days each line is already booked.
  function committed() {
    const stock = { ...company.supply.usable(holds()) };
    const backlog = {};
    const open = company.orders.filter((o) => o.qty > o.delivered + o.shipped && !(o.export && o.export.status !== "approved"));
    for (const o of open) {
      const left = o.qty - o.delivered - o.shipped;
      backlog[o.sku] = (backlog[o.sku] ?? 0) + left;
      for (const [pn, per] of BOMS[o.sku] ?? []) stock[pn] = Math.max(0, (stock[pn] ?? 0) - per * left);
    }
    return { stock, backlog };
  }

  /**
   * Earliest honest ship date for qty of sku.
   * @param {string} sku @param {number} qty @param {{ expedite?: boolean, second_shift?: boolean }} [opt]
   */
  function earliest(sku, qty, opt = {}) {
    if (!BOMS[sku]) return { error: `${nameOf(sku)} is not built on this line`, status: 400 };
    const n = Math.round(Number(qty));
    if (!Number.isFinite(n) || n < 1 || n > 100_000) return { error: "quantity must be 1 to 100,000", status: 400 };
    const expedite = Boolean(opt.expedite);
    const twoShifts = opt.second_shift ?? shift;
    const { stock, backlog } = committed();
    const pos = company.supply.pos.filter((p) => !p.received);
    let expediteUsd = 0;
    const parts = BOMS[sku].map(([pn, per]) => {
      const part = partOf(pn);
      const need = per * n;
      const have = stock[pn] ?? 0;
      let short = Math.max(0, need - have);
      let ready = TODAY;
      const covered = [];
      for (const po of pos.filter((p) => p.pn === pn).sort((a, b) => a.due.localeCompare(b.due))) {
        if (short <= 0) break;
        const take = Math.min(short, po.qty);
        short -= take;
        covered.push({ po: po.po, qty: take, due: po.due });
        ready = later(ready, expedite && !po.expedited ? addDays(TODAY, ASSUME.expedite_days_min) : po.due);
        if (expedite && !po.expedited) expediteUsd += Math.round(part.usd * take * ASSUME.expedite_premium);
      }
      let order = 0;
      if (short > 0) {
        order = short;
        const lead = expedite ? Math.max(ASSUME.expedite_days_min, Math.ceil(part.lead_days * ASSUME.expedite_share)) : part.lead_days;
        ready = later(ready, addDays(TODAY, lead));
        if (expedite) expediteUsd += Math.round(part.usd * short * ASSUME.expedite_premium);
      }
      return { pn, name: part.name, need, on_hand: have, from_po: covered, to_order: order, ready, lead_days: part.lead_days, supplier: part.supplier };
    });
    const binding = parts.reduce((a, b) => (b.ready > a.ready ? b : a));
    const material = binding.ready;
    const rate = (LINE_RATE[sku] ?? 1) * (twoShifts ? ASSUME.second_shift : 1);
    const queueDays = calDays((backlog[sku] ?? 0) / rate);
    const lineFree = addDays(TODAY, queueDays);
    const buildWorking = Math.ceil(n / rate);
    const start = later(material, lineFree);
    const date = addDays(start, calDays(buildWorking) + ASSUME.pack_ship_days);
    const shiftUsd = twoShifts ? Math.round(ASSUME.second_shift_usd_per_day * Math.ceil(((backlog[sku] ?? 0) + n) / rate)) : 0;
    const bindingWhy = material > lineFree
      ? `${binding.name}: ${binding.to_order ? `${binding.to_order.toLocaleString("en-US")} more to order, ${expedite ? "expedited" : `${binding.lead_days}-day lead time`}` : "waiting on open purchase orders"}`
      : `Line: booked with ${(backlog[sku] ?? 0).toLocaleString("en-US")} ${nameOf(sku)} for open orders until ${lineFree}`;
    return {
      sku, name: nameOf(sku), qty: n, date, expedite, second_shift: twoShifts,
      material_ready: material, line_free: lineFree, line_rate_per_day: Number(rate.toFixed(1)), build_days: calDays(buildWorking),
      binding: { what: material > lineFree ? binding.pn : "line", why: bindingWhy },
      parts, cost: { expedite_usd: expediteUsd, second_shift_usd: shiftUsd, total_usd: expediteUsd + shiftUsd },
    };
  }

  /** Three ways to meet an ask, cheapest first, and whether each makes the date. */
  function options(sku, qty, by = null) {
    const base = earliest(sku, qty, { expedite: false, second_shift: false });
    if (base.error) return base;
    const rows = [
      { label: "As planned", ...base },
      { label: "Expedite parts", ...earliest(sku, qty, { expedite: true, second_shift: false }) },
      { label: "Expedite and add a second shift", ...earliest(sku, qty, { expedite: true, second_shift: true }) },
    ].map((r) => ({ ...r, meets: by ? r.date <= by : null }));
    const pick = by ? rows.find((r) => r.meets) ?? null : rows[0];
    return { sku, name: nameOf(sku), qty: base.qty, by, options: rows, recommended: pick ? pick.label : null, verdict: by ? (pick ? `${pick.label} ships by ${pick.date}, ${pick.cost.total_usd ? `about $${pick.cost.total_usd.toLocaleString("en-US")} extra` : "at no extra cost"}.` : `No option makes ${by}. The earliest is ${rows[2].date}.`) : null };
  }

  /** Expedite: raise POs for what the ask is short, expedited, through the factory's supply record. */
  function expedite(a) {
    const r = earliest(String(a.sku ?? ""), Number(a.qty), { expedite: true });
    if (r.error) return r;
    const out = [];
    for (const p of r.parts.filter((x) => x.to_order > 0)) {
      const po = company.supply.raisePo(p.pn, p.to_order, TODAY);
      if (po.error) return po;
      company.supply.expeditePo(po.po.po, TODAY);
      out.push(po.po.po);
      raised.push({ po: po.po.po, pn: p.pn, qty: p.to_order, for: `${r.qty} × ${r.name}`, at: TODAY });
    }
    for (const p of r.parts) for (const c of p.from_po) {
      const po = company.supply.pos.find((x) => x.po === c.po);
      if (po && !po.expedited) {
        company.supply.expeditePo(po.po, TODAY);
        out.push(po.po);
      }
    }
    if (!out.length) return { error: "Nothing to expedite: released stock and on-time orders already cover this ask.", status: 409 };
    return { ok: true, message: `Expedited for ${r.qty} × ${r.name}: ${out.join(", ")}. Material ready ${r.material_ready}.` };
  }

  function setShift(on) {
    shift = Boolean(on);
    return { ok: true, message: shift ? `Second shift on: line output × ${ASSUME.second_shift}, about $${ASSUME.second_shift_usd_per_day.toLocaleString("en-US")} per working day.` : "Second shift off." };
  }

  function view(sku = "ARCHER-5", qty = 400, by = addDays(TODAY, 56)) {
    const { backlog } = committed();
    return {
      source: "Simulated: stock, purchase orders, lead times, line rates, expedite premium and shift cost are demo assumptions.",
      today: TODAY,
      assumptions: ASSUME,
      second_shift: shift,
      lines: Object.keys(BOMS).map((s) => ({ sku: s, name: nameOf(s), rate: LINE_RATE[s], backlog: backlog[s] ?? 0, free: addDays(TODAY, calDays((backlog[s] ?? 0) / ((LINE_RATE[s] ?? 1) * (shift ? ASSUME.second_shift : 1)))) })),
      ask: options(sku, qty, by),
      raised: raised.slice().reverse(),
      presets: [
        { label: "Phase III production sprint: 400 in 8 weeks", sku: "ARCHER-5", qty: 400, by: addDays(TODAY, 56) },
        { label: "A brigade's 10-inch kit: 120 by Christmas", sku: "ARCHER-10", qty: 120, by: "2026-12-24" },
        { label: "Allied order: 300 of the 8-inch in 10 weeks", sku: "ARCHER-8", qty: 300, by: addDays(TODAY, 70) },
      ],
    };
  }

  return { earliest, options, expedite, setShift, view, get shift() { return shift; } };
}

