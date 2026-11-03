import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEvalTable } from "./evalrows.mjs";

test("the README eval table parses into rows with where each was measured", () => {
  const rows = parseEvalTable(readFileSync(new URL("../../../README.md", import.meta.url), "utf8"));
  assert.ok(rows.length >= 20);
  const v2 = rows.find((r) => r.metric === "Runs that held the target, tracker v2");
  assert.equal(v2.measured_in, "PX4 SITL");
  assert.equal(v2.value, "3");
  assert.equal(v2.unit, "of 5 runs");
  assert.ok(rows.every((r) => ["Unit check", "PX4 SITL"].includes(r.measured_in)));
});

test("no markers, no rows", () => {
  assert.deepEqual(parseEvalTable("# nothing"), []);
});
