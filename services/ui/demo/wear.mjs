// Wear by flight load. A maintenance schedule in flight hours treats an hour of
// still-air hover and an hour of loaded flight in a gusty wind as the same
// hour. The parts do not:
//
//   Motor bearings  Rolling-bearing life goes with the cube of load and falls
//                   with speed (ISO 281: L10 = (C/P)^3 revolutions). A rotor's
//                   thrust goes with speed squared, so an hour at thrust ratio
//                   T uses T^3.5 hours of hover life. In forward flight the
//                   rear rotors carry more than the front to hold the nose
//                   down, so the four motors do not age together.
//   Frame arms      Carbon laminate has a very flat fatigue curve: damage per
//                   cycle goes with about the tenth power of the load
//                   (Palmgren-Miner sum on a Basquin curve). Gust cycles are
//                   too small to count; hard landings are nearly all of it.
//
// So the question a maintainer needs answered is not "how many hours" but "how
// were they flown". The flight log here is synthetic (SIM), the same for a tail
// on every load; the life figures are assumptions written out to be argued
// with. Nothing is a measured Neros figure.

import { AIRFRAMES, G, RHO } from "./physics.mjs";
import { ENVELOPE } from "./envelope.mjs";

export const WEAR = {
  bearing_l10_h: 90, // hours at still-air hover before 10% of bearings show wear (small outrunner, assumed)
  bearing_exp: 3.5, // load cubed (ISO 281) times speed, with thrust going as speed squared
  rear_bias_per_mps: 0.006, // rear rotors carry this much more thrust per m/s of airspeed, the front as much less
  thrust_ti_per_mps: 0.02, // thrust fluctuation, as a share of the mean, per m/s of gust
  inspect_at: 0.8, // spin-check the bearings at this share of rated life
  frame_exp: 10, // Basquin exponent for a carbon/epoxy arm
  frame_n_ref: 8e6, // cycles to failure at a 1 g load reversal
  frame_inspect_at: 0.5, // tap-test the arms at half the Miner sum
  hard_g: 3, // a landing harder than this is logged as hard
};

/** Betaflight order: 1 rear right, 2 front right, 3 rear left, 4 front left. */
export const MOTORS = [
  { id: "M1", where: "rear right", rear: true },
  { id: "M2", where: "front right", rear: false },
  { id: "M3", where: "rear left", rear: true },
  { id: "M4", where: "front left", rear: false },
];

/** Mean thrust over weight for a sortie: tilt against drag, plus any payload. */
export function thrustRatio(frame, s) {
  const W = frame.mass_kg * G;
  const air = s.air_mps ?? frame.cruise_mps;
  const drag = ENVELOPE.rotor_drag_per_mps * W * air + 0.5 * RHO * frame.drag_area_m2 * air * air;
  return Math.hypot(W + (s.extra_kg ?? 0) * G, drag) / W;
}

/**
 * What one sortie takes out of the airframe.
 *
 * @param {object} frame an AIRFRAMES entry
 * @param {{minutes: number, air_mps?: number, gust_mps?: number, extra_kg?: number, landing_g?: number, trim?: number[]}} s
 */
export function sortieWear(frame, s) {
  const hours = s.minutes / 60;
  const tau = thrustRatio(frame, s);
  const air = s.air_mps ?? frame.cruise_mps;
  const ti = WEAR.thrust_ti_per_mps * (s.gust_mps ?? 0);
  // Mean of (1 + x)^n over a fluctuation of intensity ti, to second order.
  const rough = 1 + 0.5 * WEAR.bearing_exp * (WEAR.bearing_exp - 1) * ti * ti;
  const motors = MOTORS.map((m, i) => {
    const share = tau * (1 + (m.rear ? 1 : -1) * WEAR.rear_bias_per_mps * air) * (1 + (s.trim?.[i] ?? 0));
    const eq = hours * share ** WEAR.bearing_exp * rough;
    return { eq_hours: eq, life: eq / WEAR.bearing_l10_h };
  });
  const g = s.landing_g ?? 1.4;
  return { hours, thrust_ratio: tau, motors, frame: g ** WEAR.frame_exp / WEAR.frame_n_ref, hard: g >= WEAR.hard_g };
}

// ---- the flight log (SIM) -----------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);

const PROFILE = {
  "ARCHER-5": { minutes: [5, 9], extra: 0, sorties: [60, 150] },
  "ARCHER-8": { minutes: [14, 24], extra: 0.3, sorties: [40, 110] },
  "ARCHER-10": { minutes: [18, 30], extra: 0.8, sorties: [30, 80] },
};

/**
 * A tail's flight log: one row per sortie, oldest first. Synthetic and
 * repeatable. Some tails live on a windy site and some carry payload, which is
 * the point: equal hours, unequal wear.
 */
export function logFor(tail, sku, opts = {}) {
  const frame = AIRFRAMES[sku];
  const prof = PROFILE[sku];
  if (!frame || !prof) return [];
  const r = rng(hash(tail));
  const n = Math.round(prof.sorties[0] + r() * (prof.sorties[1] - prof.sorties[0]));
  const windy = 2 + r() * 8; // the site's usual wind
  const loaded = r(); // how often this tail carries payload
  const trim = MOTORS.map(() => (r() - 0.5) * 0.06);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const wind = Math.max(0, windy + (r() - 0.5) * 6);
    const hard = r() < 0.025;
    rows.push({
      n: i + 1,
      minutes: Math.round(prof.minutes[0] + r() * (prof.minutes[1] - prof.minutes[0])),
      air_mps: Math.round((frame.cruise_mps * 0.8 + 0.35 * wind) * 10) / 10,
      wind_mps: Math.round(wind * 10) / 10,
      gust_mps: Math.round(wind * (0.3 + r() * 0.5) * 10) / 10,
      extra_kg: r() < loaded ? Math.round(prof.extra * (0.4 + 0.6 * r()) * 100) / 100 : 0,
      landing_g: Math.round((hard ? 3 + r() * 1.6 : 1.1 + r() * 0.8) * 10) / 10,
      trim,
    });
  }
  // A recorded event overrides the dice: the scenario's prop strike on recovery was a hard arrival.
  if (opts.strike && rows.length) rows.at(-1).landing_g = 4.6;
  return rows;
}

const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => Math.round(v * 1000) / 10;

/** A tail's wear from its log: each motor's bearing life used, the frame's fatigue sum, and when each line is crossed. */
export function wearFor(tail, sku, log = logFor(tail, sku)) {
  const frame = AIRFRAMES[sku];
  if (!frame || !log.length) return null;
  const motors = MOTORS.map((m) => ({ ...m, eq_hours: 0, life: 0 }));
  let hours = 0;
  let fatigue = 0;
  const hard = [];
  const curve = [];
  const per = [];
  for (const s of log) {
    const w = sortieWear(frame, s);
    hours += w.hours;
    fatigue += w.frame;
    w.motors.forEach((x, i) => {
      motors[i].eq_hours += x.eq_hours;
      motors[i].life += x.life;
    });
    if (w.hard) hard.push({ sortie: s.n, g: s.landing_g, share: w.frame });
    const worst = Math.max(...motors.map((x) => x.life));
    per.push(Math.max(...w.motors.map((x) => x.life)));
    curve.push({ n: s.n, hours: r1(hours), by_load: pct(worst), by_hours: pct(hours / WEAR.bearing_l10_h), frame: pct(fatigue) });
  }
  const worst = motors.reduce((a, b) => (b.life > a.life ? b : a));
  // The rate this tail has been wearing at lately, per sortie, for the projection.
  const recent = per.slice(-12);
  const rate = recent.reduce((a, b) => a + b, 0) / recent.length;
  const until = (line) => (worst.life >= line ? 0 : Math.ceil((line - worst.life) / Math.max(1e-9, rate)));
  const byHours = hours / WEAR.bearing_l10_h;
  const bearing = worst.life >= 1 ? "replace" : worst.life >= WEAR.inspect_at ? "inspect" : "ok";
  const arms = fatigue >= 1 ? "replace" : fatigue >= WEAR.frame_inspect_at ? "inspect" : "ok";
  const hoursPerSortie = hours / log.length;
  return {
    tail,
    sku,
    airframe: frame.label,
    sorties: log.length,
    hours: r1(hours),
    eq_hours: r1(worst.eq_hours),
    load_factor: Math.round((worst.eq_hours / hours) * 100) / 100,
    motors: motors.map((m) => ({ id: m.id, where: m.where, life_pct: pct(m.life), eq_hours: r1(m.eq_hours) })),
    worst: { id: worst.id, where: worst.where, life_pct: pct(worst.life) },
    by_hours_pct: pct(byHours),
    bearing,
    inspect_in: until(WEAR.inspect_at),
    replace_in: until(1),
    // What a flat hours schedule would say for the same line.
    hours_schedule_in: byHours >= WEAR.inspect_at ? 0 : Math.ceil(((WEAR.inspect_at - byHours) * WEAR.bearing_l10_h) / hoursPerSortie),
    frame: { fatigue_pct: pct(fatigue), state: arms, hard_landings: hard.map((h) => ({ sortie: h.sortie, g: h.g, share_pct: pct(h.share) })), from_hard_pct: fatigue > 0 ? Math.round((hard.reduce((a, h) => a + h.share, 0) / fatigue) * 100) : 0 },
    state: bearing === "replace" || arms === "replace" ? "replace" : bearing === "inspect" || arms === "inspect" ? "inspect" : "ok",
    curve: curve.length > 90 ? curve.filter((_, i) => i % Math.ceil(curve.length / 90) === 0 || i === curve.length - 1) : curve,
    lines: { inspect_pct: WEAR.inspect_at * 100, frame_inspect_pct: WEAR.frame_inspect_at * 100, l10_h: WEAR.bearing_l10_h },
  };
}

/** One sentence a maintainer can act on. */
export function verdictOf(w) {
  const parts = [];
  if (w.bearing === "replace") parts.push(`${w.worst.id} (${w.worst.where}) is past its rated bearing life by load, ${w.worst.life_pct}%: replace the motor before it flies again`);
  else if (w.bearing === "inspect") parts.push(`${w.worst.id} (${w.worst.where}) is at ${w.worst.life_pct}% of rated bearing life by load: spin-check it at the next turnaround, replace within ${w.replace_in} sorties at this tail's usage`);
  if (w.frame.state === "replace") parts.push(`the arms have used their fatigue life (${w.frame.fatigue_pct}%), ${w.frame.from_hard_pct}% of it in ${w.frame.hard_landings.length} hard landings: replace the frame`);
  else if (w.frame.state === "inspect") parts.push(`the arms are at ${w.frame.fatigue_pct}% of their fatigue life, ${w.frame.from_hard_pct}% of it from ${w.frame.hard_landings.length} hard landings: tap-test them`);
  if (!parts.length) return `Nothing due. ${w.worst.id} leads at ${w.worst.life_pct}% of bearing life; the inspection line is about ${w.inspect_in} sorties away at this tail's usage.`;
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function describeWear() {
  return { source: "Wear by flight load (SIM): ISO 281 bearing life with thrust-squared speed, Palmgren-Miner fatigue on a Basquin curve, over a synthetic flight log. Assumed life figures, not measured.", assumptions: WEAR };
}
