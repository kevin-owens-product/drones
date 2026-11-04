// Operator readiness: training joined to what each operator's sorties did.
//
// Why: training is the binding constraint on fielding (Gauntlet I operators got
// about two hours per system; Drone Dominance Phase II prices reportedly bundle
// six training sessions), and operator workload is now scored. A unit needs to
// know who is current, who needs a refresher, and whether the training it was
// sold changed results. This joins each operator's training record (courses,
// bundled sessions, the simulator qualification in Operate) to the outcomes of
// their sorties in the end-of-flight records.
//
// Operators are designators (A-01), never names. Everything is simulated (SIM).
// Neros sees only aggregates, and only while the customer shares. Pure JavaScript.

import { TODAY } from "./company.mjs";

export const BUNDLED_SESSIONS = 6;
const CURRENCY_DAYS = 14;
const MIN_SORTIES = 3;

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** @param {{ serials: ReturnType<import("./serials.mjs").createSerials>, sharing: Record<string, boolean> }} deps */
export function createReadiness({ serials, sharing }) {
  // Training records derived from the sim's operator skill, so training and outcomes line up as the sim intends.
  const training = new Map(serials.operators.map((o) => {
    const sessions = o.skill >= 0.9 ? 6 : o.skill >= 0.85 ? 5 : o.skill >= 0.8 ? 4 : o.skill >= 0.7 ? 3 : 2;
    return [o.id, {
      course: "TRN-ADO",
      course_done: o.skill >= 0.65 ? "2026-09-26" : null,
      instructor: o.skill >= 0.92,
      sessions,
      sim: { scenario: "qual-1", correct_rate: Math.min(1, Number((o.skill * 1.05).toFixed(2))), mean_time_to_act_s: Number((4 + (1 - o.skill) * 30).toFixed(1)), passed: o.skill >= 0.75, at: "2026-10-20" },
      refresher: null,
    }];
  }));

  function stats(recs) {
    const n = recs.length;
    const done = recs.filter((r) => r.outcome === "completed").length;
    const jam = recs.filter((r) => r.jamming);
    return { sorties: n, completed: done, rate: n ? done / n : null, jam_sorties: jam.length, jam_rate: jam.length ? jam.filter((r) => r.outcome === "completed").length / jam.length : null };
  }

  function rows(org) {
    const since = addDays(TODAY, -28);
    const recent = addDays(TODAY, -CURRENCY_DAYS);
    const recs = serials.records.filter((r) => r.org === org && r.day >= since);
    const units = new Set(recs.map((r) => r.unit));
    return serials.operators.filter((o) => units.has(o.unit)).map((o) => {
      const t = training.get(o.id);
      const mine = recs.filter((r) => r.operator === o.id);
      const last = mine.map((r) => r.day).sort().pop() ?? null;
      const s = stats(mine);
      const current = Boolean(last && last >= recent && mine.length >= MIN_SORTIES);
      const flags = [];
      if (!t.course_done) flags.push("No operator course on file");
      if (!t.sim.passed) flags.push("Simulator qualification not passed");
      if (!current) flags.push(`Not current: fewer than ${MIN_SORTIES} sorties or none in ${CURRENCY_DAYS} days`);
      if (s.rate != null && s.sorties >= 8 && s.rate < 0.5) flags.push("Completes under half of sorties");
      if (t.sessions < BUNDLED_SESSIONS) flags.push(`${BUNDLED_SESSIONS - t.sessions} bundled sessions not used`);
      return { id: o.id, unit: o.unit, ...t, ...s, last_sortie: last, current, flags, ready: flags.length === 0 || flags.every((f) => f.includes("bundled")) };
    });
  }

  /** Did the bundled sessions move results? Completion by sessions taken, and by simulator pass. */
  function effect(list) {
    const bucket = (r) => (r.sessions >= 6 ? "6 of 6" : r.sessions >= 4 ? "4 to 5" : "3 or fewer");
    const groups = ["3 or fewer", "4 to 5", "6 of 6"].map((label) => {
      const g = list.filter((r) => bucket(r) === label);
      const sorties = g.reduce((n, r) => n + r.sorties, 0);
      const done = g.reduce((n, r) => n + r.completed, 0);
      const js = g.reduce((n, r) => n + r.jam_sorties, 0);
      const jd = g.reduce((n, r) => n + Math.round((r.jam_rate ?? 0) * r.jam_sorties), 0);
      return { label, operators: g.length, sorties, rate: sorties ? done / sorties : null, jam_rate: js ? jd / js : null };
    });
    const sim = [true, false].map((passed) => {
      const g = list.filter((r) => r.sim.passed === passed);
      const sorties = g.reduce((n, r) => n + r.sorties, 0);
      return { passed, operators: g.length, sorties, rate: sorties ? g.reduce((n, r) => n + r.completed, 0) / sorties : null };
    });
    return { by_sessions: groups, by_sim: sim };
  }

  function view(org) {
    const list = rows(org);
    return {
      source: "Simulated: training records, simulator results and sorties are demo data. Operators are designators, never names.",
      today: TODAY,
      bundled_sessions: BUNDLED_SESSIONS,
      currency_rule: `Current means at least ${MIN_SORTIES} sorties in 28 days and one in the last ${CURRENCY_DAYS}`,
      operators: list,
      counts: { operators: list.length, ready: list.filter((r) => r.ready).length, not_current: list.filter((r) => !r.current).length, sim_failed: list.filter((r) => !r.sim.passed).length, refreshers: list.filter((r) => r.refresher).length },
      effect: effect(list),
      sharing: Boolean(sharing[org]),
    };
  }

  /** What Neros may see: the training effect across sharing customers, with no operator rows. */
  function nerosView() {
    const orgs = Object.keys(sharing).filter((k) => sharing[k]);
    const list = orgs.flatMap((o) => rows(o));
    return { customers: orgs, operators: list.length, effect: effect(list) };
  }

  function refresher(org, a, actor) {
    const t = training.get(String(a.operator ?? ""));
    const op = serials.operators.find((o) => o.id === a.operator);
    if (!t || !op || !rows(org).some((r) => r.id === op.id)) return { error: "not one of your operators", status: 404 };
    if (t.refresher) return { error: `${op.id} already has a refresher booked for ${t.refresher.on}`, status: 409 };
    t.refresher = { on: addDays(TODAY, 2), by: actor, kind: a.kind === "session" ? "bundled session" : "simulator qualification" };
    return { ok: true, message: `${op.id}: ${t.refresher.kind} booked for ${t.refresher.on}` };
  }

  return { view, nerosView, refresher };
}
