import assert from "node:assert/strict";
import { test } from "node:test";
import { createResponder, SPEED } from "./dfr.mjs";
import { verifyChain } from "./ledger.mjs";

const SUP = { display_name: "Supervisor", roles: ["mission_commander"], org: "CUS-D" };
const PILOT = { display_name: "Pilot", roles: ["operator"], org: "CUS-D" };
const OTHER = { display_name: "Commander A", roles: ["mission_commander"], org: "CUS-A" };
const T0 = Date.parse("2026-11-03T15:00:00Z");

function launched() {
  const r = createResponder({ now: T0 });
  const call = r.view(SUP, T0).queue[0];
  assert.equal(r.act("call.approve", { id: call.id }, SUP, T0).status, 200);
  assert.equal(r.act("call.launch", { id: call.id }, PILOT, T0 + 5_000).status, 200);
  const flight = r.flights.at(-1);
  return { r, call, flight };
}

test("the queue opens on the priority-1 call with the nearest ready dock picked by flight time", () => {
  const r = createResponder({ now: T0 });
  const v = r.view(SUP, T0);
  assert.equal(v.queue[0].priority, 1);
  assert.equal(v.queue[0].dock, "D1");
  // Dock 3 is charging under the 60% launch floor, so it is never picked.
  assert.ok(v.queue.every((c) => c.dock !== "D3"));
  assert.equal(v.docks.find((d) => d.id === "D3").state, "charging");
});

test("only a supervisor approves, and only the pilot launches", () => {
  const r = createResponder({ now: T0 });
  const id = r.view(SUP, T0).queue[0].id;
  assert.equal(r.act("call.approve", { id }, PILOT, T0).status, 403);
  assert.equal(r.act("call.launch", { id }, PILOT, T0).status, 409, "not approved yet");
  assert.equal(r.act("call.approve", { id }, SUP, T0).status, 200);
  assert.equal(r.act("call.launch", { id }, SUP, T0).status, 403);
  assert.equal(r.act("call.launch", { id }, PILOT, T0).status, 200);
});

test("the pilot's decline needs a reason and stands; the supervisor cannot decline or approve it back", () => {
  const r = createResponder({ now: T0 });
  const id = r.view(SUP, T0).queue[1].id;
  assert.equal(r.act("call.decline", { id, reason: "weather" }, PILOT, T0).status, 400);
  assert.equal(r.act("call.decline", { id, reason: "weather", note: "Fog bank over the gate" }, SUP, T0).status, 403);
  assert.equal(r.act("call.decline", { id, reason: "weather", note: "Fog bank over the gate" }, PILOT, T0).status, 200);
  assert.equal(r.act("call.approve", { id }, SUP, T0).status, 409);
  assert.ok(r.records().declined.some((d) => d.call === id && d.by_role === "RPIC"));
});

test("gusts past the waiver limit raise a no-go on scene; only the pilot can end the flight", () => {
  const { r, flight } = launched();
  const onScene = Date.parse(r.flightState(flight, T0 + 5_000 + 60_000).on_scene_at ?? 0) || flight.launched_at + 20_000;
  const later = onScene + Math.ceil((45 / SPEED) * 1000);
  const s = r.flightState(flight, later);
  assert.equal(s.phase, "on_scene");
  assert.equal(s.alert?.level, "no-go");
  assert.equal(r.act("flight.terminate", { id: flight.id, reason: "gusts" }, SUP, later).status, 403);
  assert.equal(r.act("flight.terminate", { id: flight.id, reason: "Gusts 13.4 m/s over the 12 m/s limit" }, PILOT, later).status, 200);
  assert.equal(r.flightState(flight, later + 1000).phase, "returning");
});

test("a flight turned back on the way out flies home from where it was, not from the scene", () => {
  const { r, flight } = launched();
  const out = flight.launched_at + Math.ceil((40 / SPEED) * 1000);
  assert.equal(r.flightState(flight, out).phase, "en_route");
  r.act("flight.terminate", { id: flight.id, reason: "Link warning" }, PILOT, out);
  const s = r.flightState(flight, out + 1);
  assert.equal(s.phase, "returning");
  assert.equal(s.on_scene_at, null);
});

test("a record files once the aircraft is docked, prefilled from the flight; a correction is a new sealed version", () => {
  const { r, flight } = launched();
  const rec = r.records(T0).items.find((x) => x.flight === flight.id);
  assert.equal(r.act("record.file", { id: rec.id, narrative: "Too early to say much" }, PILOT, T0 + 10_000).status, 409);
  r.act("flight.release", { id: flight.id }, SUP, flight.launched_at + 30_000);
  const docked = Date.parse(r.flightState(flight, flight.launched_at + 30_000).docked_at ?? 0) || flight.launched_at + 60_000;
  const after = Math.max(docked, flight.launched_at + 60_000) + 1000;
  assert.equal(r.act("record.file", { id: rec.id, narrative: "short" }, PILOT, after).status, 400);
  assert.equal(r.act("record.file", { id: rec.id, narrative: "Person located at the seawall ladder; units guided in." }, SUP, after).status, 403);
  assert.equal(r.act("record.file", { id: rec.id, narrative: "Person located at the seawall ladder; units guided in." }, PILOT, after).status, 200);
  assert.equal(r.act("record.file", { id: rec.id, narrative: "Person located at the seawall ladder; units guided in." }, PILOT, after).status, 409);
  assert.equal(r.act("record.amend", { id: rec.id, narrative: "Person located at the north ladder; units guided in." }, PILOT, after + 1).status, 400, "a correction needs a reason");
  assert.equal(r.act("record.amend", { id: rec.id, narrative: "Person located at the north ladder; units guided in.", why: "Wrong ladder in v1" }, PILOT, after + 2).status, 200);
  const filed = r.records(after + 3).items.find((x) => x.id === rec.id);
  assert.equal(filed.versions.length, 2);
  assert.equal(filed.fields.rpic, "J. Park");
  assert.equal(filed.fields.incident, r.calls.find((c) => c.id === flight.call).incident);
  const chain = r.evidence.items();
  assert.equal(verifyChain(chain), -1);
  chain[chain.length - 2].detail = chain[chain.length - 2].detail.replace("seawall", "pier");
  assert.notEqual(verifyChain(chain), -1, "an edited record breaks the chain");
});

test("another customer cannot read or act on the program", () => {
  const r = createResponder({ now: T0 });
  assert.equal(r.handle("GET", new URL("http://x/v1/dfr"), "", OTHER).status, 403);
  assert.equal(r.handle("POST", new URL("http://x/v1/dfr/act"), JSON.stringify({ action: "feed.next" }), OTHER).status, 403);
  assert.equal(r.handle("GET", new URL("http://x/v1/dfr"), "", SUP).status, 200);
});
