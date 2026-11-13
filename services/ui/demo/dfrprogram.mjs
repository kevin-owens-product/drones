// The responder program's month: what the contractor reports and bills, how the
// agency checks it, how long each record is kept, and what leaves the building
// when someone asks for the records.
//
//   - Monthly activity report: calls, flights, response times, hours staffed
//     against hours scheduled, gaps, mishaps, pilot currency and aircraft care.
//   - Invoice built from the signed shift logs: staffed console hours at the
//     contract rate. Unstaffed hours are not payable. A shift whose flight
//     records are not filed has its hours held until they are.
//   - Weekly battery and aircraft care log per aircraft, signed by the pilot.
//     An overdue check is a caution on the console; a failed pack grounds the
//     aircraft until a passing check is signed.
//   - Retention by record type, legal hold, and a records request that packages
//     the matching records with redactions and a hash manifest.
//
// Everything is simulated (SIM): the rate, policy periods, history and people
// are made up. Pure JavaScript, no Node imports.

import { sha256Hex } from "./ledger.mjs";

/** Contract terms the invoice applies (SIM). */
export const CONTRACT = { rate_usd: 124, period: "2026-10", label: "October 2026", number: "INV-2026-10", contractor: "Contract pilot company (SIM)" };
/** How long each kind of record is kept before it may be destroyed, unless a legal hold stops the clock (SIM policy). */
export const RETENTION = [
  { type: "flight_record", label: "Flight records and video", years: 2, from: "filing" },
  { type: "shift_log", label: "Shift logs", years: 3, from: "signing" },
  { type: "mishap", label: "Mishap reports", years: 5, from: "filing" },
  { type: "care_log", label: "Aircraft care log", years: 3, from: "signing" },
  { type: "request", label: "Records-request packages", years: 2, from: "release" },
];
export const CARE_DAYS = 7;
/** A pack is retired below this health or above this cell spread, or if it is swollen at all. */
export const PACK_LIMITS = { health_pct: 80, spread_mv: 30 };

const r1 = (v) => Math.round(v * 10) / 10;
function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addYears(isoDate, n) {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** A small seeded generator, so the made-up history is the same on every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pct(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/**
 * Shift logs for the days before the hand-built week: a month of console history to report and bill.
 * One day has a late relief and one has nobody on console, so the invoice has something to exclude.
 */
export function history(fromDate, toDate, pilotName) {
  const next = rng(20261001);
  const out = [];
  const order = ["P-02", "P-03", "P-01", "P-02", "P-03", "P-01", "P-02"];
  const notes = {
    weather: ["Fog under 1,000 ft over the outer harbor", "Gusts 14 m/s at the breakwater", "Rain cell over the main channel"],
    airspace: ["Medical helicopter landing at the pier heliport", "TFR over the cruise terminal for a ship call"],
    battery: ["Nearest aircraft at 54% after the previous call"],
    aircraft: ["DFR-01 compass fault on pre-flight"],
  };
  for (let date = fromDate, i = 0; date <= toDate; date = addDays(date, 1), i += 1) {
    const rpic = order[i % order.length];
    const unstaffed = date.endsWith("-19");
    const late = date.endsWith("-14") ? 45 : 0;
    const flights = unstaffed ? 0 : 2 + Math.floor(next() * 5);
    const declined = [];
    if (!unstaffed && next() < 0.35) {
      const reason = ["weather", "weather", "airspace", "battery", "aircraft"][Math.floor(next() * 5)];
      const pick = notes[reason];
      declined.push({ reason, note: pick[Math.floor(next() * pick.length)] });
    }
    const launch_s = Array.from({ length: flights }, () => 28 + Math.round(next() * 40));
    const scene_s = launch_s.map((l) => l + 45 + Math.round(next() * 110));
    const staffed = unstaffed ? 0 : r1(12 - late / 60);
    out.push({
      id: `SH-${date}`,
      date,
      rpic: unstaffed ? "Nobody on console" : pilotName(rpic),
      supervisor: "Sgt. M. Ortega",
      scheduled_h: 12,
      staffed_h: staffed,
      flights,
      flight_ids: [],
      calls: flights + declined.length,
      launch_s,
      scene_s,
      declined,
      gaps: unstaffed ? ["07:00 to 19:00: no pilot on console. The rostered pilot called in sick at 05:40; no relief was available. Reported to the program manager."] : late ? [`07:00 to 07:${late}: relief pilot late. Reported to the program manager at 06:50.`] : [],
      discrepancies: [],
      aircraft_start: "All four docks ready",
      aircraft_end: "All four docks ready",
      records_unfiled: 0,
      signed_by: unstaffed ? "Sgt. M. Ortega (no pilot on console)" : pilotName(rpic),
      signed_at: `${date}T19:0${i % 10}:00.000Z`,
    });
  }
  return out;
}

/** Response times for a log that does not carry them (the hand-built week): made up the same way, from its id. */
export function responses(log) {
  if (log.launch_s) return log;
  const next = rng([...log.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const launch_s = Array.from({ length: log.flights }, () => 28 + Math.round(next() * 40));
  return { ...log, calls: log.flights + log.declined.length, launch_s, scene_s: launch_s.map((l) => l + 45 + Math.round(next() * 110)) };
}

/**
 * @param {object} o
 * @param {() => string} o.today the console's date (moves at each shift hand-off)
 * @param {{ append: Function, items: Function }} o.evidence the evidence chain
 * @param {(id: string) => string} o.pilotName
 */
export function createProgram({ today, evidence, pilotName }) {
  // ---- Aircraft care: three weeks of weekly checks, one aircraft overdue, one pack near retirement ----
  const care = [];
  const seedCare = [
    { tail: "DFR-01", last: "2026-10-31", cycles: 212, health: [94, 94, 93], spread: [8, 9, 9], by: "P-01" },
    { tail: "DFR-02", last: "2026-11-01", cycles: 188, health: [96, 95, 95], spread: [6, 7, 7], by: "P-02" },
    { tail: "DFR-03", last: "2026-10-30", cycles: 240, health: [84, 83, 81], spread: [18, 21, 24], by: "P-03" },
    { tail: "DFR-04", last: "2026-10-25", cycles: 97, health: [97, 97, 96], spread: [5, 5, 6], by: "P-02" },
  ];
  for (const s of seedCare) {
    for (let w = 2; w >= 0; w -= 1) {
      const date = addDays(s.last, -7 * w);
      const entry = { tail: s.tail, date, by: pilotName(s.by), cycles: s.cycles - 14 * w, health_pct: s.health[2 - w], spread_mv: s.spread[2 - w], swelling: false, props: "No nicks or cracks", motors: "Spin free, no noise", dock: "Seals, contacts and filter clean", notes: s.tail === "DFR-03" && w === 0 ? "Pack health down 3% in two weeks; watch it." : "", pass: true };
      const row = evidence.append({ actor: entry.by, action: "care.sign", resource_type: "care_log", resource_id: `${s.tail}@${date}`, detail: JSON.stringify(entry), at: Date.parse(`${date}T15:00:00Z`) });
      care.push({ ...entry, hash: row.row_hash });
    }
  }

  /** Where an aircraft stands on care: last check, when the next is due, and whether its pack keeps it on the ground. */
  function careOf(tail) {
    const last = care.filter((c) => c.tail === tail).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
    const due = last ? addDays(last.date, CARE_DAYS) : today();
    const overdue = daysBetween(due, today());
    return { tail, last, due, overdue_days: Math.max(0, overdue), overdue: overdue > 0, grounded: Boolean(last && !last.pass), why: last && !last.pass ? last.fail_reason : null };
  }

  function signCare(args, by, now) {
    const tail = String(args.tail ?? "");
    const prev = careOf(tail).last;
    if (!prev) return { ok: false, status: 404, why: "No such aircraft." };
    const health = Number(args.health_pct);
    const spread = Number(args.spread_mv);
    if (!(health > 0 && health <= 100) || !(spread >= 0 && spread < 1000)) return { ok: false, status: 400, why: "Enter pack health (%) and cell spread (mV) from the battery report." };
    const swelling = Boolean(args.swelling);
    const fails = [];
    if (health < PACK_LIMITS.health_pct) fails.push(`pack health ${health}% (retire under ${PACK_LIMITS.health_pct}%)`);
    if (spread > PACK_LIMITS.spread_mv) fails.push(`cell spread ${spread} mV (retire over ${PACK_LIMITS.spread_mv} mV)`);
    if (swelling) fails.push("pack swollen");
    if (args.props_ok === false) fails.push("propellers damaged");
    const date = today();
    const entry = { tail, date, by, cycles: Number(args.cycles) || prev.cycles + 7, health_pct: health, spread_mv: spread, swelling, props: args.props_ok === false ? "Damaged: replace before flight" : "No nicks or cracks", motors: "Spin free, no noise", dock: "Seals, contacts and filter clean", notes: String(args.notes ?? "").trim(), pass: fails.length === 0, fail_reason: fails.length ? fails.join("; ") : undefined };
    const row = evidence.append({ actor: by, action: "care.sign", resource_type: "care_log", resource_id: `${tail}@${date}`, detail: JSON.stringify(entry), at: now });
    care.push({ ...entry, hash: row.row_hash });
    return { ok: true, pass: entry.pass, message: entry.pass ? `${tail} care check signed. Next due ${addDays(date, CARE_DAYS)}.` : `${tail} grounded: ${entry.fail_reason}. Replace the pack, then sign a passing check to fly it again.` };
  }

  function careView() {
    const tails = [...new Set(care.map((c) => c.tail))];
    return {
      limits: PACK_LIMITS,
      every_days: CARE_DAYS,
      aircraft: tails.map((t) => ({ ...careOf(t), history: care.filter((c) => c.tail === t).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4) })),
    };
  }

  // ---- Retention and legal holds ----
  const holds = new Map();
  function retention(type, startIso, id) {
    const rule = RETENTION.find((r) => r.type === type);
    const hold = holds.get(id) ?? null;
    return { until: startIso ? addYears(startIso, rule.years) : null, rule: `${rule.label}: ${rule.years} years from ${rule.from}`, hold };
  }
  function setHold(id, matter, by, now) {
    if (holds.has(id)) return { ok: false, why: `${id} is already on hold for ${holds.get(id).matter}.` };
    const m = String(matter ?? "").trim();
    if (m.length < 4) return { ok: false, why: "Name the matter or case the hold is for." };
    const hold = { matter: m, by, at: new Date(now).toISOString() };
    const row = evidence.append({ actor: by, action: "hold.place", resource_type: "legal_hold", resource_id: id, detail: JSON.stringify(hold), at: now });
    holds.set(id, { ...hold, hash: row.row_hash });
    return { ok: true, message: `${id} on legal hold for ${m}. It is kept past its retention date until the hold is lifted.` };
  }
  function liftHold(id, by, now) {
    const h = holds.get(id);
    if (!h) return { ok: false, why: `${id} is not on hold.` };
    evidence.append({ actor: by, action: "hold.lift", resource_type: "legal_hold", resource_id: id, detail: JSON.stringify({ matter: h.matter }), at: now });
    holds.delete(id);
    return { ok: true, message: `Hold on ${id} lifted. Its retention clock applies again.` };
  }

  // ---- Records requests: what matches, what is redacted, and the manifest that proves what left ----
  const requests = [];
  const REDACT = [
    { what: "licence plate", re: /\b\d[A-Z]{3}\d{3}\b/g },
    { what: "phone number", re: /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g },
    { what: "private person's name", re: /\b(?:Mr|Ms|Mrs|Mx)\.? [A-Z][a-z]+\b/g },
  ];
  function redact(text) {
    let out = String(text ?? "");
    const found = [];
    for (const r of REDACT) {
      out = out.replace(r.re, () => {
        found.push(r.what);
        return `[${r.what} redacted]`;
      });
    }
    return { text: out, found };
  }

  /** @param {object} args @param {{ records: any[], shiftLogs: any[] }} src */
  function createRequest(args, src, by, now) {
    const requester = String(args.requester ?? "").trim();
    const incident = String(args.incident ?? "").trim();
    const from = String(args.from ?? "").slice(0, 10);
    const to = String(args.to ?? "").slice(0, 10) || from;
    if (requester.length < 3) return { ok: false, status: 400, why: "Who is asking? Name the requester." };
    if (!incident && !from) return { ok: false, status: 400, why: "Give an incident number or a date range." };
    const inRange = (d) => from && d >= from && d <= to;
    const recs = src.records.filter((r) => r.versions.length && (incident ? r.fields.incident === incident : inRange(r.fields.launch_at.slice(0, 10))));
    const logs = incident ? [] : src.shiftLogs.filter((l) => inRange(l.date));
    if (!recs.length && !logs.length) return { ok: false, status: 404, why: incident ? `No filed record carries incident ${incident}.` : `Nothing filed between ${from} and ${to}.` };
    const items = [
      ...recs.map((r) => {
        const v = r.versions.at(-1);
        const n = redact(v.fields.narrative);
        const a = redact(v.fields.anomaly);
        return { id: r.id, type: "flight_record", version: v.v, versions: r.versions.length, sha256: v.hash, fields: { ...v.fields, narrative: n.text, anomaly: a.text }, redacted: [...n.found, ...a.found] };
      }),
      ...logs.map((l) => ({ id: l.id, type: "shift_log", version: 1, versions: 1, sha256: l.hash, fields: { date: l.date, rpic: l.rpic, staffed_h: l.staffed_h, flights: l.flights, declined: l.declined, gaps: l.gaps }, redacted: [] })),
    ];
    const seq = 142 + requests.length;
    const req = { id: `RR-2026-${String(seq).padStart(4, "0")}`, requester, number: String(args.number ?? "").trim(), scope: incident ? `Incident ${incident}` : `${from} to ${to}`, created_at: new Date(now).toISOString(), created_by: by, status: "review", items, released_at: null, released_by: null };
    req.manifest = items.map((x) => ({ id: x.id, version: x.version, sha256: x.sha256, redactions: x.redacted.length }));
    req.package_sha256 = sha256Hex(JSON.stringify({ id: req.id, scope: req.scope, items }));
    requests.unshift(req);
    return { ok: true, message: `${req.id}: ${items.length} item${items.length === 1 ? "" : "s"} gathered, ${items.reduce((s, x) => s + x.redacted.length, 0)} redactions. Review it, then release.` };
  }

  function releaseRequest(id, by, now, chainIntact) {
    const req = requests.find((r) => r.id === id);
    if (!req) return { ok: false, status: 404, why: "No such request." };
    if (req.status === "released") return { ok: false, status: 409, why: `${id} was released ${req.released_at.slice(0, 10)}.` };
    if (!chainIntact) return { ok: false, status: 409, why: "The evidence chain does not verify. Nothing is released until it does." };
    req.status = "released";
    req.released_at = new Date(now).toISOString();
    req.released_by = by;
    const row = evidence.append({ actor: by, action: "request.release", resource_type: "records_request", resource_id: id, detail: JSON.stringify({ requester: req.requester, scope: req.scope, package_sha256: req.package_sha256, manifest: req.manifest }), at: now });
    req.hash = row.row_hash;
    return { ok: true, message: `${id} released to ${req.requester}. The manifest and package hash are sealed in the evidence chain.` };
  }

  // ---- The month: activity report and invoice from the signed shift logs ----
  let month = { status: "draft", submitted: null, decided: null, history: [] };

  /** @param {{ shiftLogs: any[], records: any[], mishaps: any[], crewView: any }} src */
  function report(src) {
    const logs = src.shiftLogs.filter((l) => l.date.startsWith(CONTRACT.period)).map(responses).sort((a, b) => (a.date < b.date ? -1 : 1));
    const launch = logs.flatMap((l) => l.launch_s ?? []);
    const scene = logs.flatMap((l) => l.scene_s ?? []);
    const declined = {};
    for (const l of logs) for (const x of l.declined) declined[x.reason] = (declined[x.reason] ?? 0) + 1;
    const pilots = {};
    for (const l of logs.filter((x) => x.staffed_h > 0)) {
      const p = (pilots[l.rpic] ??= { pilot: l.rpic, shifts: 0, hours: 0, flights: 0 });
      p.shifts += 1;
      p.hours = r1(p.hours + l.staffed_h);
      p.flights += l.flights;
    }
    const scheduled = logs.reduce((s, l) => s + l.scheduled_h, 0);
    const staffed = r1(logs.reduce((s, l) => s + l.staffed_h, 0));
    const open = src.records.filter((r) => r.status !== "filed" && logs.some((l) => (l.flight_ids ?? []).includes(r.flight)));
    const mishaps = src.mishaps.filter((m) => new Date(m.verbal_at).toISOString().startsWith(CONTRACT.period));
    const careDue = careView().aircraft;
    return {
      period: CONTRACT.period,
      label: CONTRACT.label,
      shifts: logs.length,
      scheduled_h: scheduled,
      staffed_h: staffed,
      staffed_pct: scheduled ? r1((staffed / scheduled) * 100) : 0,
      gaps: logs.filter((l) => l.gaps.length).map((l) => ({ date: l.date, hours: r1(l.scheduled_h - l.staffed_h), why: l.gaps.join(" ") })),
      calls: logs.reduce((s, l) => s + (l.calls ?? l.flights + l.declined.length), 0),
      flights: logs.reduce((s, l) => s + l.flights, 0),
      declined,
      response: { launch_median_s: pct(launch, 50), launch_p90_s: pct(launch, 90), scene_median_s: pct(scene, 50), scene_p90_s: pct(scene, 90) },
      pilots: Object.values(pilots).sort((a, b) => b.hours - a.hours),
      mishaps: mishaps.map((m) => ({ id: m.id, date: new Date(m.verbal_at).toISOString().slice(0, 10), tail: m.tail, kind: m.kind, written: Boolean(m.written), faa: m.written ? m.written.injury || m.written.damage_usd > 500 : null })),
      records_open: open.map((r) => r.id),
      not_current: invoice(src).lines.filter((x) => x.lapsed).map((x) => `${x.date}: ${x.notes[0]}`),
      currency: { pilots: src.crewView.counts.pilots, solo: src.crewView.counts.solo, not_assignable: src.crewView.counts.not_assignable, warnings: src.crewView.pilots.flatMap((p) => [...p.blocking.map((b) => `${p.name}: ${b}`), ...p.warnings.map((w) => `${p.name}: ${w}`)]) },
      care: { checks: care.filter((c) => c.date.startsWith(CONTRACT.period)).length, overdue: careDue.filter((a) => a.overdue).map((a) => `${a.tail} since ${a.due}`), grounded: careDue.filter((a) => a.grounded).map((a) => a.tail) },
    };
  }

  function invoice(src) {
    const logs = src.shiftLogs.filter((l) => l.date.startsWith(CONTRACT.period)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const lines = logs.map((l) => {
      const unfiled = (l.flight_ids ?? []).length ? src.records.filter((r) => l.flight_ids.includes(r.flight) && r.status !== "filed").map((r) => r.id) : [];
      // A pilot who was not current that day: the hours are not payable, whoever worked them.
      const p = src.crewView.pilots.find((x) => x.name === l.rpic);
      const lapses = p ? [...(p.lapses ?? []), { item: "TWIC", from: p.twic_expires, to: "9999-12-31" }, { item: "Recurrent training", from: p.recurrent_due, to: "9999-12-31" }] : [];
      const lapsed = l.staffed_h > 0 ? lapses.find((x) => l.date > x.from && l.date <= x.to) : null;
      const held = unfiled.length && !lapsed ? l.staffed_h : 0;
      const excluded = lapsed ? l.scheduled_h : r1(l.scheduled_h - l.staffed_h);
      const billable = lapsed ? 0 : r1(l.staffed_h - held);
      const notes = [];
      if (lapsed) notes.push(`${l.rpic}'s ${lapsed.item} lapsed ${lapsed.from}: hours worked while not current are not payable`);
      else if (excluded) notes.push(l.staffed_h === 0 ? "Unstaffed: not payable" : `${excluded} h unstaffed: not payable`);
      if (held) notes.push(`Held until ${unfiled.join(", ")} ${unfiled.length === 1 ? "is" : "are"} filed`);
      return { shift: l.id, date: l.date, pilot: l.rpic, scheduled_h: l.scheduled_h, staffed_h: l.staffed_h, billable_h: billable, held_h: held, excluded_h: excluded, amount_usd: Math.round(billable * CONTRACT.rate_usd * 100) / 100, notes, held_for: unfiled, lapsed: Boolean(lapsed), log_sha256: l.hash ?? null };
    });
    const sum = (k) => r1(lines.reduce((s, x) => s + x[k], 0));
    const totals = { scheduled_h: sum("scheduled_h"), staffed_h: sum("staffed_h"), billable_h: sum("billable_h"), held_h: sum("held_h"), excluded_h: sum("excluded_h") };
    return { number: CONTRACT.number, period: CONTRACT.period, label: CONTRACT.label, contractor: CONTRACT.contractor, rate_usd: CONTRACT.rate_usd, lines, totals: { ...totals, amount_usd: Math.round(totals.billable_h * CONTRACT.rate_usd * 100) / 100, held_usd: Math.round(totals.held_h * CONTRACT.rate_usd * 100) / 100 } };
  }

  function monthView(src) {
    const rep = report(src);
    const inv = invoice(src);
    const live = sha256Hex(JSON.stringify({ rep, totals: inv.totals }));
    return { report: rep, invoice: inv, status: month.status, submitted: month.submitted, decided: month.decided, history: month.history, changed_since_submit: Boolean(month.submitted && month.submitted.sha256 !== live) };
  }

  function submitMonth(src, by, now) {
    if (month.status === "submitted") return { ok: false, why: "Already submitted; waiting on the program manager." };
    if (month.status === "approved") return { ok: false, why: `${CONTRACT.number} was approved for payment.` };
    const rep = report(src);
    const inv = invoice(src);
    const sha = sha256Hex(JSON.stringify({ rep, totals: inv.totals }));
    const row = evidence.append({ actor: by, action: "month.submit", resource_type: "invoice", resource_id: CONTRACT.number, detail: JSON.stringify({ totals: inv.totals, report_sha256: sha }), at: now });
    month = { ...month, status: "submitted", submitted: { by, at: new Date(now).toISOString(), totals: inv.totals, sha256: sha, hash: row.row_hash }, decided: null };
    month.history.unshift({ at: month.submitted.at, by, what: `Submitted: ${inv.totals.billable_h} h payable, $${inv.totals.amount_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${inv.totals.held_h ? `, ${inv.totals.held_h} h held` : ""}` });
    return { ok: true, message: `${CONTRACT.label} report and ${CONTRACT.number} submitted to the program manager: ${inv.totals.billable_h} h payable, $${inv.totals.amount_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` };
  }

  function decideMonth(approve, note, by, now) {
    if (month.status !== "submitted") return { ok: false, why: "Nothing submitted to decide on." };
    const n = String(note ?? "").trim();
    if (!approve && n.length < 6) return { ok: false, why: "Say what needs fixing so the contractor can resubmit." };
    const row = evidence.append({ actor: by, action: approve ? "month.approve" : "month.return", resource_type: "invoice", resource_id: CONTRACT.number, detail: JSON.stringify({ note: n, totals: month.submitted.totals }), at: now });
    month = { ...month, status: approve ? "approved" : "returned", decided: { by, at: new Date(now).toISOString(), note: n, hash: row.row_hash } };
    month.history.unshift({ at: month.decided.at, by, what: approve ? `Approved for payment: $${month.submitted.totals.amount_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `Returned: ${n}` });
    return { ok: true, message: approve ? `${CONTRACT.number} approved for payment: $${month.submitted.totals.amount_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Held hours carry to the next invoice once their records are filed.` : `${CONTRACT.number} returned to the contractor: ${n}` };
  }

  return { careOf, careView, signCare, retention, setHold, liftHold, holds, requests, createRequest, releaseRequest, redact, monthView, submitMonth, decideMonth, report, invoice };
}
