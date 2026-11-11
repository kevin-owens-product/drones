import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { BANDS, EMITTER, ground, hop, knifeEdgeDb } from "./rf.mjs";
import { PACKS, flyPack, preheat, r0At } from "./pack.mjs";
import { density, densityAltitude, dryden, headroom } from "./envelope.mjs";
import { AIRFRAMES, power } from "./physics.mjs";

const asset = (name) => JSON.parse(readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8"));
const COMMANDER = { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"] };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"] };
const GCS = { x: -2400, y: -1350, agl: 3 };

function demo() {
  const d = createDemo({ terrain: asset("terrain.json"), attrition: asset("attrition.json") });
  return (who, path, method = "GET", body) => d.handle(method, new URL(`http://demo${path}`), body ? JSON.stringify(body) : "", who);
}

test("knife-edge loss follows ITU-R P.526: 0 dB at 60% clearance, 6 dB grazing, more when blocked", () => {
  assert.equal(knifeEdgeDb(-0.8), 0);
  assert.ok(Math.abs(knifeEdgeDb(0) - 6) < 0.1);
  assert.ok(knifeEdgeDb(2.4) > 19 && knifeEdgeDb(2.4) < 21);
});

test("the range's real terrain shadows the culvert from the GCS and leaves the ridge clear", () => {
  assert.ok(ground(-2400, -1350) > 250 && ground(-2400, -1350) < 310, "GCS ground height from SRTM");
  const ridge = hop(GCS, { x: -900, y: -1100, agl: 110 }, "915");
  const culvert = hop(GCS, { x: 2300, y: -50, agl: 60 }, "915");
  assert.ok(ridge.clearance_f1 > 0.6 && ridge.diffraction_db === 0, "ridge in clear line of sight");
  assert.ok(culvert.clearance_f1 < 0 && culvert.diffraction_db > 15, "culvert behind terrain");
  // Higher frequencies diffract worse round the same ridge.
  assert.ok(hop(GCS, { x: 2300, y: -50, agl: 60 }, "5800").diffraction_db > culvert.diffraction_db);
});

test("the EW emitter takes 900 MHz but not 5.8 GHz near the road junction", () => {
  const p = { x: 700, y: -200, agl: 90 };
  assert.ok(hop(GCS, p, "915", EMITTER).margin_db < 0);
  assert.ok(hop(GCS, p, "915", null).margin_db > 20);
  assert.equal(hop(GCS, p, "5800", EMITTER).margin_db, hop(GCS, p, "5800", null).margin_db);
  assert.equal(EMITTER.erp_dbm[BANDS[5800].id], null);
});

test("a cold pack sags further, collapses on a full climb, and preheating fixes the climb-out", () => {
  const pack = PACKS["ARCHER-8"];
  assert.ok(r0At(pack, -10) / r0At(pack, 25) > 2.5, "resistance roughly triples by -10 °C");
  const f = AIRFRAMES["ARCHER-8"];
  const trace = Array.from({ length: 60 }, (_, k) => ({ t: k * 10, watts: power(f, f.cruise_mps), air_mps: f.cruise_mps, punch_w: 480 }));
  const warm = flyPack(pack, trace, { ambient_c: 20 });
  const cold = flyPack(pack, trace, { ambient_c: -10 });
  assert.ok(cold.climb_out_punch_v_cell < pack.cutoff_v && warm.climb_out_punch_v_cell > pack.cutoff_v);
  assert.ok(cold.end.temp_c > -10 + 10, "the current heats the pack in flight");
  const advice = preheat(pack, trace, { ambient_c: -10 });
  assert.ok(advice.needed && advice.launch_c > 0 && advice.launch_c <= 35 && advice.warm_min > 0);
  assert.ok(advice.warm.climb_out_punch_v_cell >= pack.cutoff_v);
});

test("thrust headroom: density altitude from temperature, Dryden gusts, and a cold pack cuts thrust", () => {
  assert.ok(densityAltitude(density(300, 40)) > densityAltitude(density(300, -10)) + 1000);
  assert.ok(dryden(10, 30).sigma_u > dryden(10, 300).sigma_u, "rougher near the ground");
  const f = AIRFRAMES["ARCHER-8"];
  const c = { elev_m: 300, temp_c: 0, wind_mps: 8, gust_mps: 12 };
  assert.ok(headroom(f, "ARCHER-8", { ...c, cell_v: 3.0 }).headroom < headroom(f, "ARCHER-8", { ...c, cell_v: 3.7 }).headroom);
});

test("the dawn survey: terrain, cold packs and fixes that change the plan", () => {
  const call = demo();
  const check = call(COMMANDER, "/v1/missions/M-1035/physics").body;
  assert.equal(check.verdict, "no-go");
  assert.ok(check.findings.some((f) => f.area === "link" && f.tail === "NX-07" && f.fixes.some((x) => x.kind === "relay")));
  assert.ok(check.findings.some((f) => f.area === "pack" && f.fixes.some((x) => x.kind === "preheat")));
  assert.ok(check.range.places.length > 0 && check.profile.rows.length > 10);
  assert.ok(JSON.stringify(check).indexOf("_apply") === -1, "internals stay on the server");
  // An operator sees the fixes but cannot apply them.
  const relay = check.findings.flatMap((f) => f.fixes).find((x) => x.kind === "relay");
  assert.equal(call(OPERATOR, "/v1/missions/M-1035/physics", "POST", { fix: relay.id }).status, 403);
  const out = call(COMMANDER, "/v1/missions/M-1035/physics", "POST", { fix: relay.id });
  assert.equal(out.status, 200);
  const objectives = call(COMMANDER, "/v1/missions/M-1035/objectives").body.items;
  assert.ok(objectives.some((o) => o.relay && o.kind === "loiter"));
  const after = call(COMMANDER, "/v1/missions/M-1035/physics").body;
  const nx07 = after.tails.find((t) => t.tail === "NX-07");
  assert.equal(nx07.link.video_lost_s, 0, "the relay brings the culvert's video back");
  // Preheat is a launch task: it clears the pack finding and shows as a go launch check.
  const pre = after.findings.flatMap((f) => f.fixes).find((x) => x.kind === "preheat");
  call(COMMANDER, "/v1/missions/M-1035/physics", "POST", { fix: pre.id });
  const checks = call(COMMANDER, "/v1/missions/M-1035/readiness").body.checks;
  assert.ok(checks.some((c) => c.area === "physics" && c.level === "go" && /preheat planned/.test(c.detail)));
});

test("fixing an approved plan sends it back to draft for a second look", () => {
  const call = demo();
  const check = call(COMMANDER, "/v1/missions/M-1032/physics").body;
  const fix = check.findings.flatMap((f) => f.fixes).find((x) => x.changes_plan);
  const out = call(COMMANDER, "/v1/missions/M-1032/physics", "POST", { fix: fix.id });
  assert.equal(out.body.state, "draft");
  const history = call(COMMANDER, "/v1/missions/M-1032/history").body.items;
  assert.match(history.at(-1).note, /back to draft from approved/);
  assert.equal(call(COMMANDER, "/v1/missions/M-1032/physics", "POST", { fix: "alt:NX-99:0:999" }).status, 409);
});

test("under EW the check names jamming, not terrain, and offers a band the emitter does not reach", () => {
  const call = demo();
  const check = call(COMMANDER, "/v1/missions/M-1033/physics").body;
  const f = check.findings.find((x) => x.tail === "NX-04" && x.area === "link");
  assert.match(f.title, /EW emitter/);
  assert.ok(f.fixes.some((x) => x.id === "band:5800"));
  const calm = call(COMMANDER, "/v1/missions/M-1033/physics?ew=0").body;
  assert.ok(!calm.findings.some((x) => x.tail === "NX-04" && x.area === "link"));
});
