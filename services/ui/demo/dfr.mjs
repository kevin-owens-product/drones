// Drone as first responder (DFR): a public safety program that flies docked
// aircraft from a remote console. A call comes in from dispatch, a supervisor
// approves the launch, the remote pilot in command (RPIC) launches the nearest
// ready dock, flies to the scene, and files a flight record before the shift
// ends. The supervisor directs the work; the pilot alone decides whether a
// flight is safe and lawful, and that call cannot be overridden by anyone.
//
// Why it is here: agencies now buy docked, remote-console operations as a
// staffed service, and the system of record they run it on has to carry split
// launch authority, a per-flight record with set fields, and records that hold
// up as evidence. Those are the same primitives a defense unit needs (launch
// authority, crew currency, evidence-grade logs), so the platform carries them
// once and a program picks its operating mode: "defense" or "public_safety".
//
// Everything is simulated (SIM): the harbor is a schematic, the docks, aircraft,
// pilots, calls and weather are made up, and no aircraft is commanded from here.
// Pure JavaScript, no Node imports: runs behind demo/server.mjs and in the page.

import { createLedger, can, RESPONDER_ORGS, verifyChain } from "./ledger.mjs";
import { TODAY } from "./company.mjs";
import { createCrew } from "./dfrcrew.mjs";
import { createProgram, history, RETENTION } from "./dfrprogram.mjs";

/** The public safety program in the demo, and the contractor that staffs its console. */
export const PROGRAM = { id: "CUS-D", name: "Customer D: Harbor police DFR program (SIM)", mode: "public_safety" };
export { RESPONDER_ORGS };

/** Sim seconds per wall-clock second, so a three-minute flight plays in about thirty seconds. */
export const SPEED = 6;
/** Cruise speed of the docked quad, m/s; launch is door open, climb and clear. */
const CRUISE_MPS = 15;
const LAUNCH_S = 20;
/** Battery use in flight, percent per sim second (about 1.1% a minute), and the reserve to land with. */
const DRAIN_PER_S = 0.018;
const RESERVE_PCT = 20;
/** The waiver's wind limit the flight is checked against (COA condition, SIM). */
export const LIMITS = { wind_mps: 10, gust_mps: 12, visibility_km: 5, ceiling_ft: 1000 };
const WEATHER = { wind_mps: 7, wind_from_deg: 270, gust_mps: 10, visibility_km: 10, ceiling_ft: 2500, precip: "none" };

/** A schematic harbor, local metres (x east, y north). Not a real port's layout. */
export const MAP = {
  width_m: 6000,
  height_m: 4000,
  water: [
    // main channel and two basins
    [[0, 1600], [6000, 1600], [6000, 2300], [0, 2300]],
    [[1400, 2300], [2300, 2300], [2300, 3400], [1400, 3400]],
    [[3600, 600], [4400, 600], [4400, 1600], [3600, 1600]],
  ],
  places: [
    { id: "berth-87", label: "Berth 87 seawall", x: 2350, y: 2900 },
    { id: "gate-4", label: "Terminal gate 4", x: 4700, y: 900 },
    { id: "rail-row", label: "Rail right-of-way, Mile 2", x: 1000, y: 700 },
    { id: "anchorage-b", label: "Anchorage B", x: 5600, y: 1950 },
    { id: "block-12", label: "Container yard block 12", x: 3100, y: 1100 },
    { id: "berth-55", label: "Berth 55 pier", x: 800, y: 2500 },
    { id: "cruise-term", label: "Cruise terminal", x: 1900, y: 3700 },
  ],
  // Tall things the transit has to clear: the console checks each route against them (heights AGL, SIM).
  structures: [
    { id: "crane-b", label: "Crane row B", x0: 2150, y0: 2400, x1: 2250, y1: 3300, height_m: 75 },
    { id: "stacks", label: "Container stacks", x0: 3800, y0: 900, x1: 4300, y1: 1300, height_m: 25 },
    { id: "bridge", label: "Bridge towers", x0: 2900, y0: 1500, x1: 3000, y1: 2400, height_m: 110 },
  ],
};
/** Transit height and the clearance kept over any structure on the route. */
const TRANSIT_M = 60;
const CLEAR_M = 15;
/** Airspace and harbor activity the shift starts against (SIM). */
const AIRSPACE = [
  { level: "caution", text: "TFR over the cruise terminal, surface to 3,000 ft, until 12:00 local (dignitary arrival). Calls there are declined until it lifts." },
  { level: "ok", text: "NOTAM: crane at Berth 90 raised to 95 m AGL until 20 Nov. Not on a dock route." },
  { level: "ok", text: "Bridge lift 14:00 to 14:20 local; vessel traffic in the main channel. No effect on transit heights." },
];
const CHANNELS = "Harbor 1 (dispatch), Air 2 (air operations)";

const DOCKS = [
  { id: "D1", name: "Dock 1: West basin", x: 1300, y: 2700, tail: "DFR-01" },
  { id: "D2", name: "Dock 2: Container terminal", x: 3300, y: 1300, tail: "DFR-02" },
  { id: "D3", name: "Dock 3: Main channel east", x: 5200, y: 2500, tail: "DFR-03" },
  { id: "D4", name: "Dock 4: North yard", x: 2000, y: 600, tail: "DFR-04" },
];

/** Contract pilots on the console (names are made up). P-02 is the demo pilot login. */
export const PILOTS = [
  { id: "P-01", name: "A. Reyes" },
  { id: "P-02", name: "J. Park" },
  { id: "P-03", name: "S. Whitfield" },
  { id: "P-04", name: "T. Nguyen" },
];
const SUPERVISOR = "Sgt. M. Ortega";

/** The dispatch feed: calls for service as computer-aided dispatch would send them (SIM). */
const FEED = [
  { kind: "Water rescue", place: "berth-87", priority: 1, text: "Person in the water off the seawall, caller lost sight of them" },
  { kind: "Suspicious vehicle", place: "gate-4", priority: 2, text: "Vehicle parked at the gate for 40 minutes, occupant walking the fence line" },
  { kind: "Trespass", place: "rail-row", priority: 3, text: "Two people walking the rail right-of-way toward the yard" },
  { kind: "Vessel fire", place: "anchorage-b", priority: 1, text: "Smoke reported from a small vessel at anchor" },
  { kind: "Theft in progress", place: "block-12", priority: 2, text: "Security reports a container door open and a truck backed up to it" },
  { kind: "Injured worker", place: "berth-55", priority: 1, text: "Longshore worker fell from a ladder on the pier, ambulance en route" },
];

export const DECLINE_REASONS = ["weather", "airspace", "aircraft", "battery", "other"];

const r1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const iso = (ms) => new Date(ms).toISOString();
function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} [o]
 * @param {number} [o.now] when the scenario opened (ms)
 * @param {{append: Function}} [o.audit] the platform audit log, which records each DFR decision too
 */
export function createResponder(o = {}) {
  const opened = o.now ?? Date.now();
  const audit = o.audit ?? createLedger();
  // The shift opened three hours ago and runs twelve: one pilot on console, one supervisor approving.
  const crew = createCrew({ today: TODAY });
  const shift = { id: `SH-${TODAY}`, date: TODAY, start: opened - 3 * 3600_000, end: opened + 9 * 3600_000, rpic: "P-02", supervisor: SUPERVISOR, started_at: null, checklist: [], docks_at_start: [], discrepancies: [] };
  const shiftLogs = [];
  const mishaps = [];
  const docks = DOCKS.map((d, i) => ({ ...d, power: "on", comms: "ok", door: "closed", charge: [96, 100, 48, 91][i], cycles: [212, 188, 240, 97][i] }));
  const calls = [];
  const flights = [];
  const records = [];
  // Evidence chain: every filed flight record and every correction, hashed onto the one before it.
  const evidence = createLedger();
  let fed = 0;
  let callSeq = 1000;
  let flightSeq = 40;

  const place = (id) => MAP.places.find((p) => p.id === id);
  const dockOf = (id) => docks.find((d) => d.id === id);
  const pilotName = (id) => PILOTS.find((p) => p.id === id)?.name ?? id;
  // The month: care log, retention and holds, records requests, the activity report and the invoice (demo/dfrprogram.mjs).
  const program = createProgram({ today: () => shift.date, evidence, pilotName });

  function receive(at) {
    const f = FEED[fed % FEED.length];
    fed += 1;
    callSeq += 1;
    const p = place(f.place);
    const c = { id: `C-${callSeq}`, incident: `26-${String(110300 + callSeq).slice(-6)}`, kind: f.kind, priority: f.priority, text: f.text, place: p.label, x: p.x, y: p.y, received_at: at, status: "waiting", order: callSeq, history: [] };
    calls.push(c);
    return c;
  }

  // ---- Seed: two flights earlier this shift (one record filed, one still to file) and one request declined. ----
  function seed() {
    const t0 = shift.start;
    const early = [
      { kind: "Suspicious vehicle", place: "block-12", priority: 2, text: "Pickup driving between stacks with lights off", at: t0 + 35 * 60_000, dock: "D2", minutes: 14, narrative: "Arrived 74 s after launch. Pickup parked between rows 11 and 12, two occupants, no cargo movement. Units arrived and identified a terminal security patrol, plate 8KTR214; the driver, Mr. Alvarez, gave a callback of 310-555-0142. Released by supervisor.", filed: true },
      { kind: "Alarm", place: "gate-4", priority: 2, text: "Perimeter alarm at the gate, no one on camera", at: t0 + 102 * 60_000, dock: "D2", minutes: 11, narrative: null, filed: false },
    ];
    for (const e of early) {
      callSeq += 1;
      const p = place(e.place);
      const c = { id: `C-${callSeq}`, incident: `26-${String(110300 + callSeq).slice(-6)}`, kind: e.kind, priority: e.priority, text: e.text, place: p.label, x: p.x, y: p.y, received_at: e.at, status: "flown", order: callSeq, history: [] };
      calls.push(c);
      const d = dockOf(e.dock);
      const transit = dist(d, c) / CRUISE_MPS;
      flightSeq += 1;
      const launch = e.at + 48_000;
      const f = { id: `F-${flightSeq}`, call: c.id, dock: d.id, tail: d.tail, rpic: shift.rpic, approver: SUPERVISOR, approved_at: e.at + 31_000, launched_at: launch, scripted: { docked_at: launch + e.minutes * 60_000, on_scene_at: launch + (LAUNCH_S + transit) * 1000 }, released_at: launch + (e.minutes * 60 - transit) * 1000, terminated: null, observe_stopped_at: null, start_charge: 100 };
      flights.push(f);
      const rec = draftRecord(f);
      records.push(rec);
      if (e.filed) fileRecord(rec, { narrative: e.narrative, anomaly: "" }, pilotName(shift.rpic), launch + (e.minutes + 6) * 60_000);
    }
    // A flight from October 30 whose record was never filed: its shift's hours are held on the invoice until it is.
    {
      const p = place("block-12");
      const at = Date.parse("2026-10-30T21:12:00Z");
      const c = { id: "C-0987", incident: "26-109874", kind: "Theft in progress", priority: 2, text: "Container seal reported cut at block 12", place: p.label, x: p.x, y: p.y, received_at: at, status: "flown", order: 987, history: [] };
      calls.push(c);
      const d = dockOf("D2");
      const transit = dist(d, c) / CRUISE_MPS;
      const launch = at + 41_000;
      const f = { id: "F-38", call: c.id, dock: d.id, tail: d.tail, rpic: "P-03", approver: SUPERVISOR, approved_at: at + 25_000, launched_at: launch, scripted: { docked_at: launch + 16 * 60_000, on_scene_at: launch + (LAUNCH_S + transit) * 1000 }, released_at: launch + (16 * 60 - transit) * 1000, terminated: null, observe_stopped_at: null, start_charge: 100 };
      flights.push(f);
      records.push({ ...draftRecord(f), due_at: Date.parse("2026-10-31T00:00:00Z") });
    }
    // A request the pilot declined: airspace closed over the cruise terminal.
    callSeq += 1;
    const cp = place("cruise-term");
    calls.push({ id: `C-${callSeq}`, incident: `26-${String(110300 + callSeq).slice(-6)}`, kind: "Disturbance", priority: 3, text: "Crowd gathering at the terminal entrance", place: cp.label, x: cp.x, y: cp.y, received_at: t0 + 140 * 60_000, status: "declined", order: callSeq, declined: { by: pilotName(shift.rpic), at: t0 + 141 * 60_000, reason: "airspace", note: "TFR over the cruise terminal for a dignitary arrival until 12:00 local. Units advised." }, history: [] });
    // The live queue: three calls waiting for a supervisor.
    receive(opened - 90_000);
    receive(opened - 50_000);
    receive(opened - 20_000);
  }

  // ---- Flight model: phase from the sim clock. ----
  function simElapsed(f, now) {
    return Math.max(0, (now - f.launched_at) / 1000) * (f.scripted ? 1 : SPEED);
  }

  /** Where a flight is now: phase, position, battery, and the alert the pilot should see. */
  function flightState(f, now = Date.now()) {
    const d = dockOf(f.dock);
    const c = calls.find((x) => x.id === f.call);
    const transit = dist(d, c) / CRUISE_MPS;
    if (f.scripted) {
      return { phase: now >= f.scripted.docked_at ? "docked" : "on_scene", x: d.x, y: d.y, battery: 64, eta_s: 0, transit_s: Math.round(transit), alert: null, wind: WEATHER, on_scene_at: f.scripted.on_scene_at, docked_at: f.scripted.docked_at };
    }
    const t = simElapsed(f, now);
    const arrive = LAUNCH_S + transit;
    // The flight ends its time on scene when released, terminated, or the battery reaches what it needs to get home.
    const ends = [f.released_at, f.terminated?.at].filter((v) => v != null).map((ms) => ((ms - f.launched_at) / 1000) * SPEED);
    const bingoAt = (f.start_charge - RESERVE_PCT) / DRAIN_PER_S - transit;
    const stop = Math.min(bingoAt, ...ends, Infinity);
    const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    // Turned back before reaching the scene: home from wherever it was, not from the scene.
    const outK = stop < arrive ? Math.max(0, (stop - LAUNCH_S) / transit) : 1;
    const turn = lerp(d, c, outK);
    const leave = stop < arrive ? Math.max(0, stop) : stop;
    const back = transit * outK;
    const home = leave + back;
    const battery = Math.max(0, r1(f.start_charge - Math.min(t, home) * DRAIN_PER_S));
    let phase;
    let at;
    if (t >= home) [phase, at] = ["docked", d];
    else if (t >= leave) [phase, at] = ["returning", lerp(turn, d, back ? (t - leave) / back : 1)];
    else if (t < LAUNCH_S) [phase, at] = ["launching", d];
    else if (t < arrive) [phase, at] = ["en_route", lerp(d, c, (t - LAUNCH_S) / transit)];
    else [phase, at] = ["on_scene", c];
    // Scripted weather: on the water rescue the gusts rise past the waiver limit 40 s after arrival.
    const gusty = c.kind === "Water rescue" && t >= arrive + 40;
    const wind = gusty ? { ...WEATHER, wind_mps: 10.6, gust_mps: 13.4 } : WEATHER;
    let alert = null;
    if (phase === "on_scene" && gusty && !f.terminated) alert = { level: "no-go", text: `Gusts ${wind.gust_mps} m/s at 60 m, over the ${LIMITS.gust_mps} m/s waiver limit. Continued flight is your call as RPIC.` };
    else if (phase === "returning" && !f.terminated && !f.released_at) alert = { level: "caution", text: `Returning on battery reserve: ${RESERVE_PCT}% to land with.` };
    const eta = phase === "launching" || phase === "en_route" ? Math.max(0, Math.round(arrive - t)) : phase === "returning" ? Math.max(0, Math.round(home - t)) : 0;
    const reached = stop >= arrive;
    return {
      phase, x: Math.round(at.x), y: Math.round(at.y), battery, eta_s: eta, transit_s: Math.round(transit), alert, wind,
      on_scene_at: reached ? f.launched_at + (arrive / SPEED) * 1000 : null, docked_at: f.launched_at + (home / SPEED) * 1000,
    };
  }

  /** A dock's aircraft charge now: what it landed with, charging at about 3% a sim minute since. */
  function chargeOf(d, now = Date.now()) {
    const last = flights.filter((f) => f.dock === d.id && !f.scripted).at(-1);
    if (!last) return d.charge;
    const s = flightState(last, now);
    if (s.phase !== "docked") return s.battery;
    return Math.min(100, Math.round(s.battery + ((now - s.docked_at) / 1000) * SPEED * 0.05));
  }

  /** Pre-flight checks for a dock against this call: aircraft, dock, weather, airspace, link. */
  function preflight(d, c, now = Date.now()) {
    const charge = chargeOf(d, now);
    const checks = [];
    const add = (level, text) => checks.push({ level, text });
    if (d.power !== "on" || d.comms !== "ok") add("no-go", `${d.name}: ${d.power !== "on" ? "no power" : "not communicating"}.`);
    else add("go", `${d.name} powered and communicating.`);
    const busy = flights.find((f) => f.dock === d.id && flightState(f).phase !== "docked");
    if (busy) add("no-go", `${d.tail} is out on ${busy.call}.`);
    else if (charge < 60) add("no-go", `${d.tail} charging, ${charge}% (60% to launch).`);
    else add("go", `${d.tail} docked, ${charge}% charged, no damage reported.`);
    const transit = dist(d, c) / CRUISE_MPS;
    const need = Math.round((LAUNCH_S + 2 * transit) * DRAIN_PER_S + RESERVE_PCT);
    add(need < charge ? "go" : "no-go", `Energy: ${need}% for the round trip with a ${RESERVE_PCT}% reserve, about ${Math.max(0, Math.round((charge - need) / (DRAIN_PER_S * 60)))} min on scene.`);
    add(WEATHER.wind_mps <= LIMITS.wind_mps && WEATHER.gust_mps <= LIMITS.gust_mps ? "go" : "no-go", `Wind ${WEATHER.wind_mps} m/s gusting ${WEATHER.gust_mps}, limits ${LIMITS.wind_mps} and ${LIMITS.gust_mps}. Visibility ${WEATHER.visibility_km} km, ceiling ${WEATHER.ceiling_ft} ft.`);
    if (c.place === "Cruise terminal") add("no-go", "TFR active over the cruise terminal until 12:00 local.");
    else add("go", "No NOTAM or TFR on the route; inside the COA operating area.");
    for (const x of crossings(d, c)) {
      const need = x.height_m + CLEAR_M;
      if (need > TRANSIT_M) add("caution", `Route crosses ${x.label} (${x.height_m} m): the transit climbs to ${need} m over it, ${CLEAR_M} m clear.`);
      else add("go", `Route crosses ${x.label} (${x.height_m} m); the ${TRANSIT_M} m transit clears it by ${TRANSIT_M - x.height_m} m.`);
    }
    const care = program.careOf(d.tail);
    if (care.grounded) add("no-go", `${d.tail} grounded at its care check: ${care.why}.`);
    else if (care.overdue) add("caution", `${d.tail} weekly care check overdue since ${care.due}. Sign it on Flight records.`);
    add("go", "Control and video link margin good on the route (SIM).");
    return { go: !checks.some((x) => x.level === "no-go"), checks };
  }

  /** Structures the straight route from a dock to a call passes over, sampled every 20 m. */
  function crossings(a, b) {
    const n = Math.max(1, Math.ceil(dist(a, b) / 20));
    return MAP.structures.filter((x) => {
      for (let i = 0; i <= n; i += 1) {
        const px = a.x + ((b.x - a.x) * i) / n;
        const py = a.y + ((b.y - a.y) * i) / n;
        if (px >= x.x0 && px <= x.x1 && py >= x.y0 && py <= x.y1) return true;
      }
      return false;
    });
  }

  /** The nearest dock that passes its checks, by flight time. */
  function bestDock(c) {
    const ranked = docks.map((d) => ({ d, eta_s: Math.round(LAUNCH_S + dist(d, c) / CRUISE_MPS), pre: preflight(d, c) })).sort((a, b) => a.eta_s - b.eta_s);
    return { pick: ranked.find((r) => r.pre.go) ?? null, ranked };
  }

  // ---- Records ----
  function draftRecord(f) {
    const c = calls.find((x) => x.id === f.call);
    return { id: `FR-${f.id.slice(2)}`, flight: f.id, call: c.id, status: "draft", versions: [], due_at: shift.end, late: false, hold: false };
  }

  /** The fields the record carries, prefilled from the flight. Only the narrative and any anomaly are typed. */
  function prefill(rec, now = Date.now()) {
    const f = flights.find((x) => x.id === rec.flight);
    const c = calls.find((x) => x.id === rec.call);
    const d = dockOf(f.dock);
    const s = flightState(f, now);
    const recovered = s.phase === "docked" ? s.docked_at : null;
    return {
      launch_at: iso(f.launched_at),
      recovery_at: recovered ? iso(recovered) : null,
      aircraft: f.tail,
      launch_location: d.name,
      incident_location: c.place,
      duration_min: recovered ? r1((recovered - f.launched_at) / 60_000 * (f.scripted ? 1 : SPEED)) : null,
      reason: `${c.kind}: ${c.text}`,
      incident: c.incident,
      approved_by: f.approver,
      rpic: pilotName(f.rpic),
      weather: `Wind ${s.wind.wind_mps} m/s from ${s.wind.wind_from_deg}°, gusts ${s.wind.gust_mps} m/s, visibility ${s.wind.visibility_km} km, ceiling ${s.wind.ceiling_ft} ft, no precipitation`,
      airspace: "Inside the COA operating area; no NOTAM or TFR on the route",
      terminated: f.terminated ? `Terminated by RPIC at ${iso(f.terminated.at).slice(11, 19)}Z: ${f.terminated.reason}` : "",
      observation_stopped: f.observe_stopped_at ? `Observation stopped at the supervisor's direction at ${iso(f.observe_stopped_at).slice(11, 19)}Z` : "",
    };
  }

  function fileRecord(rec, typed, by, at = Date.now(), why = "") {
    const fields = { ...prefill(rec, at), narrative: String(typed.narrative ?? "").trim(), anomaly: String(typed.anomaly ?? "").trim() };
    const v = rec.versions.length + 1;
    const row = evidence.append({ actor: by, action: v === 1 ? "record.file" : "record.amend", resource_type: "flight_record", resource_id: rec.id, detail: JSON.stringify({ v, why, fields }), at });
    rec.versions.push({ v, at: iso(at), by, why, fields, hash: row.row_hash });
    rec.status = "filed";
    rec.late = at > rec.due_at;
    return rec;
  }

  seed();
  seedShifts();
  mishaps.sort((a, b) => b.verbal_at - a.verbal_at);

  // ---- Shifts: the start-of-shift checklist, discrepancies, and the signed shift log ----

  /** Everything the pilot verifies before taking calls: docks, console, weather, airspace, the supervisor and channels. */
  function checklist(now = Date.now()) {
    const items = [];
    const add = (group, level, text) => items.push({ group, level, text });
    for (const d of docks) {
      const charge = chargeOf(d, now);
      if (d.power !== "on" || d.comms !== "ok") add("Docks and aircraft", "fail", `${d.name}: ${d.power !== "on" ? "no power" : "not communicating"}.`);
      else if (charge < 60) add("Docks and aircraft", "caution", `${d.name}: powered and communicating, door clear; ${d.tail} at ${charge}%, not launchable until 60%.`);
      else add("Docks and aircraft", "ok", `${d.name}: powered, communicating, door clear; ${d.tail} at ${charge}%, no visible damage.`);
    }
    for (const d of docks) {
      const care = program.careOf(d.tail);
      if (care.grounded) add("Docks and aircraft", "fail", `${d.tail} grounded at its care check: ${care.why}.`);
      else if (care.overdue) add("Docks and aircraft", "caution", `${d.tail} weekly battery and care check overdue since ${care.due}.`);
    }
    add("Console", "ok", "Ground control station, video link, data link, recording and radio all reporting.");
    const wx = WEATHER.wind_mps <= LIMITS.wind_mps && WEATHER.gust_mps <= LIMITS.gust_mps && WEATHER.visibility_km >= LIMITS.visibility_km && WEATHER.ceiling_ft >= LIMITS.ceiling_ft;
    add("Weather", wx ? "ok" : "fail", `Wind ${WEATHER.wind_mps} m/s gusting ${WEATHER.gust_mps} (limits ${LIMITS.wind_mps} and ${LIMITS.gust_mps}); visibility ${WEATHER.visibility_km} km (${LIMITS.visibility_km}); ceiling ${WEATHER.ceiling_ft} ft (${LIMITS.ceiling_ft}); no precipitation. Forecast: gusts building to 13 m/s over the water after 15:00 local.`);
    for (const a of AIRSPACE) add("Airspace and harbor", a.level, a.text);
    add("Supervisor and radio", "ok", `${shift.supervisor} on duty and approving. Channels: ${CHANNELS}.`);
    return items;
  }

  function seedShifts() {
    // The current shift was started at 07:04 local equivalent: four minutes after the hour, with Dock 3's slow charge reported.
    shift.started_at = shift.start + 4 * 60_000;
    shift.checklist = checklist(shift.start).map((x) => ({ ...x }));
    shift.docks_at_start = docks.map((d) => ({ id: d.id, tail: d.tail, charge: d.charge }));
    shift.discrepancies.push({ at: iso(shift.start + 3 * 60_000), by: pilotName(shift.rpic), text: "Dock 3 charger slow: DFR-03 at 41% after two hours. Reported to the supervisor; Dock 3 is not used until it reaches 60%.", reported_to: SUPERVISOR });
    // The past week's signed logs.
    const week = [
      { rpic: "P-03", flights: 3, declined: [{ reason: "weather", note: "Fog under 1,000 ft over the outer harbor" }], gap_min: 0, discrepancies: [] },
      { rpic: "P-02", flights: 5, declined: [], gap_min: 0, discrepancies: ["Dock 2 door slow to close (11 s); cleared after a cycle"] },
      { rpic: "P-01", flights: 2, declined: [], gap_min: 30, gap: "07:00 to 07:30: relief pilot late. Reported to the program manager at 06:52.", discrepancies: [] },
      { rpic: "P-03", flights: 4, declined: [{ reason: "airspace", note: "Medical helicopter landing at the pier heliport" }, { reason: "battery", note: "Nearest aircraft at 52% after the previous call" }], gap_min: 0, discrepancies: [] },
      { rpic: "P-02", flights: 6, declined: [{ reason: "aircraft", note: "DFR-04 gimbal fault on pre-flight" }], gap_min: 0, discrepancies: ["DFR-04 gimbal fault: grounded, manufacturer ticket opened"] },
      { rpic: "P-03", flights: 3, declined: [], gap_min: 0, discrepancies: [] },
    ];
    week.forEach((w, i) => {
      const date = addDays(TODAY, -(i + 1));
      const staffed = 12 - w.gap_min / 60;
      const late = date === "2026-10-30";
      const log = { id: `SH-${date}`, date, rpic: pilotName(w.rpic), supervisor: SUPERVISOR, scheduled_h: 12, staffed_h: staffed, flights: w.flights, flight_ids: late ? ["F-38"] : [], declined: w.declined, gaps: w.gap ? [w.gap] : [], discrepancies: w.discrepancies, aircraft_start: "All four docks ready", aircraft_end: "All four docks ready", records_unfiled: late ? 1 : 0, signed_by: pilotName(w.rpic), signed_at: `${date}T19:0${i}:00.000Z` };
      const row = evidence.append({ actor: log.signed_by, action: "shift.sign", resource_type: "shift_log", resource_id: log.id, detail: JSON.stringify(log), at: Date.parse(log.signed_at) });
      shiftLogs.push({ ...log, hash: row.row_hash });
    });
    // The rest of the month before that week, for the activity report and the invoice.
    for (const log of history(addDays(TODAY, -33), addDays(TODAY, -(week.length + 1)), pilotName).reverse()) {
      const row = evidence.append({ actor: log.signed_by, action: "shift.sign", resource_type: "shift_log", resource_id: log.id, detail: JSON.stringify(log), at: Date.parse(log.signed_at) });
      shiftLogs.push({ ...log, hash: row.row_hash });
    }
    // An October mishap, written the same day and not reportable.
    {
      const verbal = Date.parse("2026-10-12T17:40:00Z");
      const written = { at: "2026-10-12T22:05:00.000Z", by: pilotName("P-02"), text: "Gull struck the left front propeller on climb-out from Dock 2. Aircraft held a hover, returned and landed normally. Propeller replaced; no other damage.", injury: false, damage_usd: 0, aircraft_damage: "One propeller" };
      const row = evidence.append({ actor: written.by, action: "mishap.file", resource_type: "mishap", resource_id: "MS-6", detail: JSON.stringify(written), at: Date.parse(written.at) });
      mishaps.push({ id: "MS-6", tail: "DFR-02", dock: "D2", flight: null, kind: "Bird strike", verbal_at: verbal, reported_to: SUPERVISOR, by: pilotName("P-02"), text: "Bird strike on climb-out from Dock 2; landed normally.", written: { ...written, hash: row.row_hash } });
    }
    // A mishap from yesterday evening: a hard landing on Dock 3, reported by radio, the written report still due.
    mishaps.push({ id: "MS-7", tail: "DFR-03", dock: "D3", flight: null, kind: "Hard landing", verbal_at: opened - 20 * 3600_000, reported_to: SUPERVISOR, by: pilotName("P-03"), text: "Gust on final into Dock 3; aircraft touched the dock lip and one propeller chipped. Landed and secured.", written: null });
  }

  /** The shift log as it stands: built from the shift's own records, so the pilot reviews and signs rather than types it. */
  function shiftDraft(now = Date.now()) {
    const inShift = (ms) => ms >= shift.start && ms <= now;
    const mine = flights.filter((f) => inShift(f.launched_at));
    const notFlown = calls.filter((c) => (c.status === "declined" || c.status === "cancelled") && inShift(c.received_at));
    const unfiled = records.filter((r) => r.status !== "filed" && mine.some((f) => f.id === r.flight));
    const gapMin = shift.started_at ? Math.max(0, Math.round((shift.started_at - shift.start) / 60_000) - 5) : null;
    const staffedTo = Math.min(now, shift.end);
    return {
      id: shift.id,
      date: shift.date,
      rpic: pilotName(shift.rpic),
      supervisor: shift.supervisor,
      start: iso(shift.start),
      end: iso(shift.end),
      started_at: shift.started_at ? iso(shift.started_at) : null,
      scheduled_h: 12,
      staffed_h: shift.started_at ? r1((staffedTo - shift.started_at) / 3600_000) : 0,
      flights: mine.length,
      flight_ids: mine.map((f) => f.id),
      declined: notFlown.map((c) => ({ call: c.id, reason: (c.declined ?? c.cancelled).reason, note: (c.declined ?? c.cancelled).note, by: c.status === "declined" ? "RPIC" : "Supervisor" })),
      gaps: gapMin ? [`Console unstaffed ${gapMin} min at the start of the shift.`] : [],
      discrepancies: shift.discrepancies.map((x) => x.text),
      aircraft_start: shift.docks_at_start.map((d) => `${d.tail} ${d.charge}%`).join(", "),
      aircraft_end: docks.map((d) => `${d.tail} ${chargeOf(d, now)}%`).join(", "),
      records_unfiled: unfiled.length,
    };
  }

  function nextShift(now) {
    const date = addDays(shift.date, 1);
    const day = crew.onDuty(date);
    Object.assign(shift, { id: `SH-${date}`, date, start: now, end: now + 12 * 3600_000, rpic: day?.pilot ?? null, supervisor: SUPERVISOR, started_at: null, checklist: [], docks_at_start: [], discrepancies: [] });
  }

  // ---- Mishaps: verbal at once, written within 24 hours, and whether the FAA must hear of it ----
  const MISHAP_HOURS = 24;
  function mishapView(m, now = Date.now()) {
    const due = m.verbal_at + MISHAP_HOURS * 3600_000;
    const faa = m.written ? m.written.injury || m.written.damage_usd > 500 : null;
    return { ...m, verbal_at: iso(m.verbal_at), due_at: iso(due), hours_left: r1((due - now) / 3600_000), late: !m.written && now > due, status: m.written ? "written" : "verbal", faa_reportable: faa, faa_due: faa ? iso(m.verbal_at + 10 * 86_400_000) : null };
  }

  // ---- Views ----
  const roleOf = (who) => {
    if (!who) return { supervisor: true, pilot: true, contractor: true, preview: false };
    const preview = who.org === "neros";
    // Neros staff previewing the program play every seat so the walk-through works from one login; a real program has three people.
    if (preview) return { supervisor: can(who.roles, "mission.approve"), pilot: who.roles.includes("admin"), contractor: who.roles.includes("admin"), preview };
    return { supervisor: can(who.roles, "mission.approve"), pilot: who.roles.includes("operator"), contractor: who.roles.includes("contractor"), preview };
  };

  function callView(c, now) {
    const f = flights.find((x) => x.call === c.id);
    const best = c.status === "waiting" || c.status === "approved" ? bestDock(c) : null;
    return {
      ...c,
      waited_s: Math.round(((f?.launched_at ?? c.approved_at ?? now) - c.received_at) / 1000),
      dock: c.dock ?? best?.pick?.d.id ?? null,
      dock_name: dockOf(c.dock ?? best?.pick?.d.id ?? "")?.name ?? null,
      eta_s: best?.pick?.eta_s ?? null,
      options: best ? best.ranked.map((r) => ({ dock: r.d.id, name: r.d.name, eta_s: r.eta_s, go: r.pre.go, why: r.pre.checks.filter((x) => x.level === "no-go").map((x) => x.text) })) : [],
      preflight: c.status === "approved" ? preflight(dockOf(c.dock), c) : null,
      flight: f?.id ?? null,
    };
  }

  function flightView(f, now) {
    const c = calls.find((x) => x.id === f.call);
    const s = flightState(f, now);
    return { id: f.id, call: c.id, incident: c.incident, kind: c.kind, place: c.place, dock: f.dock, tail: f.tail, rpic: pilotName(f.rpic), approver: f.approver, launched_at: iso(f.launched_at), released: Boolean(f.released_at), terminated: f.terminated, observe_stopped: Boolean(f.observe_stopped_at), target: { x: c.x, y: c.y }, ...s, on_scene_at: s.on_scene_at ? iso(s.on_scene_at) : null, docked_at: iso(s.docked_at) };
  }

  function console_(who, now = Date.now()) {
    const role = roleOf(who);
    const live = flights.filter((f) => !f.scripted).map((f) => flightView(f, now));
    const waiting = calls.filter((c) => c.status === "waiting" || c.status === "approved").sort((a, b) => a.priority - b.priority || a.order - b.order).map((c) => callView(c, now));
    const done = calls.filter((c) => !["waiting", "approved"].includes(c.status)).sort((a, b) => b.received_at - a.received_at).map((c) => callView(c, now));
    const due = records.filter((r) => r.status === "draft" && flightState(flights.find((f) => f.id === r.flight), now).phase === "docked");
    return {
      source: "Simulated program (SIM): schematic harbor, made-up docks, pilots, calls and weather. Nothing here commands an aircraft.",
      program: PROGRAM,
      role,
      shift: { id: shift.id, date: shift.date, start: iso(shift.start), end: iso(shift.end), rpic: shift.rpic, rpic_name: shift.rpic ? pilotName(shift.rpic) : "No pilot rostered", supervisor: shift.supervisor, started: Boolean(shift.started_at), started_at: shift.started_at ? iso(shift.started_at) : null, discrepancies: shift.discrepancies },
      checklist: shift.started_at ? shift.checklist : checklist(now),
      shift_log: shiftDraft(now),
      mishaps_open: mishaps.filter((m) => !m.written).map((m) => mishapView(m, now)),
      limits: LIMITS,
      weather: WEATHER,
      map: MAP,
      transit_m: TRANSIT_M,
      docks: docks.map((d) => {
        const out = flights.find((f) => f.dock === d.id && !f.scripted && flightView(f, now).phase !== "docked");
        const charge = chargeOf(d, now);
        const care = program.careOf(d.tail);
        return { ...d, charge, state: out ? "out" : d.power !== "on" || d.comms !== "ok" ? "fault" : care.grounded ? "grounded" : charge < 60 ? "charging" : "ready", out_on: out?.call ?? null, care: { due: care.due, overdue: care.overdue, grounded: care.grounded } };
      }),
      queue: waiting,
      flights: live.filter((f) => f.phase !== "docked"),
      recent: done.slice(0, 8),
      records_due: due.map((r) => ({ id: r.id, call: r.call, due_at: iso(r.due_at) })),
      feed_next: FEED[fed % FEED.length].kind,
      decline_reasons: DECLINE_REASONS,
    };
  }

  function recordsView(now = Date.now()) {
    const list = records.map((r) => {
      const f = flights.find((x) => x.id === r.flight);
      const s = flightState(f, now);
      const latest = r.versions.at(-1);
      const late = r.status !== "filed" && now > r.due_at;
      return { id: r.id, flight: r.flight, call: r.call, status: s.phase !== "docked" ? "in_flight" : r.status, due_at: iso(r.due_at), late: r.late || late, fields: latest?.fields ?? prefill(r, now), versions: r.versions.map((v) => ({ v: v.v, at: v.at, by: v.by, why: v.why, hash: v.hash })), retention: program.retention("flight_record", r.versions[0]?.at ?? null, r.id) };
    });
    const chain = evidence.items();
    const broken = verifyChain(chain);
    return {
      source: "Simulated program (SIM). Records are written once; a correction is a new version beside the original, and each version is hashed onto the one before it.",
      items: list.sort((a, b) => (a.flight < b.flight ? 1 : -1)),
      declined: calls.filter((c) => c.status === "declined" || c.status === "cancelled").map((c) => ({ call: c.id, incident: c.incident, kind: c.kind, place: c.place, received_at: iso(c.received_at), ...(c.declined ?? c.cancelled), by_role: c.status === "declined" ? "RPIC" : "Supervisor" })),
      chain: { rows: chain.length, intact: broken === -1, broken_at: broken, head: chain.at(-1)?.row_hash ?? null },
      shift_logs: [{ ...shiftDraft(now), status: "open" }, ...shiftLogs.slice(0, 7).map((l) => ({ ...l, status: "signed", retention: program.retention("shift_log", l.signed_at, l.id) }))],
      shift_logs_total: shiftLogs.length,
      mishaps: mishaps.map((m) => ({ ...mishapView(m, now), retention: program.retention("mishap", m.written?.at ?? null, m.id) })),
      care: program.careView(),
      retention: RETENTION,
      requests: program.requests,
      fields: ["Launch and recovery time", "Aircraft", "Launch location", "Incident location", "Duration", "Reason for flight", "Incident or call number", "Approving authority", "RPIC", "Weather and airspace", "Narrative", "Anomaly"],
    };
  }

  // ---- Actions ----
  const ok = (message, extra = {}) => ({ status: 200, body: { message, ...extra } });
  const no = (status, detail) => ({ status, body: { detail } });

  function act(action, args, who, now = Date.now()) {
    const role = roleOf(who);
    const actor = who?.display_name ?? "Demo console";
    const deny = (why) => {
      audit.append({ actor, action: `dfr.${action}`, resource_type: "dfr", resource_id: String(args.id ?? ""), decision: "deny", reason_codes: ["role_denied"], detail: why, at: now });
      return no(403, why);
    };
    const call = args.id ? calls.find((c) => c.id === args.id) : null;
    switch (action) {
      case "feed.next": {
        if (!role.supervisor && !role.pilot) return deny("Only the console can take calls from dispatch.");
        const c = receive(now);
        return ok(`Dispatch: ${c.kind} at ${c.place}, priority ${c.priority} (${c.incident}).`);
      }
      case "call.approve": {
        if (!role.supervisor) return deny("Every launch needs a supervisor's approval. The pilot does not self-initiate flights.");
        if (!call || call.status !== "waiting") return no(409, "That call is not waiting for approval.");
        if (!shift.started_at) return no(409, "No pilot has started the shift checklist. Nothing launches until someone is on console.");
        const dockId = String(args.dock ?? "") || bestDock(call).pick?.d.id;
        const d = dockId ? dockOf(dockId) : null;
        if (!d) return no(409, "No dock passes its launch checks for this call.");
        const pre = preflight(d, call);
        if (!pre.go) return no(409, `${d.name} fails its checks: ${pre.checks.filter((x) => x.level === "no-go").map((x) => x.text).join(" ")}`);
        call.status = "approved";
        call.dock = d.id;
        call.approved_at = now;
        call.approved_by = role.preview ? `${actor} (as supervisor)` : who ? actor : SUPERVISOR;
        audit.append({ actor, action: "dfr.approve", resource_type: "call", resource_id: call.id, detail: `${call.kind} at ${call.place}; ${d.name}`, at: now });
        return ok(`Approved ${call.id}. ${d.tail} at ${d.name} is the nearest ready aircraft; the pilot launches after the pre-flight checks.`);
      }
      case "call.priority": {
        if (!role.supervisor) return deny("The supervisor sets which request flies first.");
        if (!call || call.status !== "waiting") return no(409, "That call is not waiting.");
        const p = Math.max(1, Math.min(3, Number(args.priority)));
        call.priority = p;
        audit.append({ actor, action: "dfr.priority", resource_type: "call", resource_id: call.id, detail: `priority ${p}`, at: now });
        return ok(`${call.id} is now priority ${p}.`);
      }
      case "call.cancel": {
        if (!role.supervisor) return deny("Only the supervisor can stand a request down.");
        if (!call || !["waiting", "approved"].includes(call.status)) return no(409, "That call is not open.");
        call.status = "cancelled";
        call.cancelled = { by: actor, at: now, reason: "stood down", note: String(args.note ?? "Units on scene; aircraft not needed.") };
        audit.append({ actor, action: "dfr.cancel", resource_type: "call", resource_id: call.id, detail: call.cancelled.note, at: now });
        return ok(`${call.id} stood down. It goes on the shift log as not flown.`);
      }
      case "call.decline": {
        if (!role.pilot) return deny("Declining a flight is the RPIC's call alone.");
        if (!call || !["waiting", "approved"].includes(call.status)) return no(409, "That call is not open.");
        const reason = DECLINE_REASONS.includes(String(args.reason)) ? String(args.reason) : null;
        const note = String(args.note ?? "").trim();
        if (!reason || !note) return no(400, "Say why: pick a reason and add a line for the supervisor and the record.");
        call.status = "declined";
        call.declined = { by: role.preview ? `${actor} (as RPIC)` : who ? actor : pilotName(shift.rpic), at: now, reason, note };
        audit.append({ actor, action: "dfr.decline", resource_type: "call", resource_id: call.id, reason_codes: [`rpic_${reason}`], detail: note, at: now });
        return ok(`Declined ${call.id} (${reason}). The supervisor has been told; this cannot be overridden and is on the shift log.`);
      }
      case "call.launch": {
        if (!role.pilot) return deny("The RPIC launches, after the pre-flight checks.");
        if (!call || call.status !== "approved") return no(409, "Only an approved call can launch.");
        if (!shift.started_at) return no(409, "Start the shift checklist before launching.");
        const d = dockOf(call.dock);
        const pre = preflight(d, call);
        if (!pre.go) return no(409, `Pre-flight checks fail: ${pre.checks.filter((x) => x.level === "no-go").map((x) => x.text).join(" ")} Decline it or pick another dock.`);
        flightSeq += 1;
        const f = { id: `F-${flightSeq}`, call: call.id, dock: d.id, tail: d.tail, rpic: shift.rpic, approver: call.approved_by, approved_at: call.approved_at, launched_at: now, released_at: null, terminated: null, observe_stopped_at: null, start_charge: chargeOf(d, now) };
        flights.push(f);
        records.push(draftRecord(f));
        call.status = "flown";
        audit.append({ actor, action: "dfr.launch", resource_type: "flight", resource_id: f.id, detail: `${d.tail} from ${d.name} to ${call.place}`, at: now });
        return ok(`${d.tail} launched from ${d.name}. On scene in about ${Math.round(LAUNCH_S + dist(d, call) / CRUISE_MPS)} s.`);
      }
      case "flight.terminate": {
        if (!role.pilot) return deny("Ending a flight for safety is the RPIC's call. A supervisor can release a flight but cannot keep one up.");
        const f = flights.find((x) => x.id === args.id);
        if (!f || ["returning", "docked"].includes(flightState(f, now).phase)) return no(409, "That flight is not on its way out or on scene.");
        const reason = String(args.reason ?? "").trim();
        if (!reason) return no(400, "Say why the flight ended: it goes on the flight record.");
        f.terminated = { at: now, by: role.preview ? `${actor} (as RPIC)` : who ? actor : pilotName(f.rpic), reason };
        audit.append({ actor, action: "dfr.terminate", resource_type: "flight", resource_id: f.id, reason_codes: ["rpic_safety"], detail: reason, at: now });
        return ok(`${f.tail} terminated and returning to its dock. The supervisor has been told, and the reason is on the flight record.`);
      }
      case "flight.release": {
        if (!role.supervisor) return deny("The directing supervisor releases the aircraft.");
        const f = flights.find((x) => x.id === args.id);
        if (!f || flightState(f, now).phase !== "on_scene") return no(409, "Only an aircraft on scene can be released.");
        f.released_at = now;
        audit.append({ actor, action: "dfr.release", resource_type: "flight", resource_id: f.id, at: now });
        return ok(`${f.tail} released; returning to its dock.`);
      }
      case "flight.observe_stop": {
        if (!role.supervisor) return deny("The supervisor directs when observation stops.");
        const f = flights.find((x) => x.id === args.id);
        if (!f || f.observe_stopped_at) return no(409, "Observation is already stopped on that flight.");
        f.observe_stopped_at = now;
        audit.append({ actor, action: "dfr.observe_stop", resource_type: "flight", resource_id: f.id, reason_codes: ["privacy"], detail: "Camera to horizon; recording kept to flight safety only", at: now });
        return ok(`Observation stopped on ${f.tail}: camera to the horizon, recording kept to what flight safety needs.`);
      }
      case "record.file":
      case "record.amend": {
        if (!role.pilot) return deny("The RPIC who flew it files the flight record.");
        const rec = records.find((r) => r.id === args.id);
        if (!rec) return no(404, "No such record.");
        if (flightState(flights.find((f) => f.id === rec.flight), now).phase !== "docked") return no(409, "File the record once the aircraft is back in its dock.");
        const narrative = String(args.narrative ?? "").trim();
        if (narrative.length < 12) return no(400, "Write the narrative: what you saw and what happened, in a sentence or two.");
        if (action === "record.file" && rec.status === "filed") return no(409, "Already filed. A correction is a new version: use Correct.");
        const why = String(args.why ?? "").trim();
        if (action === "record.amend" && (rec.status !== "filed" || !why)) return no(400, "A correction needs a reason, and keeps the original beside it.");
        fileRecord(rec, { narrative, anomaly: args.anomaly }, role.preview ? `${actor} (as RPIC)` : who ? actor : pilotName(shift.rpic), now, why);
        audit.append({ actor, action: `dfr.${action.split(".")[1]}`, resource_type: "flight_record", resource_id: rec.id, detail: why || "filed", at: now });
        return ok(action === "record.file" ? `${rec.id} filed and sealed into the evidence chain.` : `${rec.id} corrected: version ${rec.versions.length} sits beside the original.`);
      }
      case "shift.start": {
        if (!role.pilot) return deny("The pilot coming on console runs the start-of-shift checks.");
        if (shift.started_at) return no(409, "This shift has already started.");
        if (!shift.rpic) return no(409, "No pilot is rostered for this shift. Fill the gap on Pilots and roster first.");
        const items = checklist(now);
        shift.started_at = now;
        shift.checklist = items;
        shift.docks_at_start = docks.map((d) => ({ id: d.id, tail: d.tail, charge: chargeOf(d, now) }));
        // Anything not right at the start is reported to the supervisor and logged before it can affect a response.
        for (const x of items.filter((i) => i.level !== "ok" && i.group === "Docks and aircraft")) shift.discrepancies.push({ at: iso(now), by: pilotName(shift.rpic), text: x.text, reported_to: shift.supervisor });
        audit.append({ actor, action: "dfr.shift_start", resource_type: "shift", resource_id: shift.id, detail: `${items.filter((i) => i.level !== "ok").length} items to watch`, at: now });
        return ok(`Shift started with ${items.length} checks. ${shift.discrepancies.length ? `${shift.discrepancies.length} discrepancy reported to ${shift.supervisor}.` : "Nothing to report."}`);
      }
      case "shift.discrepancy": {
        if (!role.pilot) return deny("The pilot on console reports discrepancies.");
        const text = String(args.text ?? "").trim();
        if (text.length < 8) return no(400, "Say what is wrong and where.");
        shift.discrepancies.push({ at: iso(now), by: pilotName(shift.rpic), text, reported_to: shift.supervisor });
        audit.append({ actor, action: "dfr.discrepancy", resource_type: "shift", resource_id: shift.id, detail: text, at: now });
        return ok(`Reported to ${shift.supervisor} and logged on ${shift.id}.`);
      }
      case "shift.end": {
        if (!role.pilot) return deny("The pilot going off console signs the shift log.");
        if (!shift.started_at) return no(409, "This shift has not started.");
        if (flights.some((f) => !f.scripted && flightState(f, now).phase !== "docked")) return no(409, "An aircraft is still out. Recover it before signing off.");
        const log = { ...shiftDraft(now), signed_by: role.preview ? `${actor} (as RPIC)` : who ? actor : pilotName(shift.rpic), signed_at: iso(now) };
        const row = evidence.append({ actor: log.signed_by, action: "shift.sign", resource_type: "shift_log", resource_id: log.id, detail: JSON.stringify(log), at: now });
        shiftLogs.unshift({ ...log, hash: row.row_hash });
        audit.append({ actor, action: "dfr.shift_end", resource_type: "shift", resource_id: log.id, detail: `${log.flights} flights, ${log.declined.length} not flown, ${log.records_unfiled} records unfiled`, at: now });
        nextShift(now);
        return ok(`${log.id} signed and sealed: ${log.staffed_h} h staffed, ${log.flights} flights, ${log.declined.length} not flown${log.records_unfiled ? `, ${log.records_unfiled} records still to file` : ""}. Next on console: ${shift.rpic ? pilotName(shift.rpic) : "nobody rostered"}.`);
      }
      case "mishap.report": {
        if (!role.pilot) return deny("The pilot reports a mishap to the supervisor.");
        const text = String(args.text ?? "").trim();
        const f = args.flight ? flights.find((x) => x.id === args.flight) : null;
        if (text.length < 8) return no(400, "Say what happened.");
        const m = { id: `MS-${8 + mishaps.length}`, tail: f?.tail ?? String(args.tail ?? ""), dock: f?.dock ?? null, flight: f?.id ?? null, kind: String(args.kind ?? "Incident"), verbal_at: now, reported_to: shift.supervisor, by: pilotName(shift.rpic), text, written: null };
        mishaps.unshift(m);
        audit.append({ actor, action: "dfr.mishap_verbal", resource_type: "mishap", resource_id: m.id, detail: text, at: now });
        return ok(`${m.id} reported to ${shift.supervisor}. The written report is due within ${MISHAP_HOURS} hours.`);
      }
      case "mishap.file": {
        if (!role.pilot) return deny("The pilot writes the mishap report.");
        const m = mishaps.find((x) => x.id === args.id);
        if (!m) return no(404, "No such mishap.");
        if (m.written) return no(409, "Already written. A correction is filed as an addendum.");
        const text = String(args.text ?? "").trim();
        if (text.length < 20) return no(400, "Write what happened, the damage, and what was done.");
        const damage = Math.max(0, Number(args.damage_usd) || 0);
        m.written = { at: iso(now), by: role.preview ? `${actor} (as RPIC)` : who ? actor : pilotName(shift.rpic), text, injury: Boolean(args.injury), damage_usd: damage, aircraft_damage: String(args.aircraft_damage ?? "").trim() };
        const row = evidence.append({ actor: m.written.by, action: "mishap.file", resource_type: "mishap", resource_id: m.id, detail: JSON.stringify(m.written), at: now });
        m.written.hash = row.row_hash;
        const late = now > m.verbal_at + MISHAP_HOURS * 3600_000;
        const faa = m.written.injury || damage > 500;
        audit.append({ actor, action: "dfr.mishap_written", resource_type: "mishap", resource_id: m.id, detail: faa ? "FAA reportable" : "not FAA reportable", at: now });
        return ok(`${m.id} written${late ? " (late)" : ""} and sealed. ${faa ? "Serious injury or more than $500 of other property damage: report it to the FAA within 10 days (14 CFR 107.9)." : "Not reportable to the FAA: no serious injury, other property damage under $500."}`);
      }
      case "roster.assign": {
        if (!role.supervisor) return deny("The program manager sets the roster.");
        const out = crew.assign(String(args.date ?? ""), args.pilot ? String(args.pilot) : null, args.supervised_by ? String(args.supervised_by) : null);
        if (!out.ok) return no(409, out.why);
        audit.append({ actor, action: "dfr.roster", resource_type: "roster", resource_id: String(args.date ?? ""), detail: out.message, at: now });
        return ok(out.message);
      }
      case "crew.certify": {
        if (!role.supervisor) return deny("The program manager signs a pilot off for solo shifts.");
        const out = crew.certify(String(args.pilot ?? ""), role.preview ? `${actor} (as program manager)` : who ? actor : SUPERVISOR);
        if (!out.ok) return no(409, out.why);
        audit.append({ actor, action: "dfr.certify", resource_type: "pilot", resource_id: String(args.pilot), detail: out.message, at: now });
        return ok(out.message);
      }
      case "care.sign": {
        if (!role.pilot) return deny("The pilot signs the weekly care check.");
        const out = program.signCare(args, role.preview ? `${actor} (as RPIC)` : who ? actor : pilotName(shift.rpic ?? "P-02"), now);
        if (!out.ok) return no(out.status, out.why);
        audit.append({ actor, action: "dfr.care", resource_type: "aircraft", resource_id: String(args.tail), detail: out.message, at: now });
        return ok(out.message);
      }
      case "record.hold":
      case "record.release_hold": {
        if (!role.supervisor) return deny("The records custodian places and lifts legal holds.");
        const id = String(args.id ?? "");
        if (![...records.map((r) => r.id), ...shiftLogs.map((l) => l.id), ...mishaps.map((m) => m.id)].includes(id)) return no(404, "No such record.");
        const by = role.preview ? `${actor} (as custodian)` : who ? actor : SUPERVISOR;
        const out = action === "record.hold" ? program.setHold(id, args.matter, by, now) : program.liftHold(id, by, now);
        if (!out.ok) return no(409, out.why);
        audit.append({ actor, action: `dfr.${action === "record.hold" ? "hold" : "hold_lift"}`, resource_type: "record", resource_id: id, detail: out.message, at: now });
        return ok(out.message);
      }
      case "request.create": {
        if (!role.supervisor) return deny("The records custodian answers records requests.");
        const out = program.createRequest(args, { records: records.map((r) => ({ ...r, fields: r.versions.at(-1)?.fields })), shiftLogs }, role.preview ? `${actor} (as custodian)` : who ? actor : SUPERVISOR, now);
        if (!out.ok) return no(out.status, out.why);
        audit.append({ actor, action: "dfr.request", resource_type: "records_request", resource_id: program.requests[0].id, detail: out.message, at: now });
        return ok(out.message);
      }
      case "request.release": {
        if (!role.supervisor) return deny("The records custodian releases a records request.");
        const out = program.releaseRequest(String(args.id ?? ""), role.preview ? `${actor} (as custodian)` : who ? actor : SUPERVISOR, now, verifyChain(evidence.items()) === -1);
        if (!out.ok) return no(out.status, out.why);
        audit.append({ actor, action: "dfr.request_release", resource_type: "records_request", resource_id: String(args.id), detail: out.message, at: now });
        return ok(out.message);
      }
      case "month.submit": {
        if (!role.contractor) return deny("The contractor submits the month's report and invoice.");
        const out = program.submitMonth(monthSrc(), role.preview ? `${actor} (as contractor)` : who ? actor : "Contract pilot company (SIM)", now);
        if (!out.ok) return no(409, out.why);
        audit.append({ actor, action: "dfr.month_submit", resource_type: "invoice", resource_id: "INV-2026-10", detail: out.message, at: now });
        return ok(out.message);
      }
      case "month.approve":
      case "month.return": {
        if (!role.supervisor) return deny("The program manager approves or returns the invoice.");
        const out = program.decideMonth(action === "month.approve", args.note, role.preview ? `${actor} (as program manager)` : who ? actor : SUPERVISOR, now);
        if (!out.ok) return no(409, out.why);
        audit.append({ actor, action: `dfr.${action.replace(".", "_")}`, resource_type: "invoice", resource_id: "INV-2026-10", detail: out.message, at: now });
        return ok(out.message);
      }
      case "crew.renew": {
        if (!role.contractor && !role.supervisor) return deny("The contractor keeps the pilot files current; the program manager can too.");
        const out = crew.renew(String(args.pilot ?? ""), String(args.item ?? ""), args.value == null ? null : String(args.value));
        if (!out.ok) return no(409, out.why);
        audit.append({ actor, action: "dfr.renew", resource_type: "pilot", resource_id: String(args.pilot), detail: out.message, at: now });
        return ok(out.message);
      }
      default:
        return no(400, `unknown action ${action}`);
    }
  }

  const monthSrc = () => ({ shiftLogs, records, mishaps, crewView: crew.view() });

  const ROUTES = ["/v1/dfr", "/v1/dfr/act", "/v1/dfr/records", "/v1/dfr/crew", "/v1/dfr/program"];
  const owns = (path) => ROUTES.includes(path);

  /** Whose program this is: the program's own people, Neros previewing it, or the local demo with no sign-in. */
  function allowed(who) {
    return !who || who.org === PROGRAM.id || who.org === "neros";
  }

  function handle(method, url, raw, who) {
    if (!allowed(who)) return no(403, "That is another customer's program.");
    // A contractor seat sees its people and its invoice, never the live console or the incident records.
    const contractorOnly = Boolean(who?.roles?.includes("contractor")) && !roleOf(who).supervisor && !roleOf(who).pilot;
    if (contractorOnly && (url.pathname === "/v1/dfr" || url.pathname === "/v1/dfr/records")) return no(403, "The live console and incident records stay with the agency. A contractor seat sees the roster, pilot files, and the month's report and invoice.");
    if (url.pathname === "/v1/dfr/act" && method === "POST") {
      let msg = {};
      try {
        msg = JSON.parse(raw || "{}");
      } catch {
        return no(400, "json");
      }
      return act(String(msg.action ?? ""), msg.args ?? {}, who);
    }
    if (url.pathname === "/v1/dfr") return { status: 200, body: console_(who) };
    if (url.pathname === "/v1/dfr/records") return { status: 200, body: recordsView() };
    if (url.pathname === "/v1/dfr/program" && !roleOf(who).supervisor && !roleOf(who).contractor) return no(403, "The month's report and invoice are between the program manager and the contractor.");
    if (url.pathname === "/v1/dfr/program") return { status: 200, body: { source: "Simulated program (SIM): made-up hours, rates and history.", today: shift.date, role: roleOf(who), ...program.monthView(monthSrc()) } };
    if (url.pathname === "/v1/dfr/crew") return { status: 200, body: { source: "Simulated program (SIM): made-up pilots, certificate numbers and dates.", today: TODAY, on_console: shift.rpic, role: roleOf(who), ...crew.view() } };
    return no(404, "unknown");
  }

  return { owns, handle, act, view: console_, records: recordsView, flightState, evidence, shift, calls, flights, crew, mishaps, program, shiftLogs };
}
