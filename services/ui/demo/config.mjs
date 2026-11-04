// Field configuration: the as-maintained record of each airframe (build 3).
//
// Why: Archer Block 2 lets soldiers swap arms, motors, props and sensor packs
// to reconfigure between 5, 8 and 10 inch (Neros, 9 Mar 2026). After the first
// swap the as-built record is stale. This keeps what each serial is now, checks
// a swap against the rules before it happens, takes the part from the unit's
// spares (with its lot), and holds the airframe out of "ready" until the
// parameter set for its new size is loaded. Neros Quality sees results by
// configuration.
//
// Compatibility rules, spares and parameter sets are SIM placeholders, not
// Neros engineering data. Pure JavaScript.

import { TODAY } from "./company.mjs";
import { OUTCOMES } from "./serials.mjs";
import { nameOf } from "./supply.mjs";

export const SIZES = {
  5: { arm: "ARM-5", motor: "MOT-S", prop: "PROP-5", params: "P-5" },
  8: { arm: "ARM-8", motor: "MOT-L", prop: "PROP-8", params: "P-8" },
  10: { arm: "ARM-10", motor: "MOT-L", prop: "PROP-10", params: "P-10" },
};
export const SENSOR_PACKS = [
  { id: "day", name: "Day FPV camera" },
  { id: "thermal", name: "Thermal and FPV" },
  { id: "down", name: "Down camera and FPV" },
  { id: "illum", name: "EO/IR illuminator and thermal" },
];
const SKU_SIZE = { "ARCHER-5": 5, "ARCHER-8": 8, "ARCHER-10": 10 };
const PART_KEYS = ["arm", "motor", "prop"];
const LOT = { "ARM-5": "AR-2610", "ARM-8": "AR-2611", "ARM-10": "AR-2612", "MOT-S": "MT-1201", "MOT-L": "MT-1192", "PROP-5": "PR-2601", "PROP-8": "PR-2602", "PROP-10": "PR-2603" };
// Spares a unit holds for swaps (SIM). A swap draws a set of four arms, motors or props.
const SPARES = {
  Alpha: { "ARM-5": 24, "ARM-8": 8, "ARM-10": 4, "MOT-S": 16, "MOT-L": 8, "PROP-5": 120, "PROP-8": 16, "PROP-10": 8 },
  Bravo: { "ARM-5": 40, "ARM-8": 0, "ARM-10": 0, "MOT-S": 24, "MOT-L": 0, "PROP-5": 200, "PROP-8": 0, "PROP-10": 0 },
  Charlie: { "ARM-5": 8, "ARM-8": 12, "ARM-10": 8, "MOT-S": 8, "MOT-L": 12, "PROP-5": 32, "PROP-8": 90, "PROP-10": 16 },
  Delta: { "ARM-5": 8, "ARM-8": 4, "ARM-10": 16, "MOT-S": 8, "MOT-L": 16, "PROP-5": 16, "PROP-8": 8, "PROP-10": 80 },
};

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** What a set of parts adds up to, or why it is not a valid airframe. */
export function check(cfg) {
  const size = Number(Object.keys(SIZES).find((k) => SIZES[k].arm === cfg.arm));
  if (!size) return { ok: false, why: `Unknown arm ${cfg.arm}` };
  const want = SIZES[size];
  const bad = PART_KEYS.filter((k) => cfg[k] !== want[k]).map((k) => `${size}-inch arms need ${want[k]} ${k}s, not ${cfg[k]}`);
  if (bad.length) return { ok: false, size, why: bad.join("; ") };
  return { ok: true, size, params: want.params };
}

/** @param {{ serials: ReturnType<import("./serials.mjs").createSerials> }} deps */
export function createConfig({ serials }) {
  const state = new Map();
  const spares = Object.fromEntries(Object.entries(SPARES).map(([u, v]) => [u, { ...v }]));

  function cfgOf(s) {
    let c = state.get(s.serial);
    if (!c) {
      const size = SKU_SIZE[s.sku] ?? 5;
      const w = SIZES[size];
      c = { arm: w.arm, motor: w.motor, prop: w.prop, sensor: SENSOR_PACKS[hash(s.serial) % SENSOR_PACKS.length].id, params: w.params, params_loaded: true, history: [] };
      state.set(s.serial, c);
    }
    return c;
  }

  function row(s) {
    const c = cfgOf(s);
    const v = check(c);
    const ready = v.ok && c.params_loaded;
    return {
      serial: s.serial, sku: s.sku, built_as: nameOf(s.sku), unit: s.unit, size: v.size ?? null, arm: c.arm, motor: c.motor, prop: c.prop, sensor: c.sensor, params: c.params, params_loaded: c.params_loaded,
      ready, blocker: !v.ok ? v.why : !c.params_loaded ? `Load parameter set ${SIZES[v.size].params} before flight` : null,
      changed: c.history.length > 0, history: c.history,
    };
  }

  const issued = (org) => [...serials.serials.values()].filter((s) => s.org === org && s.state === "issued");

  function view(org, unit = null) {
    const mine = issued(org);
    const units = [...new Set(mine.map((s) => s.unit))].sort();
    const pick = unit && units.includes(unit) ? unit : units[0] ?? null;
    const rows = mine.filter((s) => s.unit === pick).slice(0, 24).map(row);
    const changed = mine.filter((s) => state.get(s.serial)?.history.length).map(row);
    return {
      source: "Simulated: compatibility rules, spares, lots and parameter sets are demo placeholders, not Neros engineering data. Block 2 field reconfiguration as Neros announced it (9 Mar 2026).",
      today: TODAY,
      sizes: SIZES,
      sensor_packs: SENSOR_PACKS,
      units: units.map((u) => ({ unit: u, issued: mine.filter((s) => s.unit === u).length, pending: mine.filter((s) => s.unit === u && !row(s).ready).length, spares: spares[u] ?? {} })),
      unit: pick,
      rows: [...changed.filter((r) => r.unit === pick), ...rows.filter((r) => !changed.some((c) => c.serial === r.serial))],
      changed,
    };
  }

  function take(unit, pn) {
    const have = spares[unit]?.[pn] ?? 0;
    if (have < 4) return { error: `${unit} has ${have} ${pn} in spares; a swap takes a set of 4. Request spares through Supply & support.`, status: 409 };
    spares[unit][pn] = have - 4;
    return { ok: true, lot: LOT[pn] ?? "unknown lot" };
  }

  function act(org, action, a, actor) {
    const s = serials.serials.get(String(a.serial ?? ""));
    if (!s || s.org !== org) return { error: "no such serial in your fleet", status: 404 };
    if (s.state !== "issued") return { error: `${s.serial} is ${s.state}; only issued airframes are reconfigured in the field`, status: 409 };
    const c = cfgOf(s);
    if (action === "config.swap") {
      const part = String(a.part ?? "");
      const to = String(a.to ?? "");
      if (part === "sensor") {
        if (!SENSOR_PACKS.some((p) => p.id === to)) return { error: "unknown sensor pack", status: 400 };
        if (c.sensor === to) return { error: "that pack is already fitted", status: 409 };
        c.history.push({ day: TODAY, change: `Sensor pack ${c.sensor} to ${to}`, by: actor });
        c.sensor = to;
        return { ok: true, message: `${s.serial}: sensor pack now ${SENSOR_PACKS.find((p) => p.id === to).name}.` };
      }
      if (!PART_KEYS.includes(part)) return { error: "part must be arm, motor, prop or sensor", status: 400 };
      const next = { ...c, [part]: to };
      const v = check(next);
      if (!v.ok) return { error: `Refused: ${v.why}. Reconfigure the whole size instead, or fit matching parts.`, status: 409 };
      const got = take(s.unit, to);
      if (got.error) return got;
      c.history.push({ day: TODAY, change: `${part} ${c[part]} to ${to} (lot ${got.lot})`, by: actor });
      c[part] = to;
      return { ok: true, message: `${s.serial}: ${part} now ${to}.` };
    }
    if (action === "config.reconfigure") {
      const size = Number(a.size);
      const want = SIZES[size];
      if (!want) return { error: "size must be 5, 8 or 10", status: 400 };
      if (check(c).size === size) return { error: `${s.serial} is already ${size}-inch`, status: 409 };
      for (const k of PART_KEYS) if ((spares[s.unit]?.[want[k]] ?? 0) < 4) return { error: `${s.unit} has ${spares[s.unit]?.[want[k]] ?? 0} ${want[k]} in spares; a ${size}-inch conversion takes 4. Request spares through Supply & support.`, status: 409 };
      const lots = PART_KEYS.map((k) => `${want[k]} lot ${take(s.unit, want[k]).lot}`);
      c.history.push({ day: TODAY, change: `Reconfigured to ${size}-inch: ${lots.join(", ")}`, by: actor });
      Object.assign(c, { arm: want.arm, motor: want.motor, prop: want.prop, params: want.params, params_loaded: false });
      return { ok: true, message: `${s.serial} reconfigured to ${size}-inch. Held from ready until parameter set ${want.params} is loaded.` };
    }
    if (action === "config.params") {
      if (c.params_loaded) return { error: "parameters are already loaded for this configuration", status: 409 };
      c.params_loaded = true;
      c.history.push({ day: TODAY, change: `Parameter set ${c.params} loaded and verified`, by: actor });
      return { ok: true, message: `${s.serial}: parameter set ${c.params} loaded; back to ready.` };
    }
    return { error: "unknown action", status: 400 };
  }

  /** Airframes per unit held from ready by their configuration. */
  function notReady(org) {
    const out = {};
    for (const s of issued(org)) if (state.has(s.serial) && !row(s).ready) out[s.unit] = (out[s.unit] ?? 0) + 1;
    return out;
  }

  /** Neros Quality: shared outcomes by size and sensor pack. */
  function byConfiguration(records) {
    const groups = new Map();
    for (const r of records) {
      const s = serials.serials.get(r.serial);
      if (!s) continue;
      const c = cfgOf(s);
      const key = `${check(c).size ?? "?"}-inch, ${SENSOR_PACKS.find((p) => p.id === c.sensor)?.name ?? c.sensor}`;
      const g = groups.get(key) ?? { config: key, sorties: 0, completed: 0, hw_fault: 0 };
      g.sorties += 1;
      if (r.outcome === "completed") g.completed += 1;
      if (r.outcome === "hw_fault") g.hw_fault += 1;
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ ...g, rate: g.sorties ? g.completed / g.sorties : null, fault_rate: g.sorties ? g.hw_fault / g.sorties : null })).sort((a, b) => a.config.localeCompare(b.config, "en", { numeric: true }));
  }

  return { view, act, notReady, byConfiguration, check, outcomes: OUTCOMES };
}
