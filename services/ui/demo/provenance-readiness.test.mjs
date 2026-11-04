import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const act = (demo, action, args, who) => demo.handle("POST", new URL("http://x/v1/thread/act"), JSON.stringify({ action, args }), who);

test("compliance shows the planted gaps and the days to the FCC exemption deadline", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/thread/compliance", OPS).body;
  assert.equal(v.fcc_exemption_ends, "2027-01-01");
  assert.ok(v.days_left > 0);
  const status = Object.fromEntries(v.lots.map((l) => [l.lot, l.status]));
  assert.equal(status["CM-0318"], "gap");
  assert.equal(status["MT-1180"], "gap");
  assert.equal(status["BT-S-0920"], "expiring");
  assert.equal(status["ESC-2611"], "complete");
  assert.equal(get(demo, "/v1/thread/compliance", CMD).status, 403);
});

test("a customer's packet carries no supplier names; Neros's does", () => {
  const demo = createDemo({ attrition });
  const mine = get(demo, "/v1/thread/packet?lot=DL-2618", CMD);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.components.length > 0);
  for (const c of mine.body.components) assert.equal(c.supplier_name, undefined);
  const theirs = get(demo, "/v1/thread/packet?lot=DL-2619", CMD);
  assert.equal(theirs.status, 404);
  const neros = get(demo, "/v1/thread/packet?lot=DL-2618", OPS).body;
  assert.ok(neros.components.every((c) => typeof c.supplier_name === "string"));
});

test("requesting and recording evidence closes a gap and updates every packet; covered countries are refused", () => {
  const demo = createDemo({ attrition });
  const before = get(demo, "/v1/thread/compliance", OPS).body;
  const carrying = before.deliveries.filter((d) => d.status !== "complete");
  assert.ok(carrying.length > 0);
  const req = act(demo, "compliance.request", { lot: "CM-0318" }, OPS);
  assert.equal(req.status, 200, JSON.stringify(req.body));
  assert.match(req.body.message, /EVR-\d+/);
  assert.equal(act(demo, "compliance.request", { lot: "CM-0318" }, OPS).status, 409);
  assert.equal(act(demo, "compliance.record", { lot: "CM-0318", origin: "China" }, OPS).status, 409);
  assert.equal(act(demo, "compliance.record", { lot: "CM-0318", origin: "" }, OPS).status, 400);
  assert.equal(act(demo, "compliance.record", { lot: "CM-0318", origin: "Japan" }, OPS).status, 200);
  const after = get(demo, "/v1/thread/compliance", OPS).body;
  assert.equal(after.lots.find((l) => l.lot === "CM-0318").status, "complete");
  assert.equal(act(demo, "compliance.request", { lot: "CM-0318" }, CMD).status, 403);
});

test("readiness joins training to sorties, flags who is not ready, and books a refresher", () => {
  const demo = createDemo({ attrition });
  const v = get(demo, "/v1/thread/readiness", CMD).body;
  assert.ok(v.operators.length > 5);
  assert.ok(v.counts.ready < v.counts.operators, "some operators should need something");
  for (const o of v.operators) assert.match(o.id, /^[A-Z]-\d+$|^[A-Z]+-\d+$/);
  const six = v.effect.by_sessions.find((g) => g.label === "6 of 6");
  const few = v.effect.by_sessions.find((g) => g.label === "3 or fewer");
  assert.ok(six.rate > few.rate, "training should show an effect in the sim");
  const needs = v.operators.find((o) => !o.ready);
  assert.equal(act(demo, "readiness.refresher", { operator: needs.id, kind: "sim" }, OPERATOR).status, 403);
  assert.equal(act(demo, "readiness.refresher", { operator: needs.id, kind: "sim" }, CMD).status, 200);
  assert.equal(act(demo, "readiness.refresher", { operator: needs.id, kind: "sim" }, CMD).status, 409);
  assert.equal(get(demo, "/v1/thread/readiness", CMD).body.counts.refreshers, 1);
});

test("Neros sees the training effect only as aggregates, and only from sharing customers", () => {
  const demo = createDemo({ attrition });
  const n = get(demo, "/v1/thread/training-effect", OPS);
  assert.equal(n.status, 200);
  assert.equal(n.body.operators > 0, true);
  assert.equal("operators_list" in n.body, false);
  assert.ok(!JSON.stringify(n.body).includes('"id"'));
  assert.equal(get(demo, "/v1/thread/training-effect", CMD).status, 403);
});
