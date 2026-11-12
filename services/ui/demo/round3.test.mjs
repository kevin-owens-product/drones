// Wind over terrain, camera geometry and wear by flight load: the physics behind
// the Wind map on Missions, the height ladder on Brief and the wear panel on Airframes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TERRAIN_WIND, localWind, windGrid } from "./windfield.mjs";
import { CAMERAS, NEEDS, OPTICS, heightFor, ifov, ladder, levelOf, lookFor } from "./optics.mjs";
import { WEAR, logFor, sortieWear, thrustRatio, verdictOf, wearFor } from "./wear.mjs";
import { AIRFRAMES } from "./physics.mjs";
import { ground } from "./rf.mjs";
import { PLACES } from "./intent.mjs";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";

const asset = (name) => JSON.parse(readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8"));
/** A demo with the same call shape the other tests use: (method, path, body). */
function demoOf() {
  const d = createDemo({ terrain: asset("terrain.json"), attrition: asset("attrition.json") });
  return { handle: (method, path, raw = "") => d.handle(method, new URL(`http://demo${path}`), raw, null) };
}

const STATION = { x: -2400, y: -1350 };
const place = (id) => PLACES.find((p) => p.id === id);

test("terrain wind: calm air stays calm, and the forecast scales everything", () => {
  const still = localWind(0, 0, 100, 0, 270);
  assert.equal(still.speed_mps, 0);
  assert.equal(still.vertical_mps, 0);
  const a = localWind(700, -200, 90, 5, 110);
  const b = localWind(700, -200, 90, 10, 110);
  assert.ok(Math.abs(b.speed_mps - 2 * a.speed_mps) < 1e-9);
  assert.ok(Math.abs(b.vertical_mps - 2 * a.vertical_mps) < 1e-9);
});

test("terrain wind: air sinks where the ground falls away downwind and rises where it climbs", () => {
  // Find the steepest along-wind slope on the range and check the sign both ways.
  let best = null;
  for (let x = -2000; x <= 2500; x += 100) {
    for (let y = -1500; y <= 1200; y += 100) {
      const rise = ground(x + 200, y) - ground(x - 200, y);
      if (!best || Math.abs(rise) > Math.abs(best.rise)) best = { x, y, rise };
    }
  }
  // Wind from the west blows towards +x: it climbs where the ground rises to the east.
  const west = localWind(best.x, best.y, 60, 8, 270).vertical_mps;
  const east = localWind(best.x, best.y, 60, 8, 90).vertical_mps;
  assert.equal(Math.sign(west), Math.sign(best.rise));
  assert.equal(Math.sign(east), -Math.sign(best.rise));
  // The slope-following flow fades with height faster than the shear builds it.
  assert.ok(Math.abs(localWind(best.x, best.y, 150, 8, 270).vertical_mps) < Math.abs(localWind(best.x, best.y, 30, 8, 270).vertical_mps) * 1.05);
});

test("terrain wind: the speed-up is bounded and a wake only forms below a crest upwind", () => {
  for (let x = -2000; x <= 2500; x += 300) {
    for (let y = -1500; y <= 1200; y += 300) {
      const w = localWind(x, y, 40, 10, 290);
      assert.ok(w.speedup <= TERRAIN_WIND.max_speedup && w.speedup >= -0.3);
      if (w.wake) assert.ok(w.wake_depth_m > 0 && w.crest_m > 0);
      // High above everything there is no wake.
      assert.equal(localWind(x, y, 400, 10, 290).wake, false);
    }
  }
  const g = windGrid({ x0: -400, x1: 400, y0: -400, y1: 400 }, 100, 6, 290);
  assert.equal(g.cells.length, 16);
  assert.ok(g.free_mps > 6);
});

test("plan check: the terrain's wind is in the plan's energy, the table and the map", () => {
  const demo = demoOf();
  const calm = demo.handle("GET", "/v1/missions/M-1034/physics?wind_mps=0&gust_mps=0").body;
  assert.equal(calm.wind, null);
  assert.ok(calm.tails.every((t) => t.wind === null));
  const r = demo.handle("GET", "/v1/missions/M-1034/physics?wind_mps=12&gust_mps=18&wind_from_deg=90").body;
  assert.equal(r.forecast.wind_from_deg, 90);
  assert.ok(r.wind.cells.length > 50);
  const t = r.tails.find((x) => x.tail === "NX-10");
  assert.ok(t.wind.worst_sink_mps < -1, "the junction's lee slope sinks in an east wind");
  assert.ok(t.wind.extra_wh > 0 && t.wind_track.length > 10);
  const fd = r.findings.find((x) => x.id === "wind:NX-10");
  assert.ok(fd, "a wind finding for the small pack");
  assert.equal(fd.area, "wind");
  assert.match(fd.title, /sinking air/);
  // A bigger pack is the fix on offer for a cost the height cannot remove.
  assert.ok(fd.fixes.some((x) => x.kind === "swap"));
  // The same plan in a west wind does not flag it.
  const west = demo.handle("GET", "/v1/missions/M-1034/physics?wind_mps=12&gust_mps=18&wind_from_deg=270").body;
  assert.ok(west.tails.find((x) => x.tail === "NX-10").wind.extra_wh < t.wind.extra_wh);
});

test("camera: pixels on a person fall with range, and a wide fixed camera cannot recognise from an orbit", () => {
  assert.ok(ifov(CAMERAS["ARCHER-8"]) < ifov(CAMERAS["ARCHER-5"]));
  assert.equal(levelOf(1), "none");
  assert.equal(levelOf(OPTICS.detect_px), "detect");
  assert.equal(levelOf(OPTICS.recognise_px), "recognise");
  assert.equal(levelOf(OPTICS.identify_px), "identify");
  const fpv = ladder("observe", place("T2"), "ARCHER-5");
  const eo = ladder("observe", place("T2"), "ARCHER-8");
  assert.equal(fpv.can, false);
  assert.match(fpv.why, /cannot recognise/);
  assert.equal(eo.can, true);
  for (let i = 1; i < eo.rows.length; i += 1) {
    assert.ok(eo.rows[i].px <= eo.rows[i - 1].px, "higher is further");
    assert.ok(eo.rows[i].hidden_m <= eo.rows[i - 1].hidden_m, "higher sees over more");
  }
  // An orbit goes as high as the camera still resolves from.
  assert.equal(eo.recommended_m, eo.rows.filter((r) => r.ok).at(-1).alt_m);
});

test("camera: a search flies the lowest height that closes its strips, and the video link can raise it", () => {
  const need = NEEDS.search;
  const l = ladder("search", place("B"), "ARCHER-8");
  const first = l.rows.find((r) => r.closed);
  assert.equal(l.recommended_m, first.alt_m);
  assert.ok(first.swath_m >= need.spacing_m * (1 + OPTICS.sidelap));
  assert.ok(l.rows[0].cover < 1, "at 30 m a 60 degree camera leaves gaps");
  // With the GCS in the picture, a height in a radio shadow is passed over.
  const d = ladder("survey", place("D"), "ARCHER-5");
  const linked = ladder("survey", place("D"), "ARCHER-5", STATION);
  assert.ok(linked.recommended_m >= d.recommended_m);
  assert.ok(linked.rows.find((r) => r.alt_m === linked.recommended_m).video_db >= OPTICS.video_margin_db);
  // A set height wins over the suggestion.
  const task = { kind: "survey", tails: ["NX-10"], alt_m: { "NX-10": 70 } };
  assert.equal(heightFor(task, place("D"), "NX-10", () => "ARCHER-5", STATION), 70);
  assert.equal(lookFor(task, place("D"), () => "ARCHER-5", STATION).tails[0].alt_m, 70);
  assert.equal(lookFor({ kind: "relay", tails: ["NX-05"] }, place("T3"), () => "ARCHER-8"), null);
});

test("brief: proposals carry the look, a height can be set before approval, and the plan files it", () => {
  const demo = demoOf();
  const post = (path, body) => demo.handle("POST", path, JSON.stringify(body));
  const p = post("/v1/intent/propose", { brief: "Search the north field with two vehicles" }).body;
  const look = p.plan[0].look;
  assert.ok(look.strips && look.tails.length === 2);
  const tail = look.tails[0].tail;
  assert.equal(post("/v1/intent/height", { id: p.id, task: 0, tail, alt_m: 500 }).status, 400);
  assert.equal(post("/v1/intent/height", { id: p.id, task: 0, tail: "NX-99", alt_m: 80 }).status, 400);
  const set = post("/v1/intent/height", { id: p.id, task: 0, tail, alt_m: 80 }).body;
  assert.equal(set.plan[0].look.tails.find((x) => x.tail === tail).alt_m, 80);
  const done = post("/v1/intent/approve", { id: p.id, decision: "approve" }).body;
  assert.equal(done.status, "approved");
  const legs = demo.handle("GET", `/v1/missions/${done.mission_id}/objectives`).body.items;
  assert.equal(legs.find((o) => o.tail === tail && o.kind !== "rtb").alt_m, 80);
  const other = look.tails[1];
  assert.equal(legs.find((o) => o.tail === other.tail && o.kind !== "rtb").alt_m, other.recommended_m);
  // Decided briefs are fixed.
  assert.equal(post("/v1/intent/height", { id: p.id, task: 0, tail, alt_m: 90 }).status, 409);
  // A brief's relay is filed as a relay, so the plan check routes video through it.
  const r = post("/v1/intent/propose", { brief: "Observe gate 3 with 2 drones for 20 minutes, relay on the ridge" }).body;
  const filed = post("/v1/intent/approve", { id: r.id, decision: "approve" }).body;
  const relayLeg = demo.handle("GET", `/v1/missions/${filed.mission_id}/objectives`).body.items.find((o) => o.label === "Ridge");
  assert.equal(relayLeg.relay, true);
});

test("wear: load, payload and gusts age a bearing faster than the clock, rear motors first", () => {
  const frame = AIRFRAMES["ARCHER-8"];
  assert.ok(Math.abs(thrustRatio(frame, { air_mps: 0 }) - 1) < 1e-9);
  const hover = sortieWear(frame, { minutes: 60, air_mps: 0, gust_mps: 0, landing_g: 1.2 });
  for (const m of hover.motors) assert.ok(Math.abs(m.eq_hours - 1) < 1e-9, "an hour of hover is an hour");
  const cruise = sortieWear(frame, { minutes: 60, air_mps: 16, gust_mps: 0 });
  assert.ok(cruise.motors[0].eq_hours > cruise.motors[1].eq_hours, "rear right over front right");
  assert.ok(cruise.motors[1].eq_hours < cruise.motors[0].eq_hours && cruise.motors[0].eq_hours > 1);
  const loaded = sortieWear(frame, { minutes: 60, air_mps: 16, gust_mps: 0, extra_kg: 0.3 });
  const gusty = sortieWear(frame, { minutes: 60, air_mps: 16, gust_mps: 8 });
  assert.ok(loaded.motors[0].eq_hours > cruise.motors[0].eq_hours);
  assert.ok(gusty.motors[0].eq_hours > cruise.motors[0].eq_hours);
  // Frame fatigue is the landings: one hard arrival outweighs a thousand soft ones.
  const soft = sortieWear(frame, { minutes: 10, landing_g: 1.4 }).frame;
  const hard = sortieWear(frame, { minutes: 10, landing_g: 4.5 });
  assert.ok(hard.hard && hard.frame > 1000 * soft);
  assert.ok(Math.abs(hard.frame - 4.5 ** WEAR.frame_exp / WEAR.frame_n_ref) < 1e-12);
});

test("wear: a tail's log is repeatable and its summary adds up", () => {
  assert.deepEqual(logFor("NX-01", "ARCHER-10"), logFor("NX-01", "ARCHER-10"));
  const w = wearFor("NX-01", "ARCHER-10");
  assert.equal(w.sorties, logFor("NX-01", "ARCHER-10").length);
  assert.ok(w.eq_hours > w.hours && w.load_factor > 1);
  assert.equal(w.worst.life_pct, Math.max(...w.motors.map((m) => m.life_pct)));
  assert.ok(w.worst.life_pct > w.by_hours_pct, "by load it is further along than by hours");
  assert.ok(w.hours_schedule_in > w.inspect_in);
  assert.equal(w.curve.at(-1).by_load, w.worst.life_pct);
  assert.ok(verdictOf(w).length > 20);
  // The recorded prop strike is a hard arrival in NX-08's log.
  const struck = wearFor("NX-08", "ARCHER-5", logFor("NX-08", "ARCHER-5", { strike: true }));
  assert.equal(struck.frame.hard_landings.at(-1).g, 4.6);
  assert.notEqual(struck.frame.state, "ok");
  assert.equal(wearFor("NX-01", "NO-SUCH"), null);
});

test("wear: the route lists the named tails and answers for one", () => {
  const demo = demoOf();
  const list = demo.handle("GET", "/v1/wear").body;
  assert.ok(list.items.length >= 10 && list.items.every((x) => ["ok", "inspect", "replace"].includes(x.state)));
  assert.ok(list.items.some((x) => x.state !== "ok"));
  const one = demo.handle("GET", "/v1/wear?tail=NX-01");
  assert.equal(one.status, 200);
  assert.equal(one.body.motors.length, 4);
  assert.match(one.body.source, /SIM/);
  assert.equal(demo.handle("GET", "/v1/wear?tail=ZZ-1").status, 404);
});
