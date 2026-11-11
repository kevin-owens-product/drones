// The flight envelope: can this airframe hold its position and still have
// thrust left to fight a gust, in tonight's air, on tonight's pack?
//
// Three things close the envelope and they come from different directions.
// Thin air (high ground, a hot day) cuts rotor thrust with density. A cold pack
// sags, and a motor's top speed, so its thrust, falls with the square of the
// voltage it gets. Wind and turbulence ask for tilt to hold station, and tilt
// costs thrust. So the envelope shuts at both ends of the thermometer. Gusts
// follow the low-altitude Dryden model (MIL-F-8785C): turbulence intensity from
// the wind at 20 ft, larger near the ground, and the design gust is 3 sigma.
//
// Textbook relations, assumed coefficients, not measured Neros figures.

import { G } from "./physics.mjs";
import { PACKS, currentFor, ocv, r0At } from "./pack.mjs";

/** Thrust to weight at sea level, standard day, full pack. Assumed by class: FPV-agile, long-range, heavy-lift. */
export const TWR = { "ARCHER-5": 4.0, "ARCHER-8": 2.6, "ARCHER-10": 2.2 };

export const ENVELOPE = {
  v_ref_cell: 3.8, // the voltage per cell the thrust figure is quoted at
  rotor_drag_per_mps: 0.025, // rotor H-force, as a share of weight per m/s of airspeed (linear rotor drag)
  max_tilt_deg: 35, // the attitude limit the flight controller enforces
  headroom_go: 0.3, // keep 30% of thrust in hand for attitude control and gust recovery
  headroom_min: 0.15, // under this a gust can saturate the motors
  station_air_mps: 4, // airspeed added to the wind when holding near a point (orbit and corrections)
  punch_fraction: 0.8, // an avoidance climb or gust recovery at 80% of available thrust
};

const R_AIR = 287.05;

/** Air density, kg/m^3, at a height above sea level and an actual temperature (ISA pressure). */
export function density(elevM, tempC) {
  const p = 101325 * (1 - 2.25577e-5 * elevM) ** 5.25588;
  return p / (R_AIR * (tempC + 273.15));
}

/** Density altitude, metres: the standard-atmosphere height with this density. */
export function densityAltitude(rho) {
  return 44330.8 * (1 - (rho / 1.225) ** 0.234969);
}

/**
 * Dryden low-altitude turbulence (MIL-F-8785C) at a height above ground:
 * vertical intensity is a tenth of the wind at 20 ft; horizontal intensity is
 * larger, more so near the ground. Returns 1-sigma gust speeds, m/s.
 */
export function dryden(wind10Mps, aglM) {
  const w20 = wind10Mps * (6.1 / 10) ** 0.14;
  const hFt = Math.max(10, Math.min(1000, aglM * 3.281));
  const sw = 0.1 * w20;
  const su = sw / (0.177 + 0.000823 * hFt) ** 0.4;
  return { sigma_u: su, sigma_w: sw };
}

/**
 * Electrical power the rotors draw at a thrust, from the hover power and
 * momentum theory (P grows with T^1.5, and with 1/sqrt(density)).
 */
export function powerAtThrust(hoverW, thrustOverWeight, sigma = 1) {
  return hoverW * thrustOverWeight ** 1.5 / Math.sqrt(sigma);
}

/** Loaded cell voltage for a pack at a state of charge and temperature, delivering `watts` (no polarisation). */
export function loadedCell(sku, soc, tempC, watts) {
  const pack = PACKS[sku];
  const e = pack.s * ocv(pack.chem, soc);
  const r = (r0At(pack, tempC) * pack.s) / pack.p;
  const i = currentFor(e, r, watts);
  return i === null ? e / (2 * pack.s) : (e - i * r) / pack.s;
}

/**
 * Thrust headroom for an airframe in one set of conditions.
 *
 * @param {object} frame physics.mjs AIRFRAMES entry (mass, drag area)
 * @param {string} sku
 * @param {{elev_m: number, temp_c: number, wind_mps: number, gust_mps?: number, agl_m?: number, cell_v?: number, extra_kg?: number}} c
 */
export function headroom(frame, sku, c) {
  const rho = density(c.elev_m + (c.agl_m ?? 100), c.temp_c);
  const sigma = rho / 1.225;
  const mass = frame.mass_kg + (c.extra_kg ?? 0);
  const W = mass * G;
  const turb = dryden(c.wind_mps, c.agl_m ?? 100);
  const gust = Math.max(3 * turb.sigma_u, (c.gust_mps ?? 0) - c.wind_mps);
  const cell = c.cell_v ?? ENVELOPE.v_ref_cell;
  const tMax = TWR[sku] * frame.mass_kg * G * sigma * Math.min(1.15, (cell / ENVELOPE.v_ref_cell) ** 2);
  const force = (air) => ENVELOPE.rotor_drag_per_mps * W * air + 0.5 * rho * frame.drag_area_m2 * air * air;
  const steadyAir = c.wind_mps + ENVELOPE.station_air_mps;
  const gustAir = steadyAir + gust;
  const need = (air) => Math.hypot(W, force(air));
  const tilt = (air) => (Math.atan2(force(air), W) * 180) / Math.PI;
  const steady = need(steadyAir);
  const gusty = need(gustAir);
  const h = 1 - gusty / tMax;
  const tiltGust = tilt(gustAir);
  const verdict = h < ENVELOPE.headroom_min || tiltGust > ENVELOPE.max_tilt_deg + 5 ? "no-go" : h < ENVELOPE.headroom_go || tiltGust > ENVELOPE.max_tilt_deg ? "caution" : "go";
  return {
    verdict,
    headroom: Math.round(h * 100) / 100,
    headroom_steady: Math.round((1 - steady / tMax) * 100) / 100,
    thrust_max_n: Math.round(tMax * 10) / 10,
    thrust_gust_n: Math.round(gusty * 10) / 10,
    weight_n: Math.round(W * 10) / 10,
    tilt_steady_deg: Math.round(tilt(steadyAir)),
    tilt_gust_deg: Math.round(tiltGust),
    gust_mps: Math.round(gust * 10) / 10,
    sigma_u_mps: Math.round(turb.sigma_u * 10) / 10,
    density: Math.round(rho * 1000) / 1000,
    density_altitude_m: Math.round(densityAltitude(rho)),
    cell_v: Math.round(cell * 100) / 100,
  };
}

/** Strongest steady wind, m/s, that still reads "go", scanning in half metres per second. */
export function maxWind(frame, sku, c) {
  let best = 0;
  for (let w = 0; w <= 25; w += 0.5) {
    if (headroom(frame, sku, { ...c, wind_mps: w, gust_mps: 0 }).verdict === "go") best = w;
    else break;
  }
  return best;
}

/** Extra mass, kg, the airframe can lift in calm air and still keep the go headroom. */
export function spareLift(frame, sku, c) {
  let best = 0;
  for (let kg = 0; kg <= 3; kg += 0.05) {
    if (headroom(frame, sku, { ...c, wind_mps: 0, gust_mps: 0, extra_kg: kg }).headroom >= ENVELOPE.headroom_go) best = kg;
    else break;
  }
  return Math.round(best * 100) / 100;
}

/**
 * The envelope as a grid for a chart: air temperature down the side, steady
 * wind along the bottom, headroom in each cell with the pack cold-soaked to
 * the air at half charge (the middle of a sortie).
 */
export function envelopeGrid(frame, sku, c, hoverW) {
  const temps = [-20, -10, 0, 10, 20, 30, 40];
  const winds = [0, 2, 4, 6, 8, 10, 12, 14];
  const cells = [];
  for (const t of temps) {
    for (const w of winds) {
      const cell = loadedCell(sku, 0.5, t, hoverW * 1.2);
      const r = headroom(frame, sku, { ...c, temp_c: t, wind_mps: w, gust_mps: 0, cell_v: cell });
      cells.push({ temp_c: t, wind_mps: w, headroom: r.headroom, verdict: r.verdict });
    }
  }
  return { temps, winds, cells };
}
