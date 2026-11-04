import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { check } from "./config.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const CMD_B = { display_name: "Customer B Commander", roles: ["mission_commander"], org: "CUS-B" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const act = (demo, action, args, who) => demo.handle("POST", new URL("http://x/v1/market/act"), JSON.stringify({ action, args }), who);

test("quote: price matches the lines, sortie cost comes from records, and Neros cannot promise a date the factory cannot make", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/quote?sku=ARCHER-5&sensor=thermal&qty=120&seats=10&fleet=battalion", CMD).body;
  const p = v.preview;
  assert.equal(p.total_usd, p.lines.reduce((s, l) => s + l.usd, 0));
  assert.equal(p.unit_usd, 2950 + 420);
  assert.ok(p.sortie.usd > p.unit_usd, "a completed sortie costs more than one drone when not every sortie completes");
  assert.equal(p.sortie.basis, "your own end-of-flight records");
  assert.ok(p.delivery.fastest <= p.delivery.date);

  assert.equal(act(demo, "quote.request", { sku: "ARCHER-5", qty: 120 }, OPERATOR).status, 403, "operators view only");
  assert.equal(act(demo, "quote.request", { sku: "ARCHER-5", qty: 120 }, OPS).status, 403, "Neros does not request its own quotes");
  const r = act(demo, "quote.request", { sku: "ARCHER-5", sensor: "thermal", qty: 120, seats: 10, fleet: "battalion" }, CMD);
  assert.equal(r.status, 200);
  const item = get(demo, "/v1/ops/queue", OPS).body.items.find((i) => i.id === `q-quote-${r.body.id}`);
  assert.ok(item, "the request is in the Neros work queue");

  assert.equal(act(demo, "quote.price", { id: r.body.id, date: "2026-11-04" }, OPS).status, 409, "no promise before the fastest the factory can do");
  assert.equal(act(demo, "quote.price", { id: r.body.id }, CMD).status, 403, "customers do not price");
  const priced = demo.handle("POST", new URL("http://x/v1/ops/act"), JSON.stringify({ action: item.actions[0].action, args: item.actions[0].args }), OPS);
  assert.equal(priced.status, 200);
  assert.equal(get(demo, "/v1/quote", CMD_B).body.quotes.length, 0, "Customer B never sees Customer A's quotes");
  const ok = act(demo, "quote.accept", { id: r.body.id }, CMD);
  assert.match(ok.body.message, /order ORD-Q-/);
  assert.ok(get(demo, "/v1/company", OPS).body, "company still loads with the new order");
});

test("mixed fleet: one picture across vendors; imports check every row; no birth record for other vendors", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/mixed", CMD).body;
  assert.ok(v.counts.vendors >= 3);
  assert.equal(v.units.reduce((s, u) => s + u.total, 0), v.counts.tails);
  assert.ok(v.others.some((t) => t.state === "unknown"), "a tail with no recent log is unknown, not ready");
  const imp = act(demo, "mixed.import", { csv: v.sample_log }, CMD).body;
  assert.deepEqual(imp.accepted, ["SRQ-121", "PBE-2231"]);
  assert.equal(imp.rejected.length, 2);
  assert.match(imp.rejected.find((x) => x.tail === "NX-05").why[0], /Neros tails/);
  const after = get(demo, "/v1/mixed", CMD).body;
  assert.equal(after.others.find((t) => t.tail === "SRQ-121").state, "ready", "a fresh log brings the tail back");
  assert.ok(after.others.some((t) => t.tail === "PBE-2231"), "a new tail from a log is added");
  const tail = get(demo, "/v1/mixed/tail?tail=SRQ-101", CMD).body;
  assert.equal(tail.genealogy, null);
  assert.match(tail.why, /no birth record/);
  assert.equal(get(demo, "/v1/mixed/tail?tail=SRQ-101", CMD_B).status, 404, "another customer's tail is not found");
  assert.equal(act(demo, "mixed.ngc2", { tail: "SBS-0031" }, CMD).status, 409, "manual entry cannot publish to NGC2");
});

test("configuration: invalid swaps are refused, a conversion holds the airframe until its parameters load", () => {
  assert.equal(check({ arm: "ARM-10", motor: "MOT-S", prop: "PROP-5" }).ok, false);
  assert.equal(check({ arm: "ARM-8", motor: "MOT-L", prop: "PROP-8" }).params, "P-8");
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/config?unit=Alpha", CMD).body;
  const serial = v.rows[0].serial;
  const bad = act(demo, "config.swap", { serial, part: "arm", to: "ARM-10" }, CMD);
  assert.equal(bad.status, 409);
  assert.match(bad.body.detail, /10-inch arms need MOT-L/);
  const conv = act(demo, "config.reconfigure", { serial, size: 8 }, CMD);
  assert.equal(conv.status, 200);
  const row = get(demo, "/v1/config?unit=Alpha", CMD).body.rows.find((r) => r.serial === serial);
  assert.equal(row.ready, false);
  assert.equal(row.size, 8);
  const held = get(demo, "/v1/mixed", CMD).body.units.find((u) => u.unit === "Alpha");
  assert.equal(held.held, 1, "All vendors counts the held airframe as not ready");
  assert.equal(act(demo, "config.params", { serial }, CMD).status, 200);
  assert.equal(get(demo, "/v1/mixed", CMD).body.units.find((u) => u.unit === "Alpha").held, 0);
  // Bravo has no 10-inch spares: the conversion is refused before anything changes.
  const b = get(demo, "/v1/config?unit=Bravo", CMD).body.rows[0].serial;
  assert.match(act(demo, "config.reconfigure", { serial: b, size: 10 }, CMD).body.detail, /Bravo has 0 ARM-10/);
  assert.equal(get(demo, "/v1/config/quality", CMD).status, 403);
  assert.ok(get(demo, "/v1/config/quality", OPS).body.rows.length > 0);
});

test("surge: the as-planned date never beats the slowest part, and expediting is never later", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/surge?sku=ARCHER-5&qty=400&by=2026-12-29", OPS).body;
  const [plain, fast, shift] = v.ask.options;
  for (const p of plain.parts) assert.ok(plain.material_ready >= p.ready);
  assert.ok(fast.date <= plain.date);
  assert.ok(shift.date <= fast.date);
  assert.ok(fast.cost.expedite_usd > 0);
  assert.equal(get(demo, "/v1/surge", CMD).status, 403);
});
