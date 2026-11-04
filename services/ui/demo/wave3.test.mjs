import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { NEVER_SENT } from "./interop.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const CMD_B = { display_name: "Customer B Commander", roles: ["mission_commander"], org: "CUS-B" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const post = (demo, path, body, who) => demo.handle("POST", new URL(`http://x${path}`), JSON.stringify(body), who);
const act = (demo, action, args, who) => post(demo, "/v1/thread/act", { action, args }, who);

test("updates: approve, canary, roll out unit by unit, and the planted re-band regression halts itself", () => {
  const demo = createDemo({ attrition });
  assert.equal(act(demo, "updates.canary", { release: "FW-1.16.0" }, CMD).status, 409, "canary needs approval first");
  assert.equal(act(demo, "updates.approve", { release: "FW-1.16.0" }, OPERATOR).status, 403);
  assert.equal(act(demo, "updates.approve", { release: "FW-1.16.0" }, CMD).status, 200);
  assert.equal(act(demo, "updates.promote", { release: "FW-1.16.0", unit: "Alpha" }, CMD).status, 409, "no rollout before the canary");
  const canary = act(demo, "updates.canary", { release: "FW-1.16.0" }, CMD);
  assert.match(canary.body.message, /canary passed/);
  for (const unit of ["Alpha", "Bravo", "Charlie", "Delta"]) assert.equal(act(demo, "updates.promote", { release: "FW-1.16.0", unit }, CMD).status, 200);
  const v = get(demo, "/v1/thread/updates", CMD).body;
  assert.equal(v.releases.find((r) => r.id === "FW-1.16.0").rollout.status, "complete");
  for (const u of v.versions) assert.deepEqual(Object.keys(u.firmware), ["1.16.0"]);

  act(demo, "updates.approve", { release: "RF-P4" }, CMD);
  const rf = act(demo, "updates.canary", { release: "RF-P4" }, CMD);
  assert.match(rf.body.message, /halted automatically.*Delta/);
  assert.equal(act(demo, "updates.promote", { release: "RF-P4", unit: "Alpha" }, CMD).status, 409);
  const after = get(demo, "/v1/thread/updates", CMD).body.versions;
  assert.equal(after.find((u) => u.unit === "Alpha").band_plan.P4, 2, "only the canary drones carry the halted profile");
  // Neros sees the halt in the work queue and can withdraw the release.
  const q = get(demo, "/v1/ops/queue", OPS).body.items.find((i) => i.id === "q-upd-CUS-A-RF-P4");
  assert.ok(q, "halt is in the Neros queue");
  assert.equal(post(demo, "/v1/ops/act", { action: q.actions[0].action, args: q.actions[0].args }, OPS).status, 200);
  assert.equal(act(demo, "updates.revert", { release: "RF-P4" }, CMD).status, 200);
  assert.equal(get(demo, "/v1/thread/updates", CMD).body.versions.find((u) => u.unit === "Alpha").band_plan.P4, undefined);
});

test("updates: drafts stay with Neros until published, and bundles carry the signature and targets", () => {
  const demo = createDemo({ attrition });
  assert.ok(!get(demo, "/v1/thread/updates", CMD).body.releases.some((r) => r.status === "draft"));
  assert.equal(act(demo, "updates.publish", { release: "FW-1.17.0-rc1" }, CMD).status, 403);
  assert.equal(act(demo, "updates.publish", { release: "FW-1.17.0-rc1" }, OPS).status, 200);
  assert.ok(get(demo, "/v1/thread/updates", CMD).body.releases.some((r) => r.id === "FW-1.17.0-rc1"));
  assert.equal(get(demo, "/v1/thread/bundle?release=FW-1.16.0", CMD).status, 409, "no bundle before approval");
  act(demo, "updates.approve", { release: "FW-1.16.0" }, CMD);
  const b = get(demo, "/v1/thread/bundle?release=FW-1.16.0&unit=Delta", CMD).body;
  assert.match(b.signature, /^ed25519:[0-9a-f]{64}$/);
  assert.equal(b.sha256.length, 64);
  assert.ok(b.targets.length > 0 && b.targets.every((s) => s.startsWith("A10-")));
  assert.deepEqual(get(demo, "/v1/thread/bundle?release=FW-1.16.0&unit=Delta", CMD).body.bundle, b.bundle, "bundle ids are stable");
});

test("interop: CoT and entities carry only the customer's own drones, as friendly air", () => {
  const demo = createDemo({ attrition });
  const cot = get(demo, "/v1/interop/cot", CMD).body;
  assert.ok(cot.count > 0);
  const events = cot.xml.match(/<event /g) ?? [];
  assert.equal(events.length, cot.count);
  for (const t of cot.xml.match(/type="[^"]+"/g)) assert.equal(t, 'type="a-f-A-M-H-Q"');
  assert.ok(!/SX-/.test(cot.xml), "synthetic drones belong to no customer");
  assert.ok(!/target|strike|weapon|munition|hostile/i.test(cot.xml));
  const ents = get(demo, "/v1/interop/entities", CMD).body.entities;
  assert.equal(ents.length, cot.count);
  for (const e of ents) assert.equal(e.milView.disposition, "DISPOSITION_FRIENDLY");
  assert.equal(get(demo, "/v1/interop/cot", CMD_B).body.count, 0, "Customer B sees none of Customer A's drones");
});

test("interop: feeds are the customer's, Lattice needs configuring, and inbound commands are refused", () => {
  const demo = createDemo({ attrition });
  assert.equal(post(demo, "/v1/interop/act", { action: "feed.set", args: { id: "tak", on: false } }, OPERATOR).status, 403);
  assert.equal(post(demo, "/v1/interop/act", { action: "feed.set", args: { id: "tak", on: false } }, OPS).status, 403);
  assert.equal(post(demo, "/v1/interop/act", { action: "feed.set", args: { id: "tak", on: false } }, CMD).status, 200);
  assert.equal(get(demo, "/v1/interop", CMD).body.feeds.find((f) => f.id === "tak").on, false);
  assert.equal(post(demo, "/v1/interop/act", { action: "feed.set", args: { id: "lattice", on: true } }, CMD).status, 409);
  const inbound = post(demo, "/v1/interop/inbound?from=tak", { command: "goto" }, null);
  assert.equal(inbound.status, 403);
  const audit = get(demo, "/v1/audit", null).body.items;
  assert.ok(audit.some((e) => e.action === "interop.inbound" && e.decision === "deny"));
  assert.ok(NEVER_SENT.includes("COMMAND_LONG"));
  assert.ok(get(demo, "/v1/interop", CMD).body.mavlink.every((m) => !NEVER_SENT.includes(m.message)));
});

test("program cockpit: Neros only, joins price, completion, acceptance, orders, demand and training", () => {
  const demo = createDemo({ attrition });
  assert.equal(get(demo, "/v1/program", CMD).status, 403);
  const p = get(demo, "/v1/program", OPS).body;
  assert.deepEqual(p.ladder.map((r) => r.price_usd), [5000, 3500, 3000, 2300]);
  assert.ok(p.ladder.every((r) => /secondary|Breaking Defense/.test(r.source)));
  for (const s of p.skus) {
    assert.ok(s.bom_usd > 0 && s.bom_usd < 2000);
    assert.ok(s.rate > 0.3 && s.rate < 0.95);
  }
  assert.ok(p.acceptance.rate > p.acceptance.program.rate);
  assert.ok(p.orders.length >= 5);
  assert.ok(p.expenditure.length === 4 && p.expenditure.every((e) => e.org === "CUS-A"), "only sharing customers");
  assert.ok(p.training.full.rate > p.training.few.rate);
  assert.ok(!/munition|warhead|strike_|target/i.test(JSON.stringify(p.skus) + JSON.stringify(p.expenditure)));
});
