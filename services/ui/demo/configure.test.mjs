import { test } from "node:test";
import assert from "node:assert/strict";
import { coldFactor, cruiseWatts, explain, hopKm, plan, BANDS, VARIANTS } from "./configure.mjs";

const base = { range_km: 3, wind_mps: 4, temp_c: 20, loiter_min: 5, jamming: "none" };

test("physics helpers move the right way", () => {
  assert.equal(coldFactor(25), 1);
  assert.ok(coldFactor(-10) < coldFactor(0));
  assert.ok(cruiseWatts(1.4) > cruiseWatts(1.2));
  assert.ok(hopKm(BANDS[0], VARIANTS[0], "heavy") < hopKm(BANDS[0], VARIANTS[0], "none"));
  assert.ok(hopKm(BANDS[0], VARIANTS[1], "heavy") > hopKm(BANDS[0], VARIANTS[0], "heavy"));
});

test("the cold takes the standard LiPo under the reserve, so the planner moves to the bigger pack", () => {
  const warm = plan(base);
  assert.equal(warm.best.battery, "6S2200");
  const cold = plan({ ...base, temp_c: -10 });
  const lipo = cold.options.find((o) => o.variant === "A" && o.battery === "6S2200" && o.band === "915");
  assert.equal(lipo.ok, false);
  assert.match(lipo.reason, /reserve/);
  assert.equal(cold.best.battery, "6S4000");
});

test("heavy jamming picks the hardened radio because it needs fewer relays", () => {
  const r = plan({ ...base, range_km: 5, jamming: "heavy" });
  assert.equal(r.best.variant, "B");
  const a = r.options.filter((o) => o.ok && o.variant === "A").sort((x, y) => x.relays - y.relays)[0];
  assert.ok(a.relays > r.best.relays);
  assert.match(explain(r), /hardened radio/);
});

test("an impossible mission says so instead of picking something", () => {
  const r = plan({ ...base, range_km: 12, wind_mps: 10 });
  assert.equal(r.best, null);
  assert.match(explain(r), /No configuration/);
  assert.equal(plan({ ...base, wind_mps: 20 }).options[0].ok, false);
});
