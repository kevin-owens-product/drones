// Stockpile health: airframes and battery packs sitting in a unit's store,
// and whether they are still ready to fly (docs/design/round-two.md, build 9).
//
// Why: attritable drones are bought ahead of need and stored. Lithium packs
// age on the shelf, age faster at high charge and in heat, and a pack past its
// shelf life is not a pack you launch on. Separately, the FY24 NDAA bars
// batteries from listed cell makers from a set date. A unit needs to know
// which stored airframes will actually fly, and what to recharge, inspect,
// rotate or retire before they are needed.
//
// Pack data (maker, made date, charge, heat) are SIM, seeded per serial. Cell
// makers are generic labels. The listed-maker date is the FY24 NDAA §154
// effective date as the demo assumes it. Pure JavaScript.

import { TODAY } from "./company.mjs";
import { addDays } from "./serials.mjs";

export const RULES = {
  shelf_days: 180, // pack past this age is not flown: holds its airframe
  storage_soc_max: 0.6, // charge above this in storage for long...
  storage_days_warn: 45, // ...longer than this: recharge (discharge) to storage charge
  heat_c: 40, // store hotter than this: inspect for swelling
  listed_ban: "2027-10-01", // listed cell makers barred from this date (SIM reading of FY24 NDAA §154)
};

const MAKERS = [
  { id: "CELL-A", name: "Cell maker A (domestic)", listed: false },
  { id: "CELL-B", name: "Cell maker B (allied)", listed: false },
  { id: "CELL-C", name: "Cell maker C (listed maker, §154)", listed: true },
];

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
function hash(str) {
  let h = [...str].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  // Avalanche, so neighbouring serials get unrelated packs.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** @param {{ serials: any }} deps */
export function createStockpile({ serials }) {
  /** serial -> pack state; only for airframes in a store. */
  const packs = new Map();
  const retired = new Map();
  let packSeq = 5000;

  function lotUnit(s) {
    return serials.deliveries.find((l) => l.id === s.delivery_lot)?.unit ?? null;
  }
  function stored(org) {
    return [...serials.serials.values()].filter((s) => s.org === org && s.state === "accepted" && lotUnit(s) && !retired.has(s.serial));
  }
  function packOf(s) {
    if (!packs.has(s.serial)) {
      const h = hash(s.serial);
      const maker = MAKERS[h % 11 === 0 ? 2 : h % 3 === 0 ? 1 : 0];
      packs.set(s.serial, {
        id: `PK-${(packSeq += 1)}`,
        maker: maker.id,
        made: addDays(TODAY, -(30 + (h % 190))),
        stored: addDays(TODAY, -(10 + ((h >>> 3) % 90))),
        soc: Number((0.35 + ((h >>> 5) % 60) / 100).toFixed(2)),
        heat_c: 22 + ((h >>> 7) % 23),
        history: [],
      });
    }
    return packs.get(s.serial);
  }

  function assess(s) {
    const p = packOf(s);
    const maker = MAKERS.find((m) => m.id === p.maker);
    const age = daysBetween(p.made, TODAY);
    const storedDays = daysBetween(p.stored, TODAY);
    const flags = [];
    if (age > RULES.shelf_days) flags.push({ level: "hold", code: "over_age", text: `Pack ${age} days old, past the ${RULES.shelf_days}-day shelf life`, fix: "rotate" });
    if (maker.listed) flags.push({ level: "warn", code: "listed_maker", text: `${maker.name}: barred from ${RULES.listed_ban} (${daysBetween(TODAY, RULES.listed_ban)} days)`, fix: "rotate" });
    if (p.soc > RULES.storage_soc_max && storedDays > RULES.storage_days_warn) flags.push({ level: "warn", code: "high_charge", text: `Stored ${storedDays} days at ${Math.round(p.soc * 100)}% charge`, fix: "recharge" });
    if (p.heat_c > RULES.heat_c) flags.push({ level: "warn", code: "heat", text: `Store reached ${p.heat_c} °C`, fix: "inspect" });
    return {
      serial: s.serial, sku: s.sku, unit: lotUnit(s), lot: s.delivery_lot,
      pack: { id: p.id, maker: maker.name, listed: maker.listed, made: p.made, age_days: age, stored_days: storedDays, soc: p.soc, heat_c: p.heat_c },
      flags, ready: !flags.some((f) => f.level === "hold"), history: p.history.slice(),
    };
  }

  function view(org, unit = null) {
    const rows = stored(org).map(assess);
    const units = [...new Set(rows.map((r) => r.unit))].sort();
    const pick = unit && units.includes(unit) ? unit : null;
    const shown = (pick ? rows.filter((r) => r.unit === pick) : rows).sort((a, b) => Number(a.ready) - Number(b.ready) || b.flags.length - a.flags.length || a.serial.localeCompare(b.serial));
    const count = (code) => rows.filter((r) => r.flags.some((f) => f.code === code)).length;
    return {
      source: "Simulated: pack makers, ages, charge and store temperatures are demo data seeded per serial. Cell makers are generic labels.",
      today: TODAY, rules: RULES,
      units: units.map((u) => ({ unit: u, stored: rows.filter((r) => r.unit === u).length, held: rows.filter((r) => r.unit === u && !r.ready).length })),
      unit: pick,
      counts: { stored: rows.length, held: rows.filter((r) => !r.ready).length, over_age: count("over_age"), listed: count("listed_maker"), high_charge: count("high_charge"), heat: count("heat") },
      rows: shown.slice(0, 120),
      retired: [...retired.entries()].filter(([id]) => serials.serials.get(id)?.org === org).map(([serial, x]) => ({ serial, ...x })),
      ban_days: daysBetween(TODAY, RULES.listed_ban),
    };
  }

  function act(org, action, a, actor) {
    const s = serials.serials.get(String(a.serial ?? ""));
    if (!s || s.org !== org || s.state !== "accepted" || retired.has(s.serial)) return { error: "not an airframe in your store", status: 404 };
    const p = packOf(s);
    if (action === "stock.recharge") {
      if (p.soc <= RULES.storage_soc_max) return { error: `${p.id} is already at ${Math.round(p.soc * 100)}%, inside storage charge`, status: 409 };
      p.soc = 0.5;
      p.stored = TODAY;
      p.history.push({ day: TODAY, what: `Brought to 50% storage charge by ${actor}` });
      return { ok: true, message: `${s.serial}: ${p.id} brought to 50% storage charge.` };
    }
    if (action === "stock.inspect") {
      p.heat_c = Math.min(p.heat_c, RULES.heat_c);
      p.history.push({ day: TODAY, what: `Inspected for swelling after heat, passed, by ${actor}` });
      return { ok: true, message: `${s.serial}: ${p.id} inspected after heat exposure; no swelling recorded.` };
    }
    if (action === "stock.rotate") {
      const old = p.id;
      const fresh = { id: `PK-${(packSeq += 1)}`, maker: "CELL-A", made: addDays(TODAY, -14), stored: TODAY, soc: 0.5, heat_c: 22, history: [...p.history, { day: TODAY, what: `Pack ${old} rotated out for a fresh domestic pack by ${actor}` }] };
      packs.set(s.serial, fresh);
      return { ok: true, message: `${s.serial}: ${old} swapped for ${fresh.id} (domestic, 14 days old). ${assess(s).ready ? "Back to ready." : ""}`.trim() };
    }
    if (action === "stock.retire") {
      retired.set(s.serial, { day: TODAY, by: actor, reason: String(a.reason ?? "Retired from store") });
      return { ok: true, message: `${s.serial} retired from store; it no longer counts toward readiness.` };
    }
    return { error: "unknown action", status: 400 };
  }

  /** Stored airframes per unit held from ready: an over-age pack, or retired from store. */
  function notReady(org) {
    const out = {};
    for (const s of stored(org)) if (!assess(s).ready) out[lotUnit(s)] = (out[lotUnit(s)] ?? 0) + 1;
    // Retired airframes still sit on the books until the store hands them back; they never count as ready.
    for (const id of retired.keys()) {
      const s = serials.serials.get(id);
      if (s?.org === org && s.state === "accepted") out[lotUnit(s)] = (out[lotUnit(s)] ?? 0) + 1;
    }
    return out;
  }

  return { view, act, notReady, RULES };
}
