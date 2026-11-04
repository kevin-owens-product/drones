import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { RULES } from "./release.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const CMD_B = { display_name: "Customer B Commander", roles: ["mission_commander"], org: "CUS-B" };
const ALLY = { display_name: "Allied Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-C" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const act = (demo, action, args, who) => demo.handle("POST", new URL("http://x/v1/market/act"), JSON.stringify({ action, args }), who);

function keys(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
  return out;
}

const PATHS = ["/v1/quote", "/v1/mixed", "/v1/mixed/tail?tail=ALQ-11", "/v1/config", "/v1/stockpile", "/v1/plans", "/v1/release",
  "/v1/thread/updates", "/v1/thread/accountability", "/v1/thread/receiving", "/v1/thread/readiness", "/v1/field-reports", "/v1/fleet", "/v1/missions", "/v1/attrition"];

test("allied tenants: an allied session never receives a field its releasability rules withhold", () => {
  const demo = createDemo({ attrition });
  const withheld = RULES.map((r) => r.field);
  let saw = 0;
  for (const p of PATHS) {
    const r = get(demo, p, ALLY);
    const found = [...keys(r.body)].filter((k) => withheld.includes(k));
    assert.deepEqual(found, [], `${p} leaked ${found.join(", ")}`);
    if (r.body && r.body._withheld) saw += r.body._withheld.length;
  }
  assert.ok(saw > 0, "pages say what they withheld");
  // A quote request from the allied tenant still works, and its response is filtered too.
  const q = act(demo, "quote.request", { sku: "ARCHER-8", qty: 20 }, ALLY);
  assert.equal(q.status, 200);
  assert.ok(!keys(get(demo, "/v1/quote", ALLY).body).has("program_price"));
  // The same pages for a US customer keep the fields.
  assert.ok(keys(get(demo, "/v1/thread/updates", CMD).body).has("sha256"));
  assert.ok(keys(get(demo, "/v1/quote", CMD).body).has("program_price"));
  assert.equal(get(demo, "/v1/quote", CMD).body._marking, undefined);
});

test("plans: a tenant's tier gates its routes and usage counts match the records", () => {
  const demo = createDemo({ attrition });
  const b = get(demo, "/v1/mixed", CMD_B);
  assert.equal(b.status, 403);
  assert.equal(b.body.gated.needs, "fleet");
  assert.equal(get(demo, "/v1/stockpile", CMD_B).status, 403);
  assert.equal(act(demo, "config.swap", { serial: "x", part: "arm", to: "ARM-8" }, CMD_B).status, 403);
  assert.equal(get(demo, "/v1/mixed", CMD).status, 200, "Customer A is on Fleet");
  const r = act(demo, "plans.request", { tier: "fleet" }, CMD_B);
  assert.equal(r.status, 200);
  const item = get(demo, "/v1/ops/queue", OPS).body.items.find((i) => i.id.startsWith("q-plan-"));
  assert.ok(item, "the request is in the Neros queue");
  assert.equal(act(demo, "plans.set", { org: "CUS-B", tier: "fleet" }, CMD).status, 403, "customers do not set plans");
  const set = demo.handle("POST", new URL("http://x/v1/ops/act"), JSON.stringify({ action: item.actions[0].action, args: item.actions[0].args }), OPS);
  assert.equal(set.status, 200);
  assert.equal(get(demo, "/v1/mixed", CMD_B).status, 200, "Fleet opens All vendors");
  const v = get(demo, "/v1/plans", OPS).body;
  const a = v.customers.find((c) => c.org === "CUS-A");
  const serials = get(demo, "/v1/thread/receiving", CMD).body;
  assert.ok(serials);
  const mixedA = get(demo, "/v1/mixed", CMD).body;
  assert.equal(a.usage.formations, mixedA.units.length);
  const acct = get(demo, "/v1/thread/accountability", CMD).body;
  assert.ok(a.usage.drones >= acct.units.reduce((n, u) => n + u.in_store + u.issued, 0), "every drone on hand is counted under the record");
  assert.equal(v.totals.annual_usd, v.customers.reduce((n, c) => n + c.usage.annual_usd, 0));
});

test("stockpile: an over-age pack holds its airframe from ready, and rotating restores it", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/stockpile", CMD).body;
  const held = v.rows.find((r) => !r.ready);
  assert.ok(held && held.flags.some((f) => f.code === "over_age"));
  const unitBefore = get(demo, "/v1/mixed", CMD).body.units.find((u) => u.unit === held.unit).held;
  assert.ok(unitBefore >= 1, "All vendors counts the held airframe");
  assert.equal(act(demo, "stock.rotate", { serial: held.serial }, { ...CMD, roles: ["operator"] }).status, 403);
  assert.equal(act(demo, "stock.rotate", { serial: held.serial }, CMD).status, 200);
  const after = get(demo, "/v1/stockpile", CMD).body;
  assert.equal(after.counts.held, v.counts.held - 1);
  assert.equal(get(demo, "/v1/mixed", CMD).body.units.find((u) => u.unit === held.unit).held, unitBefore - 1);
  const charged = after.rows.find((r) => r.flags.some((f) => f.code === "high_charge"));
  if (charged) assert.equal(act(demo, "stock.recharge", { serial: charged.serial }, CMD).status, 200);
  const ok = after.rows.find((r) => r.ready);
  assert.equal(act(demo, "stock.retire", { serial: ok.serial }, CMD).status, 200);
  assert.equal(get(demo, "/v1/mixed", CMD).body.units.find((u) => u.unit === ok.unit).held >= 1, true, "a retired airframe never counts as ready");
  assert.equal(act(demo, "stock.rotate", { serial: "A5-9999-001" }, CMD).status, 404);
});

test("bid desk picks up releasability once rules exist", () => {
  const demo = createDemo({ attrition });
  const rows = get(demo, "/v1/bid?id=ALLY-T", OPS).body.current.rows;
  assert.equal(rows.find((r) => r.id === "rel").status, "met");
  assert.equal(rows.find((r) => r.id === "sov").status, "partial");
});
