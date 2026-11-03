import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROLE_MATRIX, birthRecord, birthVerdict, can, createLedger, sha256Hex, verifyChain } from "./ledger.mjs";

test("the role matrix matches the policy file", () => {
  const policy = JSON.parse(readFileSync(new URL("../../../policies/role_matrix/data.json", import.meta.url), "utf8"));
  assert.deepEqual(ROLE_MATRIX, policy);
  assert.equal(can(["operator"], "mission.approve"), false);
  assert.equal(can(["mission_commander", "planner"], "mission.approve"), true);
});

test("sha256Hex matches node:crypto", () => {
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "ünïcode ✓", "x".repeat(1000)]) {
    assert.equal(sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text.slice(0, 10)));
  }
});

test("the audit chain verifies, and an edited row breaks it", () => {
  const log = createLedger();
  log.append({ actor: "Demo Admin", action: "brief.approve", resource_type: "proposal", resource_id: "P-1" });
  log.append({ actor: "Demo Operator", action: "brief.approve", resource_type: "proposal", resource_id: "P-2", decision: "deny", reason_codes: ["role_denied"] });
  log.append({ actor: "Demo Maintainer", action: "attrition.hold", resource_type: "lot", resource_id: "ESC-2611" });
  const rows = log.items();
  assert.equal(verifyChain(rows), -1);
  assert.equal(rows[1].prev_hash, rows[0].row_hash);
  rows[1].decision = "allow";
  assert.equal(verifyChain(rows), 1);
});

test("birth record verdicts follow a2e.birth.verdict", () => {
  assert.deepEqual(birthVerdict(birthRecord("NX-01", 0, null)), { status: "airworthy", reason: "EOL hover test passed" });
  assert.deepEqual(birthVerdict(birthRecord("NX-12", 11, "EOL hover test failed: IMU cal out of range")), {
    status: "grounded",
    reason: "EOL hover test failed: IMU cal out of range",
  });
  assert.equal(birthRecord("NX-05", 4, null).parts.find((p) => p.part === "esc").lot, "ESC-2611");
  assert.match(birthRecord("NX-03", 2, null).firmware_sha256, /^[0-9a-f]{64}$/);
});
