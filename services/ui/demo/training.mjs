// Training scenarios for the demo console. A scenario injects scripted alerts
// on a timeline and records how the operator responded. The responses are
// training records only: nothing here commands a vehicle (ADR 0016; the
// console monitors and advises).

// Responses an operator can record. These are decisions, not commands.
export const RESPONSES = ["monitor", "confirm_failsafe", "confirm_vio", "plan_recovery", "ground_next_sortie"];

export const SCENARIOS = {
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
