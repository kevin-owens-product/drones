import assert from "node:assert/strict";
import test from "node:test";
import { coverage } from "./coverage.mjs";
import { AREA, STATION } from "./denial.mjs";
import { airframesTonight } from "./tonight.mjs";

test("the radio coverage grid shrinks under the jammer and grows with height", () => {
  const clear = coverage(STATION, AREA, { link: "c2", band: "915", agl_m: 100 });
  const jammed = coverage(STATION, AREA, { link: "c2", band: "915", agl_m: 100, ew: true });
  assert.ok(jammed.emitter.on && !clear.emitter.on);
  assert.ok(jammed.held_pct < clear.held_pct, `${jammed.held_pct} < ${clear.held_pct}`);
  // 5.8 GHz control: the range emitter does not cover it.
  assert.equal(coverage(STATION, AREA, { link: "c2", band: "5800", ew: true }).emitter.on, false);
  const low = coverage(STATION, AREA, { link: "video", agl_m: 40 });
  const high = coverage(STATION, AREA, { link: "video", agl_m: 150 });
  assert.ok(high.held_pct > low.held_pct, `${high.held_pct} > ${low.held_pct}`);
  assert.equal(low.cells.length, clear.cells.length);
});

test("airframes in tonight's air: a cold night asks for the warmer, a mild one does not", () => {
  const cold = airframesTonight({ temp_c: -10, wind_mps: 6, elev_m: 300 });
  const mild = airframesTonight({ temp_c: 18, wind_mps: 6, elev_m: 300 });
  const a8 = (r) => r.airframes.find((a) => a.sku === "ARCHER-8");
  assert.equal(a8(cold).preheat.needed, true);
  assert.ok(a8(cold).preheat.warm_min > 0);
  assert.equal(a8(mild).preheat.needed, false);
  assert.ok(a8(cold).cold.climb_out_punch_v < a8(mild).cold.climb_out_punch_v);
  assert.equal(cold.airframes.length, 3);
  assert.equal(cold.envelope.sku, "ARCHER-8");
  // Thin hot air on high ground leaves less thrust in hand than the same wind at sea level.
  const high = airframesTonight({ temp_c: 35, wind_mps: 6, elev_m: 2500 });
  const sea = airframesTonight({ temp_c: 15, wind_mps: 6, elev_m: 0 });
  assert.ok(a8(high).thrust.headroom < a8(sea).thrust.headroom);
});
