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
};

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

/**
 * @param {object} [o]
 * @param {number} [o.now] when the scenario opened (ms)
 * @param {{append: Function}} [o.audit] the platform audit log, which records each DFR decision too
 */
export function createResponder(o = {}) {
  const opened = o.now ?? Date.now();
  const audit = o.audit ?? createLedger();
  // The shift opened three hours ago and runs twelve: one pilot on console, one supervisor approving.
  const shift = { id: "SH-1", start: opened - 3 * 3600_000, end: opened + 9 * 3600_000, rpic: "P-02", supervisor: SUPERVISOR };
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
      { kind: "Suspicious vehicle", place: "block-12", priority: 2, text: "Pickup driving between stacks with lights off", at: t0 + 35 * 60_000, dock: "D2", minutes: 14, narrative: "Arrived 74 s after launch. Pickup parked between rows 11 and 12, two occupants, no cargo movement. Units arrived and identified a terminal security patrol. Released by supervisor.", filed: true },
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
    add("go", "Control and video link margin good on the route (SIM).");
    return { go: !checks.some((x) => x.level === "no-go"), checks };
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

  // ---- Views ----
  const roleOf = (who) => {
    if (!who) return { supervisor: true, pilot: true, preview: false };
    const preview = who.org === "neros";
    // Neros staff previewing the program play both seats so the walk-through works from one login; a real program has two people.
    if (preview) return { supervisor: can(who.roles, "mission.approve"), pilot: who.roles.includes("admin"), preview };
    return { supervisor: can(who.roles, "mission.approve"), pilot: who.roles.includes("operator"), preview };
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
      shift: { ...shift, start: iso(shift.start), end: iso(shift.end), rpic_name: pilotName(shift.rpic) },
      limits: LIMITS,
      weather: WEATHER,
      map: MAP,
      docks: docks.map((d) => {
        const out = flights.find((f) => f.dock === d.id && !f.scripted && flightView(f, now).phase !== "docked");
        const charge = chargeOf(d, now);
        return { ...d, charge, state: out ? "out" : d.power !== "on" || d.comms !== "ok" ? "fault" : charge < 60 ? "charging" : "ready", out_on: out?.call ?? null };
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
      return { id: r.id, flight: r.flight, call: r.call, status: s.phase !== "docked" ? "in_flight" : r.status, due_at: iso(r.due_at), late: r.late, fields: latest?.fields ?? prefill(r, now), versions: r.versions.map((v) => ({ v: v.v, at: v.at, by: v.by, why: v.why, hash: v.hash })) };
    });
    const chain = evidence.items();
    const broken = verifyChain(chain);
    return {
      source: "Simulated program (SIM). Records are written once; a correction is a new version beside the original, and each version is hashed onto the one before it.",
      items: list.sort((a, b) => (a.flight < b.flight ? 1 : -1)),
      declined: calls.filter((c) => c.status === "declined" || c.status === "cancelled").map((c) => ({ call: c.id, incident: c.incident, kind: c.kind, place: c.place, received_at: iso(c.received_at), ...(c.declined ?? c.cancelled), by_role: c.status === "declined" ? "RPIC" : "Supervisor" })),
      chain: { rows: chain.length, intact: broken === -1, broken_at: broken, head: chain.at(-1)?.row_hash ?? null },
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
      default:
        return no(400, `unknown action ${action}`);
    }
  }

  const ROUTES = ["/v1/dfr", "/v1/dfr/act", "/v1/dfr/records"];
  const owns = (path) => ROUTES.includes(path);

  /** Whose program this is: the program's own people, Neros previewing it, or the local demo with no sign-in. */
  function allowed(who) {
    return !who || who.org === PROGRAM.id || who.org === "neros";
  }

  function handle(method, url, raw, who) {
    if (!allowed(who)) return no(403, "That is another customer's program.");
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
    return no(404, "unknown");
  }

  return { owns, handle, act, view: console_, records: recordsView, flightState, evidence, shift, calls, flights };
}
