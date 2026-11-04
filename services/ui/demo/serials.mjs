// One record per serial, from the factory bench to the end of its last flight.
//
// The research behind this (docs/design/serial-record.md): no vendor found joins
// a drone's build genealogy to its field outcome, its operator and its supplier
// lot, and the Drone Dominance rules reward exactly that (on-time acceptance,
// provenance at every tier, low operator workload). This module holds:
//
//  - Delivery lots and the acceptance package a customer signs for: each
//    serial's as-built record (component lots, firmware, bench results) with
//    automatic checks, accept or reject with a reason, rejections to Neros.
//  - Issue by lot and count, like ammunition, with the serials known underneath.
//  - End-of-flight records the ground station writes when a sortie ends, with
//    no operator paperwork: outcome class, last link, nav source, battery,
//    fault codes. Outcome classes are neutral. There are no target, strike or
//    damage fields anywhere here (ADR-0016): the platform records how a drone
//    ended, never what it hit.
//  - The field-to-lot loop for Neros: outcome fields the customer shares,
//    joined to genealogy, flag lots and suppliers out of family, open a
//    supplier corrective action or hold the lot, and say whether the evidence
//    supports moving end-of-line flight test from 100% to sampling.
//
// Everything is simulated (seeded, deterministic) and labelled SIM on screen.
// Pure JavaScript, so it runs behind demo/server.mjs and in the browser.

import { sha256Hex } from "./ledger.mjs";
import { CUSTOMERS, TODAY } from "./company.mjs";
import { PARTS, SUPPLIERS, nameOf } from "./supply.mjs";

export const OUTCOMES = ["completed", "aborted", "lost_link", "lost_nav", "hw_fault", "battery", "unknown"];
export const OUTCOME_LABEL = {
  completed: "Completed",
  aborted: "Aborted by operator",
  lost_link: "Lost link",
  lost_nav: "Lost navigation",
  hw_fault: "Hardware fault",
  battery: "Battery",
  unknown: "Unknown",
};
/** The fields an end-of-flight record may carry. A test fails if anything else appears (ADR-0016). */
export const END_FIELDS = ["id", "serial", "sku", "delivery_lot", "org", "unit", "operator", "gcs", "day", "outcome", "recovered", "jamming", "last_link_dbm", "nav_source", "battery_pct", "fault_codes", "firmware", "synced"];
/** What a customer shares with Neros: outcome fields only, no operator, unit, station or day of flight. */
export const SHARED_FIELDS = ["id", "serial", "sku", "delivery_lot", "outcome", "recovered", "jamming", "nav_source", "battery_pct", "fault_codes", "firmware", "week"];

export const REJECT_REASONS = {
  transit_damage: "Damaged in transit",
  bench_missing: "Bench record missing",
  firmware_unreleased: "Firmware is not a released build",
  bench_out_of_limits: "Bench result out of limits",
  wrong_count: "Count does not match the packing list",
  other: "Other",
};

// Fault codes the flight controller logs, and the part each one points at.
export const FAULTS = {
  ESC_DESYNC: { part: "esc", text: "ESC desync" },
  MOTOR_STALL: { part: "motor", text: "Motor stall" },
  FC_RESET: { part: "fc", text: "Flight controller reset" },
  VTX_LOSS: { part: "vtx", text: "Video transmitter dropout" },
  FRAME_CRACK: { part: "frame", text: "Frame or arm crack" },
};

// Released firmware. A serial carrying anything else fails the acceptance check.
export const RELEASES = [
  { version: "1.15.3", sha256: sha256Hex("a2e-px4-v1.15.3-release"), released: "2026-09-01" },
  { version: "1.15.4", sha256: sha256Hex("a2e-px4-v1.15.4-release"), released: "2026-10-01" },
];
const DEV_BUILD = sha256Hex("a2e-px4-v1.15.4-dev-bench7");

// Bench limits (SIM placeholders, same as sim/bench profiles).
export const BENCH_LIMITS = { imu: 0.2, vibration_g: 1.5, hover_s: 30 };
// Program comparison: Gauntlet I acceptance across all vendors, 10 Sep 2026
// (drone-warfare.com tracker, a secondary source; see the research report).
export const PROGRAM_ACCEPTANCE = { rate: 0.57, label: "Drone Dominance Gauntlet I, all vendors, 10 Sep 2026 (secondary tracker)" };

const PREFIX = { "ARCHER-5": "A5", "ARCHER-8": "A8", "ARCHER-10": "A10" };
const FRAME = { "ARCHER-5": "FR-2609", "ARCHER-8": "FR-2604", "ARCHER-10": "FR-2607" };
const MOTOR = { "ARCHER-5": ["MT-1201"], "ARCHER-8": ["MT-1180", "MT-1192"], "ARCHER-10": ["MT-1192"] };
const BATTERY = { "ARCHER-5": "BT-S-0920", "ARCHER-8": "BT-L-0920", "ARCHER-10": "BT-L-0920" };

// Delivery lots: what Neros shipped to each customer as one acceptance decision (SIM).
// `esc2611` is the share of the lot built with ESC lot ESC-2611 (received 9 Oct).
const DELIVERIES = [
  { id: "DL-2609", org: "CUS-A", unit: "Alpha", sku: "ARCHER-5", qty: 180, built: "2026-09-24", shipped: "2026-09-29", decided: "2026-10-01", rejects: [], esc2611: 0, fw: "1.15.3", fc: "FC-0331" },
  { id: "DL-2610", org: "CUS-A", unit: "Bravo", sku: "ARCHER-5", qty: 160, built: "2026-10-01", shipped: "2026-10-06", decided: "2026-10-09", rejects: [[37, "transit_damage"]], esc2611: 0, fw: "1.15.4", fc: "FC-0331" },
  { id: "DL-2612", org: "CUS-A", unit: "Charlie", sku: "ARCHER-8", qty: 130, built: "2026-10-10", shipped: "2026-10-13", decided: "2026-10-15", rejects: [], esc2611: 0.6, fw: "1.15.4", fc: "FC-0334" },
  { id: "DL-2613", org: "CUS-A", unit: "Delta", sku: "ARCHER-10", qty: 100, built: "2026-10-12", shipped: "2026-10-16", decided: "2026-10-20", rejects: [], esc2611: 0.5, fw: "1.15.4", fc: "FC-0334" },
  { id: "DL-2615", org: "CUS-A", unit: "Bravo", sku: "ARCHER-5", qty: 120, built: "2026-10-14", shipped: "2026-10-17", decided: "2026-10-19", rejects: [], esc2611: 0.7, fw: "1.15.4", fc: "FC-0334" },
  // Delivered, waiting on the customer: the acceptance-package demo.
  { id: "DL-2618", org: "CUS-A", unit: "Alpha", sku: "ARCHER-5", qty: 60, built: "2026-10-27", shipped: "2026-11-01", decided: null, rejects: [], esc2611: 0.5, fw: "1.15.4", fc: "FC-0334", flaws: { 14: "bench_missing", 33: "firmware_unreleased", 47: "imu_marginal" } },
  { id: "DL-2619", org: "CUS-B", unit: null, sku: "ARCHER-5", qty: 24, built: "2026-10-28", shipped: "2026-11-02", decided: null, rejects: [], esc2611: 0, fw: "1.15.4", fc: "FC-0334" },
];

// Field sortie rate per unit per day, and how much of the day's flying is under jamming (SIM).
const TEMPO = { Alpha: { per_day: 4, jam: 0.35 }, Bravo: { per_day: 7, jam: 0.45 }, Charlie: { per_day: 4, jam: 0.25 }, Delta: { per_day: 3, jam: 0.2 } };
// How many airframes a unit draws from a lot when it is accepted, the rest stays in the unit's store (SIM).
const ISSUE_SHARE = 0.75;
const HISTORY_DAYS = 28;

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

export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
function weekOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - jan1) / 86_400_000 + new Date(jan1).getUTCDay() + 1) / 7)).padStart(2, "0")}`;
}

/** Poisson upper tail P(X >= k) for mean m. */
export function poissonTail(k, m) {
  if (k <= 0) return 1;
  let term = Math.exp(-m);
  let cdf = term;
  for (let i = 1; i < k; i += 1) {
    term *= m / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

/** Upper bound of a one-sided 95% Wilson interval for a proportion. */
export function wilsonUpper(k, n, z = 1.645) {
  if (n === 0) return 1;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre + spread) / den;
}

/** Operators on each unit's roster. Designators only; no names. */
export function roster() {
  const out = [];
  const sizes = { Alpha: 6, Bravo: 7, Charlie: 5, Delta: 5 };
  for (const [unit, n] of Object.entries(sizes)) {
    for (let i = 1; i <= n; i += 1) {
      // Skill drives outcomes in the sim; readiness.mjs derives training from it.
      const skill = [0.92, 0.8, 0.95, 0.7, 0.86, 0.62, 0.9][(i - 1 + unit.length) % 7];
      out.push({ id: `${unit[0]}-${String(i).padStart(2, "0")}`, unit, skill });
    }
  }
  return out;
}

/**
 * The serial record for one demo session.
 * @param {{ births?: object[], sharing?: Record<string, boolean>, holds?: object[] }} opts
 */
export function createSerials({ births = [], sharing = { "CUS-A": true }, holds = [] } = {}) {
  const rand = mulberry32(2611);
  const serials = new Map();
  const deliveries = [];
  const records = [];
  const actions = [];
  const OPERATORS = roster();
  let deliverySeq = 2620;
  let recordSeq = 1;
  let actionSeq = 40;
  let syncedTo = addDays(TODAY, -1);

  function makeSerial(d, i, flaw) {
    const r = mulberry32(daysBetween("2026-01-01", d.built) * 1000 + i)();
    const esc = r < d.esc2611 ? "ESC-2611" : i % 2 ? "ESC-2603" : "ESC-2598";
    const motors = MOTOR[d.sku];
    const imu = flaw === "imu_marginal" ? 0.19 : Number((0.03 + ((i * 7) % 11) / 100).toFixed(2));
    const fw = RELEASES.find((x) => x.version === d.fw);
    const s = {
      serial: `${PREFIX[d.sku]}-${d.id.slice(3)}-${String(i).padStart(3, "0")}`,
      sku: d.sku,
      delivery_lot: d.id,
      org: d.org,
      built: d.built,
      parts: { frame: FRAME[d.sku], esc, motor: motors[i % motors.length], fc: d.fc, battery: BATTERY[d.sku], camera: d.built < "2026-10-10" ? "CM-0302" : "CM-0318", radio: "RF-0712", vtx: "VT-0440" },
      firmware: flaw === "firmware_unreleased" ? { version: "1.15.4-dev", sha256: DEV_BUILD, released: false } : { version: fw.version, sha256: fw.sha256, released: true },
      bench: flaw === "bench_missing" ? null : { station: `EOL-${1 + (i % 4)}`, imu, vibration_g: Number((0.4 + ((i * 3) % 7) / 10).toFixed(1)), hover_s: 30, passed: imu <= BENCH_LIMITS.imu },
      state: "packed", // packed -> shipped -> accepted | rejected -> issued -> ended
      unit: null,
      issued: null,
      ended: null,
    };
    serials.set(s.serial, s);
    return s;
  }

  function newDelivery(d) {
    const lot = { ...d, serials: [], rejected: [], status: d.decided ? "accepted" : "awaiting acceptance", decided_by: d.decided ? "Receiving officer (SIM)" : null };
    for (let i = 1; i <= d.qty; i += 1) {
      const s = makeSerial(d, i, d.flaws?.[i]);
      s.state = "shipped";
      lot.serials.push(s.serial);
    }
    if (d.decided) {
      for (const [i, reason] of d.rejects) {
        const s = serials.get(lot.serials[i - 1]);
        s.state = "rejected";
        lot.rejected.push({ serial: s.serial, reason, replaced: true });
      }
      for (const id of lot.serials) {
        const s = serials.get(id);
        if (s.state === "shipped") s.state = "accepted";
      }
    }
    deliveries.push(lot);
    return lot;
  }
  for (const d of DELIVERIES) newDelivery(d);

  // Issue: the unit draws airframes from an accepted lot by count; the serials
  // go oldest first underneath, so the record still knows which one flew.
  function issue(lotId, unit, qty, day) {
    const lot = deliveries.find((l) => l.id === lotId);
    const pool = lot.serials.map((id) => serials.get(id)).filter((s) => s.state === "accepted");
    const take = pool.slice(0, qty);
    for (const s of take) {
      s.state = "issued";
      s.unit = unit;
      s.issued = day;
    }
    return take.length;
  }

  // ---- End-of-flight records ----
  // The ground station writes one when a sortie ends. The sim picks an issued
  // airframe, an operator from the unit, and an outcome from rates that depend
  // on jamming, the operator's skill and (for ESC-2611) the part.
  function fly(unit, day, r) {
    const pool = [...serials.values()].filter((s) => s.state === "issued" && s.unit === unit);
    if (!pool.length) return null;
    const s = pool[Math.floor(r() * pool.length)];
    const ops = OPERATORS.filter((o) => o.unit === unit);
    const op = ops[Math.floor(r() * ops.length)];
    const jam = r() < TEMPO[unit].jam;
    const weak = 1 - op.skill; // 0.05 .. 0.38
    const escBad = s.parts.esc === "ESC-2611";
    const w = {
      completed: 0.72 - weak * 0.5 - (jam ? 0.12 : 0),
      aborted: 0.05 + weak * 0.15,
      lost_link: 0.07 + (jam ? 0.11 : 0) + weak * 0.15,
      lost_nav: 0.03 + (jam ? 0.05 : 0),
      hw_fault: escBad ? 0.11 : 0.035,
      battery: 0.03 + weak * 0.1,
      unknown: 0.02,
    };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let x = r() * total;
    let outcome = "unknown";
    for (const [k, v] of Object.entries(w)) {
      if ((x -= v) <= 0) {
        outcome = k;
        break;
      }
    }
    const fault = [];
    if (outcome === "hw_fault") {
      if (escBad && r() < 0.7) fault.push("ESC_DESYNC");
      else {
        const y = r();
        fault.push(y < 0.3 ? "ESC_DESYNC" : y < 0.55 ? "MOTOR_STALL" : y < 0.72 ? "FC_RESET" : y < 0.88 ? "VTX_LOSS" : "FRAME_CRACK");
      }
    }
    // Most sorties in this sim are one-way; aborts and some completions come home.
    const recovered = outcome === "aborted" ? r() < 0.85 : outcome === "completed" ? r() < 0.3 : outcome === "battery" ? r() < 0.2 : false;
    const rec = {
      id: `ER-${String(recordSeq++).padStart(5, "0")}`,
      serial: s.serial,
      sku: s.sku,
      delivery_lot: s.delivery_lot,
      org: s.org,
      unit,
      operator: op.id,
      gcs: `GCS-${unit[0]}-${1 + Math.floor(r() * 3)}`,
      day,
      outcome,
      recovered,
      jamming: jam,
      last_link_dbm: Math.round(-72 - r() * 18 - (jam ? 12 : 0) - (outcome === "lost_link" ? 8 : 0)),
      nav_source: outcome === "lost_nav" ? "none" : jam && r() < 0.6 ? "vio" : "gnss",
      battery_pct: outcome === "battery" ? Math.round(4 + r() * 8) : Math.round(18 + r() * 60),
      fault_codes: fault,
      firmware: s.firmware.version,
      synced: day,
    };
    records.push(rec);
    if (!recovered) {
      s.state = "ended";
      s.ended = { day, record: rec.id, outcome };
    }
    return rec;
  }

  function flyDay(day, r) {
    const out = [];
    for (const [unit, t] of Object.entries(TEMPO)) {
      for (let k = 0; k < t.per_day; k += 1) {
        const rec = fly(unit, day, r);
        if (rec) out.push(rec);
      }
    }
    return out;
  }

  // Seed the history: each accepted lot is drawn by its unit two days after the
  // decision, then the units fly every day until yesterday.
  const issueDays = deliveries.filter((l) => l.status === "accepted").map((l) => ({ lot: l, day: addDays(l.decided, 2) }));
  for (let d = -HISTORY_DAYS - 10; d <= -1; d += 1) {
    const day = addDays(TODAY, d);
    for (const x of issueDays.filter((x) => x.day === day)) issue(x.lot.id, x.lot.unit, Math.round(x.lot.serials.length * ISSUE_SHARE), day);
    if (d >= -HISTORY_DAYS) {
      // A unit running low draws more from its store before the day's flying.
      for (const [unit, t] of Object.entries(TEMPO)) {
        const issued = [...serials.values()].filter((s) => s.state === "issued" && s.unit === unit).length;
        if (issued >= t.per_day * 4) continue;
        const lot = deliveries.find((l) => l.unit === unit && l.status === "accepted" && l.serials.some((id) => serials.get(id).state === "accepted"));
        if (lot) issue(lot.id, unit, t.per_day * 6, day);
      }
      flyDay(day, rand);
    }
  }

  // ---- Views ----

  const custName = (org) => CUSTOMERS.find((c) => c.id === org)?.name ?? org;
  const released = (sha) => RELEASES.some((x) => x.sha256 === sha);

  /** Automatic checks on one serial's as-built record, as the receiving officer sees them. */
  function checks(s) {
    const out = [];
    if (!s.bench) out.push({ level: "fail", code: "bench_missing", text: "No end-of-line bench record" });
    else {
      if (!s.bench.passed) out.push({ level: "fail", code: "bench_out_of_limits", text: `IMU cal ${s.bench.imu} over the ${BENCH_LIMITS.imu} limit` });
      else if (s.bench.imu >= BENCH_LIMITS.imu * 0.9) out.push({ level: "warn", code: "imu_marginal", text: `IMU cal ${s.bench.imu} is within 10% of the limit` });
    }
    if (!released(s.firmware.sha256)) out.push({ level: "fail", code: "firmware_unreleased", text: `Firmware ${s.firmware.version} is not a released build` });
    return out;
  }

  function lotSummary(l) {
    const rows = l.serials.map((id) => serials.get(id));
    const failing = rows.filter((s) => checks(s).some((c) => c.level === "fail")).length;
    const warn = rows.filter((s) => checks(s).some((c) => c.level === "warn")).length;
    const accepted = rows.filter((s) => s.state !== "rejected" && s.state !== "shipped").length;
    return {
      id: l.id,
      org: l.org,
      customer: custName(l.org).split(":")[0],
      unit: l.unit,
      sku: l.sku,
      name: nameOf(l.sku),
      qty: l.serials.length,
      built: l.built,
      shipped: l.shipped,
      status: l.status,
      decided: l.decided,
      decided_by: l.decided_by,
      days_to_decide: l.decided ? daysBetween(l.shipped, l.decided) : null,
      days_waiting: l.decided ? null : daysBetween(l.shipped, TODAY),
      accepted,
      rejected: l.rejected.map((x) => ({ ...x, reason_text: REJECT_REASONS[x.reason] ?? x.reason })),
      failing,
      warn,
      firmware: [...new Set(rows.map((s) => s.firmware.version))],
      replaces: l.replaces ?? null,
    };
  }

  /** The package a receiving officer opens: every serial's as-built record with its checks. */
  function lotPackage(id, org = null) {
    const l = deliveries.find((x) => x.id === id && (!org || x.org === org));
    if (!l) return null;
    const rows = l.serials.map((sid) => {
      const s = serials.get(sid);
      return { serial: s.serial, state: s.state, built: s.built, parts: s.parts, firmware: s.firmware, bench: s.bench, checks: checks(s), rejected: l.rejected.find((x) => x.serial === sid)?.reason ?? null };
    });
    return { ...lotSummary(l), rows, limits: BENCH_LIMITS, releases: RELEASES, reasons: REJECT_REASONS };
  }

  function acceptanceStats(org = null) {
    const lots = deliveries.filter((l) => l.decided && (!org || l.org === org));
    const delivered = lots.reduce((n, l) => n + l.serials.length, 0);
    const rejected = lots.reduce((n, l) => n + l.rejected.length, 0);
    const firstPass = lots.filter((l) => l.rejected.length === 0).length;
    const days = lots.map((l) => daysBetween(l.shipped, l.decided));
    return {
      lots: lots.length,
      serials: delivered,
      accepted: delivered - rejected,
      rate: delivered ? (delivered - rejected) / delivered : null,
      first_pass: lots.length ? firstPass / lots.length : null,
      mean_days: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
      waiting: deliveries.filter((l) => !l.decided && (!org || l.org === org)).length,
      program: PROGRAM_ACCEPTANCE,
    };
  }

  function receiving(org) {
    const mine = deliveries.filter((l) => !org || l.org === org);
    return {
      source: "Simulated: delivery lots, serials, bench results and decisions are demo data.",
      today: TODAY,
      waiting: mine.filter((l) => !l.decided).map(lotSummary),
      history: mine.filter((l) => l.decided).map(lotSummary).reverse(),
      stats: acceptanceStats(org),
      reasons: REJECT_REASONS,
    };
  }

  // ---- Accountability: on hand, issued, ended, by unit and lot ----

  function accountability(org) {
    const cust = CUSTOMERS.find((c) => c.id === org);
    const mine = [...serials.values()].filter((s) => s.org === org);
    const recs = records.filter((r) => r.org === org);
    const since = addDays(TODAY, -14);
    const units = (cust?.units ?? []).map((unit) => {
      const own = mine.filter((s) => s.unit === unit);
      const issued = own.filter((s) => s.state === "issued").length;
      const ended14 = own.filter((s) => s.ended && s.ended.day >= since).length;
      const perDay = ended14 / 14;
      const store = deliveries.filter((l) => l.org === org && l.unit === unit && l.status === "accepted").reduce((n, l) => n + l.serials.filter((id) => serials.get(id).state === "accepted").length, 0);
      return {
        unit,
        sku: own[0]?.sku ?? null,
        in_store: store,
        issued,
        ended_14d: ended14,
        per_day: Number(perDay.toFixed(2)),
        days_of_supply: perDay > 0 ? Number(((issued + store) / perDay).toFixed(1)) : null,
        sorties_14d: recs.filter((r) => r.unit === unit && r.day >= since).length,
      };
    });
    const byLot = deliveries.filter((l) => l.org === org && l.status === "accepted").map((l) => {
      const rows = l.serials.map((id) => serials.get(id));
      return { lot: l.id, unit: l.unit, sku: l.sku, delivered: rows.length, rejected: l.rejected.length, in_store: rows.filter((s) => s.state === "accepted").length, issued: rows.filter((s) => s.state === "issued").length, ended: rows.filter((s) => s.state === "ended").length };
    });
    const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, recs.filter((r) => r.day >= since && r.outcome === o).length]));
    return {
      source: "Simulated: written by ground stations at the end of each sortie and synced when they reconnect. No operator paperwork.",
      today: TODAY,
      synced_to: syncedTo,
      sharing: Boolean(sharing[org]),
      units,
      lots: byLot,
      outcomes,
      outcome_labels: OUTCOME_LABEL,
      records: recs.slice(-60).reverse(),
      fields: END_FIELDS,
      shared_fields: SHARED_FIELDS,
    };
  }

  /** One serial's history, oldest first, each event hashing the one before it. */
  function serialRecord(id, org = null) {
    const s = serials.get(id);
    if (!s || (org && s.org !== org)) return null;
    const lot = deliveries.find((l) => l.id === s.delivery_lot);
    const ev = [];
    const add = (day, kind, text, owner) => ev.push({ day, kind, text, owner });
    add(s.built, "born", s.bench ? `Bench ${s.bench.station}: IMU ${s.bench.imu}, vibration ${s.bench.vibration_g} g, hover ${s.bench.hover_s} s ${s.bench.passed ? "passed" : "failed"}` : "No bench record", "neros");
    add(s.built, "packed", `Packed into ${s.delivery_lot}; firmware ${s.firmware.version}`, "neros");
    add(lot.shipped, "shipped", `Shipped to ${custName(s.org).split(":")[0]}${lot.unit ? `, ${lot.unit}` : ""}`, "neros");
    const rej = lot.rejected.find((x) => x.serial === id);
    if (rej) add(lot.decided, "rejected", `Rejected at receiving: ${REJECT_REASONS[rej.reason] ?? rej.reason}`, s.org);
    else if (lot.decided) add(lot.decided, "accepted", `Accepted with ${lot.id} by ${lot.decided_by}`, s.org);
    if (s.issued) add(s.issued, "issued", `Issued to ${s.unit}`, s.org);
    for (const r of records.filter((x) => x.serial === id)) {
      add(r.day, r.recovered ? "flew" : "ended", `${OUTCOME_LABEL[r.outcome]}${r.fault_codes.length ? ` (${r.fault_codes.join(", ")})` : ""}${r.jamming ? ", under jamming" : ""}${r.recovered ? ", recovered" : ""}; ${r.gcs}, operator ${r.operator}`, s.org);
    }
    let prev = "0".repeat(64);
    const events = ev.map((e, i) => {
      const hash = sha256Hex(prev + JSON.stringify([i, e.day, e.kind, e.text, e.owner, s.serial]));
      const row = { seq: i + 1, ...e, prev_hash: prev, hash };
      prev = hash;
      return row;
    });
    return { serial: s.serial, sku: s.sku, name: nameOf(s.sku), state: s.state, parts: s.parts, firmware: s.firmware, bench: s.bench, events, verified: verify(events, s.serial) };
  }

  function verify(events, serial) {
    let prev = "0".repeat(64);
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.prev_hash !== prev || sha256Hex(prev + JSON.stringify([i, e.day, e.kind, e.text, e.owner, serial])) !== e.hash) return false;
      prev = e.hash;
    }
    return true;
  }

  // ---- Neros: the field-to-lot loop ----

  /** The records Neros may see: only from customers that share, and only the outcome fields. */
  function sharedRecords() {
    return records.filter((r) => sharing[r.org]).map((r) => {
      const out = Object.fromEntries(SHARED_FIELDS.filter((k) => k in r).map((k) => [k, r[k]]));
      out.week = weekOf(r.day);
      return out;
    });
  }

  const LOT_PART = { esc: "ESC-4IN1", motor: null, fc: "FC-1", frame: null, battery: null, vtx: "VTX-1" };
  function lotPn(part, lot) {
    if (LOT_PART[part]) return LOT_PART[part];
    if (part === "motor") return lot === "MT-1201" ? "MOT-S" : "MOT-L";
    if (part === "frame") return { "FR-2609": "FRM-5", "FR-2604": "FRM-8", "FR-2607": "FRM-10" }[lot];
    if (part === "battery") return lot.startsWith("BT-S") ? "BAT-S" : "BAT-L";
    return null;
  }
  const supplierOf = (pn) => PARTS.find((p) => p.pn === pn)?.supplier ?? null;

  /** Field fault rate per component lot, against the rest of that part's lots. */
  function lotSignals(shared) {
    const rows = [];
    for (const part of ["esc", "motor", "fc", "vtx", "frame"]) {
      const groups = new Map();
      for (const r of shared) {
        const lot = serials.get(r.serial).parts[part];
        const g = groups.get(lot) ?? { sorties: 0, faults: 0 };
        g.sorties += 1;
        if (r.fault_codes.some((c) => FAULTS[c]?.part === part)) g.faults += 1;
        groups.set(lot, g);
      }
      for (const [lot, g] of groups) {
        let os = 0;
        let of = 0;
        for (const [other, h] of groups) if (other !== lot) {
          os += h.sorties;
          of += h.faults;
        }
        // With one lot in the field, compare against the fleet-wide rate for this part instead.
        const base = os > 0 ? Math.max(of / os, 0.002) : Math.max((g.faults + 1) / (g.sorties + 2), 0.002);
        const expected = g.sorties * base;
        const p = poissonTail(g.faults, expected);
        const ratio = expected > 0 ? g.faults / expected : 0;
        const pn = lotPn(part, lot);
        const flagged = g.faults >= 5 && ratio >= 1.5 && p < 0.01;
        rows.push({ part, lot, pn, supplier: supplierOf(pn), sorties: g.sorties, faults: g.faults, rate: g.sorties ? g.faults / g.sorties : 0, baseline: base, ratio: Number(ratio.toFixed(2)), p_value: Number(p.toPrecision(3)), flagged, held: holds.some((h) => h.value === lot), action: actions.find((a) => a.lot === lot && a.status === "open")?.id ?? null });
      }
    }
    return rows.sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.p_value - b.p_value);
  }

  function scorecard(shared, signals) {
    return SUPPLIERS.map((sup) => {
      const mine = signals.filter((s) => s.supplier === sup.id);
      const sorties = mine.reduce((n, s) => n + s.sorties, 0);
      const faults = mine.reduce((n, s) => n + s.faults, 0);
      const worst = mine.slice().sort((a, b) => b.ratio - a.ratio)[0] ?? null;
      return {
        id: sup.id,
        name: sup.name,
        commodity: sup.commodity,
        incoming_ppm: sup.ppm,
        on_time: sup.on_time,
        ndaa: sup.ndaa,
        field_sorties: sorties,
        field_faults: faults,
        per_1000: sorties ? Number(((faults / sorties) * 1000).toFixed(1)) : null,
        worst_lot: worst && worst.faults ? { lot: worst.lot, ratio: worst.ratio, flagged: worst.flagged } : null,
        open_actions: actions.filter((a) => a.supplier === sup.id && a.status === "open").map((a) => a.id),
        tracked: mine.length > 0,
      };
    });
  }

  /**
   * Does field evidence support moving end-of-line flight test from 100% to
   * sampling? Only for builds whose lots are all clean, and only if the upper
   * bound of their field fault rate is under the threshold.
   */
  function sampling(shared, signals) {
    const bad = new Set(signals.filter((s) => s.flagged || s.held || s.action).map((s) => s.lot));
    const clean = shared.filter((r) => !Object.values(serials.get(r.serial).parts).some((lot) => bad.has(lot)));
    const faults = clean.filter((r) => r.outcome === "hw_fault").length;
    const upper = wilsonUpper(faults, clean.length);
    const threshold = 0.07;
    const ok = clean.length >= 200 && upper < threshold;
    const MINUTES = 6; // hover and link check per airframe (SIM)
    const RATE = 250; // airframes a day, as reported in Aug 2026 (Sourcery)
    return {
      current: "100% end-of-line flight test",
      recommend: ok ? "Sample 1 in 5 for builds whose component lots are all clean; keep 100% for any lot under action or hold" : "Keep 100% flight test: not enough clean field evidence yet",
      ok,
      sorties: clean.length,
      faults,
      rate: clean.length ? faults / clean.length : null,
      upper_95: Number(upper.toFixed(4)),
      threshold,
      excluded_lots: [...bad],
      hours_saved_per_day: ok ? Number(((RATE * 0.8 * MINUTES) / 60).toFixed(1)) : 0,
      assumptions: `${MINUTES} min per flight test (SIM); ${RATE} airframes a day (reported, Aug 2026)`,
    };
  }

  function quality() {
    const shared = sharedRecords();
    const signals = lotSignals(shared);
    return {
      source: "Simulated: end-of-flight records shared by customers, joined to factory genealogy. Outcome fields only; no operator, unit, location or mission content.",
      today: TODAY,
      sharing: Object.fromEntries(CUSTOMERS.map((c) => [c.id, Boolean(sharing[c.id])])),
      shared_sorties: shared.length,
      acceptance: acceptanceStats(),
      lots_waiting: deliveries.filter((l) => !l.decided).map(lotSummary),
      replacements: deliveries.flatMap((l) => l.rejected.filter((x) => !x.replaced).map((x) => ({ lot: l.id, org: l.org, serial: x.serial, reason: REJECT_REASONS[x.reason] ?? x.reason }))),
      signals,
      suppliers: scorecard(shared, signals),
      actions: actions.slice().reverse(),
      sampling: sampling(shared, signals),
      faults: FAULTS,
    };
  }

  // ---- Actions ----

  function acceptDelivery(org, a, actor) {
    const l = deliveries.find((x) => x.id === a.id && x.org === org);
    if (!l) return { error: "not one of your delivery lots", status: 404 };
    if (l.decided) return { error: `${l.id} was already decided on ${l.decided}`, status: 409 };
    const reject = (Array.isArray(a.reject) ? a.reject : []).map((x) => ({ serial: String(x.serial), reason: String(x.reason ?? "other") }));
    for (const x of reject) {
      if (!l.serials.includes(x.serial)) return { error: `${x.serial} is not in ${l.id}`, status: 400 };
      if (!REJECT_REASONS[x.reason]) return { error: "pick a reason for each rejected serial", status: 400 };
    }
    l.decided = TODAY;
    l.decided_by = actor;
    l.status = "accepted";
    l.rejected = reject.map((x) => ({ ...x, replaced: false }));
    for (const id of l.serials) {
      const s = serials.get(id);
      s.state = reject.some((x) => x.serial === id) ? "rejected" : "accepted";
    }
    const n = l.serials.length - reject.length;
    return { ok: true, message: `${l.id}: ${n} accepted${reject.length ? `, ${reject.length} rejected and sent back to Neros for replacement` : ""}` };
  }

  function issueAct(org, a) {
    const l = deliveries.find((x) => x.id === a.lot && x.org === org && x.status === "accepted");
    if (!l) return { error: "pick an accepted lot", status: 404 };
    const cust = CUSTOMERS.find((c) => c.id === org);
    const unit = String(a.unit ?? l.unit ?? "");
    if (!cust.units.includes(unit)) return { error: "not one of your units", status: 403 };
    const qty = Math.round(Number(a.qty));
    if (!Number.isFinite(qty) || qty < 1) return { error: "issue at least one", status: 400 };
    const n = issue(l.id, unit, qty, TODAY);
    if (!n) return { error: `Nothing left in store from ${l.id}`, status: 409 };
    return { ok: true, message: `${n} ${nameOf(l.sku)} from ${l.id} issued to ${unit}${n < qty ? ` (only ${n} were in store)` : ""}` };
  }

  function syncAct(org) {
    // Ground stations reconnect and upload the sorties flown since the last sync.
    const day = addDays(syncedTo, 1);
    if (day > TODAY) return { error: "Every ground station is already synced to today", status: 409 };
    const r = mulberry32(daysBetween("2026-01-01", day) * 7 + records.length);
    const out = flyDay(day, r).filter((x) => x.org === org);
    syncedTo = day;
    const ended = out.filter((x) => !x.recovered).length;
    return { ok: true, message: `Synced ${out.length} end-of-flight records for ${day} from your ground stations: ${ended} airframes ended, ${out.length - ended} recovered` };
  }

  function replaceRejects(a) {
    const l = deliveries.find((x) => x.id === a.lot);
    const open = l ? l.rejected.filter((x) => !x.replaced) : [];
    if (!open.length) return { error: "no rejected serials waiting on that lot", status: 409 };
    const id = `DL-${(deliverySeq += 1)}`;
    const nl = newDelivery({ id, org: l.org, unit: l.unit, sku: l.sku, qty: open.length, built: TODAY, shipped: TODAY, decided: null, rejects: [], esc2611: 0, fw: RELEASES[RELEASES.length - 1].version, fc: "FC-0334" });
    nl.replaces = l.id;
    for (const x of open) x.replaced = id;
    return { ok: true, message: `${id} shipped to ${custName(l.org).split(":")[0]}: ${open.length} replacement ${nameOf(l.sku)} for the serials rejected on ${l.id}, each with its bench record` };
  }

  function openAction(a, actor) {
    const q = quality();
    const sig = q.signals.find((s) => s.lot === a.lot);
    if (!sig) return { error: "no field data for that lot", status: 404 };
    if (sig.action) return { error: `${sig.action} is already open for ${sig.lot}`, status: 409 };
    const id = `SCA-${(actionSeq += 1)}`;
    actions.push({
      id, lot: sig.lot, pn: sig.pn, supplier: sig.supplier, status: "open", opened: TODAY, by: actor,
      evidence: `${sig.faults} field faults in ${sig.sorties} shared sorties (${(sig.rate * 100).toFixed(1)}% against ${(sig.baseline * 100).toFixed(1)}% for the other lots, p = ${sig.p_value})`,
    });
    return { ok: true, message: `${id} opened with ${SUPPLIERS.find((s) => s.id === sig.supplier)?.name ?? sig.supplier} for lot ${sig.lot}: ${sig.faults} field faults in ${sig.sorties} sorties` };
  }

  function holdLot(a, actor) {
    const lot = String(a.lot ?? "");
    if (!quality().signals.some((s) => s.lot === lot)) return { error: "no field data for that lot", status: 404 };
    if (holds.some((h) => h.value === lot)) return { error: `${lot} is already on hold`, status: 409 };
    const inService = [...serials.values()].filter((s) => Object.values(s.parts).includes(lot) && ["accepted", "issued"].includes(s.state)).length;
    holds.push({ attribute: "lot", value: lot, serials: inService, by: actor, at: new Date().toISOString(), from: "quality" });
    return { ok: true, message: `${lot} on hold: ${inService} airframes in customer stores carry it and get inspection work orders; factory stock is quarantined` };
  }

  function closeAction(a) {
    const x = actions.find((y) => y.id === a.id && y.status === "open");
    if (!x) return { error: "no open action with that id", status: 404 };
    x.status = "closed";
    x.closed = TODAY;
    return { ok: true, message: `${x.id} closed: the supplier's root cause and fix are on file` };
  }

  /** Neros queue items from the serial record. */
  function queueItems() {
    const items = [];
    for (const l of deliveries) {
      const open = l.rejected.filter((x) => !x.replaced);
      if (open.length) {
        items.push({
          id: `q-rej-${l.id}`, area: "Logistics", severity: "high", org: l.org,
          title: `Replace ${open.length} serial${open.length === 1 ? "" : "s"} rejected at receiving on ${l.id}`,
          detail: open.map((x) => `${x.serial}: ${REJECT_REASONS[x.reason] ?? x.reason}`).join("; "),
          actions: [{ label: `Ship ${open.length} replacement${open.length === 1 ? "" : "s"}`, action: "thread.rejects.replace", args: { lot: l.id }, primary: true }],
        });
      }
    }
    for (const s of quality().signals.filter((x) => x.flagged && !x.action)) {
      items.push({
        id: `q-field-${s.lot}`, area: "Quality", severity: "high",
        title: `Field data: lot ${s.lot} (${s.pn}) faults ${s.ratio}x the other lots`,
        detail: `${s.faults} faults in ${s.sorties} shared sorties, p = ${s.p_value}. Open a supplier corrective action, and hold the lot if it should not fly.`,
        actions: [
          { label: "Open supplier action", action: "thread.quality.action", args: { lot: s.lot }, primary: true },
          ...(s.held ? [] : [{ label: "Hold the lot", action: "thread.quality.hold", args: { lot: s.lot } }]),
        ],
      });
    }
    return items;
  }

  /** Per-unit on-hand count for the supply portal: issued plus in store. */
  function onHand(unit) {
    return [...serials.values()].filter((s) => s.unit === unit ? s.state === "issued" : s.state === "accepted" && deliveries.find((l) => l.id === s.delivery_lot)?.unit === unit).length;
  }

  return {
    receiving, lotPackage, accountability, serialRecord, quality, queueItems, onHand, sharedRecords, acceptanceStats,
    acceptDelivery, issueAct, syncAct, replaceRejects, openAction, holdLot, closeAction,
    serials, deliveries, records, operators: OPERATORS, actions,
    get syncedTo() { return syncedTo; },
  };
}
