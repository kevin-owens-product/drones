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

test("attrition: report served as baked, hold recorded once, nothing without a bake", async () => {
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(await readFile(new URL("./assets/attrition.json", import.meta.url), "utf8"));
  const demo = createDemo({ attrition: report });
  const body = get(demo, "/v1/attrition");
  assert.match(body.source, /simulated/i);
  assert.ok(body.autopsy.alerts.length >= 1);
  const alert = body.autopsy.alerts[0];
  const post = (msg) => demo.handle("POST", new URL("/v1/attrition/hold", "http://x"), JSON.stringify(msg));
  assert.equal(post({ attribute: alert.attribute, value: alert.value, by: "Demo Operator" }).status, 200);
  post({ attribute: alert.attribute, value: alert.value, by: "Demo Operator" });
  assert.equal(get(demo, "/v1/attrition").holds.length, 1);
  assert.equal(post({ attribute: "esc_lot", value: "nope" }).status, 404);
  assert.equal(createDemo().handle("GET", new URL("/v1/attrition", "http://x")).status, 404);
});

test("the performance model: NX-06 calls bingo and turns for home, the others report energy, wind and link", () => {
  const items = get(createDemo(), "/v1/telemetry/live").items;
  const low = items.find((i) => i.tail_number === "NX-06");
  assert.equal(low.bingo, true);
  assert.equal(low.mode, "RTL");
  assert.ok(low.endurance_min < low.home_min + 3);
  const ok = items.find((i) => i.tail_number === "NX-01");
  assert.ok(ok.air_mps > 0 && ok.wind_mps > 0 && ok.power_w > 50 && ok.pack_v > 20 && ok.link_margin_db > 0);
  assert.ok(Math.abs(ok.heading_deg - ok.heading_deg) < 1e-9);
  const physics = get(createDemo(), "/v1/physics");
  assert.ok(physics.airframes["ARCHER-8"].hover_w > physics.airframes["ARCHER-5"].hover_w);
  assert.ok(physics.curves["ARCHER-8"].length > 20);
});

test("launch checks price a plan's energy against the pack, and refuse one that cannot fly", () => {
  const demo = createDemo();
  const who = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"] };
  const checks = demo.handle("GET", new URL("/v1/missions/M-1034/readiness", "http://x"), "", who).body.checks;
  assert.ok(checks.some((c) => c.level === "no-go" && /energy: the \d+-minute plan needs/.test(c.detail)));
  const fine = demo.handle("GET", new URL("/v1/missions/M-1032/readiness", "http://x"), "", who).body.checks;
  assert.ok(fine.some((c) => c.level === "go" && /energy: .* lands near \d+%/.test(c.detail)));
});
