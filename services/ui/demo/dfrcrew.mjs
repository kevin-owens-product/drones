// The responder program's people: each contract pilot's currency file and the
// console roster. The program staffs one pilot on console twelve hours a day,
// every day, and never leaves a scheduled shift unstaffed. A pilot works a
// shift alone only once their certificate, recurrent training, credentials and
// supervised time are on file and the program manager has signed them off.
//
// Names, certificate numbers and dates are made up (SIM). The thresholds are
// the ones a public agency's contract states: Part 107 recurrent training
// within 24 calendar months, 100 logged hours with 25 from a docked console,
// three supervised console shifts and ten supervised flights before solo.
// Pure JavaScript.

export const RULES = { recurrent_months: 24, hours: 100, docked_hours: 25, supervised_shifts: 3, supervised_flights: 10, warn_days: 30 };
export const SHIFT_HOURS = { start: "07:00", end: "19:00", hours: 12 };

const SEED = [
  { id: "P-01", name: "A. Reyes", cert: "4417203", cert_issued: "2022-03-14", recurrent: "2025-02-10", background: "cleared", twic_expires: "2026-10-30", cjis: "cleared", hours: 412, docked_hours: 96, controlled_airspace: true, supervised_shifts: 3, supervised_flights: 14, solo_on: "2025-06-01", rate: "standard" },
  { id: "P-02", name: "J. Park", cert: "4598812", cert_issued: "2023-05-02", recurrent: "2025-09-01", background: "cleared", twic_expires: "2028-04-18", cjis: "cleared", hours: 268, docked_hours: 141, controlled_airspace: true, supervised_shifts: 3, supervised_flights: 12, solo_on: "2025-04-12", rate: "lead" },
  { id: "P-03", name: "S. Whitfield", cert: "4702291", cert_issued: "2024-11-15", recurrent: "2024-11-15", background: "cleared", twic_expires: "2027-08-02", cjis: "cleared", hours: 155, docked_hours: 38, controlled_airspace: true, supervised_shifts: 4, supervised_flights: 11, solo_on: "2026-01-20", rate: "standard" },
  { id: "P-04", name: "T. Nguyen", cert: "4810557", cert_issued: "2026-02-20", recurrent: "2026-02-20", background: "cleared", twic_expires: "2029-01-10", cjis: "pending", hours: 118, docked_hours: 27, controlled_airspace: true, supervised_shifts: 3, supervised_flights: 10, solo_on: null, rate: "onboarding" },
];

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** @param {{ today: string }} o */
export function createCrew({ today }) {
  const pilots = SEED.map((p) => ({ ...p }));
  // Fourteen days of console shifts, one pilot each. Two problems are seeded: an empty day, and a pilot not yet cleared for solo working alone.
  const plan = ["P-02", "P-03", "P-01", "P-02", "P-03", null, "P-02", "P-04", "P-03", "P-04", "P-02", "P-03", "P-02", "P-03"];
  const roster = plan.map((pilot, i) => ({ date: addDays(today, i), pilot, supervised_by: i === 7 ? "P-02" : null }));
  const byId = (id) => pilots.find((p) => p.id === id);

  /** Each line of a pilot's file: what is on record, whether it holds today, and when it next falls due. */
  function file(p) {
    const due = addMonths(p.recurrent, RULES.recurrent_months);
    const items = [];
    const add = (key, label, value, level, note = "") => items.push({ key, label, value, level, note });
    add("cert", "FAA Remote Pilot Certificate, Part 107", `No. ${p.cert}, issued ${p.cert_issued}`, "ok");
    const left = daysBetween(today, due);
    add("recurrent", "Part 107 recurrent training", `${p.recurrent}, due ${due}`, left < 0 ? "fail" : left <= RULES.warn_days ? "warn" : "ok", left < 0 ? "Lapsed: not assignable" : left <= RULES.warn_days ? `Due in ${left} days` : "");
    add("hours", "Logged sUAS PIC hours", `${p.hours} h, ${p.docked_hours} h from a docked console`, p.hours >= RULES.hours && p.docked_hours >= RULES.docked_hours ? "ok" : "fail", `Needs ${RULES.hours} h with ${RULES.docked_hours} h docked`);
    add("airspace", "Controlled airspace experience", p.controlled_airspace ? "Documented" : "Not documented", p.controlled_airspace ? "ok" : "fail");
    add("background", "Police background investigation", p.background, p.background === "cleared" ? "ok" : "fail");
    const twic = daysBetween(today, p.twic_expires);
    add("twic", "TWIC", `Expires ${p.twic_expires}`, twic < 0 ? "fail" : twic <= RULES.warn_days ? "warn" : "ok", twic < 0 ? "Expired: not assignable until renewed" : twic <= RULES.warn_days ? `Expires in ${twic} days` : "");
    add("cjis", "CJIS clearance", p.cjis, p.cjis === "cleared" ? "ok" : "warn", p.cjis === "cleared" ? "" : "Records-system access limited until cleared");
    add("supervised", "Supervised console time", `${p.supervised_shifts} shifts, ${p.supervised_flights} flights`, p.supervised_shifts >= RULES.supervised_shifts && p.supervised_flights >= RULES.supervised_flights ? "ok" : "warn", `Needs ${RULES.supervised_shifts} shifts and ${RULES.supervised_flights} flights before solo`);
    add("solo", "Program manager's solo sign-off", p.solo_on ?? "Not yet", p.solo_on ? "ok" : "warn");
    const blocking = items.filter((x) => x.level === "fail").map((x) => `${x.label}: ${x.note || x.value}`);
    const assignable = blocking.length === 0;
    const solo = assignable && Boolean(p.solo_on);
    const certifiable = assignable && !p.solo_on && p.supervised_shifts >= RULES.supervised_shifts && p.supervised_flights >= RULES.supervised_flights;
    return { ...p, recurrent_due: due, items, assignable, solo, certifiable, blocking, warnings: items.filter((x) => x.level === "warn" && x.key !== "solo" && x.key !== "supervised").map((x) => `${x.label}: ${x.note}`) };
  }

  /** The roster with every problem named: an empty shift, a pilot who cannot work, a pilot working alone before sign-off. */
  function rosterView() {
    return roster.map((r) => {
      const p = r.pilot ? file(byId(r.pilot)) : null;
      const flags = [];
      if (!p) flags.push("Unstaffed: no pilot on console. Unstaffed hours are not payable and the gap must be reported.");
      else {
        if (!p.assignable) flags.push(`${p.name} cannot work: ${p.blocking.join("; ")}`);
        if (p.assignable && !p.solo && !r.supervised_by) flags.push(`${p.name} is not cleared for solo shifts and has no supervising pilot`);
      }
      return { ...r, pilot_name: p?.name ?? null, supervised_by_name: r.supervised_by ? byId(r.supervised_by)?.name : null, flags };
    });
  }

  function view() {
    const files = pilots.map(file);
    const days = rosterView();
    return {
      rules: RULES,
      shift_hours: SHIFT_HOURS,
      pilots: files,
      roster: days,
      counts: {
        pilots: files.length,
        solo: files.filter((p) => p.solo).length,
        not_assignable: files.filter((p) => !p.assignable).length,
        coverage_gaps: days.filter((d) => !d.pilot).length,
        roster_flags: days.filter((d) => d.flags.length).length,
        scheduled_hours: days.length * SHIFT_HOURS.hours,
        staffed_hours: days.filter((d) => d.pilot && d.flags.length === 0).length * SHIFT_HOURS.hours,
      },
    };
  }

  /** Put a pilot on a day. Refused when they cannot work, or would work alone before sign-off without a supervising pilot. */
  function assign(date, pilotId, supervisedBy = null) {
    const day = roster.find((r) => r.date === date);
    if (!day) return { ok: false, why: "That day is not on this roster." };
    if (!pilotId) {
      day.pilot = null;
      day.supervised_by = null;
      return { ok: true, message: `${date} cleared. It now shows as a coverage gap.` };
    }
    const p = byId(pilotId);
    if (!p) return { ok: false, why: "No such pilot." };
    const f = file(p);
    if (!f.assignable) return { ok: false, why: `${p.name} cannot be rostered: ${f.blocking.join("; ")}.` };
    let sup = null;
    if (!f.solo) {
      sup = supervisedBy ? byId(supervisedBy) : null;
      if (!sup || !file(sup).solo) return { ok: false, why: `${p.name} is not cleared for solo shifts. Add a supervising pilot who is.` };
    }
    day.pilot = p.id;
    day.supervised_by = sup?.id ?? null;
    return { ok: true, message: `${p.name} on console ${date}${sup ? `, supervised by ${sup.name}` : ""}.` };
  }

  /** The program manager's written sign-off that a pilot may work unsupervised. */
  function certify(pilotId, by) {
    const p = byId(pilotId);
    if (!p) return { ok: false, why: "No such pilot." };
    const f = file(p);
    if (f.solo) return { ok: false, why: `${p.name} is already cleared for solo shifts.` };
    if (!f.certifiable) return { ok: false, why: `${p.name} is not ready: ${f.blocking.length ? f.blocking.join("; ") : `needs ${RULES.supervised_shifts} supervised shifts and ${RULES.supervised_flights} supervised flights`}.` };
    p.solo_on = today;
    p.solo_by = by;
    return { ok: true, message: `${p.name} cleared for solo shifts by ${by}, ${today}.` };
  }

  /** Who is rostered on a date. */
  const onDuty = (date) => roster.find((r) => r.date === date) ?? null;

  return { view, assign, certify, onDuty, file: (id) => (byId(id) ? file(byId(id)) : null), pilots, roster };
}
