// Wind over terrain. A forecast gives one wind for the range, measured at 10 m
// over open ground. A small drone does not fly in that wind: it flies in what
// the hills make of it. Three effects, each a standard engineering relation:
//
//   Speed-up   Air squeezed over a crest runs faster than the forecast. The
//              fractional speed-up at the surface is about 2 H/L for a ridge
//              (Jackson and Hunt 1975; the K1 factor in ASCE 7 and EN 1991-1-4)
//              and fades with height as exp(-3 z/L).
//   Wake       Behind a crest the flow separates. Inside a wedge that falls
//              about one in ten downwind of the crest the mean wind drops and
//              the turbulence rises: this is where gusts saturate motors.
//   Sink       Air follows the slope. On the lee side it descends, and a drone
//              holding height there is climbing through sinking air.
//
// Direction is not deflected (no channelling round hills): a linear model on an
// 80 m grid cannot claim it. Textbook relations, assumed coefficients, real
// SRTM/NED terrain; not field data, and pages that show it say "SIM".

import { ASSUMED } from "./physics.mjs";
import { ground } from "./rf.mjs";

export const TERRAIN_WIND = {
  reach_m: 500, // half-length the hill is measured over, upwind and downwind
  step_m: 100, // spacing of the terrain samples along the wind
  slope_m: 200, // the slope the air follows is taken over this far each side: the flow does not feel every bump
  speedup_k: 2.0, // surface speed-up = k * H / L (ridge)
  decay: 3.0, // speed-up fades as exp(-decay * agl / L)
  max_speedup: 0.6, // the linear theory overshoots on steep ground; capped here
  wake_fall: 0.1, // the wake's top falls one in ten downwind of the crest
  wake_reach_m: 1500, // how far upwind a crest is looked for
  wake_deficit: 0.35, // mean wind lost inside the wake
  wake_ti: 0.3, // turbulence intensity inside the wake, as a share of the free wind
  sink_decay: 2.0, // slope-following flow fades as exp(-sink_decay * agl / L)
};

/**
 * The wind a vehicle meets at a point, from the forecast's 10 m wind and the
 * terrain around it.
 *
 * @param {number} x local metres east
 * @param {number} y local metres north
 * @param {number} agl metres above the ground
 * @param {number} wind10 forecast wind at 10 m, m/s
 * @param {number} fromDeg direction the wind blows from
 */
export function localWind(x, y, agl, wind10, fromDeg) {
  const W = TERRAIN_WIND;
  const a = (fromDeg * Math.PI) / 180;
  // Unit vector pointing downwind.
  const dx = -Math.sin(a);
  const dy = -Math.cos(a);
  const z0 = ground(x, y);
  const free = wind10 * (Math.max(10, agl) / 10) ** ASSUMED.wind_shear_exp;
  // The hill under the vehicle: its height over the ground along the wind line.
  let sum = 0;
  let n = 0;
  for (let s = -W.reach_m; s <= W.reach_m; s += W.step_m) {
    if (s === 0) continue;
    sum += ground(x + dx * s, y + dy * s);
    n += 1;
  }
  const H = z0 - sum / n;
  const fade = Math.exp((-W.decay * agl) / W.reach_m);
  const speedup = Math.max(-0.3, Math.min(W.max_speedup, ((W.speedup_k * H) / W.reach_m) * fade * (H < 0 ? 0.5 : 1)));
  // A crest upwind: the deepest the vehicle sits under a wake top falling one in ten from it.
  const height = z0 + agl;
  let depth = 0;
  let crest = null;
  for (let s = W.step_m; s <= W.wake_reach_m; s += W.step_m) {
    const zc = ground(x - dx * s, y - dy * s);
    const d = zc - s * W.wake_fall - height;
    if (d > depth) [depth, crest] = [d, { s, z: zc }];
  }
  const wake = depth > 0;
  // Slope along the wind: positive is rising ground ahead of the air (lift), negative is the lee (sink).
  const slope = (ground(x + dx * W.slope_m, y + dy * W.slope_m) - ground(x - dx * W.slope_m, y - dy * W.slope_m)) / (2 * W.slope_m);
  const mean = free * (1 + speedup) * (wake ? 1 - W.wake_deficit : 1);
  const vertical = free * (1 + speedup) * slope * Math.exp((-W.sink_decay * agl) / W.reach_m);
  return {
    free_mps: free,
    speed_mps: mean,
    speedup,
    wake,
    wake_depth_m: wake ? depth : 0,
    crest_m: crest ? crest.s : null,
    sigma_wake_mps: wake ? W.wake_ti * free : 0,
    vertical_mps: vertical,
    ground_m: z0,
    hill_m: H,
  };
}

/** The wind field over an area at one height, as cells for a map. */
export function windGrid(area, agl, wind10, fromDeg, cell = 200) {
  const cells = [];
  for (let y = area.y0 + cell / 2; y < area.y1; y += cell) {
    for (let x = area.x0 + cell / 2; x < area.x1; x += cell) {
      const w = localWind(x, y, agl, wind10, fromDeg);
      cells.push([Math.round(x), Math.round(y), Math.round(w.speed_mps * 10) / 10, w.wake ? 1 : 0, Math.round(w.vertical_mps * 10) / 10]);
    }
  }
  return { agl_m: agl, cell_m: cell, free_mps: Math.round(wind10 * (Math.max(10, agl) / 10) ** ASSUMED.wind_shear_exp * 10) / 10, from_deg: fromDeg, cells };
}

export function describeWind() {
  return { source: "Wind over terrain (SIM): Jackson-Hunt speed-up, a one-in-ten lee wake and slope-following sink over SRTM/NED terrain. Assumed coefficients, not measured.", assumptions: TERRAIN_WIND };
}
