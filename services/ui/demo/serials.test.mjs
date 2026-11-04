import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { createSerials, END_FIELDS, SHARED_FIELDS, poissonTail, wilsonUpper } from "./serials.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const OPS = { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" };
const CMD = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const get = (demo, path, who) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const post = (demo, path, body, who) => demo.handle("POST", new URL(`http://x${path}`), JSON.stringify(body), who);
const act = (demo, action, args, who) => post(demo, "/v1/thread/act", { action, args }, who);

test("the seeded history is deterministic and every serial's chain verifies", () => {
  const a = createSerials();
  const b = createSerials();
  assert.equal(a.records.length, b.records.length);
  assert.deepEqual(a.records.slice(0, 20), b.records.slice(0, 20));
  assert.ok(a.records.length > 300);
  for (const id of [...a.serials.keys()].filter((_, i) => i % 97 === 0)) {
    const rec = a.serialRecord(id);
    assert.equal(rec.verified, true, id);
    assert.equal(rec.events[0].kind, "born");
  }
});

test("end-of-flight records carry no target, strike or damage fields (ADR-0016)", () => {
  const s = createSerials();
  for (const r of s.records) assert.deepEqual(Object.keys(r).sort(), [...END_FIELDS].sort());
  const banned = /target|strike|damage|bda|kill|hit|munition|payload|warhead/i;
  for (const f of [...END_FIELDS, ...SHARED_FIELDS]) assert.ok(!banned.test(f), f);
  for (const r of s.sharedRecords()) for (const k of Object.keys(r)) assert.ok(SHARED_FIELDS.includes(k), k);
});

test("the acceptance package flags the planted problems and the customer can reject them", () => {
  const demo = createDemo({ attrition });
  const pkg = get(demo, "/v1/thread/lot?id=DL-2618", CMD).body;
  const codes = pkg.rows.flatMap((r) => r.checks.map((c) => c.code));
  assert.deepEqual(codes.sort(), ["bench_missing", "firmware_unreleased", "imu_marginal"]);
  const reject = pkg.rows.filter((r) => r.checks.some((c) => c.level === "fail")).map((r) => ({ serial: r.serial, reason: r.checks[0].code }));
  // An operator can look but not decide.
  assert.equal(act(demo, "delivery.accept", { id: "DL-2618", reject }, OPERATOR).status, 403);
  const out = act(demo, "delivery.accept", { id: "DL-2618", reject }, CMD);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.match(out.body.message, /58 accepted, 2 rejected/);
  assert.equal(act(demo, "delivery.accept", { id: "DL-2618" }, CMD).status, 409);
  // The rejections land in Neros's queue; shipping replacements opens a new lot at the customer.
  const item = get(demo, "/v1/ops/queue", OPS).body.items.find((i) => i.id === "q-rej-DL-2618");
  assert.ok(item);
  const ship = post(demo, "/v1/ops/act", { action: item.actions[0].action, args: item.actions[0].args }, OPS);
  assert.equal(ship.status, 200, JSON.stringify(ship.body));
  const waiting = get(demo, "/v1/thread/receiving", CMD).body.waiting;
  assert.ok(waiting.some((l) => l.replaces === "DL-2618" && l.qty === 2 && l.failing === 0));
  const audit = get(demo, "/v1/audit", null).body.items;
  assert.ok(audit.some((e) => e.action === "thread.delivery.accept" && e.decision === "deny"));
  assert.ok(audit.some((e) => e.action === "thread.rejects.replace" && e.decision === "allow"));
});

test("customers see only their own lots and serials, and never the Quality page", () => {
  const demo = createDemo({ attrition });
  assert.equal(get(demo, "/v1/thread/quality", CMD).status, 403);
  assert.equal(get(demo, "/v1/thread/lot?id=DL-2619", CMD).status, 404);
  assert.ok(get(demo, "/v1/thread/receiving?org=CUS-B", CMD).body.waiting.every((l) => l.customer.startsWith("Customer A")));
  const b = createDemo({ attrition });
  const serial = get(b, "/v1/thread/lot?id=DL-2619", OPS).body.rows[0].serial;
  assert.equal(get(b, `/v1/thread/serial?serial=${serial}`, CMD).status, 404);
});

test("the field-to-lot loop flags ESC-2611, and only from shared data", () => {
  const demo = createDemo({ attrition });
  const q = get(demo, "/v1/thread/quality", OPS).body;
  const esc = q.signals.find((s) => s.lot === "ESC-2611");
  assert.equal(esc.flagged, true);
  assert.equal(esc.supplier, "SUP-PW");
  assert.equal(q.signals.filter((s) => s.flagged).length, 1, "no false alarms on the clean lots");
  assert.ok(get(demo, "/v1/ops/queue", OPS).body.items.some((i) => i.id === "q-field-ESC-2611"));
  // Opening an action and holding the lot restricts the named tail that carries it.
  assert.equal(act(demo, "quality.action", { lot: "ESC-2611" }, OPS).status, 200);
  assert.equal(act(demo, "quality.action", { lot: "ESC-2611" }, OPS).status, 409);
  assert.equal(act(demo, "quality.hold", { lot: "ESC-2611" }, CMD).status, 403);
  assert.equal(act(demo, "quality.hold", { lot: "ESC-2611" }, OPS).status, 200);
  const nx05 = get(demo, "/v1/platforms/NX-05", OPS).body;
  assert.equal(nx05.airworthiness, "restricted");
  // Customer A turns sharing off: Neros sees no field data.
  assert.equal(post(demo, "/v1/ops/act", { action: "sharing.set", args: { on: false } }, CMD).status, 200);
  const off = get(demo, "/v1/thread/quality", OPS).body;
  assert.equal(off.shared_sorties, 0);
  assert.ok(off.signals.every((s) => !s.flagged));
});

test("sampling is recommended only for clean lots with enough evidence", () => {
  const q = createSerials().quality();
  assert.equal(q.sampling.ok, true);
  assert.ok(q.sampling.excluded_lots.includes("ESC-2611"));
  assert.ok(q.sampling.upper_95 < q.sampling.threshold);
  assert.ok(Math.abs(poissonTail(3, 1) - 0.0803) < 0.001);
  assert.ok(wilsonUpper(0, 100) > 0 && wilsonUpper(0, 100) < 0.05);
});

test("issue and sync move airframes and add records the customer can see", () => {
  const demo = createDemo({ attrition });
  const before = get(demo, "/v1/thread/accountability", CMD).body;
  const alpha = before.units.find((u) => u.unit === "Alpha");
  const lot = before.lots.find((l) => l.unit === "Alpha" && l.in_store > 0);
  assert.equal(act(demo, "issue", { lot: lot.lot, unit: "Alpha", qty: 5 }, CMD).status, 200);
  const after = get(demo, "/v1/thread/accountability", CMD).body;
  assert.equal(after.units.find((u) => u.unit === "Alpha").issued, alpha.issued + 5);
  const n = demo.handle("GET", new URL("http://x/v1/thread/accountability"), "", CMD).body.records.length;
  const sync = act(demo, "sync", {}, CMD);
  assert.equal(sync.status, 200, JSON.stringify(sync.body));
  assert.equal(act(demo, "sync", {}, CMD).status, 409, "already synced to today");
  assert.ok(n > 0);
  assert.equal(get(demo, "/v1/thread/accountability", CMD).body.synced_to, "2026-11-03");
});
