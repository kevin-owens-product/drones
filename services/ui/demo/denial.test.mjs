import { test } from "node:test";
import assert from "node:assert/strict";
import { denialPicture, fly, PASSES, ZONES } from "./denial.mjs";

test("samples inside the zones are denied and few outside are", () => {
  const s = fly(PASSES[0], 11);
  const inZone = (p) => ZONES.some((z) => (p.x - z.x) ** 2 + (p.y - z.y) ** 2 <= z.r * z.r);
  const outside = s.filter((p) => !inZone(p));
  assert.ok(outside.filter((p) => p.denied).length / outside.length < 0.02);
  const inside = fly(PASSES[1], 12).filter(inZone);
  assert.ok(inside.length > 0 && inside.filter((p) => p.denied).length / inside.length > 0.9);
});

test("the brief alone routes through the unbriefed spoofing zone; the shared map routes around it", () => {
  const before = denialPicture(0);
  assert.ok(before.route_exposure.in_zone_m.S1 > 0);
  assert.equal(before.route_exposure.in_zone_m.J1, 0, "the briefed jamming zone is avoided from the start");
  const after = denialPicture(4);
  assert.deepEqual(after.route_exposure.in_zone_m, { J1: 0, S1: 0 });
  assert.ok(after.route_exposure.length_m < before.route_exposure.length_m * 1.15);
  assert.match(after.source, /simulated/i);
});

test("across 100 seeds four passes keep both zones off the route and the map honest", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const p = denialPicture(4, seed);
    assert.deepEqual(p.route_exposure.in_zone_m, { J1: 0, S1: 0 }, `seed ${seed}`);
    assert.ok(p.score.precision >= 0.85 && p.score.recall >= 0.85, `seed ${seed}`);
  }
});
