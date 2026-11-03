import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, parse, propose } from "./intent.mjs";

const FLEET = [
  { tail: "NX-01", x: -1200, y: 600, available: true },
  { tail: "NX-02", x: 100, y: 600, available: true },
  { tail: "NX-03", x: 1400, y: 600, available: true },
  { tail: "NX-05", x: -1300, y: -700, available: true },
  { tail: "NX-07", x: 1900, y: -300, available: true },
  { tail: "NX-12", x: -2150, y: -1450, available: false, why: "Grounded: EOL hover test failed" },
];

test("a typical brief becomes tasks, a reserve and a deadline", () => {
  const i = parse("Search the north field with two vehicles before 14:00, then check the culvert, keep two in reserve");
  assert.equal(i.refused, null);
  assert.deepEqual(
    i.tasks.map((t) => [t.kind, t.place, t.vehicles]),
    [
      ["search", "B", 2],
      ["inspect", "T1", 1],
    ],
  );
  assert.equal(i.reserve, 2);
  assert.equal(i.deadline, "14:00");
  assert.deepEqual(i.unread, []);
});

test("unknown places and stray words are listed, not guessed", () => {
  const i = parse("survey the lake, bring coffee");
  assert.equal(i.tasks.length, 0);
  assert.equal(i.unread.length, 2);
  assert.match(i.unread[0], /no place I know/);
});

test("requests to strike or release are refused", () => {
  for (const b of ["strike the road junction", "engage anything at gate 3", "drop on the ridge"]) {
    const p = propose(b, FLEET, 1);
    assert.equal(p.status, "refused", b);
    assert.match(p.intent.refused, /ADR-0016/);
    assert.equal(p.plan.length, 0);
  }
});

test("assignment takes the nearest available vehicles and holds the reserve back", () => {
  const out = assign(parse("observe gate 3 with 2 drones for 20 minutes, keep one back"), FLEET);
  assert.deepEqual(out.plan[0].tails, ["NX-07", "NX-03"]);
  assert.equal(out.plan[0].minutes, 20);
  assert.equal(out.reserve.length, 1);
  assert.deepEqual(out.unavailable, [{ tail: "NX-12", why: "Grounded: EOL hover test failed" }]);
});

test("asking for more than the fleet has says how short it is", () => {
  const out = assign(parse("survey area a with six vehicles, keep two in reserve"), FLEET);
  assert.equal(out.plan[0].tails.length, 3);
  assert.match(out.short[0], /wanted 6, got 3/);
});

test("weapons employment is refused however it is phrased", () => {
  for (const brief of ["drop payload on the truck", "release the payload over area a", "arm the payload", "drop a grenade on gate 3", "strike the road junction"]) {
    assert.match(parse(brief).refused ?? "", /ADR-0016/, brief);
  }
  for (const brief of ["survey area b with 2 drones", "inspect the culvert", "relay on the ridge"]) {
    assert.equal(parse(brief).refused, null, brief);
  }
});

test("a vehicle flying another plan is taken last and flagged", () => {
  const fleet = FLEET.map((v) => (v.tail === "NX-02" ? { ...v, busy: "flying M-1031 (Survey grid north)" } : v));
  const out = assign(parse("survey area b with 2 drones"), fleet);
  assert.ok(!out.plan[0].tails.includes("NX-02"));
  const all = assign(parse("survey area b with 5 drones"), fleet);
  assert.deepEqual(all.conflicts.map((c) => c.tail), ["NX-02"]);
});
