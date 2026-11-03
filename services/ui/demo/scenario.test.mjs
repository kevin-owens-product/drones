import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "./scenario.mjs";

const get = (demo, path) => demo.handle("GET", new URL(path, "http://x")).body;

test("the picture labels itself simulated and covers every layer", () => {
  const p = get(createDemo(), "/v1/operations/picture");
  assert.match(p.source, /simulated/i);
  assert.equal(p.areas.length, 4);
  assert.equal(p.tasks.length, 4);
  assert.ok(p.tasks.every((t) => t.tail !== null), "every task has an owner when the network is whole");
  assert.equal(p.zones[0].kind, "gnss_jamming");
});

test("the vehicle on VIO reports a growing position error; GNSS vehicles a small one", () => {
  const items = get(createDemo(), "/v1/telemetry/live").items;
  const vio = items.find((i) => i.tail_number === "NX-04");
  const gnss = items.find((i) => i.tail_number === "NX-01");
  assert.equal(vio.gnss_trusted, false);
  assert.ok(vio.pos_sigma_m > gnss.pos_sigma_m);
});

test("synthetic fleet adds vehicles and registry rows only when asked", () => {
  assert.equal(get(createDemo(), "/v1/platforms").items.length, 12);
  assert.equal(get(createDemo({ extra: 50 }), "/v1/platforms").items.length, 62);
});

test("unknown routes answer with an empty list, training errors with 400", () => {
  const demo = createDemo();
  assert.deepEqual(get(demo, "/v1/nothing"), { items: [] });
  assert.equal(demo.handle("GET", new URL("/v1/training/state", "http://x")).status, 400);
});
