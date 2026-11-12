import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AGING, ageFrom, daysToEol, packHealth, projection } from "./aging.mjs";
import { powerParts, power, AIRFRAMES } from "./physics.mjs";
import { createDemo } from "./scenario.mjs";

const asset = (name) => JSON.parse(readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8"));

test("calendar ageing: heat and charge cost capacity, and a storage charge buys life", () => {
  const hot = packHealth({ age_days: 200, stored_days: 90, soc: 0.9, heat_c: 44 });
  const kind = packHealth({ age_days: 200, stored_days: 90, soc: 0.5, heat_c: 25 });
  assert.ok(hot.health_pct < kind.health_pct);
  assert.ok(hot.eol_days < hot.eol_days_storage_charge);
  assert.ok(hot.eol_days_storage_charge < (hot.eol_days_cool ?? Infinity));
  // Square-root time: four times the days is twice the loss.
  assert.ok(Math.abs(ageFrom(0, 400, 25, 0.5) / ageFrom(0, 100, 25, 0.5) - 2) < 1e-9);
  // Stepping through a change of conditions never loses capacity already lost.
  assert.ok(ageFrom(0.05, 0, 40, 0.9) >= 0.05 - 1e-12);
  assert.equal(daysToEol(1 - AGING.eol, 25, 0.5), 0);
  const curve = projection({ age_days: 100, stored_days: 50, soc: 0.8, heat_c: 35 });
  assert.ok(curve.every((p) => p.as_is <= p.storage && p.storage <= p.cool));
  assert.ok(curve.at(-1).as_is < curve[0].as_is);
});

test("the power split adds up to the power curve", () => {
  for (const [v, c] of [[0, 0], [14, 0], [8, 3], [16, -2]]) {
    const p = powerParts(AIRFRAMES["ARCHER-8"], v, c);
    assert.ok(Math.abs(p.induced + p.parasite + p.profile + p.climb + p.avionics - power(AIRFRAMES["ARCHER-8"], v, c)) < 1e-6);
  }
});

test("the debrief accounts for every watt-hour and prices the link over the terrain", () => {
  const demo = createDemo({ speed: 6, extra: 0, terrain: asset("terrain.json"), attrition: asset("attrition.json"), readme: "" });
  const d = demo.handle("GET", new URL("http://demo/v1/missions/M-1029/debrief"), "", null).body;
  for (const t of d.tracks) {
    const sum = Object.values(t.energy_parts).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - t.energy_wh) < 0.6, `${t.tail}: ${sum} vs ${t.energy_wh}`);
    assert.ok(t.link_margin.length > 5);
  }
  // A cold night shows up as its own slice.
  assert.ok(d.tracks.some((t) => t.energy_parts.cold > 0));
  assert.ok(d.findings.some((f) => /link loss/.test(f.title)));
});

test("the live station link is priced over the terrain", () => {
  const demo = createDemo({ speed: 6, extra: 0, terrain: asset("terrain.json"), attrition: asset("attrition.json"), readme: "" });
  const links = demo.handle("GET", new URL("http://demo/v1/operations/picture"), "", null).body.links.filter((l) => l.a === "GCS");
  assert.ok(links.length >= 6);
  assert.ok(links.every((l) => l.quality >= 0 && l.quality <= 1));
  const grid = demo.handle("GET", new URL("http://demo/v1/coverage?ll=1"), "", null).body;
  assert.equal(grid.cells[0].ll.length, 2);
  assert.equal(grid.half_deg.length, 2);
});
