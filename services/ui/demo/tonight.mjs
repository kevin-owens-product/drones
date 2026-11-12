// What each airframe can do in tonight's air, for the loadout planner: thrust
// in hand against a gust, the strongest wind that still reads "go", spare lift,
// and what a cold pack does on the climb-out and whether it needs the warmer.
// The same envelope and pack models the plan's launch checks use (envelope.mjs,
// pack.mjs), flown on a standard sortie rather than a particular plan.
//
// Textbook relations, assumed coefficients, not measured Neros figures.

import { AIRFRAMES, power } from "./physics.mjs";
import { ENVELOPE, TWR, density, envelopeGrid, headroom, maxWind, powerAtThrust, spareLift } from "./envelope.mjs";
import { PACK, PACKS, preheat } from "./pack.mjs";

const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

/** A standard sortie: a 25 s climb to 100 m, then cruise until 80% of the airframe's cruise endurance, sampled every 10 s. */
export function standardTrace(sku, f) {
  const frame = AIRFRAMES[sku];
  const sigma = density(f.elev_m + 100, f.temp_c) / 1.225;
  const hoverW = power(frame, 0);
  const punch = powerAtThrust(hoverW, ENVELOPE.punch_fraction * TWR[sku] * sigma, sigma);
  const cruiseW = power(frame, frame.cruise_mps);
  const minutes = Math.max(6, Math.round(((frame.pack_wh * 0.85 * 0.8) / cruiseW) * 60));
  const out = [];
  for (let t = 0; t <= minutes * 60; t += 10) out.push({ t, watts: t < 25 ? power(frame, 0, 4) : cruiseW, air_mps: t < 25 ? 0 : frame.cruise_mps, punch_w: punch });
  return { trace: out, minutes };
}

/**
 * Every airframe at one set of conditions.
 * @param {{temp_c: number, wind_mps: number, gust_mps?: number, elev_m: number, sku?: string}} f
 */
export function airframesTonight(f) {
  const rows = Object.entries(AIRFRAMES).map(([sku, frame]) => {
    const pack = PACKS[sku];
    const { trace, minutes } = standardTrace(sku, f);
    const advice = preheat(pack, trace, { ambient_c: f.temp_c, start_soc: 0.95 });
    const side = advice.needed && advice.launch_c !== null ? advice.warm : advice.cold;
    const climbV = advice.cold.climb_out_v_cell ?? ENVELOPE.v_ref_cell;
    const c = { elev_m: f.elev_m, agl_m: 100, temp_c: f.temp_c, cell_v: climbV };
    const h = headroom(frame, sku, { ...c, wind_mps: f.wind_mps, gust_mps: f.gust_mps ?? f.wind_mps });
    return {
      sku,
      airframe: frame.label,
      pack: pack.label,
      cutoff_v: pack.cutoff_v,
      sortie_min: minutes,
      thrust: { verdict: h.verdict, headroom: h.headroom, tilt_gust_deg: h.tilt_gust_deg, gust_mps: h.gust_mps, density_altitude_m: h.density_altitude_m },
      max_wind_mps: maxWind(frame, sku, c),
      spare_lift_kg: spareLift(frame, sku, c),
      cold: { climb_out_punch_v: advice.cold.climb_out_punch_v_cell, climb_out_v: advice.cold.climb_out_v_cell, collapse: Boolean(advice.cold.collapse), cutoff_min: advice.cold.cutoff ? r1(advice.cold.cutoff.t / 60) : null },
      preheat: { needed: advice.needed, launch_c: advice.launch_c, out_c: advice.out_c, warm_min: advice.warm_min, cutoff_min: side.cutoff ? r1(side.cutoff.t / 60) : null },
    };
  });
  const pick = AIRFRAMES[f.sku] ? f.sku : "ARCHER-8";
  return {
    source: "Envelope and pack models (SIM): ISA density, Dryden gusts, one-RC cell model with Arrhenius resistance. Assumed coefficients, not measured.",
    conditions: { temp_c: f.temp_c, wind_mps: f.wind_mps, gust_mps: f.gust_mps ?? f.wind_mps, elev_m: Math.round(f.elev_m) },
    pad_window_min: PACK.pad_window_min,
    headroom_go: ENVELOPE.headroom_go,
    airframes: rows,
    envelope: { sku: pick, airframe: AIRFRAMES[pick].label, ...envelopeGrid(AIRFRAMES[pick], pick, { elev_m: f.elev_m, agl_m: 100 }, power(AIRFRAMES[pick], 0)), now: { temp_c: f.temp_c, wind_mps: f.wind_mps } },
  };
}
