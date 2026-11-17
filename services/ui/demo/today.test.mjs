import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";

const asset = (name) => JSON.parse(readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8"));
const COMMANDER = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const MAINTAINER = { display_name: "Demo Maintainer", roles: ["maintainer"], org: "CUS-A" };
const SUPERVISOR = { display_name: "Demo Supervisor (Harbor police)", roles: ["mission_commander"], org: "CUS-D" };

function demo() {
  const d = createDemo({ terrain: asset("terrain.json"), attrition: asset("attrition.json") });
  return (who, path, method = "GET", body) => d.handle(method, new URL(`http://demo${path}`), body ? JSON.stringify(body) : "", who);
}
const today = (call, who) => call(who, "/v1/today").body;
const run = (call, who, action) => call(who, action.post.path, "POST", action.post.body);

test("a commander's Today leads with the plan waiting on their approval, and approving it clears the item", () => {
  const call = demo();
  const t = today(call, COMMANDER);
  const first = t.items[0];
  assert.equal(first.id, "plan-review-M-1033");
  assert.equal(first.severity, "now");
  const approve = first.actions.find((a) => a.label === "Approve");
  assert.equal(run(call, COMMANDER, approve).status, 200);
  assert.equal(call(COMMANDER, "/v1/missions/M-1033").body.state, "approved");
  assert.ok(!today(call, COMMANDER).items.some((i) => i.id === "plan-review-M-1033"));
});

test("each role sees its own jobs: the operator its sorties, the maintainer airframes a plan needs", () => {
  const call = demo();
  const op = today(call, OPERATOR);
  assert.ok(op.items.length > 0);
  assert.ok(op.items.every((i) => i.area === "Sorties"), "operators see sorties, not the unit's approvals");
  assert.ok(op.items.some((i) => i.title.startsWith("Next sortie: M-1032")));
  const mt = today(call, MAINTAINER);
  const nx12 = mt.items.find((i) => i.id === "wo-WO-5102");
  assert.match(nx12.title, /NX-12 is on M-1034/);
  assert.ok(nx12.actions.some((a) => a.label.startsWith("Close WO-5102")));
  assert.ok(!mt.items.some((i) => i.area === "Plans"), "a maintainer does not approve plans");
});

test("a held lot blocks a plan; the commander asks maintenance, the maintainer replaces the part, the plan is go", () => {
  const call = demo();
  const hold = today(call, COMMANDER).items.find((i) => i.id === "alert-esc_lot-ESC-2611");
  assert.equal(run(call, COMMANDER, hold.actions[0]).status, 200);
  const blocked = today(call, COMMANDER).items.find((i) => i.id === "plan-blocked-M-1032");
  assert.match(blocked.detail, /NX-05 restricted/);
  assert.deepEqual(blocked.actions.map((a) => a.label).slice(0, 2), ["Swap in NX-10", "Ask maintenance"]);
  assert.equal(run(call, COMMANDER, blocked.actions[1]).status, 200);
  // The ask lands first on the maintainer's Today, with the plan it is for.
  const ask = today(call, MAINTAINER).items[0];
  assert.match(ask.title, /needs NX-05 for M-1032/);
  assert.equal(run(call, MAINTAINER, ask.actions[0]).status, 200);
  const after = today(call, COMMANDER).items.find((i) => i.id.endsWith("M-1032"));
  assert.equal(after.id, "plan-release-M-1032");
  assert.equal(call(COMMANDER, "/v1/missions/M-1032/readiness").body.go, true);
});

test("swapping in another tail moves its legs and sends an approved plan back for a second approval", () => {
  const call = demo();
  call(COMMANDER, "/v1/attrition/hold", "POST", { attribute: "esc_lot", value: "ESC-2611" });
  const r = call(COMMANDER, "/v1/missions/M-1032/tail", "POST", { fix: "swap:NX-05:NX-10" });
  assert.equal(r.status, 200);
  assert.equal(r.body.state, "draft");
  const m = call(COMMANDER, "/v1/missions/M-1032").body;
  assert.ok(m.tails.includes("NX-10") && !m.tails.includes("NX-05"));
  // Only offered fixes apply, and operators cannot change a plan.
  assert.equal(call(COMMANDER, "/v1/missions/M-1032/tail", "POST", { fix: "swap:NX-07:NX-01" }).status, 409);
  assert.equal(call(OPERATOR, "/v1/missions/M-1034/tail", "POST", { fix: "ask:NX-12" }).status, 403);
});

test("Today is a customer's page: the responder program keeps its own shift page", () => {
  const call = demo();
  assert.equal(call(SUPERVISOR, "/v1/today").status, 403);
});
