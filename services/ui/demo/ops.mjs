// Two workspaces on one platform.
//
// Neros runs its own operations here: a work queue built from the live state
// of orders, the line, suppliers, lots, purchase orders, work orders and
// customer requests, where every item carries the action that clears it.
//
// Customers run their own fleets here: a portal scoped to their organization
// that shows their units, forecast, orders and shipments, and lets them ask
// Neros for replacements, spares, training or a repair. Their requests land in
// the Neros queue; Neros shipments land in their fleet when they sign for them.
// Loss data reaches Neros only if the customer chooses to share it.
//
// Customers, requests and everything they cause are SIM. Strike SKUs never
// enter a request, a build or a shipment (ADR-0016). Pure JavaScript.

import { CATALOG, BOMS, UNITS, nameOf } from "./supply.mjs";
import { CUSTOMERS, TODAY } from "./company.mjs";

export const NEROS = { id: "neros", name: "Neros Technologies (operations)" };

/** Which actions belong to which side. Neros actions need org "neros"; customer actions need the request's org. */
export const NEROS_ACTIONS = [
  "request.approve", "request.decline", "request.fulfil", "request.propose",
  "order.ship", "license.record", "build.run",
  "po.raise", "po.expedite", "po.receive",
  "lot.accept", "lot.reject", "lot.disposition", "scar.close",
  "eco.approve", "wo.close",
];
export const CUSTOMER_ACTIONS = [
  "request.replacement", "request.spares", "request.training", "request.rma",
  "proposal.accept", "proposal.decline", "shipment.receive", "airframe.accept", "sharing.set",
];

// Neros roles are demo-only (the API's role enum is fixed): ops_lead runs the queue.
const NEROS_ROLES = ["admin", "ops_lead"];
// Customer staff who can ask for things or sign for them; operators can look.
const CUSTOMER_ROLES = ["admin", "mission_commander", "maintainer"];

const SEVERITY = { high: 0, medium: 1, low: 2 };

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday at least `lead` days out: when a booked class starts. */
function nextMonday(iso, lead = 7) {
  const d = new Date(`${addDays(iso, lead)}T12:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ company: ReturnType<import("./company.mjs").createCompany>, audit: { append: (e: object) => void }, platforms: object[] }} deps
 */
export function createOps({ company, audit, platforms }) {
  const supply = company.supply;
  // Requests between a customer and Neros. `origin` says who opened it: a
  // customer request, or a Neros proposal the customer accepts or declines.
  const requests = [
    { id: "REQ-201", org: "CUS-A", origin: "customer", kind: "spares", unit: "Bravo", sku: "ARCHER-5", items: [{ pn: "PROP-5", qty: 160 }, { pn: "ARM-5", qty: 20 }], qty: 0, note: "Props and arms after the range week", status: "submitted", by: "Demo Maintainer (SIM)", created: "2026-11-02" },
    { id: "REQ-202", org: "CUS-B", origin: "customer", kind: "training", unit: null, sku: "TRN-ADI", seats: 2, qty: 0, note: "Two instructors so the evaluation can train its own operators", status: "submitted", by: "Customer B (SIM)", created: "2026-11-01" },
  ];
  let reqSeq = 210;
  let rmaSeq = 700;
  // Consent to share loss and readiness data with Neros, per customer.
  const sharing = { "CUS-A": true, "CUS-B": false, "CUS-C": false };

  const orgName = (org) => (org === NEROS.id ? NEROS.name : CUSTOMERS.find((c) => c.id === org)?.name ?? org);
  const short = (org) => orgName(org).split(":")[0];
  const unitSku = (unit) => UNITS.find((u) => u.unit === unit)?.sku ?? null;
  const unitOrg = (unit) => CUSTOMERS.find((c) => c.units.includes(unit))?.id ?? null;
  const shipmentOrg = (s) => s.customer ?? unitOrg(s.unit);

  function describe(r) {
    if (r.kind === "replacement") return `${r.qty} ${nameOf(r.sku)} for ${r.unit}`;
    if (r.kind === "spares") return `Spares for ${r.unit}: ${r.items.map((i) => `${i.qty} ${i.pn}`).join(", ")}`;
    if (r.kind === "training") return `${r.seats} seats on ${nameOf(r.sku)}${r.unit ? ` for ${r.unit}` : ""}`;
    if (r.kind === "rma") return `Repair ${r.tail}: ${r.issue}`;
    return r.kind;
  }

  // ---------------- Neros: the work queue ----------------

  function queue(ctx) {
    const { holds, demand } = ctx;
    const p = company.plan(holds, demand);
    const snap = p.snap;
    const items = [];
    const add = (it) => items.push(it);

    // Customers: requests waiting on Neros, then approved ones to fulfil.
    for (const r of requests.filter((x) => x.status === "submitted" && x.origin === "customer")) {
      add({
        id: `q-${r.id}`, area: "Customers", severity: r.kind === "rma" ? "high" : "medium", org: r.org,
        title: `${short(r.org)} asks: ${describe(r)}`,
        detail: `${r.id} from ${r.by}, ${r.created}${r.note ? `. "${r.note}"` : ""}`,
        actions: [
          { label: r.kind === "training" ? "Book the class" : r.kind === "rma" ? "Authorise return" : "Approve", action: "request.approve", args: { id: r.id }, primary: true },
          { label: "Decline", action: "request.decline", args: { id: r.id } },
        ],
      });
    }
    for (const r of requests.filter((x) => x.status === "approved" || x.status === "authorized")) {
      const need = r.kind === "spares" ? null : r.qty;
      const fg = need ? supply.finished[r.sku] ?? 0 : null;
      const ready = r.kind === "spares" ? true : fg >= need;
      const buildable = snap.build.find((b) => b.sku === r.sku)?.qty ?? 0;
      add({
        id: `q-${r.id}`, area: "Logistics", severity: "high", org: r.org,
        title: `Ship ${r.id}: ${describe(r)}`,
        detail: r.kind === "spares"
          ? `Issued from released lots, oldest first; lithium packs travel as dangerous goods (UN3480)`
          : ready
            ? `${fg} ${nameOf(r.sku)} in finished goods`
            : `Only ${fg} in finished goods; ${buildable} more can be built from released parts`,
        actions: ready
          ? [{ label: "Pick, pack and ship", action: "request.fulfil", args: { id: r.id }, primary: true }]
          : buildable > 0
            ? [{ label: `Build ${Math.min(buildable, need - fg)}`, action: "build.run", args: { sku: r.sku, qty: Math.min(buildable, need - fg) }, primary: true }]
            : [],
      });
    }

    // Customers who share loss data: offer replacements before they run out.
    for (const row of snap.replenishment) {
      const org = unitOrg(row.unit);
      if (!org || !sharing[org]) continue;
      const open = requests.some((r) => r.unit === row.unit && r.kind === "replacement" && !["declined", "delivered"].includes(r.status));
      if (open || row.shipped) continue;
      const d = (demand?.rows ?? []).filter((x) => x.unit === row.unit);
      const dos = Math.min(...d.map((x) => x.days_of_supply));
      add({
        id: `q-propose-${row.unit}`, area: "Customers", severity: dos < 10 ? "high" : "medium", org,
        title: `${row.unit} (${short(org)}) runs out of ${row.name} in about ${Math.round(dos)} days`,
        detail: `Shared loss data: ${d.reduce((s, x) => s + x.losses, 0)} lost in the last ${demand?.window_days ?? 14} days, ${row.short} short over the next ${demand?.horizon_days ?? 14}. Propose a replacement kit; the customer decides.`,
        actions: [{ label: `Propose ${row.short} + spares`, action: "request.propose", args: { unit: row.unit, qty: row.short }, primary: true }],
      });
    }

    // Orders: lines that can ship from stock now, and export lines waiting on a license.
    for (const o of p.orders) {
      if (o.export && o.export.status !== "approved") {
        add({
          id: `q-lic-${o.id}`, area: "Logistics", severity: "medium", org: o.customer,
          title: `${o.id}: ${o.left} ${o.name} for ${short(o.customer)} wait on export license ${o.export.license}`,
          detail: "Record the government's decision when it arrives. The platform records it; it does not grant it.",
          actions: [{ label: "Record license approval", action: "license.record", args: { id: o.id } }],
        });
        continue;
      }
      if (o.from_stock > 0) {
        add({
          id: `q-ship-${o.id}`, area: "Logistics", severity: o.at_risk ? "high" : "medium", org: o.customer,
          title: `Ship ${o.from_stock} of ${o.left} ${o.name} on ${o.id} (${short(o.customer)})`,
          detail: `Due ${o.due}${o.dpas ? `, DPAS ${o.dpas}` : ""}. Finished goods cover ${o.from_stock} now${o.to_build ? `; ${o.to_build} still to build` : ""}.`,
          actions: [{ label: `Ship ${o.from_stock}`, action: "order.ship", args: { id: o.id, qty: o.from_stock }, primary: true }],
        });
      }
    }

    // Production: build what the backlog needs from what released parts allow.
    for (const b of snap.build) {
      const need = p.orders.filter((o) => o.sku === b.sku).reduce((s, o) => s + o.to_build, 0);
      if (need <= 0) continue;
      const rate = p.sop.find((x) => x.sku === b.sku)?.rate ?? 1;
      const qty = Math.min(need, b.qty, rate * 5);
      add({
        id: `q-build-${b.sku}`, area: "Production", severity: b.qty < need ? "high" : "medium",
        title: qty > 0 ? `Build ${qty} ${b.name} (a week at ${rate}/day)` : `${b.name}: line is starved`,
        detail: `${need} still to build for open orders. Released parts cover ${b.qty}${b.qty < need ? `; ${b.limit} runs out first` : ""}.`,
        actions: qty > 0 ? [{ label: `Build ${qty}`, action: "build.run", args: { sku: b.sku, qty }, primary: true }] : [],
      });
    }

    // Supply: parts below reorder point, late POs, deliveries at the dock.
    for (const part of snap.parts) {
      if (part.reorder_point == null || part.on_hand >= part.reorder_point) continue;
      const po = snap.open_po.find((x) => x.pn === part.pn);
      if (po) continue;
      const qty = Math.ceil((part.reorder_point * 3) / 50) * 50;
      add({
        id: `q-rop-${part.pn}`, area: "Supply", severity: "high",
        title: `${part.name} below reorder point, no PO open`,
        detail: `${part.on_hand} released against a reorder point of ${part.reorder_point}; lead time ${part.lead_days} days.`,
        actions: [{ label: `Raise PO for ${qty}`, action: "po.raise", args: { pn: part.pn, qty }, primary: true }],
      });
    }
    for (const po of snap.open_po) {
      const part = snap.parts.find((x) => x.pn === po.pn);
      const late = po.late_days > 0;
      add({
        id: `q-po-${po.po}`, area: "Supply", severity: late ? "high" : "low",
        title: late ? `${po.po} is ${po.late_days} days late: ${po.qty} ${part?.name ?? po.pn}` : `${po.po} due ${po.due}: ${po.qty} ${part?.name ?? po.pn}${po.expedited ? " (expedited)" : ""}`,
        detail: late ? "The line needs it; expediting costs premium freight." : "Receive it at the dock when it arrives; it goes to incoming inspection.",
        actions: [
          ...(late && !po.expedited ? [{ label: "Expedite", action: "po.expedite", args: { id: po.po }, primary: true }] : []),
          { label: "Receive at dock", action: "po.receive", args: { id: po.po } },
        ],
      });
    }

    // Quality: incoming inspection, held lots to disposition, supplier corrective actions.
    for (const l of snap.lots) {
      if (l.status === "pending inspection") {
        add({
          id: `q-insp-${l.lot}`, area: "Quality", severity: "medium",
          title: `Incoming inspection: lot ${l.lot}, ${l.qty} ${l.name}`,
          detail: `Received ${l.received} on ${l.po}. Nothing from it can be built until it is accepted.`,
          actions: [
            { label: "Accept", action: "lot.accept", args: { id: l.lot }, primary: true },
            { label: "Reject", action: "lot.reject", args: { id: l.lot } },
          ],
        });
      }
      if (l.status === "quarantined") {
        add({
          id: `q-hold-${l.lot}`, area: "Quality", severity: "high",
          title: `Disposition held lot ${l.lot}: ${l.on_hand} ${l.name} on the shelf`,
          detail: `Held from the Attrition autopsy; ${l.where_used.length} fielded tails carry it and keep their own work orders.`,
          actions: [
            { label: "Return to supplier", action: "lot.disposition", args: { id: l.lot, disposition: "return" }, primary: true },
            { label: "Scrap", action: "lot.disposition", args: { id: l.lot, disposition: "scrap" } },
            { label: "Release", action: "lot.disposition", args: { id: l.lot, disposition: "release" } },
          ],
        });
      }
    }
    for (const s of snap.suppliers) {
      if (!s.scar || s.quarantined.length) continue;
      add({
        id: `q-scar-${s.id}`, area: "Quality", severity: "low",
        title: `${s.name}: ${s.scar}`,
        detail: "Every affected lot is dispositioned. Close it when the supplier's root cause and fix are on file.",
        actions: [{ label: "Close SCAR", action: "scar.close", args: { id: s.id } }],
      });
    }

    // Engineering changes waiting on review.
    for (const e of company.ecos.filter((x) => x.status === "in review")) {
      add({
        id: `q-eco-${e.id}`, area: "Engineering", severity: "low",
        title: `${e.id} in review: ${e.title}`,
        detail: `${e.driver}. Effectivity: ${e.effectivity}.`,
        actions: [{ label: "Approve change", action: "eco.approve", args: { id: e.id } }],
      });
    }

    // Sustainment: open work orders on fielded serials.
    for (const w of snap.work_orders.filter((x) => x.status === "open")) {
      add({
        id: `q-wo-${w.id}`, area: "Sustainment", severity: w.kind === "quality hold" ? "high" : "medium",
        title: `${w.id} ${w.tail}: ${w.summary}`,
        detail: w.parts.length ? `Parts: ${w.parts.map((x) => `${x.qty} ${x.name}`).join(", ")}` : "No parts",
        actions: [{ label: "Close work order", action: "wo.close", args: { id: w.id } }],
      });
    }

    items.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
    const areas = [...new Set(items.map((i) => i.area))].map((area) => ({ area, count: items.filter((i) => i.area === area).length }));
    return {
      source: "Simulated: customers, orders, stock, lots, POs and requests are demo data. Products as Neros publishes them.",
      today: TODAY,
      items,
      areas,
      customers: CUSTOMERS.map((c) => ({ id: c.id, name: c.name, sharing: sharing[c.id], open_requests: requests.filter((r) => r.org === c.id && !["declined", "delivered"].includes(r.status)).length })),
    };
  }

  // ---------------- Customers: the portal ----------------

  function portal(org, ctx) {
    const cust = CUSTOMERS.find((c) => c.id === org);
    if (!cust) return null;
    const p = company.plan(ctx.holds, ctx.demand);
    const snap = p.snap;
    const train = company.overview(ctx).training;
    const units = snap.units.filter((u) => cust.units.includes(u.unit)).map((u) => {
      const d = u.demand ?? [];
      const shortBy = d.reduce((s, x) => s + x.short, 0);
      const t = train.find((x) => x.unit === u.unit);
      const spares = supply.spareParts(u.sku, Math.max(5, shortBy));
      // Airframes already asked for (or proposed) count against the shortfall, so the row never asks twice.
      const open = openReplacement(org, u.unit);
      return {
        open_request: open ? { id: open.id, qty: open.qty, status: open.status } : null,
        unit: u.unit, sku: u.sku, name: u.name, airframes: u.airframes, gcs: u.gcs, operators: u.operators, instructors: u.instructors,
        losses: d.reduce((s, x) => s + x.losses, 0),
        days_of_supply: d.length ? Math.round(Math.min(...d.map((x) => x.days_of_supply))) : null,
        short: Math.max(0, shortBy - (open?.qty ?? 0)),
        spares_on_hand: Object.entries(u).filter(([k]) => /^[A-Z]+-/.test(k)).map(([pn, qty]) => ({ pn, qty })),
        suggested_spares: spares.map((s) => ({ pn: s.pn, name: s.name, qty: s.qty })),
        training_gaps: t?.gaps ?? [],
        suggested_course: t?.instructors === 0 ? "TRN-ADI" : "TRN-ADO",
      };
    });
    const orders = p.orders.filter((o) => o.customer === org).map((o) => ({
      id: o.id, sku: o.sku, name: o.name, qty: o.qty, delivered: o.delivered, shipped: o.shipped, left: o.left, due: o.due, projected: o.projected, at_risk: o.at_risk,
      // Customers see why a date moved, not Neros's supplier names or stock.
      why: o.export && o.export.status !== "approved" ? `Export license (${o.export.license}) pending with the government` : o.why.includes("short of") ? "Waiting on a component; the date includes the supplier's" : o.why ? "Factory capacity" : "",
    }));
    // Orders fully delivered stay visible as history.
    for (const o of company.orders.filter((x) => x.customer === org && x.qty <= x.delivered + x.shipped)) {
      if (!orders.some((r) => r.id === o.id)) orders.push({ id: o.id, sku: o.sku, name: nameOf(o.sku), qty: o.qty, delivered: o.delivered, shipped: o.shipped, left: 0, due: o.due, projected: null, at_risk: false, why: o.shipped ? "Shipped" : "Delivered" });
    }
    const shipments = supply.shipments.filter((s) => shipmentOrg(s) === org).slice().reverse().map((s) => ({ ...s, name: nameOf(s.sku) }));
    const mine = requests.filter((r) => r.org === org).slice().reverse().map((r) => ({ ...r, title: describe(r) }));
    const fleet = platforms.filter((x) => x.owner === org && x.received_on);
    return {
      source: "Simulated customer workspace: your units, orders and requests are demo data.",
      today: TODAY,
      org: { id: cust.id, name: cust.name, country: cust.country, sharing: sharing[org] },
      units,
      orders,
      shipments,
      requests: mine,
      courses: company.courses.filter((c) => c.customer === org).map((c) => ({ ...c, name: nameOf(c.sku) })),
      received: fleet.map((x) => ({ tail: x.tail_number, sku: x.sku, name: x.designation, status: x.airworthiness, reason: x.airworthiness_reason, shipment: x.shipment })),
      catalog: CATALOG.filter((c) => !c.restricted && ["training"].includes(c.family)).map((c) => ({ sku: c.sku, name: c.name })),
      tails: platforms.filter((x) => (x.owner ?? "CUS-A") === org && !String(x.tail_number).startsWith("SX-")).map((x) => x.tail_number),
    };
  }

  // ---------------- Actions ----------------

  function openReplacement(org, unit) {
    return requests.find((r) => r.org === org && r.unit === unit && r.kind === "replacement" && !["declined", "delivered"].includes(r.status)) ?? null;
  }

  function newRequest(fields) {
    const r = { id: `REQ-${(reqSeq += 1)}`, created: TODAY, status: "submitted", origin: "customer", qty: 0, ...fields };
    requests.push(r);
    return r;
  }

  /** Replacement kit: airframes plus the spares that go with them. */
  function replacement(unit, qty) {
    const sku = unitSku(unit);
    return { kind: "replacement", unit, sku, qty, items: supply.spareParts(sku, qty).map((s) => ({ pn: s.pn, qty: s.qty })) };
  }

  /** Neros-side actions. */
  function nerosAct(action, a, ctx, actor) {
    const { holds } = ctx;
    const req = a.id ? requests.find((r) => r.id === a.id) : null;
    switch (action) {
      case "request.approve": {
        if (!req || req.status !== "submitted") return { error: "request is not waiting on Neros", status: 409 };
        req.decided_by = actor;
        if (req.kind === "training") {
          const c = company.bookCourse(req.org, req.unit, req.sku, req.seats, nextMonday(TODAY));
          req.status = "booked";
          req.course = c.id;
          return { ok: true, message: `${c.id} booked: ${req.seats} seats on ${nameOf(req.sku)} from ${c.start}` };
        }
        if (req.kind === "rma") {
          req.status = "authorized";
          req.rma = `RMA-${(rmaSeq += 1)}`;
          return { ok: true, message: `${req.rma} authorized for ${req.tail}; an advance replacement ships from stock` };
        }
        req.status = "approved";
        return { ok: true, message: `${req.id} approved; it is in the shipping queue` };
      }
      case "request.decline": {
        if (!req || req.status !== "submitted") return { error: "request is not waiting on Neros", status: 409 };
        req.status = "declined";
        req.decided_by = actor;
        req.reason = String(a.reason ?? "Declined by Neros operations").slice(0, 200);
        return { ok: true, message: `${req.id} declined` };
      }
      case "request.propose": {
        const unit = String(a.unit ?? "");
        const org = unitOrg(unit);
        if (!org) return { error: "no such unit", status: 404 };
        if (!sharing[org]) return { error: "This customer does not share loss data with Neros", status: 403 };
        const qty = Math.round(Number(a.qty));
        if (!Number.isFinite(qty) || qty <= 0) return { error: "quantity must be at least 1", status: 400 };
        const r = newRequest({ org, origin: "neros", status: "proposed", by: actor, note: "Proposed from your shared loss forecast", ...replacement(unit, qty) });
        return { ok: true, message: `${r.id} proposed to ${short(org)}: ${describe(r)}. They decide in their portal.` };
      }
      case "request.fulfil": {
        if (!req || !["approved", "authorized"].includes(req.status)) return { error: "request is not approved", status: 409 };
        const n = req.kind === "rma" ? 1 : req.qty;
        if (n > 0 && !supply.pick(req.sku, n)) return { error: `Only ${supply.finished[req.sku] ?? 0} ${nameOf(req.sku)} in finished goods; build first`, status: 409 };
        let issued = [];
        if (req.items?.length) {
          const out = supply.issueParts(req.items, holds);
          if (out.error) {
            if (n > 0) supply.finished[req.sku] += n;
            return out;
          }
          issued = out.issued;
        }
        const unit = req.unit ?? (req.tail ? UNITS.find((u) => u.sku === req.sku)?.unit : null);
        const s = supply.addShipment({
          customer: req.org, request: req.id, plan: req.kind === "replacement" ? `KIT-${unit}` : undefined, unit, sku: req.sku, qty: n,
          spares: (req.items ?? []).map((i) => ({ ...i, dg: i.pn.startsWith("BAT") })), issued,
          dg: n > 0 || (req.items ?? []).some((i) => i.pn.startsWith("BAT")), by: actor, serials: serialsFor(req.sku, n),
        });
        req.status = "shipped";
        req.shipment = s.id;
        return { ok: true, message: `${s.id} shipped to ${unit ?? short(req.org)}: ${describe(req)}${s.dg ? "; lithium packs as dangerous goods" : ""}` };
      }
      case "order.ship": {
        const out = company.shipOrder(String(a.id), a.qty, actor);
        return out;
      }
      case "license.record":
        return company.recordLicense(String(a.id));
      case "build.run": {
        if (!BOMS[a.sku]) return { error: "this SKU has no build plan here", status: 400 };
        return supply.build(String(a.sku), a.qty, holds);
      }
      case "po.raise":
        return supply.raisePo(String(a.pn), a.qty, TODAY);
      case "po.expedite":
        return supply.expeditePo(String(a.id), TODAY);
      case "po.receive":
        return supply.receivePo(String(a.id), TODAY);
      case "lot.accept":
        return supply.inspectLot(String(a.id), true);
      case "lot.reject":
        return supply.inspectLot(String(a.id), false);
      case "lot.disposition":
        return supply.dispositionLot(String(a.id), String(a.disposition), holds);
      case "scar.close":
        return supply.closeScar(String(a.id), holds);
      case "eco.approve":
        return company.approveEco(String(a.id));
      case "wo.close": {
        const out = company.closeWorkOrder(String(a.id), holds, actor);
        if (out.error) return out;
        const wo = out.work_order;
        const platform = platforms.find((x) => x.tail_number === wo.tail);
        if (wo.returns_to_service && platform && platform.airworthiness !== "grounded") {
          platform.airworthiness = "airworthy";
          platform.airworthiness_reason = null;
        }
        return { ok: true, message: `${wo.id} closed: ${wo.issued.map((x) => `${x.qty} ${x.pn} from ${x.lot}`).join(", ") || "no parts"}${wo.returns_to_service ? `; ${wo.tail} back in service` : ""}` };
      }
      default:
        return { error: "unknown action", status: 400 };
    }
  }

  let serialSeq = 5100;
  function serialsFor(sku, n) {
    if (!BOMS[sku] || n <= 0) return [];
    return Array.from({ length: n }, () => `${sku.replace("ARCHER-", "A")}-${(serialSeq += 1)}`);
  }

  /** Customer-side actions, always inside the customer's own org. */
  function customerAct(org, action, a, actor) {
    const cust = CUSTOMERS.find((c) => c.id === org);
    if (!cust) return { error: "no such customer", status: 404 };
    const ownUnit = (u) => cust.units.includes(u);
    switch (action) {
      case "request.replacement": {
        const unit = String(a.unit ?? "");
        if (!ownUnit(unit)) return { error: "not one of your units", status: 403 };
        const qty = Math.round(Number(a.qty));
        if (!Number.isFinite(qty) || qty <= 0 || qty > 500) return { error: "quantity must be 1 to 500", status: 400 };
        const open = openReplacement(org, unit);
        if (open) return { error: `${open.id} for ${open.qty} airframes is already open for ${unit} (${open.status}). Wait for it, or ask Neros to change it.`, status: 409 };
        const r = newRequest({ org, by: actor, note: String(a.note ?? "").slice(0, 200), ...replacement(unit, qty) });
        return { ok: true, request: r, message: `${r.id} sent to Neros: ${describe(r)}` };
      }
      case "request.spares": {
        const unit = String(a.unit ?? "");
        if (!ownUnit(unit)) return { error: "not one of your units", status: 403 };
        const items = (Array.isArray(a.items) ? a.items : []).map((i) => ({ pn: String(i.pn), qty: Math.round(Number(i.qty)) })).filter((i) => i.qty > 0 && Number.isFinite(i.qty));
        const sku = unitSku(unit);
        const allowed = new Set(supply.spareParts(sku, 1).map((s) => s.pn));
        if (!items.length || items.some((i) => !allowed.has(i.pn))) return { error: "pick field spares for this unit's airframe", status: 400 };
        const r = newRequest({ org, by: actor, kind: "spares", unit, sku, items, note: String(a.note ?? "").slice(0, 200) });
        return { ok: true, request: r, message: `${r.id} sent to Neros: ${describe(r)}` };
      }
      case "request.training": {
        const sku = String(a.sku ?? "");
        if (!CATALOG.some((c) => c.sku === sku && c.family === "training")) return { error: "pick a course", status: 400 };
        const unit = a.unit ? String(a.unit) : null;
        if (unit && !ownUnit(unit)) return { error: "not one of your units", status: 403 };
        const seats = Math.round(Number(a.seats ?? 1));
        if (!Number.isFinite(seats) || seats < 1 || seats > 10) return { error: "1 to 10 seats per class", status: 400 };
        const r = newRequest({ org, by: actor, kind: "training", unit, sku, seats, note: String(a.note ?? "").slice(0, 200) });
        return { ok: true, request: r, message: `${r.id} sent to Neros: ${describe(r)}` };
      }
      case "request.rma": {
        const tail = String(a.tail ?? "");
        const p = platforms.find((x) => x.tail_number === tail && (x.owner ?? "CUS-A") === org);
        if (!p) return { error: "not one of your airframes", status: 403 };
        const issue = String(a.issue ?? "").trim().slice(0, 200);
        if (!issue) return { error: "say what is wrong", status: 400 };
        const r = newRequest({ org, by: actor, kind: "rma", tail, sku: p.sku, issue });
        return { ok: true, request: r, message: `${r.id} sent to Neros: ${describe(r)}` };
      }
      case "proposal.accept":
      case "proposal.decline": {
        const r = requests.find((x) => x.id === a.id && x.org === org);
        if (!r || r.status !== "proposed") return { error: "no open proposal", status: 409 };
        r.status = action === "proposal.accept" ? "approved" : "declined";
        r.decided_by = actor;
        return { ok: true, message: action === "proposal.accept" ? `${r.id} accepted; Neros ships ${describe(r)}` : `${r.id} declined` };
      }
      case "shipment.receive": {
        const s = supply.shipments.find((x) => x.id === a.id && shipmentOrg(x) === org);
        if (!s) return { error: "not one of your shipments", status: 404 };
        if (s.status === "delivered") return { error: "already received", status: 409 };
        s.status = "delivered";
        s.received_by = actor;
        if (s.order) company.deliver(s);
        if (s.unit) supply.receiveAtUnit(s.unit, s.qty ?? 0);
        const req = requests.find((r) => r.shipment === s.id);
        if (req) req.status = "delivered";
        // New serials join the customer's fleet, restricted until an acceptance flight.
        for (const serial of s.serials ?? []) {
          platforms.push({
            id: `p-${serial}`, tail_number: serial, sku: s.sku, designation: nameOf(s.sku), group_size: "Group 1", portion_mark: "(U)",
            airworthiness: "restricted", airworthiness_reason: `Received on ${s.id}; acceptance flight before first sortie`,
            classification: "UNCLASSIFIED", owner: org, received_on: TODAY, shipment: s.id, unit: s.unit,
          });
        }
        return { ok: true, message: `${s.id} signed for${s.unit ? ` at ${s.unit}` : ""}${s.serials?.length ? `; ${s.serials.length} airframes added to your fleet, restricted until their acceptance flight` : ""}` };
      }
      case "airframe.accept": {
        // One tail, or every restricted tail from one shipment once its acceptance flights pass.
        const mine = platforms.filter((x) => x.owner === org && x.received_on && x.airworthiness !== "airworthy" && (a.tail ? x.tail_number === a.tail : x.shipment === a.shipment));
        if (!mine.length) return { error: "nothing waiting for acceptance there", status: 404 };
        for (const p of mine) {
          p.airworthiness = "airworthy";
          p.airworthiness_reason = null;
        }
        return { ok: true, message: mine.length === 1 ? `${mine[0].tail_number} passed its acceptance flight and is in service` : `${mine.length} airframes from ${a.shipment} passed acceptance flights and are in service` };
      }
      case "sharing.set": {
        sharing[org] = Boolean(a.on);
        return { ok: true, message: sharing[org] ? "Neros can now see your loss and readiness data and propose resupply" : "Neros no longer sees your loss data; you can still ask for anything" };
      }
      default:
        return { error: "unknown action", status: 400 };
    }
  }

  /**
   * One entry point for every button. `viewer` is { org, roles, display_name },
   * or null when the caller is the local demo server (everything allowed).
   * Every attempt is written to the audit log, refusals included.
   */
  function act(viewer, action, args, ctx) {
    const a = args ?? {};
    const actor = viewer?.display_name ?? String(a.by ?? "operator");
    const neros = NEROS_ACTIONS.includes(action);
    const cust = CUSTOMER_ACTIONS.includes(action);
    if (!neros && !cust) return { status: 400, body: { detail: "unknown action" } };
    const org = cust ? String(viewer?.org === NEROS.id || !viewer ? a.org ?? "CUS-A" : viewer.org) : NEROS.id;
    const resource = String(a.id ?? a.pn ?? a.unit ?? a.sku ?? a.tail ?? a.shipment ?? org);
    const deny = (detail) => {
      audit.append({ actor, action: `ops.${action}`, resource_type: "ops", resource_id: resource, decision: "deny", reason_codes: ["role_denied"] });
      return { status: 403, body: { detail } };
    };
    if (viewer) {
      const roles = viewer.roles ?? [];
      if (neros && (viewer.org !== NEROS.id || !roles.some((r) => NEROS_ROLES.includes(r)))) return deny("Only Neros operations can do this.");
      if (cust && viewer.org !== NEROS.id && viewer.org !== org) return deny("That belongs to another organization.");
      if (cust && !roles.some((r) => CUSTOMER_ROLES.includes(r))) return deny("Requests and receipts need the mission commander or maintainer role; operators can view.");
    }
    const out = neros ? nerosAct(action, a, ctx, actor) : customerAct(org, action, a, actor);
    if (out.error) return { status: out.status ?? 400, body: { detail: out.error } };
    audit.append({ actor, action: `ops.${action}`, resource_type: neros ? "ops" : "customer", resource_id: resource, detail: `${neros ? "" : `${short(org)}: `}${out.message ?? ""}`.slice(0, 200) });
    return { status: 200, body: { ok: true, message: out.message } };
  }

  return { queue, portal, act, requests, sharing };
}
