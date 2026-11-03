// The whole company on one thread: customer programmes and orders, production,
// supply chain, logistics, sustainment, training and engineering change, all
// keyed by SKU and serial so a person can follow one airframe from contract to
// loss and back to the reorder it causes.
//
// Products come from demo/supply.mjs (as Neros publishes them). Customers,
// orders, rates, capacity, shipments, courses booked and change orders are
// SIM: made up for the demo, with generic customer names so no real programme
// is implied. Strike SKUs never enter an order, a build plan or a shipment
// here (ADR-0016).
//
// Pure JavaScript, runs in Node and in the browser.

import { BOMS, CATALOG, UNITS, createSupply, nameOf, skuForTail } from "./supply.mjs";

export const TODAY = "2026-11-03";

// Customers and their orders (SIM). DPAS rating sets shipping priority; an
// export order cannot ship until its licence is approved.
export const CUSTOMERS = [
  { id: "CUS-A", name: "Customer A: Army brigade programme (SIM)", country: "US", units: ["Alpha", "Bravo", "Charlie", "Delta"] },
  { id: "CUS-B", name: "Customer B: Marine Corps evaluation (SIM)", country: "US", units: [] },
  { id: "CUS-C", name: "Customer C: allied partner (SIM)", country: "Allied", units: [] },
];

export const ORDERS = [
  { id: "ORD-A1", customer: "CUS-A", sku: "ARCHER-5", qty: 120, delivered: 70, due: "2026-12-04", dpas: "DO-A1", export: null },
  { id: "ORD-A2", customer: "CUS-A", sku: "ARCHER-10", qty: 40, delivered: 18, due: "2026-11-24", dpas: "DO-A1", export: null },
  { id: "ORD-A3", customer: "CUS-A", sku: "ARCHER-8", qty: 60, delivered: 34, due: "2026-12-02", dpas: "DO-A1", export: null },
  { id: "ORD-A4", customer: "CUS-A", sku: "CROSSBOW", qty: 24, delivered: 17, due: "2026-12-15", dpas: "DO-A1", export: null },
  { id: "ORD-B1", customer: "CUS-B", sku: "ARCHER-8", qty: 30, delivered: 0, due: "2026-11-30", dpas: "DO", export: null },
  { id: "ORD-B2", customer: "CUS-B", sku: "FLATBOW", qty: 6, delivered: 0, due: "2026-11-30", dpas: "DO", export: null },
  { id: "ORD-C1", customer: "CUS-C", sku: "ARCHER-8", qty: 60, delivered: 0, due: "2027-01-20", dpas: null, export: { licence: "DSP-5", status: "pending" } },
];

// Training bookings against MISSION Success courses (SIM).
export const COURSES = [
  { id: "CLS-311", sku: "TRN-ADO", customer: "CUS-A", unit: "Alpha", seats: 10, start: "2026-11-10", status: "booked" },
  { id: "CLS-312", sku: "TRN-ADI", customer: "CUS-A", unit: "Bravo", seats: 4, start: "2026-11-17", status: "booked" },
  { id: "CLS-305", sku: "TRN-ADO", customer: "CUS-A", unit: "Charlie", seats: 10, start: "2026-10-13", status: "complete" },
  { id: "CLS-320", sku: "TRN-ADO", customer: "CUS-B", unit: null, seats: 8, start: "2026-11-24", status: "booked" },
];

// Line rate per SKU, units per working day, at the factory (SIM).
export const LINE_RATE = { "ARCHER-5": 12, "ARCHER-8": 6, "ARCHER-10": 4, CROSSBOW: 2, FLATBOW: 1 };

// Work in progress by routing step (SIM). The EOL step is the bench in sim/bench.
export const ROUTING = ["Kit", "Assemble", "Flash firmware", "EOL bench", "Pack"];
const WIP = {
  "ARCHER-5": [14, 9, 6, 4, 3],
  "ARCHER-8": [8, 5, 3, 2, 2],
  "ARCHER-10": [4, 3, 2, 1, 1],
};

// Engineering change orders (SIM). `driver` names the platform evidence behind each.
export const ECOS = [
  { id: "ECO-212", title: "Qualify a second source for the 4-in-1 ESC", status: "in review", skus: ["ARCHER-5", "ARCHER-8", "ARCHER-10"], effectivity: "Serials built after approval", driver: "Attrition flagged ESC lot ESC-2611; supplier corrective action open", link: "attrition" },
  { id: "ECO-209", title: "Thermal sensor mount: add thread-locker and torque check at EOL", status: "approved", skus: ["ARCHER-5"], effectivity: "Kits shipped after 2026-11-01; field retrofit with spares", driver: "Field reports on the video theme", link: "reports" },
  { id: "ECO-205", title: "Lost-link default: return, then land at 15% battery", status: "released", skus: ["ARCHER-5", "ARCHER-8", "ARCHER-10"], effectivity: "Firmware for all serials at next update", driver: "Lost-link policy review and SITL trials", link: "eval" },
];

function addWorkdays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  let left = Math.max(0, Math.ceil(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ births?: object[] }} opts
 */
export function createCompany({ births = [] } = {}) {
  const supply = createSupply({ births });
  // Per-session copies: actions change these.
  const orders = ORDERS.map((o) => ({ ...o, shipped: 0, export: o.export ? { ...o.export } : null }));
  const ecos = ECOS.map((e) => ({ ...e }));
  const courses = COURSES.map((c) => ({ ...c }));
  let courseSeq = 330;

  /**
   * Sales and operations plan per SKU: open orders plus the Attrition
   * replacement demand, against finished goods, what released material can
   * build, and the line rate. Projects a ship date for each open order in DPAS
   * priority, then due date.
   */
  function plan(snap, holds) {
    const fg = { ...snap.finished };
    // Released material is shared across SKUs, so orders draw on it in priority order.
    const stock = supply.usable(holds);
    const backlogBySku = {};
    const rows = [];
    const open = orders.filter((o) => o.qty > o.delivered + o.shipped).sort((a, b) => Number(Boolean(b.dpas)) - Number(Boolean(a.dpas)) || a.due.localeCompare(b.due));
    const dayCursor = {};
    for (const o of open) {
      const left = o.qty - o.delivered - o.shipped;
      backlogBySku[o.sku] = (backlogBySku[o.sku] ?? 0) + left;
      const exportHold = o.export && o.export.status !== "approved";
      const fromStock = exportHold ? 0 : Math.min(fg[o.sku] ?? 0, left);
      fg[o.sku] = (fg[o.sku] ?? 0) - fromStock;
      const build = left - fromStock;
      const rate = LINE_RATE[o.sku] ?? 1;
      let blocked = null;
      if (BOMS[o.sku] && build > 0 && !exportHold) {
        let can = Infinity;
        let limit = "";
        for (const [pn, per] of BOMS[o.sku]) {
          const n = Math.floor((stock[pn] ?? 0) / per);
          if (n < can) [can, limit] = [n, pn];
        }
        const now = Math.min(build, can);
        for (const [pn, per] of BOMS[o.sku]) stock[pn] = (stock[pn] ?? 0) - per * now;
        if (build > can) {
          const po = snap.open_po.find((p) => p.pn === limit);
          blocked = { part: limit, short: build - can, po: po?.po ?? null, due: po?.due ?? null, late_days: po?.late_days ?? 0 };
        }
      }
      if (!exportHold) dayCursor[o.sku] = (dayCursor[o.sku] ?? 0) + build / rate;
      let ships = addWorkdays(TODAY, (dayCursor[o.sku] ?? 0) + 2);
      if (blocked) {
        const arrive = blocked.due ? addWorkdays(blocked.due, blocked.late_days + 3) : addWorkdays(TODAY, 30);
        if (arrive > ships) ships = arrive;
      }
      rows.push({
        ...o,
        name: nameOf(o.sku),
        customer_name: CUSTOMERS.find((c) => c.id === o.customer)?.name ?? o.customer,
        left,
        from_stock: fromStock,
        to_build: build,
        projected: exportHold ? null : ships,
        at_risk: Boolean(exportHold) || ships > o.due,
        why: exportHold
          ? `Export licence (${o.export.licence}) ${o.export.status}`
          : blocked
            ? `${blocked.short} short of ${blocked.part}${blocked.po ? ` until ${blocked.po}${blocked.late_days ? ` (${blocked.late_days} days late)` : ""}` : ", no PO open"}`
            : ships > o.due
              ? "Line rate cannot make the date"
              : "",
      });
    }
    const attrition = {};
    for (const r of snap.replenishment) attrition[r.sku] = (attrition[r.sku] ?? 0) + r.short;
    const skus = Object.keys(LINE_RATE);
    const sop = skus.map((sku) => ({
      sku,
      name: nameOf(sku),
      backlog: backlogBySku[sku] ?? 0,
      attrition: attrition[sku] ?? 0,
      finished: snap.finished[sku] ?? 0,
      buildable: snap.build.find((b) => b.sku === sku)?.qty ?? null,
      limit: snap.build.find((b) => b.sku === sku)?.limit ?? null,
      rate: LINE_RATE[sku],
      days_to_clear: Math.round((Math.max(0, (backlogBySku[sku] ?? 0) + (attrition[sku] ?? 0) - (snap.finished[sku] ?? 0)) / LINE_RATE[sku]) * 10) / 10,
      wip: WIP[sku] ? ROUTING.map((step, i) => ({ step, qty: WIP[sku][i] })) : null,
    }));
    return { orders: rows, sop, stock_left: stock };
  }

  function training(snap) {
    return snap.units.map((u) => {
      const booked = courses.filter((c) => c.unit === u.unit && c.status === "booked");
      const gaps = [];
      if (u.instructors === 0) gaps.push("No AD-I instructor to sustain training");
      if (u.operators < u.airframes / 2) gaps.push(`${u.operators} operators for ${u.airframes} airframes`);
      return { unit: u.unit, name: u.name, operators: u.operators, instructors: u.instructors, airframes: u.airframes, booked, gaps };
    });
  }

  function reservedBy(orders) {
    const out = {};
    for (const o of orders) out[o.sku] = (out[o.sku] ?? 0) + o.from_stock;
    return out;
  }

  function ship(planId, demand, holds, by) {
    const p = plan(supply.snapshot({ holds, demand }), holds);
    return supply.ship(planId, demand, holds, by, reservedBy(p.orders), p.stock_left);
  }

  /** One serial, contract to field: the digital thread. */
  function thread(tail, snap, platforms = []) {
    const birth = births.find((b) => b.tail_number === tail);
    if (!birth) return null;
    const sku = skuForTail(tail);
    const order = orders.find((o) => o.customer === "CUS-A" && o.sku === sku);
    const unit = UNITS.find((u) => u.sku === sku)?.unit ?? "Alpha";
    const parts = birth.parts.map((p) => {
      const lot = snap.lots.find((l) => l.lot === p.lot);
      const sup = lot ? snap.suppliers.find((s) => s.id === lot.supplier) : null;
      return { ...p, supplier: sup?.name ?? null, lot_status: lot?.status ?? "unknown", scar: sup?.scar ?? null };
    });
    const wos = snap.work_orders.filter((w) => w.tail === tail);
    const platform = platforms.find((p) => p.tail_number === tail);
    return {
      tail,
      serial: birth.serial,
      sku,
      name: nameOf(sku),
      steps: [
        { stage: "Order", text: order ? `${order.id}: ${order.qty} ${nameOf(sku)} for Customer A (SIM), due ${order.due}` : "No order on file" },
        { stage: "Build", text: `Built from ${parts.length} tracked lots`, parts },
        { stage: "EOL bench", text: birth.eol.passed ? `Passed ${birth.eol.kind} test` : `Failed ${birth.eol.kind} test: ${birth.eol.note}`, ok: birth.eol.passed },
        { stage: "Ship", text: `Kitted to ${unit}` },
        { stage: "Fly", text: platform ? `${platform.airworthiness}${platform.airworthiness_reason ? `: ${platform.airworthiness_reason}` : ""}` : "In service", ok: platform ? platform.airworthiness === "airworthy" : true },
        { stage: "Sustain", text: wos.length ? wos.map((w) => `${w.id} ${w.status}: ${w.summary}`).join("; ") : "No open work orders", ok: !wos.some((w) => w.status === "open") },
      ],
    };
  }

  function overview({ holds = [], demand = null, platforms = [] } = {}) {
    const first = supply.snapshot({ holds, demand });
    const p = plan(first, holds);
    // Kit plans for attrition replacements see only finished goods not already promised to an order.
    const snap = { ...first, replenishment: demand ? supply.replenishment(demand, holds, reservedBy(p.orders), p.stock_left) : [] };
    delete p.stock_left;
    const backlog = p.orders.reduce((s, o) => s + (CATALOG.find((c) => c.sku === o.sku)?.family === "airframe" ? o.left : 0), 0);
    const atRisk = p.orders.filter((o) => o.at_risk);
    const openWo = snap.work_orders.filter((w) => w.status === "open");
    const train = training(snap);
    const kpis = [
      { id: "backlog", label: "Airframes on order, not yet delivered", value: backlog },
      { id: "at_risk", label: "Order lines at risk of a late ship", value: atRisk.length, warn: atRisk.length > 0 },
      { id: "fpy", label: "End-of-line first-pass yield (named tails)", value: snap.eol.total ? `${Math.round((snap.eol.passed / snap.eol.total) * 100)}%` : "—" },
      { id: "material", label: "Material exceptions", value: snap.exceptions.length, warn: snap.exceptions.some((e) => e.severity === "high") },
      { id: "attrition", label: "Airframes the units are short (Attrition)", value: snap.replenishment.reduce((s, r) => s + r.short, 0) },
      { id: "work_orders", label: "Open maintenance work orders", value: openWo.length },
      { id: "training", label: "Units with a training gap", value: train.filter((t) => t.gaps.length).length, warn: train.some((t) => t.gaps.length) },
    ];
    return {
      source: "Products as Neros publishes them. Customers, orders, rates, stock, suppliers and units are simulated demo data.",
      today: TODAY,
      kpis,
      customers: CUSTOMERS,
      ...p,
      ...snap,
      ecos,
      courses: courses.map((c) => ({ ...c, name: nameOf(c.sku) })),
      training: train,
      routing: ROUTING,
      units_catalog: UNITS,
    };
  }

  // ---- Actions ----

  /** Ship finished goods against an order line. Serials are assigned at pack. */
  function shipOrder(id, qty, by) {
    const o = orders.find((x) => x.id === id);
    if (!o) return { error: "no such order", status: 404 };
    if (o.export && o.export.status !== "approved") return { error: `Export licence (${o.export.licence}) is ${o.export.status}`, status: 409 };
    const left = o.qty - o.delivered - o.shipped;
    const n = Math.min(left, Math.round(Number(qty)));
    if (!Number.isFinite(n) || n <= 0) return { error: "nothing left to ship on this line", status: 409 };
    if (!supply.pick(o.sku, n)) return { error: `Only ${supply.finished[o.sku] ?? 0} ${nameOf(o.sku)} in finished goods; build first`, status: 409 };
    o.shipped += n;
    const unit = CUSTOMERS.find((c) => c.id === o.customer)?.units.find((u) => UNITS.find((x) => x.unit === u)?.sku === o.sku) ?? null;
    const dg = Boolean(BOMS[o.sku]);
    const s = supply.addShipment({ customer: o.customer, order: o.id, unit, sku: o.sku, qty: n, spares: [], dg, by, serials: serials(o.sku, n) });
    return { ok: true, shipment: s, message: `${s.id}: ${n} ${nameOf(o.sku)} to ${CUSTOMERS.find((c) => c.id === o.customer)?.name.split(":")[0]}${dg ? ", lithium packs as dangerous goods" : ""}` };
  }

  let serialSeq = 4100;
  function serials(sku, n) {
    if (!BOMS[sku]) return [];
    const code = sku.replace("ARCHER-", "A");
    return Array.from({ length: n }, () => `${code}-${(serialSeq += 1)}`);
  }

  /** The customer signs for a shipment: an order line's quantity moves from shipped to delivered. */
  function deliver(shipment) {
    const o = orders.find((x) => x.id === shipment.order);
    if (o) {
      o.shipped = Math.max(0, o.shipped - shipment.qty);
      o.delivered += shipment.qty;
    }
  }

  /** Records a licence decision that arrived from the government; it does not grant anything itself. */
  function recordLicence(id) {
    const o = orders.find((x) => x.id === id);
    if (!o?.export) return { error: "no export licence on this order", status: 404 };
    if (o.export.status === "approved") return { error: "already recorded", status: 409 };
    o.export.status = "approved";
    return { ok: true, message: `${o.export.licence} approval recorded for ${o.id}; the line can ship` };
  }

  function approveEco(id) {
    const e = ecos.find((x) => x.id === id);
    if (!e) return { error: "no such change", status: 404 };
    if (e.status !== "in review") return { error: `change is ${e.status}`, status: 409 };
    e.status = "approved";
    return { ok: true, message: `${e.id} approved: ${e.title}. Effective: ${e.effectivity}` };
  }

  function bookCourse(customer, unit, sku, seats, start) {
    const c = { id: `CLS-${(courseSeq += 1)}`, sku, customer, unit, seats, start, status: "booked" };
    courses.push(c);
    return c;
  }

  return {
    overview,
    thread,
    ship,
    orders,
    ecos,
    courses,
    supply,
    shipOrder,
    deliver,
    recordLicence,
    approveEco,
    bookCourse,
    plan: (holds, demand) => {
      const snap = supply.snapshot({ holds, demand });
      const p = plan(snap, holds);
      delete p.stock_left;
      return { snap, ...p };
    },
    closeWorkOrder: supply.closeWorkOrder,
    openWorkOrders: supply.openWorkOrders,
  };
}
