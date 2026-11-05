// Training scenarios for the demo console. A scenario injects scripted alerts
// on a timeline and records how the operator responded. The responses are
// training records only: nothing here commands a vehicle (ADR 0016; the
// console monitors and advises).

// Responses an operator can record. These are decisions, not commands.
export const RESPONSES = ["monitor", "confirm_failsafe", "confirm_vio", "plan_recovery", "ground_next_sortie"];

export const SCENARIOS = {
  // Energy, wind and link: the alerts the performance model raises. The expected
  // responses follow the console's own rule: bingo is the vehicle's call to
  // confirm, tight energy is a plan to change, a thin link is watched.
  "qual-2": {
    title: "Qualification 2: wind, energy, link",
    alerts: [
      { id: "b1", at_s: 5, tail: "NX-06", kind: "bingo", text: "NX-06 bingo: 5 min of energy, 3 min to home against 6 m/s. It has turned for the station on RTL.", correct: "confirm_failsafe" },
      { id: "b2", at_s: 20, tail: "NX-01", kind: "energy_tight", text: "NX-01 energy tight: 4 min spare after the flight home. Wind is up to 8 m/s at 120 m; the upwind legs are costing 320 W.", correct: "plan_recovery" },
      { id: "b3", at_s: 35, tail: "NX-07", kind: "link_margin", text: "NX-07 link margin 7 dB at 4.3 km and 60 m. One hill or one more kilometre drops it.", correct: "monitor" },
      { id: "b4", at_s: 50, tail: "NX-06", kind: "landed", text: "NX-06 landed at the station with 22%. Pack swap before it flies again.", correct: "ground_next_sortie" },
    ],
  },
  "qual-1": {
    title: "Qualification 1: link, GNSS, battery",
    alerts: [
      { id: "a1", at_s: 5, tail: "NX-03", kind: "link_lost", text: "NX-03 link lost for 3 s. Failsafe should engage.", correct: "confirm_failsafe" },
      { id: "a2", at_s: 20, tail: "NX-04", kind: "gnss_rejected", text: "NX-04 GNSS rejected by the estimator. Nav source switched.", correct: "confirm_vio" },
      { id: "a3", at_s: 35, tail: "NX-06", kind: "low_battery", text: "NX-06 battery 18 %, below reserve for the planned route.", correct: "plan_recovery" },
    ],
  },
};

export function startSession(name, now) {
  const scenario = SCENARIOS[name];
  if (!scenario) return null;
  return { name, title: scenario.title, t0: now, alerts: scenario.alerts, acks: {} };
}

// Alerts whose time has come, each with its acknowledgement if any.
export function visible(session, now) {
  const t = (now - session.t0) / 1000;
  return session.alerts
    .filter((a) => a.at_s <= t)
    .map((a) => ({ id: a.id, tail: a.tail, kind: a.kind, text: a.text, raised_at: session.t0 + a.at_s * 1000, ack: session.acks[a.id] ?? null }));
}

export function acknowledge(session, id, action, now) {
  const alert = session.alerts.find((a) => a.id === id);
  if (!alert) return { error: "unknown alert" };
  if (!RESPONSES.includes(action)) return { error: "unknown response" };
  const raised = session.t0 + alert.at_s * 1000;
  if (now < raised) return { error: "alert not raised yet" };
  if (session.acks[id]) return { error: "already acknowledged" };
  session.acks[id] = { action, time_to_act_s: (now - raised) / 1000, correct: action === alert.correct };
  return { ok: true, ack: session.acks[id] };
}

// Time to act per alert and the correct-response rate over acknowledged alerts.
export function scorecard(session) {
  const rows = session.alerts.map((a) => ({
    id: a.id,
    kind: a.kind,
    tail: a.tail,
    ...(session.acks[a.id] ?? { action: null, time_to_act_s: null, correct: null }),
  }));
  const done = rows.filter((r) => r.action !== null);
  const times = done.map((r) => r.time_to_act_s);
  return {
    scenario: session.name,
    title: session.title,
    alerts: rows.length,
    acknowledged: done.length,
    complete: done.length === rows.length,
    correct_rate: done.length ? done.filter((r) => r.correct).length / done.length : null,
    mean_time_to_act_s: times.length ? times.reduce((s, x) => s + x, 0) / times.length : null,
    max_time_to_act_s: times.length ? Math.max(...times) : null,
    rows,
  };
}
