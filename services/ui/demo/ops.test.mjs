import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const post = (demo, path, body, who) => demo.handle("POST", new URL(`http://x${path}`), JSON.stringify(body), who);
const act = (demo, action, args, who) => post(demo, "/v1/ops/act", { action, args }, who);
const queue = (demo) => get(demo, "/v1/ops/queue", OPS).body.items;
const portal = (demo, who = CMD, q = "") => get(demo, `/v1/ops/portal${q}`, who).body;

test("every queue item carries an action, and its first action works", () => {
  const demo = createDemo({ attrition });
  const items = queue(demo);
  assert.ok(items.length >= 10);
  const areas = new Set(items.map((i) => i.area));
  for (const a of ["Customers", "Logistics", "Production", "Supply", "Sustainment"]) assert.ok(areas.has(a), a);
  for (const i of items) assert.ok(i.actions.length > 0, i.title);
  const first = items[0].actions[0];
  const out = act(demo, first.action, first.args, OPS);
  assert.equal(out.status, 200, JSON.stringify(out.body));
});

test("customers cannot see the Neros queue or Company view, and cannot run Neros actions", () => {
  const demo = createDemo({ attrition });
  assert.equal(get(demo, "/v1/ops/queue", CMD).status, 403);
  assert.equal(get(demo, "/v1/company", CMD).status, 403);
  const out = act(demo, "po.raise", { pn: "FC-1", qty: 100 }, CMD);
  assert.equal(out.status, 403);
  const audit = get(demo, "/v1/audit", null).body.items;
  assert.ok(audit.some((e) => e.action === "ops.po.raise" && e.decision === "deny"));
});

test("a customer's portal shows only its own organization", () => {
  const demo = createDemo({ attrition });
  const mine = portal(demo, CMD, "?org=CUS-B");
  assert.equal(mine.org.id, "CUS-A");
  assert.ok(mine.orders.every((o) => o.id.startsWith("ORD-A")));
  assert.ok(mine.shipments.every((s) => ["Alpha", "Bravo", "Charlie", "Delta"].includes(s.unit)));
  // Customers see why a date moved, not Neros's supplier names.
  assert.ok(mine.orders.every((o) => !/Supplier|PO-/.test(o.why)));
  // Neros can open any customer's portal to see what they see.
  assert.equal(portal(demo, OPS, "?org=CUS-B").org.id, "CUS-B");
});

test("operators can view the portal but requests need a commander or maintainer", () => {
  const demo = createDemo({ attrition });
  assert.equal(get(demo, "/v1/ops/portal", OPERATOR).status, 200);
  const out = act(demo, "request.replacement", { unit: "Alpha", qty: 5 }, OPERATOR);
  assert.equal(out.status, 403);
});

test("request to delivery: customer asks, Neros approves and ships, the airframes join the customer's fleet", () => {
  const demo = createDemo({ attrition });
  const asked = act(demo, "request.replacement", { unit: "Bravo", qty: 4 }, CMD);
  assert.equal(asked.status, 200);
  const id = asked.body.message.match(/REQ-\d+/)[0];
  assert.equal(act(demo, "request.replacement", { unit: "Bravo", qty: 4 }, { ...CMD, org: "CUS-B" }).status, 403);
  const item = queue(demo).find((i) => i.id === `q-${id}`);
  assert.ok(item, "the request lands in the Neros queue");
  assert.equal(act(demo, "request.approve", { id }, OPS).status, 200);
  const before = portal(demo).units.find((u) => u.unit === "Bravo").airframes;
  const shipped = act(demo, "request.fulfil", { id }, OPS);
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
  const shp = shipped.body.message.match(/SHP-\d+/)[0];
  const p = portal(demo);
  assert.equal(p.requests.find((r) => r.id === id).status, "shipped");
  assert.equal(p.shipments.find((s) => s.id === shp).status, "in transit");
  assert.equal(act(demo, "shipment.receive", { id: shp }, CMD).status, 200);
  const after = portal(demo);
  assert.equal(after.units.find((u) => u.unit === "Bravo").airframes, before + 4);
  assert.equal(after.requests.find((r) => r.id === id).status, "delivered");
  assert.equal(after.received.length, 4);
  assert.ok(after.received.every((r) => r.status === "restricted"));
  const tail = after.received[0].tail;
  assert.ok(get(demo, "/v1/platforms", CMD).body.items.some((x) => x.tail_number === tail));
  assert.equal(act(demo, "airframe.accept", { tail }, CMD).status, 200);
  assert.equal(portal(demo).received.find((r) => r.tail === tail).status, "airworthy");
  assert.equal(act(demo, "airframe.accept", { shipment: shp }, CMD).status, 200);
  assert.ok(portal(demo).received.every((r) => r.status === "airworthy"));
});

test("Neros proposes resupply only while the customer shares loss data", () => {
  const demo = createDemo({ attrition });
  const offer = queue(demo).find((i) => i.id === "q-propose-Alpha");
  assert.ok(offer, "Alpha is short and shares data");
  assert.equal(act(demo, offer.actions[0].action, offer.actions[0].args, OPS).status, 200);
  const prop = portal(demo).requests.find((r) => r.status === "proposed");
  assert.ok(prop);
  assert.equal(act(demo, "proposal.accept", { id: prop.id }, CMD).status, 200);
  assert.ok(queue(demo).some((i) => i.id === `q-${prop.id}`), "accepted proposal is in the shipping queue");

  const other = createDemo({ attrition });
  assert.equal(act(other, "sharing.set", { on: false }, CMD).status, 200);
  assert.ok(!queue(other).some((i) => i.id.startsWith("q-propose-")));
  assert.equal(act(other, "request.propose", { unit: "Alpha", qty: 5 }, OPS).status, 403);
  assert.equal(get(other, "/v1/attrition", OPS).status, 403);
  assert.equal(get(other, "/v1/attrition", CMD).status, 200);
});

test("purchase order to stock: raise, receive, inspect, then the parts can be built", () => {
  const demo = createDemo({ attrition });
  const raised = act(demo, "po.raise", { pn: "FC-1", qty: 300 }, OPS);
  assert.equal(raised.status, 200);
  const po = raised.body.message.match(/PO-\d+/)[0];
  assert.equal(act(demo, "po.receive", { id: po }, OPS).status, 200);
  const inspect = queue(demo).find((i) => i.area === "Quality" && i.title.includes("Incoming inspection"));
  assert.ok(inspect);
  const lot = inspect.actions[0].args.id;
  const buildBefore = get(demo, "/v1/company", OPS).body.build.find((b) => b.sku === "ARCHER-5").qty;
  assert.equal(act(demo, "lot.accept", { id: lot }, OPS).status, 200);
  const buildAfter = get(demo, "/v1/company", OPS).body.build.find((b) => b.sku === "ARCHER-5").qty;
  assert.ok(buildAfter > buildBefore, `${buildAfter} > ${buildBefore}`);
});

test("held lot: disposition it, then close the supplier corrective action", () => {
  const demo = createDemo({ attrition });
  const admin = { display_name: "Demo Admin", roles: ["admin"], org: "neros" };
  assert.equal(post(demo, "/v1/attrition/hold", { attribute: "esc_lot", value: "ESC-2611" }, admin).status, 200);
  assert.equal(act(demo, "scar.close", { id: "SUP-PW" }, OPS).status, 409, "cannot close while the lot is on the shelf");
  assert.equal(act(demo, "lot.disposition", { id: "ESC-2611", disposition: "return" }, OPS).status, 200);
  assert.ok(queue(demo).some((i) => i.id === "q-scar-SUP-PW"));
  assert.equal(act(demo, "scar.close", { id: "SUP-PW" }, OPS).status, 200);
  assert.equal(get(demo, "/v1/company", OPS).body.suppliers.find((s) => s.id === "SUP-PW").scar, null);
});

test("Strike SKUs never enter a build or a request (ADR-0016)", () => {
  const demo = createDemo({ attrition });
  assert.equal(act(demo, "build.run", { sku: "ARCHER-5-S", qty: 1 }, OPS).status, 400);
  assert.equal(act(demo, "request.training", { sku: "ARCHER-5-S", seats: 1 }, CMD).status, 400);
  assert.equal(act(demo, "request.spares", { unit: "Alpha", items: [{ pn: "ARCHER-5-S", qty: 1 }] }, CMD).status, 400);
  const items = queue(demo);
  assert.ok(!items.some((i) => /ARCHER-\d+-S\b|Strike/.test(i.title)));
});

test("a unit can't have two replacement requests open at once", () => {
  const demo = createDemo({ attrition });
  assert.equal(act(demo, "request.replacement", { unit: "Charlie", qty: 4 }, CMD).status ?? 200, 200);
  const again = act(demo, "request.replacement", { unit: "Charlie", qty: 4 }, CMD);
  assert.equal(again.status, 409);
});
