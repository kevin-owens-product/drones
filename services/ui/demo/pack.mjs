// The battery as an electro-thermal system, not a fuel tank.
//
// A cold pack does not run out of energy, it runs out of voltage. Internal
// resistance roughly triples between 25 °C and -10 °C, so the same 150 W pulls
// the cells down further, the flight controller's low-voltage cutoff trips with
// energy still in the pack, and the worst moment is the climb-out: peak power,
// coldest pack. Once flying, the current heats the cells and the airflow cools
// them, and which wins depends on the airframe. This model carries all of that:
// a one-RC equivalent circuit per cell with Arrhenius resistance, a lumped
// thermal mass with self-heating and convective cooling, and the cutoff as the
// thing that ends the flight. The flat "7.5% per 10 °C" derate in physics.mjs
// stays for the live sortie; launch checks and the physics check use this.
//
// Textbook relations, assumed coefficients. Nothing here is a measured Neros
// figure; the bench (sim/bench) is where R0 and the thermal mass get measured.

/**
 * Packs by airframe SKU. Series cells, parallel strings, per-cell resistance
 * at 25 °C, chemistry, and the load-voltage cutoff the flight controller lands on.
 * Energies match physics.mjs AIRFRAMES.
 */
export const PACKS = {
  "ARCHER-5": { label: "6S 1300 mAh LiPo", chem: "lipo", s: 6, p: 1, ah: 1.3, r0_ohm: 0.01, mass_kg: 0.21, cp: 1000, cutoff_v: 3.3 },
  "ARCHER-8": { label: "6S 4000 mAh Li-ion", chem: "liion", s: 6, p: 1, ah: 4.0, r0_ohm: 0.018, mass_kg: 0.42, cp: 900, cutoff_v: 3.0 },
  "ARCHER-10": { label: "6S2P 8000 mAh Li-ion", chem: "liion", s: 6, p: 2, ah: 4.0, r0_ohm: 0.018, mass_kg: 0.84, cp: 900, cutoff_v: 3.0 },
};

export const PACK = {
  arrhenius_k: 2400, // B in R(T) = R25 exp(B (1/T - 1/298 K)); about 3x at -10 °C
  r1_fraction: 0.5, // polarisation resistance as a share of R0
  tau_s: 30, // polarisation time constant
  cold_capacity_per_c: 0.004, // 0.4% of capacity per °C below 25 °C is not reachable at any rate
  g_still_w_per_k: 0.25, // conductance pack to air inside the airframe, still air
  g_flow_w_per_k: 0.12, // plus this times sqrt(airspeed m/s) in flight
  warmer_c: 40, // pad warmer set point
  g_warmer_w_per_k: 1.0, // pack to warmer conductance (a heated bag)
  pad_window_min: 5, // time on the pad between the warmer and launch the advice allows for
  margin_v: 0.1, // cutoff margin per cell the advice holds
  punch_climb_mps: 5, // a full-rate climb, which the operator may command at any moment
  climb_out_s: 300, // the first five minutes: peak power on the coldest pack
  preheat_margin_c: 5, // the core lags the skin: warm 5 °C past the bare minimum
};

const K = 273.15;

/** Open-circuit voltage per cell at a state of charge. LiPo has a long plateau and a late knee; Li-ion slopes. */
export function ocv(chem, soc) {
  const s = Math.max(0, Math.min(1, soc));
  if (chem === "liion") return 3.0 + 1.2 * s - 0.3 * (1 - s) ** 10;
  return 3.3 + 0.9 * s ** 0.55 - 0.15 * (1 - s) ** 8;
}

/** Internal resistance per cell at a temperature, ohms. */
export function r0At(pack, tempC) {
  return pack.r0_ohm * Math.exp(PACK.arrhenius_k * (1 / (tempC + K) - 1 / (25 + K)));
}

/** Fraction of rated capacity reachable at a temperature, before any voltage limit. */
export function capacityAt(tempC) {
  return Math.max(0.6, 1 - PACK.cold_capacity_per_c * Math.max(0, 25 - tempC));
}

/**
 * Current a pack draws to deliver `watts` from an open-circuit EMF `e` through
 * series resistance `r`: the smaller root of r I^2 - e I + P = 0. When the
 * power asked for is more than e^2 / 4r the pack cannot deliver it at any
 * current (the voltage collapses): null.
 */
export function currentFor(e, r, watts) {
  const disc = e * e - 4 * r * watts;
  if (disc < 0) return null;
  return (e - Math.sqrt(disc)) / (2 * r);
}

/**
 * Fly a power trace through the pack. `trace` is [{t, watts, air_mps}] at a
 * fixed step. Returns a row per step and what ended or threatened the flight.
 *
 * @param {object} pack a PACKS entry
 * @param {{t: number, watts: number, air_mps?: number, punch_w?: number}[]} trace
 * @param {{ambient_c: number, start_c?: number, start_soc?: number}} cond
 */
export function flyPack(pack, trace, cond) {
  const ambient = cond.ambient_c;
  let temp = cond.start_c ?? ambient;
  let soc = cond.start_soc ?? 0.95;
  let v1 = 0; // polarisation voltage per cell
  let wh = 0;
  const heatCap = pack.mass_kg * pack.cp;
  const rows = [];
  let cutoff = null;
  let collapse = null;
  let minV = Infinity;
  let minPunch = Infinity;
  let minPunchAt = null;
  let earlyV = Infinity;
  let earlyPunch = Infinity;
  for (let k = 0; k < trace.length; k += 1) {
    const { t, watts, air_mps: air = 0, punch_w } = trace[k];
    const capAh = pack.ah * pack.p * capacityAt(temp);
    const r0 = (r0At(pack, temp) * pack.s) / pack.p;
    const r1 = r0 * PACK.r1_fraction;
    const e = pack.s * (ocv(pack.chem, soc) - v1);
    let i = currentFor(e, r0, watts);
    if (i === null) {
      collapse ??= { t, watts: Math.round(watts), temp_c: Math.round(temp * 10) / 10 };
      i = e / (2 * r0);
    }
    const vCell = (e - i * r0) / pack.s;
    minV = Math.min(minV, vCell);
    if (t <= PACK.climb_out_s) earlyV = Math.min(earlyV, vCell);
    if (vCell < pack.cutoff_v && !cutoff) cutoff = { t, v_cell: Math.round(vCell * 100) / 100, soc: Math.round(soc * 100), temp_c: Math.round(temp * 10) / 10, wh: Math.round(wh * 10) / 10 };
    // A full-rate climb from here: instantaneous, so only R0 bites.
    if (punch_w) {
      const ip = currentFor(e, r0, punch_w);
      const vp = ip === null ? e / (2 * pack.s) : (e - ip * r0) / pack.s;
      if (vp < minPunch) [minPunch, minPunchAt] = [vp, t];
      if (t <= PACK.climb_out_s) earlyPunch = Math.min(earlyPunch, vp);
    }
    const heat = i * i * (r0 + r1);
    const g = PACK.g_still_w_per_k + PACK.g_flow_w_per_k * Math.sqrt(Math.max(0, air));
    rows.push({ t, soc: Math.round(soc * 1000) / 10, v_cell: Math.round(vCell * 1000) / 1000, temp_c: Math.round(temp * 10) / 10, amps: Math.round(i * 10) / 10, heat_w: Math.round(heat * 10) / 10, watts: Math.round(watts) });
    // Step the state to the next sample.
    const h = k + 1 < trace.length ? trace[k + 1].t - t : 0;
    if (h > 0) {
      soc = Math.max(0, soc - (i * h) / 3600 / capAh);
      const a = Math.exp(-h / PACK.tau_s);
      v1 = v1 * a + ((i * r1) / pack.s) * (1 - a);
      temp += ((heat - g * (temp - ambient)) * h) / heatCap;
      wh += (watts * h) / 3600;
    }
  }
  return {
    rows,
    cutoff,
    collapse,
    min_v_cell: Math.round(minV * 100) / 100,
    min_punch_v_cell: Number.isFinite(minPunch) ? Math.round(minPunch * 100) / 100 : null,
    min_punch_at_s: minPunchAt,
    climb_out_v_cell: Number.isFinite(earlyV) ? Math.round(earlyV * 100) / 100 : null,
    climb_out_punch_v_cell: Number.isFinite(earlyPunch) ? Math.round(earlyPunch * 100) / 100 : null,
    end: rows.at(-1) ?? null,
    delivered_wh: Math.round(wh * 10) / 10,
  };
}

/**
 * The climb-out holds when, in the first five minutes, the cells stay above
 * the cutoff plus margin in steady flight and above the cutoff in a full-rate
 * climb. This is the part preheating fixes.
 */
export function climbOutHolds(pack, result) {
  if (result.collapse && result.collapse.t <= PACK.climb_out_s) return false;
  if (result.climb_out_v_cell !== null && result.climb_out_v_cell < pack.cutoff_v + PACK.margin_v) return false;
  if (result.climb_out_punch_v_cell !== null && result.climb_out_punch_v_cell < pack.cutoff_v) return false;
  return true;
}

/** Pack temperature after `minutes` exposed to `ambient` through conductance `g`, from `start`. */
export function soak(pack, start, ambient, g, minutes) {
  const tau = (pack.mass_kg * pack.cp) / g;
  return ambient + (start - ambient) * Math.exp((-minutes * 60) / tau);
}

/**
 * Preheat advice for one sortie. Cold: the flight with the pack at ambient.
 * Then the coolest launch temperature whose climb-out holds, the temperature
 * to take the pack out of the warmer at so it still has that after the pad
 * window, how long the warmer takes from ambient, and the flight flown from
 * there. A null `launch_c` means nothing up to the warmer's set point is enough.
 * Preheating buys the climb-out; the pack's thermal mass gives most of it back
 * within about ten minutes, so a cutoff late in the flight is a reserve
 * problem (land sooner), not a preheat problem.
 */
export function preheat(pack, trace, cond) {
  const ambient = cond.ambient_c;
  const cold = flyPack(pack, trace, { ...cond, start_c: ambient });
  if (climbOutHolds(pack, cold)) return { needed: false, launch_c: Math.round(ambient), out_c: Math.round(ambient), warm_min: 0, cold, warm: cold };
  let launch = null;
  let warm = null;
  for (let T = Math.ceil(ambient) + 1; T <= PACK.warmer_c - 5; T += 1) {
    const r = flyPack(pack, trace, { ...cond, start_c: T });
    if (climbOutHolds(pack, r)) {
      launch = Math.min(PACK.warmer_c - 5, T + PACK.preheat_margin_c);
      warm = flyPack(pack, trace, { ...cond, start_c: launch });
      break;
    }
  }
  if (launch === null) return { needed: true, launch_c: null, out_c: null, warm_min: null, cold, warm: flyPack(pack, trace, { ...cond, start_c: PACK.warmer_c - 5 }) };
  const tauPad = (pack.mass_kg * pack.cp) / PACK.g_still_w_per_k / 60;
  const out = Math.min(PACK.warmer_c - 1, ambient + (launch - ambient) * Math.exp(PACK.pad_window_min / tauPad));
  const tauWarm = (pack.mass_kg * pack.cp) / PACK.g_warmer_w_per_k / 60;
  const warmMin = tauWarm * Math.log((PACK.warmer_c - ambient) / Math.max(0.5, PACK.warmer_c - out));
  return { needed: true, launch_c: launch, out_c: Math.round(out), warm_min: Math.ceil(warmMin), cold, warm };
}
