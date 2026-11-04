// Fix loop: a field report becomes a case, the case gets an engineer and a
// partner unit, a change ships to that unit, and the case closes only when the
// end-of-flight records show the change worked (docs/design/round-two.md,
// build 6).
//
// Why: closing a ticket is not fixing a drone. The measure is a
// difference-in-differences: the partner unit's rate of the case's outcome
// after the change, less before, against the same difference for the units
// that did not get it. That nets out what moved for everyone (weather,
// jamming, tempo). A case closes only when the measured improvement clears a
// one-sided 90% bar on enough sorties. If it does not, the change did not
// work, and the case stays open for the next one.
//
// The before window is this demo's own end-of-flight records. The after window
// is simulated field sorties ("trial days"), because the demo clock stops at
// today; each change has a true effect hidden from the page, and some changes
// do nothing. All SIM. Pure JavaScript.

import { TODAY } from "./company.mjs";
import { addDays } from "./serials.mjs";

/** Which end-of-flight outcome measures each field-report theme. */
export const THEME_METRIC = {
  airframe: { outcome: "hw_fault", label: "hardware faults" },
  power: { outcome: "battery", label: "battery endings" },
  link: { outcome: "lost_link", label: "lost-link endings" },
  nav: { outcome: "lost_nav", label: "lost-navigation endings" },
  video: { outcome: "aborted", label: "aborted sorties" },
  console: { outcome: "aborted", label: "aborted sorties" },
  other: { outcome: "unknown", label: "unexplained endings" },
};

export const RULE = { before_days: 14, min_after: 40, z: 1.28, trial_days_per_collect: 14, trial_sorties_per_day: 8 };

// What each kind of change really does to the rate (hidden from the page). 1 = nothing.
/** Who a case in each theme goes to by default. */
export const ENGINEER_FOR = { airframe: "Propulsion engineer", power: "Power engineer", link: "RF engineer", nav: "Navigation engineer", video: "Video systems engineer", console: "Console engineer", other: "Console engineer" };

const TRUE_EFFECT = { airframe: 0.3, power: 0.6, link: 1, nav: 0.55, video: 0.4, console: 1, other: 1 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const rate = (k, n) => (n ? k / n : null);

/** @param {{ serials: any, triage: () => any[], org?: string, units?: string[] }} deps */
export function createCases({ serials, triage, org = "CUS-A", units = ["Alpha", "Bravo", "Charlie", "Delta"] }) {
  let seq = 102;
  const cases = [];

  // Before-window rate per unit from the real records.
  function before(c) {
    const from = addDays(c.shipped, -RULE.before_days);
    const out = {};
    for (const u of units) {
      const recs = serials.records.filter((r) => r.org === org && r.unit === u && r.day >= from && r.day < c.shipped);
      out[u] = { n: recs.length, k: recs.filter((r) => r.outcome === c.metric.outcome).length };
    }
    return out;
  }

  // Simulated field sorties after the change, per unit; the partner unit carries the change's true effect.
  function collect(c, days = RULE.trial_days_per_collect) {
    const base = before(c);
    const r = mulberry32(Number(c.id.replace(/\D/g, "")) * 97 + c.trial.length * 13);
    const pooled = Object.values(base).reduce((a, b) => ({ n: a.n + b.n, k: a.k + b.k }), { n: 0, k: 0 });
    for (let d = 0; d < days; d += 1) {
      const day = addDays(c.shipped, c.trial_days + d);
      for (const u of units) {
        const b = base[u];
        // Shrink a small unit's rate towards the pooled one so a quiet week does not set the baseline.
        const p0 = (b.k + 5 * rate(pooled.k, pooled.n || 1)) / (b.n + 5);
        const p = u === c.partner ? p0 * c.effect : p0;
        let k = 0;
        for (let i = 0; i < RULE.trial_sorties_per_day; i += 1) if (r() < p) k += 1;
        c.trial.push({ day, unit: u, n: RULE.trial_sorties_per_day, k });
      }
    }
    c.trial_days += days;
  }

  function measure(c) {
    if (!c.shipped) return null;
    const b = before(c);
    const after = {};
    for (const u of units) after[u] = c.trial.filter((t) => t.unit === u).reduce((a, t) => ({ n: a.n + t.n, k: a.k + t.k }), { n: 0, k: 0 });
    const sum = (m, us) => us.reduce((a, u) => ({ n: a.n + m[u].n, k: a.k + m[u].k }), { n: 0, k: 0 });
    const controls = units.filter((u) => u !== c.partner);
    const pb = b[c.partner];
    const pa = after[c.partner];
    const cb = sum(b, controls);
    const ca = sum(after, controls);
    const p = (x) => rate(x.k, x.n);
    const ready = pb.n > 0 && cb.n > 0 && pa.n >= RULE.min_after && ca.n >= RULE.min_after;
    const v = (x) => (x.n ? (p(x) * (1 - p(x))) / x.n : 0);
    const did = ready ? p(pa) - p(pb) - (p(ca) - p(cb)) : null;
    // A floor on the standard error so a zero-count week cannot make any change look certain.
    const se = ready ? Math.max(Math.sqrt(v(pa) + v(pb) + v(ca) + v(cb)), 0.005) : null;
    const z = ready ? did / se : null;
    const improved = ready && z <= -RULE.z;
    return {
      ready, improved,
      partner: { unit: c.partner, before: { ...pb, rate: p(pb) }, after: { ...pa, rate: p(pa) } },
      control: { units: controls, before: { ...cb, rate: p(cb) }, after: { ...ca, rate: p(ca) } },
      did, se, z: z == null ? null : Number(z.toFixed(2)),
      verdict: !ready
        ? `Not enough sorties since the change: ${pa.n} on ${c.partner} and ${ca.n} on the control units, ${RULE.min_after} needed on each.`
        : improved
          ? `The change cut ${c.metric.label} on ${c.partner} by ${Math.abs(did * 100).toFixed(1)} points more than on the control units (z = ${z.toFixed(2)}).`
          : `No measured improvement: ${c.partner} moved ${(did * 100).toFixed(1)} points against the control units (z = ${z.toFixed(2)}, needs ${-RULE.z} or lower). The change did not work, or not yet.`,
    };
  }

  function make(theme, title, reported, partner, extra = {}) {
    const metric = THEME_METRIC[theme] ?? THEME_METRIC.other;
    const c = {
      id: `CASE-${(seq += 1)}`, theme, title, reported, partner, metric,
      status: "open", engineer: null, change: null, shipped: null, closed: null, measured: null,
      effect: TRUE_EFFECT[theme] ?? 1, trial: [], trial_days: 0, history: [{ day: reported, what: "Opened from field reports" }],
      ...extra,
    };
    cases.push(c);
    return c;
  }

  // Seeds: one closed and measured, one shipped awaiting data, one assigned whose change will not work.
  {
    const v = make("video", "Video feed freezes after link handover", "2026-10-08", "Bravo", { engineer: "Video systems engineer", change: "VTX firmware 2.1 canary", shipped: "2026-10-20", status: "shipped" });
    v.history.push({ day: "2026-10-12", what: "Assigned to Video systems engineer" }, { day: "2026-10-20", what: "Shipped VTX firmware 2.1 canary to Bravo" });
    collect(v, 21);
    const m = measure(v);
    if (m?.improved) {
      v.status = "closed";
      v.closed = "2026-11-01";
      v.measured = m;
      v.history.push({ day: v.closed, what: `Closed: ${m.verdict}` });
    }
    const e = make("airframe", "ESC desync on 8-inch airframes", "2026-10-18", "Charlie", { engineer: "Propulsion engineer", change: "ESC lot ESC-2611 swapped for ESC-2603 on issued airframes", shipped: addDays(TODAY, -1), status: "shipped" });
    e.history.push({ day: "2026-10-21", what: "Assigned to Propulsion engineer" }, { day: e.shipped, what: `Shipped: ${e.change}` });
    const l = make("link", "Link drops under jamming at range", "2026-10-25", "Bravo", { engineer: "RF engineer", status: "assigned" });
    l.history.push({ day: "2026-10-28", what: "Assigned to RF engineer" });
  }

  function row(c) {
    const m = c.measured ?? measure(c);
    return {
      id: c.id, theme: c.theme, title: c.title, metric: c.metric.label, reported: c.reported, partner: c.partner,
      status: c.status, engineer: c.engineer, change: c.change, shipped: c.shipped, closed: c.closed,
      trial_days: c.trial_days, measurement: m, measured: Boolean(c.measured),
      days_to_fix: c.closed ? daysBetween(c.reported, c.closed) : null,
      history: c.history.slice(),
    };
  }

  function stats() {
    const closed = cases.filter((c) => c.closed).map((c) => daysBetween(c.reported, c.closed)).sort((a, b) => a - b);
    const median = closed.length ? closed[Math.floor((closed.length - 1) / 2)] : null;
    return { open: cases.filter((c) => !c.closed).length, closed: closed.length, median_days: median, awaiting_data: cases.filter((c) => c.status === "shipped").length };
  }

  function view() {
    const t = triage();
    const covered = new Set(cases.filter((c) => !c.closed).map((c) => c.theme));
    return {
      source: "Simulated: the before window is this demo's end-of-flight records; the after window is simulated field sorties. Each change's true effect is hidden from this page.",
      today: TODAY, rule: RULE, units,
      cases: cases.map(row),
      stats: stats(),
      themes: t.map((x) => ({ theme: x.theme, label: x.label, count: x.count, units: x.units, latest: x.latest, concentrated: x.concentrated, has_case: covered.has(x.theme) })),
      engineers: [...new Set(Object.values(ENGINEER_FOR))],
    };
  }

  function act(action, a, actor) {
    if (action === "case.open") {
      const t = triage().find((x) => x.theme === a.theme);
      if (!t) return { error: "no field reports in that theme", status: 404 };
      if (cases.some((c) => c.theme === t.theme && !c.closed)) return { error: `${t.label} already has an open case`, status: 409 };
      const partner = units.includes(a.partner) ? a.partner : (t.units.find((u) => units.includes(u)) ?? units[0]);
      const c = make(t.theme, `${t.label}: ${t.count} field reports`, String(t.latest || TODAY).slice(0, 10), partner);
      c.history[0].what = `Opened from ${t.count} field reports by ${actor}`;
      return { ok: true, message: `${c.id} opened for ${t.label}, partner unit ${partner}. Measured by ${c.metric.label}.`, id: c.id };
    }
    const c = cases.find((x) => x.id === a.id);
    if (!c) return { error: "no such case", status: 404 };
    if (c.closed) return { error: `${c.id} closed on ${c.closed}`, status: 409 };
    if (action === "case.assign") {
      const who = String(a.engineer ?? "").trim();
      if (!who) return { error: "name the engineer", status: 400 };
      c.engineer = who;
      if (c.status === "open") c.status = "assigned";
      c.history.push({ day: TODAY, what: `Assigned to ${who} by ${actor}` });
      return { ok: true, message: `${c.id} assigned to ${who}.` };
    }
    if (action === "case.ship") {
      if (!c.engineer) return { error: "Assign an engineer before shipping a change", status: 409 };
      const change = String(a.change ?? "").trim();
      if (!change) return { error: "describe the change that shipped", status: 400 };
      c.change = change;
      c.shipped = TODAY;
      c.status = "shipped";
      c.trial = [];
      c.trial_days = 0;
      c.history.push({ day: TODAY, what: `Shipped to ${c.partner}: ${change}` });
      return { ok: true, message: `${c.id}: ${change} shipped to ${c.partner}. The case closes when the records show it worked.` };
    }
    if (action === "case.collect") {
      if (!c.shipped) return { error: "Nothing has shipped yet, so there is nothing to measure", status: 409 };
      collect(c);
      const m = measure(c);
      return { ok: true, message: `${c.id}: ${c.trial_days} days of field sorties since the change. ${m.verdict}` };
    }
    if (action === "case.close") {
      const m = measure(c);
      if (!m) return { error: "Nothing has shipped yet: a case closes only on a measured effect", status: 409 };
      if (!m.ready) return { error: m.verdict, status: 409 };
      if (!m.improved) return { error: `${m.verdict} Ship another change to ${c.partner}.`, status: 409 };
      c.status = "closed";
      c.closed = TODAY;
      c.measured = m;
      c.history.push({ day: TODAY, what: `Closed by ${actor}: ${m.verdict}` });
      return { ok: true, message: `${c.id} closed. ${m.verdict}` };
    }
    return { error: "unknown action", status: 400 };
  }

  function queueItems() {
    const out = [];
    for (const c of cases.filter((x) => !x.closed)) {
      const m = measure(c);
      if (c.status === "shipped" && m?.improved) {
        out.push({ id: `q-case-${c.id}`, area: "Quality", severity: "medium", org: null, title: `${c.id}: the fix measured, ready to close`, detail: m.verdict, actions: [{ label: "Close with the measurement", action: "market.case.close", args: { id: c.id }, primary: true }] });
      } else if (!c.engineer) {
        out.push({ id: `q-case-${c.id}`, area: "Quality", severity: "medium", org: null, title: `${c.id}: ${c.title} has no engineer`, detail: `Reported ${c.reported}; partner unit ${c.partner}.`, actions: [{ label: `Assign the ${ENGINEER_FOR[c.theme] ?? "Console engineer"}`, action: "market.case.assign", args: { id: c.id, engineer: ENGINEER_FOR[c.theme] ?? "Console engineer" }, primary: true }] });
      }
    }
    return out;
  }

  return { view, act, measure: (id) => { const c = cases.find((x) => x.id === id); return c ? measure(c) : null; }, queueItems, stats };
}
