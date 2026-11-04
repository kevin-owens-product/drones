import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { EVIDENCE_PAGES, OUT_OF_SCOPE } from "./biddesk.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander"], org: "CUS-A" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const act = (demo, action, args, who) => demo.handle("POST", new URL("http://x/v1/market/act"), JSON.stringify({ action, args }), who);

test("surge actions: expediting raises orders, the second shift pulls the date in, customers cannot", () => {
  const demo = createDemo({ attrition });
  const before = get(demo, "/v1/surge?sku=ARCHER-5&qty=400&by=2026-12-29", OPS).body;
  assert.equal(act(demo, "surge.shift", { on: true }, CMD).status, 403);
  assert.equal(act(demo, "surge.shift", { on: true }, OPS).status, 200);
  const shifted = get(demo, "/v1/surge?sku=ARCHER-5&qty=400&by=2026-12-29", OPS).body;
  assert.equal(shifted.second_shift, true);
  assert.ok(shifted.ask.options[0].date <= before.ask.options[0].date, "a second shift is never later");
  const ex = act(demo, "surge.expedite", { sku: "ARCHER-5", qty: 400 }, OPS);
  assert.equal(ex.status, 200);
  assert.ok(get(demo, "/v1/surge", OPS).body.raised.length > 0);
});

test("bid desk: every met row links to a record that exists; weapons rows are out of scope and cannot be assigned", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/bid", OPS).body;
  assert.ok(v.solicitations.length >= 3);
  for (const s of v.solicitations) {
    const rows = get(demo, `/v1/bid?id=${s.id}`, OPS).body.current.rows;
    for (const r of rows.filter((x) => x.status === "met")) {
      assert.ok(r.evidence, `${s.id}/${r.id} met without evidence`);
      assert.ok([...EVIDENCE_PAGES, "release"].includes(r.evidence.page), `${r.evidence.page} is a page`);
      assert.ok(r.evidence.count > 0, `${s.id}/${r.id} evidence has records`);
    }
  }
  const dd = v.current.rows;
  for (const id of ["atr", "esad"]) {
    const r = dd.find((x) => x.id === id);
    assert.equal(r.status, "out_of_scope");
    assert.equal(r.value, OUT_OF_SCOPE);
  }
  assert.equal(act(demo, "bid.owner", { id: "DD-P3", row: "atr", owner: "Product" }, OPS).status, 409);
  assert.equal(act(demo, "bid.owner", { id: "DD-P3", row: "single", owner: "Product" }, CMD).status, 403);
  assert.equal(act(demo, "bid.owner", { id: "DD-P3", row: "single", owner: "Product", due: "2027-06-01" }, OPS).status, 409, "no owner date after the bid is due");
  assert.equal(act(demo, "bid.owner", { id: "DD-P3", row: "single", owner: "Product" }, OPS).status, 200);
  assert.equal(get(demo, "/v1/bid", OPS).body.current.rows.find((r) => r.id === "single").owner.owner, "Product");
  const brief = get(demo, "/v1/bid/brief?id=DD-P3", OPS).body.markdown;
  assert.match(brief, /Out of scope/);
  assert.match(brief, /\| Met \|/);
  assert.equal(get(demo, "/v1/bid", CMD).status, 403);
  assert.doesNotMatch(JSON.stringify(v), /"(target|strike|damage)[a-z_]*":/i, "no weapons fields in the payload");
});

test("fix loop: a case closes only with a measured cohort-against-control effect", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/cases", OPS).body;
  const closed = v.cases.find((c) => c.status === "closed");
  assert.ok(closed.measured && closed.measurement.improved && closed.days_to_fix > 0);
  assert.equal(v.stats.median_days, closed.days_to_fix);
  const shipped = v.cases.find((c) => c.status === "shipped");
  assert.equal(act(demo, "case.close", { id: shipped.id }, OPS).status, 409, "no sorties since the change: refused");
  act(demo, "case.collect", { id: shipped.id }, OPS);
  act(demo, "case.collect", { id: shipped.id }, OPS);
  const m = get(demo, "/v1/cases", OPS).body.cases.find((c) => c.id === shipped.id).measurement;
  assert.ok(m.ready && m.improved, m.verdict);
  assert.ok(m.did < 0 && m.control.units.length === 3);
  assert.equal(act(demo, "case.close", { id: shipped.id }, CMD).status, 403, "customers do not close Neros cases");
  assert.equal(act(demo, "case.close", { id: shipped.id }, OPS).status, 200);
  // A change that does nothing never closes, however much data comes in.
  const dud = v.cases.find((c) => c.status === "assigned");
  assert.equal(act(demo, "case.ship", { id: dud.id, change: "New antenna mount" }, OPS).status, 200);
  for (let i = 0; i < 4; i += 1) act(demo, "case.collect", { id: dud.id }, OPS);
  const r = act(demo, "case.close", { id: dud.id }, OPS);
  assert.equal(r.status, 409);
  assert.match(r.body.detail, /No measured improvement/);
  // Opening a case from a theme without one.
  const theme = v.themes.find((t) => !t.has_case);
  const opened = act(demo, "case.open", { theme: theme.theme }, OPS);
  assert.equal(opened.status, 200);
  assert.equal(act(demo, "case.ship", { id: opened.body.id, change: "x" }, OPS).status, 409, "no engineer, no ship");
  assert.ok(get(demo, "/v1/ops/queue", OPS).body.items.some((i) => i.id === `q-case-${opened.body.id}`));
});
