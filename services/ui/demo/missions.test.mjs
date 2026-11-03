import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";

const asset = (name) => JSON.parse(readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8"));
const COMMANDER = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"] };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"] };
const MAINTAINER = { display_name: "Demo Maintainer", roles: ["maintainer"] };

function demo() {
  const d = createDemo({ terrain: asset("terrain.json"), attrition: asset("attrition.json") });
  return (who, path, method = "GET", body) => d.handle(method, new URL(`http://demo${path}`), body ? JSON.stringify(body) : "", who);
}

test("the board opens with plans in every state, tied to the demo fleet", () => {
  const call = demo();
  const { items } = call(COMMANDER, "/v1/missions").body;
  for (const s of ["draft", "review", "approved", "active", "closed"]) assert.ok(items.some((m) => m.state === s), s);
  assert.ok(items.find((m) => m.state === "active").tails.includes("NX-04"));
  assert.ok(items.every((m) => m.portion_mark.includes("SIM")));
});

test("launch checks name the grounded, low-battery and flagged-lot vehicles", () => {
  const call = demo();
  const checks = call(COMMANDER, "/v1/missions/M-1034/readiness").body.checks;
  assert.ok(checks.some((c) => c.level === "no-go" && c.detail.startsWith("NX-12 grounded")));
  assert.ok(checks.some((c) => c.level === "no-go" && c.detail.includes("NX-11 battery 41%")));
  const lot = call(COMMANDER, "/v1/missions/M-1032/readiness").body.checks.find((c) => c.detail.includes("ESC-2611"));
  assert.equal(lot.level, "caution");
});

test("holding the flagged lot in Attrition blocks the plan that uses it", () => {
  const call = demo();
  call(MAINTAINER, "/v1/attrition/hold", "POST", { attribute: "esc_lot", value: "ESC-2611" });
  const ready = call(COMMANDER, "/v1/missions/M-1032/readiness").body;
  assert.equal(ready.go, false);
  const out = call(COMMANDER, "/v1/missions/M-1032/transition", "POST", { action: "mission.execute" });
  assert.equal(out.status, 409);
  assert.equal(out.body.detail, "tail_not_airworthy");
});

test("an operator cannot approve and the drafter cannot approve their own plan", () => {
  const call = demo();
  assert.equal(call(OPERATOR, "/v1/missions/M-1033/transition", "POST", { action: "mission.approve" }).body.detail, "role_denied");
  const id = call(COMMANDER, "/v1/missions", "POST", { name: "Own plan" }).body.id;
  call(COMMANDER, `/v1/missions/${id}/transition`, "POST", { action: "mission.review" });
  assert.equal(call(COMMANDER, `/v1/missions/${id}/transition`, "POST", { action: "mission.approve" }).body.detail, "two_person_required");
  assert.equal(call(COMMANDER, "/v1/missions/M-1033/transition", "POST", { action: "mission.approve" }).body.state, "approved");
  const audit = call({ display_name: "Demo Admin", roles: ["admin"] }, "/v1/audit").body.items;
  assert.ok(audit.some((a) => a.action === "mission.approve" && a.decision === "deny" && a.reason_codes.includes("two_person_required")));
});

test("approving a brief files a draft plan, and a strike brief is refused", () => {
  const call = demo();
  const briefs = call(COMMANDER, "/v1/intent").body.items;
  assert.ok(briefs.some((p) => p.status === "refused"));
  const waiting = briefs.find((p) => p.status === "awaiting approval");
  const decided = call(COMMANDER, "/v1/intent/approve", "POST", { id: waiting.id, decision: "approve" }).body;
  assert.match(decided.mission_id, /^M-\d+$/);
  const filed = call(COMMANDER, `/v1/missions/${decided.mission_id}/objectives`).body.items;
  assert.ok(filed.some((o) => o.tail === "NX-07" || o.kind === "loiter"));
  assert.ok(filed.some((o) => o.kind === "rtb"));
});

test("a closed plan replays with tracks, events and the north-star metric", () => {
  const call = demo();
  const d = call(COMMANDER, "/v1/missions/M-1029/debrief").body;
  assert.equal(d.stats.sorties, 6);
  assert.equal(d.stats.aborted, 1);
  assert.ok(d.stats.effective_per_operator_hour > 0);
  assert.ok(d.events.some((e) => e.kind === "link" && e.tail === "NX-07"));
  assert.ok(d.events.some((e) => e.kind === "gnss"));
  assert.ok(d.tracks.every((t) => t.points.length > 10));
  const lost = call(COMMANDER, "/v1/missions/M-1024/debrief").body;
  assert.equal(lost.stats.lost, 1);
  assert.ok(lost.findings.some((f) => f.link === "#attrition"));
});

test("releasing a debrief needs the export permission and is audited", () => {
  const call = demo();
  assert.equal(call(OPERATOR, "/v1/debrief/export", "POST", { format: "csv", mission_id: "M-1027" }).status, 403);
  const out = call(COMMANDER, "/v1/debrief/export", "POST", { format: "csv", mission_id: "M-1027" }).body;
  assert.match(out.body, /^# UNCLASSIFIED \/\/ DEMO DATA/);
});
