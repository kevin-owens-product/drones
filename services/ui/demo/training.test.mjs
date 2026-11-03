// Unit check for the training scorecard. Run: node --test demo/training.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { acknowledge, scorecard, startSession, visible } from "./training.mjs";

test("qual-1 scores time to act and correct responses", () => {
  const s = startSession("qual-1", 0);
  assert.equal(visible(s, 4_000).length, 0);
  assert.equal(visible(s, 21_000).length, 2);
  assert.equal(acknowledge(s, "a3", "monitor", 21_000).error, "alert not raised yet");
  assert.ok(acknowledge(s, "a1", "confirm_failsafe", 9_000).ok);
  assert.equal(acknowledge(s, "a1", "monitor", 10_000).error, "already acknowledged");
  assert.equal(acknowledge(s, "a2", "arm", 22_000).error, "unknown response");
  assert.ok(acknowledge(s, "a2", "monitor", 26_000).ok);
  assert.ok(acknowledge(s, "a3", "plan_recovery", 37_000).ok);
  const card = scorecard(s);
  assert.equal(card.complete, true);
  assert.deepEqual(card.rows.map((r) => r.time_to_act_s), [4, 6, 2]);
  assert.equal(card.correct_rate, 2 / 3);
  assert.equal(card.mean_time_to_act_s, 4);
  assert.equal(card.max_time_to_act_s, 6);
});

test("unknown scenario is refused", () => {
  assert.equal(startSession("nope", 0), null);
});
