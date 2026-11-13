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

// ---- Phase 2: shift, roster, currency, mishaps, structures ----

test("the water-rescue route from Dock 1 climbs over Crane row B, and says so in the pre-flight", () => {
  const r = createResponder({ now: T0 });
  const id = r.view(SUP, T0).queue[0].id;
  r.act("call.approve", { id }, SUP, T0);
  const pre = r.view(PILOT, T0).queue.find((c) => c.id === id).preflight;
  const crane = pre.checks.find((x) => x.text.includes("Crane row B"));
  assert.equal(crane.level, "caution");
  assert.match(crane.text, /90 m/);
  assert.equal(pre.go, true, "a caution does not stop the launch");
});

test("signing the shift log seals it on the evidence chain and hands the console to the next rostered pilot; nothing is approved until they start", () => {
  const r = createResponder({ now: T0 });
  assert.equal(r.act("shift.end", {}, SUP, T0).status, 403);
  const end = r.act("shift.end", {}, PILOT, T0 + 60_000);
  assert.equal(end.status, 200);
  const logs = r.records().shift_logs;
  assert.equal(logs[0].status, "open", "the next shift's log is open");
  const signed = logs.find((l) => l.id === "SH-2026-11-03");
  assert.equal(signed.status, "signed");
  assert.ok(signed.hash);
  assert.equal(verifyChain(r.evidence.items()), -1);
  assert.equal(r.shift.rpic, "P-03", "Whitfield is rostered for the next day");
  const id = r.view(SUP, T0 + 120_000).queue[0].id;
  assert.equal(r.act("call.approve", { id }, SUP, T0 + 120_000).status, 409, "no pilot on console yet");
  assert.equal(r.act("shift.start", {}, PILOT, T0 + 180_000).status, 200);
  assert.equal(r.act("call.approve", { id }, SUP, T0 + 200_000).status, 200);
});

test("the roster refuses a pilot with an expired TWIC and a not-yet-solo pilot without a supervising pilot", () => {
  const r = createResponder({ now: T0 });
  const day = "2026-11-08";
  assert.equal(r.act("roster.assign", { date: day, pilot: "P-02" }, PILOT, T0).status, 403, "only the program manager sets the roster");
  const reyes = r.act("roster.assign", { date: day, pilot: "P-01" }, SUP, T0);
  assert.equal(reyes.status, 409);
  assert.match(reyes.body.detail, /TWIC/);
  assert.equal(r.act("roster.assign", { date: day, pilot: "P-04" }, SUP, T0).status, 409);
  assert.equal(r.act("roster.assign", { date: day, pilot: "P-04", supervised_by: "P-03" }, SUP, T0).status, 200);
  const crew = r.crew.view();
  assert.equal(crew.counts.coverage_gaps, 0, "the empty day is now filled");
});

test("the program manager signs a ready pilot off for solo shifts once, and that clears the unsupervised day", () => {
  const r = createResponder({ now: T0 });
  const before = r.crew.view().roster.find((d) => d.date === "2026-11-12");
  assert.ok(before.flags.some((f) => /not cleared for solo/.test(f)));
  assert.equal(r.act("crew.certify", { pilot: "P-04" }, PILOT, T0).status, 403);
  assert.equal(r.act("crew.certify", { pilot: "P-01" }, SUP, T0).status, 409, "an expired TWIC blocks sign-off");
  assert.equal(r.act("crew.certify", { pilot: "P-04" }, SUP, T0).status, 200);
  assert.equal(r.act("crew.certify", { pilot: "P-04" }, SUP, T0).status, 409, "already signed off");
  const after = r.crew.view().roster.find((d) => d.date === "2026-11-12");
  assert.deepEqual(after.flags, []);
});

test("a mishap is verbal at once and written within 24 hours; injury or more than $500 of damage makes it FAA reportable", () => {
  const r = createResponder({ now: T0 });
  assert.equal(r.act("mishap.report", { tail: "DFR-02", text: "Prop strike on the dock lid" }, SUP, T0).status, 403);
  const rep = r.act("mishap.report", { tail: "DFR-02", kind: "Prop strike", text: "Prop strike on the dock lid" }, PILOT, T0);
  assert.equal(rep.status, 200);
  const m = r.mishaps[0];
  assert.equal(r.act("mishap.file", { id: m.id, text: "short" }, PILOT, T0).status, 400);
  const minor = r.act("mishap.file", { id: m.id, text: "Propeller touched the dock lid on landing; one blade replaced.", damage_usd: 120 }, PILOT, T0 + 3600_000);
  assert.equal(minor.status, 200);
  assert.match(minor.body.message ?? JSON.stringify(minor.body), /Not reportable/);
  const ms7 = r.act("mishap.file", { id: "MS-7", text: "Hard landing on Dock 3 lip; dock lid hinge bent, contractor quote $1,800.", damage_usd: 1800 }, PILOT, T0);
  assert.match(ms7.body.message ?? JSON.stringify(ms7.body), /FAA within 10 days/);
  assert.equal(r.records().mishaps.find((x) => x.id === "MS-7").faa_reportable, true);
});

// ---- Phase 3: the month, care, retention, records requests, the contractor seat ----

const CTR = { display_name: "Contractor", roles: ["contractor"], org: "CUS-D" };
const get = (r, path, who) => r.handle("GET", new URL(`http://demo${path}`), "", who);

test("the invoice comes from the signed shift logs: unstaffed and not-current hours are not payable, and a shift with an unfiled record is held until it is filed", () => {
  const r = createResponder({ now: T0 });
  const m = get(r, "/v1/dfr/program", SUP).body;
  const line = (date) => m.invoice.lines.find((l) => l.date === date);
  assert.equal(m.invoice.lines.length, 31, "every October shift");
  assert.equal(line("2026-10-19").billable_h, 0, "nobody on console");
  assert.match(line("2026-10-31").notes[0], /TWIC lapsed/, "Reyes worked after his TWIC expired");
  assert.equal(line("2026-10-31").billable_h, 0);
  assert.deepEqual(line("2026-10-30").held_for, ["FR-38"]);
  const before = m.invoice.totals.amount_usd;
  assert.equal(r.act("record.file", { id: "FR-38", narrative: "Seal cut on a container at block 12; units found the door closed and the seal replaced." }, PILOT, T0).status, 200);
  const after = get(r, "/v1/dfr/program", SUP).body.invoice;
  assert.equal(after.totals.held_h, 0);
  assert.equal(after.totals.amount_usd, before + 12 * after.rate_usd, "the held shift is released once its record is filed");
});

test("the contractor submits the month and the program manager approves or returns it; neither can do the other's part", () => {
  const r = createResponder({ now: T0 });
  assert.equal(r.act("month.submit", {}, SUP, T0).status, 403);
  assert.equal(r.act("month.submit", {}, CTR, T0).status, 200);
  assert.equal(r.act("month.approve", {}, CTR, T0).status, 403);
  assert.equal(r.act("month.return", { note: "no" }, SUP, T0).status, 409, "a return needs a reason");
  assert.equal(r.act("month.return", { note: "File FR-38 first" }, SUP, T0).status, 200);
  assert.equal(r.act("month.submit", {}, CTR, T0 + 1).status, 200, "resubmitted");
  assert.equal(r.act("month.approve", {}, SUP, T0 + 2).status, 200);
  assert.equal(get(r, "/v1/dfr/program", SUP).body.status, "approved");
  assert.equal(verifyChain(r.evidence.items()), -1);
});

test("the contractor seat sees its pilots and its invoice, never the console or incident records; the pilot never sees the invoice", () => {
  const r = createResponder({ now: T0 });
  assert.equal(get(r, "/v1/dfr", CTR).status, 403);
  assert.equal(get(r, "/v1/dfr/records", CTR).status, 403);
  assert.equal(get(r, "/v1/dfr/crew", CTR).status, 200);
  assert.equal(get(r, "/v1/dfr/program", CTR).status, 200);
  assert.equal(get(r, "/v1/dfr/program", PILOT).status, 403);
  assert.equal(r.act("call.approve", { id: r.view(SUP, T0).queue[0].id }, CTR, T0).status, 403);
});

test("a TWIC renewal makes a pilot assignable again, but the days it was lapsed stay unpayable", () => {
  const r = createResponder({ now: T0 });
  assert.equal(r.act("roster.assign", { date: "2026-11-08", pilot: "P-01" }, SUP, T0).status, 409);
  assert.equal(r.act("crew.renew", { pilot: "P-01", item: "twic", value: "2026-10-01" }, CTR, T0).status, 409, "a renewal expires in the future");
  assert.equal(r.act("crew.renew", { pilot: "P-01", item: "twic", value: "2031-11-02" }, PILOT, T0).status, 403);
  assert.equal(r.act("crew.renew", { pilot: "P-01", item: "twic", value: "2031-11-02" }, CTR, T0).status, 200);
  assert.equal(r.act("roster.assign", { date: "2026-11-08", pilot: "P-01" }, SUP, T0).status, 200);
  const line = get(r, "/v1/dfr/program", SUP).body.invoice.lines.find((l) => l.date === "2026-10-31");
  assert.equal(line.billable_h, 0);
});

test("an overdue care check is a caution; a failed pack grounds the aircraft until a passing check is signed", () => {
  const r = createResponder({ now: T0 });
  assert.ok(r.view(PILOT, T0).checklist.some((c) => c.level === "caution" && /DFR-04 weekly/.test(c.text)));
  assert.equal(r.act("care.sign", { tail: "DFR-01", health_pct: 76, spread_mv: 12 }, SUP, T0).status, 403);
  assert.equal(r.act("care.sign", { tail: "DFR-01", health_pct: 76, spread_mv: 12 }, PILOT, T0).status, 200);
  const v = r.view(SUP, T0);
  assert.equal(v.docks.find((d) => d.id === "D1").state, "grounded");
  assert.notEqual(v.queue.find((c) => c.kind === "Water rescue").dock, "D1", "the nearest dock is skipped while grounded");
  assert.equal(r.act("care.sign", { tail: "DFR-01", health_pct: 98, spread_mv: 4, notes: "New pack" }, PILOT, T0).status, 200);
  assert.equal(r.view(SUP, T0).docks.find((d) => d.id === "D1").state, "ready");
});

test("a records request gathers the filed record, redacts plates, phones and private names, and is released once with a sealed manifest", () => {
  const r = createResponder({ now: T0 });
  const ask = { requester: "Harbor Gazette", number: "PRA-2026-118", incident: "26-111301" };
  assert.equal(r.act("request.create", ask, PILOT, T0).status, 403);
  assert.equal(r.act("request.create", ask, SUP, T0).status, 200);
  const q = r.records(T0).requests[0];
  const narrative = q.items[0].fields.narrative;
  assert.ok(!/8KTR214|555-0142|Alvarez/.test(narrative), narrative);
  assert.deepEqual(q.items[0].redacted.sort(), ["licence plate", "phone number", "private person's name"]);
  assert.equal(q.items[0].sha256, r.records(T0).items.find((x) => x.id === "FR-41").versions[0].hash, "the manifest names the sealed version");
  assert.equal(r.act("request.release", { id: q.id }, SUP, T0).status, 200);
  assert.equal(r.act("request.release", { id: q.id }, SUP, T0).status, 409);
  assert.equal(r.evidence.items().at(-1).action, "request.release");
});

test("a legal hold is the custodian's, needs a matter, and shows on the record", () => {
  const r = createResponder({ now: T0 });
  assert.equal(r.act("record.hold", { id: "FR-41", matter: "Claim 26-CV-0413" }, PILOT, T0).status, 403);
  assert.equal(r.act("record.hold", { id: "FR-41", matter: "x" }, SUP, T0).status, 409);
  assert.equal(r.act("record.hold", { id: "FR-41", matter: "Claim 26-CV-0413" }, SUP, T0).status, 200);
  assert.equal(r.records(T0).items.find((x) => x.id === "FR-41").retention.hold.matter, "Claim 26-CV-0413");
  assert.equal(r.act("record.release_hold", { id: "FR-41" }, SUP, T0).status, 200);
  assert.equal(r.records(T0).items.find((x) => x.id === "FR-41").retention.hold, null);
});
