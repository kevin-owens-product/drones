// Mixed fleet: one readiness and accountability picture across every vendor a
// unit flies, whichever control software flies them (build 2).
//
// Why: Drone Dominance Phase III makes open architecture mandatory and points
// vendors at "unified government control software"; the Army's C2 call buys
// controllers that plug into NGC2 through a government SDK. A unit commander
// already runs three to five vendors (SRR quads, several PBAS primes, nano
// recon). The platform earns its place by keeping the fleet's record across
// all of them: Neros tails carry the full serial record, other vendors' tails
// carry what their logs give, and the page says which is which.
//
// Vendors here are generic program labels on purpose; no real product is
// implied. Tails, logs and the NGC2 status are SIM. Pure JavaScript.

import { TODAY } from "./company.mjs";
import { OUTCOMES, addDays } from "./serials.mjs";
import { nameOf } from "./supply.mjs";

export const VENDORS = [
  { id: "neros", name: "Neros Archer", program: "PBAS / Drone Dominance", depth: ["Birth record", "Acceptance package", "End-of-flight records", "Supplier lots", "Field configuration"] },
  { id: "srr-q", name: "Short-range recon quad (other vendor)", program: "SRR", depth: ["Flight log"] },
  { id: "pbas-e", name: "PBAS FPV (another prime)", program: "PBAS", depth: ["Flight log"] },
  { id: "sbs-n", name: "Nano recon (other vendor)", program: "SBS", depth: ["Flight log"] },
];
export const LOG_SOURCES = ["Government control software export", "MAVLink-M telemetry", "Manual entry"];
export const LOG_FIELDS = ["tail", "vendor", "unit", "day", "minutes", "outcome"];
export const STALE_DAYS = 21;
export const NO_GENEALOGY = "This vendor publishes no birth record, acceptance package or supplier lots, so the platform holds its flight log only.";

const SEED = {
  "CUS-A": [
    { tail: "SRQ-101", vendor: "srr-q", unit: "Alpha", source: 0, last: "2026-11-02", flights_30d: 14, minutes_30d: 286, status: "ready" },
    { tail: "SRQ-102", vendor: "srr-q", unit: "Alpha", source: 0, last: "2026-10-31", flights_30d: 9, minutes_30d: 171, status: "ready" },
    { tail: "SRQ-118", vendor: "srr-q", unit: "Bravo", source: 1, last: "2026-11-03", flights_30d: 21, minutes_30d: 402, status: "ready" },
    { tail: "SRQ-121", vendor: "srr-q", unit: "Bravo", source: 1, last: "2026-10-08", flights_30d: 2, minutes_30d: 31, status: "ready" },
    { tail: "PBE-2204", vendor: "pbas-e", unit: "Charlie", source: 0, last: "2026-11-01", flights_30d: 11, minutes_30d: 96, status: "ready" },
    { tail: "PBE-2207", vendor: "pbas-e", unit: "Charlie", source: 0, last: "2026-11-02", flights_30d: 8, minutes_30d: 70, status: "grounded", note: "Cracked arm, vendor part on order" },
    { tail: "PBE-2215", vendor: "pbas-e", unit: "Delta", source: 2, last: "2026-10-30", flights_30d: 6, minutes_30d: 48, status: "ready" },
    { tail: "SBS-0031", vendor: "sbs-n", unit: "Delta", source: 2, last: "2026-10-29", flights_30d: 12, minutes_30d: 190, status: "ready" },
    { tail: "SBS-0034", vendor: "sbs-n", unit: "Delta", source: 2, last: "2026-10-02", flights_30d: 0, minutes_30d: 0, status: "ready" },
  ],
  "CUS-C": [
    { tail: "ALQ-11", vendor: "srr-q", unit: "1st Recce Sqn", source: 1, last: "2026-11-02", flights_30d: 17, minutes_30d: 344, status: "ready" },
    { tail: "ALQ-14", vendor: "srr-q", unit: "1st Recce Sqn", source: 1, last: "2026-10-27", flights_30d: 7, minutes_30d: 120, status: "ready" },
  ],
};

/**
 * @param {{ serials: ReturnType<import("./serials.mjs").createSerials>, notReady?: (org: string) => Record<string, number> }} deps
 * `notReady` returns, per unit, Neros airframes another record holds back (stockpile health, pending parameters).
 */
export function createMixedFleet({ serials, notReady = () => ({}) }) {
  const tails = new Map();
  for (const [org, rows] of Object.entries(SEED)) for (const r of rows) tails.set(r.tail, { ...r, org, source: LOG_SOURCES[r.source], ngc2: r.source === 1, retired: null, log: [] });

  function statusOf(t) {
    if (t.retired) return "retired";
    if (t.status === "grounded") return "grounded";
    if (t.last < addDays(TODAY, -STALE_DAYS)) return "unknown";
    return "ready";
  }

  function view(org) {
    const acct = serials.accountability(org);
    const held = notReady(org);
    const nerosRows = acct.units.filter((u) => u.in_store + u.issued > 0).map((u) => {
      const total = u.in_store + u.issued;
      const hold = Math.min(total, held[u.unit] ?? 0);
      return { kind: "neros", unit: u.unit, vendor: "neros", model: nameOf(u.sku), total, ready: total - hold, held: hold, sorties_14d: u.sorties_14d, source: "Neros ground station end-of-flight records", depth: VENDORS[0].depth };
    });
    const others = [...tails.values()].filter((t) => t.org === org).map((t) => ({ ...t, vendor_name: VENDORS.find((v) => v.id === t.vendor)?.name ?? t.vendor, state: statusOf(t), depth: VENDORS.find((v) => v.id === t.vendor)?.depth ?? ["Flight log"], log: t.log.slice(-5) }));
    const units = [...new Set([...nerosRows.map((r) => r.unit), ...others.map((t) => t.unit)])];
    const byUnit = units.map((unit) => {
      const n = nerosRows.filter((r) => r.unit === unit);
      const o = others.filter((t) => t.unit === unit && t.state !== "retired");
      const vendors = new Set([...n.map(() => "neros"), ...o.map((t) => t.vendor)]);
      return {
        unit,
        vendors: vendors.size,
        total: n.reduce((s, r) => s + r.total, 0) + o.length,
        ready: n.reduce((s, r) => s + r.ready, 0) + o.filter((t) => t.state === "ready").length,
        unknown: o.filter((t) => t.state === "unknown").length,
        grounded: o.filter((t) => t.state === "grounded").length,
        held: n.reduce((s, r) => s + r.held, 0),
      };
    });
    return {
      source: "Simulated: other vendors' tails and logs are demo data under generic labels; no real product is implied. Neros tails come from the serial record.",
      today: TODAY,
      vendors: VENDORS,
      sources: LOG_SOURCES,
      log_fields: LOG_FIELDS,
      stale_days: STALE_DAYS,
      units: byUnit,
      neros: nerosRows,
      others,
      counts: {
        vendors: new Set([...(nerosRows.length ? ["neros"] : []), ...others.filter((t) => t.state !== "retired").map((t) => t.vendor)]).size,
        tails: byUnit.reduce((s, u) => s + u.total, 0),
        ready: byUnit.reduce((s, u) => s + u.ready, 0),
        unknown: others.filter((t) => t.state === "unknown").length,
        ngc2: others.filter((t) => t.ngc2 && t.state !== "retired").length + (nerosRows.length ? 1 : 0),
      },
      sample_log: "tail,vendor,unit,day,minutes,outcome\nSRQ-121,srr-q,Bravo,2026-11-03,22,completed\nPBE-2231,pbas-e,Charlie,2026-11-03,9,completed\nNX-05,neros,Charlie,2026-11-03,12,completed\nSRQ-140,srr-q,Bravo,2026-13-01,20,completed",
    };
  }

  function tail(org, id) {
    const t = tails.get(id);
    if (!t || t.org !== org) return null;
    return { tail: t.tail, vendor: t.vendor, state: statusOf(t), genealogy: null, why: NO_GENEALOGY, log: t.log, last: t.last, source: t.source };
  }

  /** Parse a CSV log export. Every row is checked; good rows land, bad rows come back with the reason. */
  function importLog(org, csv, actor) {
    const lines = String(csv ?? "").trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { error: "Paste a header row and at least one flight.", status: 400 };
    const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const missing = LOG_FIELDS.filter((f) => !head.includes(f));
    if (missing.length) return { error: `The log is missing columns: ${missing.join(", ")}`, status: 400 };
    const accepted = [];
    const rejected = [];
    for (const [i, line] of lines.slice(1).entries()) {
      const cells = line.split(",").map((c) => c.trim());
      const row = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? ""]));
      const why = [];
      if (!/^[A-Z0-9-]{2,16}$/.test(row.tail)) why.push("tail id");
      if (row.vendor === "neros") why.push("Neros tails report through their own end-of-flight records");
      else if (!VENDORS.some((v) => v.id === row.vendor)) why.push(`unknown vendor ${row.vendor || "(blank)"}`);
      const d = new Date(`${row.day}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== row.day) why.push("day is not a date");
      else if (row.day > TODAY) why.push("day is in the future");
      const min = Number(row.minutes);
      if (!Number.isFinite(min) || min <= 0 || min > 300) why.push("minutes must be 1 to 300");
      if (!OUTCOMES.includes(row.outcome)) why.push(`outcome must be one of ${OUTCOMES.join(", ")}`);
      const existing = tails.get(row.tail);
      if (existing && existing.org !== org) why.push("tail belongs to another organisation");
      if (why.length) {
        rejected.push({ line: i + 2, tail: row.tail, why });
        continue;
      }
      const t = existing ?? { tail: row.tail, vendor: row.vendor, unit: row.unit || "Unassigned", org, source: LOG_SOURCES[0], last: row.day, flights_30d: 0, minutes_30d: 0, status: "ready", ngc2: false, retired: null, log: [] };
      t.log.push({ day: row.day, minutes: min, outcome: row.outcome, by: actor });
      if (row.day >= addDays(TODAY, -30)) {
        t.flights_30d += 1;
        t.minutes_30d += min;
      }
      if (row.day > t.last) t.last = row.day;
      tails.set(t.tail, t);
      accepted.push(row.tail);
    }
    return {
      ok: true, accepted, rejected,
      message: `${accepted.length} flight${accepted.length === 1 ? "" : "s"} imported${rejected.length ? `; ${rejected.length} row${rejected.length === 1 ? "" : "s"} refused: ${rejected.map((r) => `line ${r.line} (${r.why.join("; ")})`).join(", ")}` : ""}.`,
    };
  }

  function act(org, action, a, actor) {
    if (action === "mixed.import") return importLog(org, a.csv, actor);
    const t = tails.get(String(a.tail ?? ""));
    if (!t || t.org !== org) return { error: "no such tail in your fleet", status: 404 };
    if (action === "mixed.retire") {
      if (t.retired) return { error: "already retired", status: 409 };
      t.retired = { day: TODAY, reason: String(a.reason ?? "Expended or written off"), by: actor };
      return { ok: true, message: `${t.tail} retired: ${t.retired.reason}.` };
    }
    if (action === "mixed.ngc2") {
      if (t.source === LOG_SOURCES[2]) return { error: `${t.tail} reports by manual entry; publishing to NGC2 needs a MAVLink-M or government SDK source.`, status: 409 };
      t.ngc2 = !t.ngc2;
      return { ok: true, message: `${t.tail} ${t.ngc2 ? "now publishes" : "no longer publishes"} its position and status to the NGC2 data layer (SIM).` };
    }
    if (action === "mixed.ground") {
      t.status = t.status === "grounded" ? "ready" : "grounded";
      t.note = t.status === "grounded" ? String(a.note ?? "Grounded by the unit") : undefined;
      return { ok: true, message: `${t.tail} ${t.status === "grounded" ? "grounded" : "returned to service"}.` };
    }
    return { error: "unknown action", status: 400 };
  }

  return { view, tail, act, importLog, tails };
}
