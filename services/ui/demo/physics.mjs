// One quadcopter performance model for the demo: the live sortie
// (scenario.mjs), the debrief replay (missions.mjs), the loadout planner
// (configure.mjs) and the supervision sweep (sim/scale/fleet.py, a Python port
// of the same equations) all draw from it, so a number shown on one page agrees
// with the next. Pure JavaScript, no imports, deterministic for a given seed.
//
// Everything here is textbook or an assumption written out so it can be argued
// with. Nothing is a measured Neros figure. Where a page shows one of these
// numbers it says "SIM" or "assumed".

export const G = 9.81;
export const RHO = 1.225; // kg/m^3, sea level, 15 C

/**
 * Airframes by SKU. Mass includes the pack. Hover power is set by the same
 * "95 W per kg^1.5" rule the planner has always used; everything else follows
 * from momentum theory and a drag area. Pack energy and cell counts match the
 * planner's battery catalog. These are assumptions, not Neros data.
 */
export const AIRFRAMES = {
  "ARCHER-5": { label: "Archer 5", mass_kg: 0.92, pack_wh: 28.9, pack: "6S 1300 mAh LiPo", cells: 6, cruise_mps: 14, max_air_mps: 24, drag_area_m2: 0.011, max_bank_deg: 35, max_climb_mps: 5 },
  "ARCHER-8": { label: "Archer 8", mass_kg: 1.45, pack_wh: 88.8, pack: "6S 4000 mAh Li-ion", cells: 6, cruise_mps: 16, max_air_mps: 26, drag_area_m2: 0.014, max_bank_deg: 35, max_climb_mps: 5 },
  "ARCHER-10": { label: "Archer 10", mass_kg: 2.2, pack_wh: 177.6, pack: "2 × 6S 4000 mAh Li-ion", cells: 6, cruise_mps: 15, max_air_mps: 24, drag_area_m2: 0.019, max_bank_deg: 32, max_climb_mps: 4 },
};

export const ASSUMED = {
  hover_w_at_1kg: 95, // electrical watts to hover a 1 kg airframe
  efficiency: 0.6, // motor, ESC and propeller together, shaft power to electrical
  profile_fraction: 0.18, // blade profile drag as a fraction of hover power
  descent_recovery: 0.35, // fraction of climb power saved on descent
  avionics_w: 6, // flight controller, radio, camera
  cell_r_ohm: 0.005, // internal resistance per cell at 20 C
  usable_depth: 0.85, // fraction of rated Wh the pack gives before the low-voltage cutoff
  reserve: 0.2, // fraction of rated Wh kept back; the console calls bingo when flying on past it
  cold_derate_per_c: 0.0075, // 7.5% less usable energy per 10 C below 20 C
  vio_scale_drift: 0.01, // position error grows 1% of distance flown on VIO (scale and yaw error)
  vio_walk_m_per_sqrt_m: 0.25, // plus a random walk, metres per sqrt(metre flown)
  gnss_sigma_m: 1.2, // horizontal 1-sigma with a clean fix
  wind_shear_exp: 0.14, // power-law profile above 10 m, open terrain
  radio: { budget_db: 142, loss_1km_db: 112, exponent: 2.3, good_margin_db: 25 }, // 900 MHz, clutter above free space
};

/** Usable fraction of rated energy at a temperature: full at 20 C and above, 7.5% less per 10 C below. */
export function coldFactor(tempC) {
  return Math.max(0.5, Math.min(1, 1 - ASSUMED.cold_derate_per_c * (20 - tempC)));
}

/** Hover power, electrical watts. Momentum theory scales thrust power with mass^1.5. */
export function hoverWatts(massKg) {
  return ASSUMED.hover_w_at_1kg * massKg ** 1.5;
}

/** Parasite drag at an airspeed, newtons. */
export function drag(frame, airMps) {
  return 0.5 * RHO * frame.drag_area_m2 * airMps * airMps;
}

/**
 * Electrical power in flight. Induced power falls as forward speed feeds the
 * rotors (Glauert's forward-flight relation for the induced velocity), parasite
 * power rises with the cube of airspeed, profile power is a fixed share of hover,
 * climbing costs weight times rate, and descent gives a little back.
 */
export function power(frame, airMps = 0, climbMps = 0) {
  const m = frame.mass_kg;
  const eta = ASSUMED.efficiency;
  const hover = hoverWatts(m);
  const D = drag(frame, airMps);
  const thrust = Math.hypot(m * G, D);
  // Hover induced velocity from the hover power rule: P_h = T v_h / eta.
  const vh = (eta * hover * (1 - ASSUMED.profile_fraction)) / (m * G);
  // Glauert: v_i = v_h^2 / sqrt(V^2 + v_i^2), a few fixed-point steps converge.
  let vi = vh;
  for (let k = 0; k < 8; k += 1) vi = (vh * vh) / Math.hypot(airMps, vi);
  vi *= thrust / (m * G);
  const induced = (thrust * vi) / eta;
  const parasite = (D * airMps) / eta;
  const profile = hover * ASSUMED.profile_fraction * (1 + 3 * (airMps / 60) ** 2);
  const climb = climbMps >= 0 ? (m * G * climbMps) / eta : m * G * climbMps * ASSUMED.descent_recovery;
  return Math.max(ASSUMED.avionics_w, induced + parasite + profile + climb + ASSUMED.avionics_w);
}

/**
 * Airspeed that minimises energy per metre over the ground, m/s, for a headwind
 * (negative for a tailwind). Into a headwind the answer is faster than the
 * still-air best-range speed, as every pilot knows. Found by scan; the curve is smooth.
 */
export function bestRangeSpeed(frame, headwindMps = 0) {
  let best = 1;
  let bestCost = Infinity;
  for (let v = 1; v <= frame.max_air_mps; v += 0.5) {
    const over = v - headwindMps;
    if (over <= 0.5) continue;
    const cost = power(frame, v) / over;
    if (cost < bestCost) [best, bestCost] = [v, cost];
  }
  return best;
}

/**
 * Pack terminal voltage at a state of charge under load. The open-circuit
 * curve is a smooth LiPo shape (4.2 V full, a knee near 3.5 V); sag is current
 * times internal resistance, which rises in the cold.
 */
export function packVolts(frame, soc, watts, tempC = 20) {
  const s = Math.max(0, Math.min(1, soc));
  const ocv = 3.3 + 0.9 * s ** 0.55 - 0.15 * (1 - s) ** 8;
  const r = frame.cells * ASSUMED.cell_r_ohm * (1 + 0.04 * Math.max(0, 20 - tempC));
  const v0 = frame.cells * ocv;
  const i = watts / Math.max(1, v0);
  return v0 - i * r;
}

/**
 * Wind at a time and height. Steady vector plus gusts made of three slow
 * sinusoids so it is smooth, repeatable and never a step. Height follows a
 * power-law profile from the 10 m reference. Returns [east, north] m/s.
 */
export function windAt(env, t, altM = 10) {
  const speed10 = env.wind_mps ?? 0;
  if (speed10 <= 0) return [0, 0];
  const shear = (Math.max(10, altM) / 10) ** ASSUMED.wind_shear_exp;
  const gust = env.gust ?? 0.25;
  const ph = env.phase ?? 0;
  const g = 1 + gust * (0.5 * Math.sin(t / 23 + ph) + 0.3 * Math.sin(t / 47 + 2 * ph) + 0.2 * Math.sin(t / 71 + 3 * ph));
  const wander = (env.wander_deg ?? 12) * (0.6 * Math.sin(t / 61 + ph) + 0.4 * Math.sin(t / 97 + 1.7 * ph));
  const from = ((env.wind_from_deg ?? 270) + wander) * (Math.PI / 180);
  const s = speed10 * shear * g;
  // "From" direction: the air moves the opposite way.
  return [-s * Math.sin(from), -s * Math.cos(from)];
}

/** Direction the wind blows from, degrees, and its speed, from an [east, north] vector. */
export function windFrom([we, wn]) {
  const speed = Math.hypot(we, wn);
  const from = ((Math.atan2(-we, -wn) * 180) / Math.PI + 360) % 360;
  return { speed, from };
}

/**
 * 1-sigma horizontal position error on VIO after `metres` flown since GNSS was
 * last trusted: a scale/yaw term that grows linearly plus a random-walk term.
 */
export function vioSigma(metres) {
  const d = Math.max(0, metres);
  return Math.hypot(1.5, ASSUMED.vio_scale_drift * d, ASSUMED.vio_walk_m_per_sqrt_m * Math.sqrt(d));
}

/**
 * The C2 link over a distance: received margin above the receiver's floor,
 * with a log-distance path loss steeper than free space to stand for ground
 * clutter, and a low-altitude penalty for the ground reflection. Quality is
 * the margin against a comfortable 25 dB, as a 0..1 figure for the map.
 */
export function linkBudget(distanceM, altM = 100, extraLossDb = 0) {
  const r = ASSUMED.radio;
  const km = Math.max(0.02, distanceM / 1000);
  const loss = r.loss_1km_db + 10 * r.exponent * Math.log10(km) + (altM < 30 ? (30 - altM) * 0.25 : 0) + extraLossDb;
  const margin = r.budget_db - loss;
  const rssi = -110 + margin; // a -110 dBm floor at the demodulator
  return { margin_db: margin, rssi_dbm: rssi, quality: Math.max(0, Math.min(1, margin / r.good_margin_db)) };
}

const deg = (rad) => ((rad * 180) / Math.PI + 360) % 360;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Length of a polyline. */
export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Point at a distance along a polyline; loops when asked. */
export function pointAlong(pts, d, loop = false) {
  const total = pathLength(pts);
  if (total <= 0) return [pts[0][0], pts[0][1]];
  let left = loop ? ((d % total) + total) % total : Math.max(0, Math.min(total, d));
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (left <= len || i === pts.length - 1) {
      const f = len > 0 ? Math.min(1, left / len) : 0;
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    }
    left -= len;
  }
  return pts.at(-1);
}

/**
 * Fly a plan with a simple guidance loop and the energy model, and return
 * one sample per `dt` seconds. The vehicle follows a lookahead point on its
 * path, holds a commanded ground speed where the wind allows, slows on the
 * upwind leg when the airspeed limit bites, banks to turn at a bounded rate
 * (so corners are arcs, not points), crabs into the wind, and spends energy
 * from its pack by the power curve. When the energy left would not get it home
 * with the reserve it turns for the station (bingo), descends over it and lands.
 *
 * @param {object} frame an AIRFRAMES entry
 * @param {{ pts: [number, number][], loop?: boolean, speed_mps?: number, alt_m?: number, start_wh?: number,
 *           station?: [number, number], home_on_bingo?: boolean, temp_c?: number, air_cap_mps?: number }} plan
 * @param {{ wind_mps?: number, wind_from_deg?: number, gust?: number, phase?: number }} env
 * @param {{ dt?: number, duration_s?: number }} [opts]
 */
export function flyPlan(frame, plan, env, opts = {}) {
  const dt = opts.dt ?? 1;
  const T = opts.duration_s ?? 700;
  const temp = plan.temp_c ?? 20;
  const usable = frame.pack_wh * ASSUMED.usable_depth * coldFactor(temp);
  const reserveWh = frame.pack_wh * ASSUMED.reserve;
  const bankMax = (frame.max_bank_deg * Math.PI) / 180;
  const cruise = plan.speed_mps ?? frame.cruise_mps;
  const altCmd = plan.alt_m ?? 100;
  const station = plan.station ?? null;
  const pts = plan.pts;
  const total = pathLength(pts);
  const loop = Boolean(plan.loop);

  let [x, y] = pts[0];
  let along = 0;
  let course = (() => {
    const [ax, ay] = pointAlong(pts, Math.min(total, 30), loop);
    return Math.atan2(ax - x, ay - y);
  })();
  let vg = cruise * 0.9;
  let alt = altCmd;
  let e = plan.start_wh ?? frame.pack_wh * 0.95;
  let phase = "mission"; // mission | rtl | land | landed
  let bingoAt = null;
  let forced = false;
  const out = [];

  for (let t = 0; t <= T + 1e-9; t += dt) {
    const w = windAt(env, t, alt);
    const wspd = Math.hypot(w[0], w[1]);
    // Energy to get home from here against the wind on the best-range speed, with the reserve.
    let homeS = 0;
    let homeWh = 0;
    if (station) {
      const dx = station[0] - x;
      const dy = station[1] - y;
      const dist = Math.hypot(dx, dy);
      const dir = dist > 0 ? [dx / dist, dy / dist] : [0, 1];
      const headwind = -(dir[0] * w[0] + dir[1] * w[1]);
      const vAir = bestRangeSpeed(frame, headwind);
      const vHome = Math.max(2, vAir - headwind);
      homeS = dist / vHome;
      homeWh = (power(frame, vAir) * homeS) / 3600 + (power(frame, 0) * 25) / 3600; // plus a 25 s descent and landing
    }
    const left = e - (frame.pack_wh - usable);
    const bingo = station && phase === "mission" && plan.home_on_bingo !== false && left - homeWh < reserveWh;
    if (bingo) {
      phase = "rtl";
      bingoAt = t;
    }
    // Out of usable energy short of home: the flight controller lands where it is.
    if (left <= 0 && (phase === "mission" || phase === "rtl")) {
      phase = "land";
      forced = true;
    }

    // Where to go.
    let target;
    let speedCmd = cruise;
    if (phase === "mission") {
      const look = Math.max(40, 2.5 * vg);
      target = pointAlong(pts, along + look, loop);
    } else if (phase === "rtl" || (phase === "land" && !forced)) {
      target = station;
      const dxs = station[0] - x;
      const dys = station[1] - y;
      const ds = Math.hypot(dxs, dys) || 1;
      // Best-range airspeed for the headwind on the way home, flown as a ground speed.
      const hw = -((dxs / ds) * w[0] + (dys / ds) * w[1]);
      speedCmd = Math.max(3, bestRangeSpeed(frame, hw) - hw);
    } else {
      target = [x, y];
    }
    const distToStation = station ? Math.hypot(station[0] - x, station[1] - y) : Infinity;
    if (phase === "rtl" && distToStation < 25) phase = "land";

    let climb = 0;
    let va = 0;
    let roll = 0;
    let turnRate = 0;
    if (phase === "landed") {
      vg = 0;
      va = 0;
    } else {
      const dx = target[0] - x;
      const dy = target[1] - y;
      const dist = Math.hypot(dx, dy);
      const wantCourse = dist > 1 ? Math.atan2(dx, dy) : course;
      // Turn at a rate the bank limit allows: omega = g tan(phi) / V.
      const vRef = Math.max(3, vg);
      const omegaMax = (G * Math.tan(bankMax)) / vRef;
      const err = wrap(wantCourse - course);
      turnRate = Math.max(-omegaMax, Math.min(omegaMax, err / dt));
      course = wrap(course + turnRate * dt);
      roll = Math.atan((turnRate * vRef) / G);
      // Ground speed the airspeed limit allows along this course against the wind.
      const d = [Math.sin(course), Math.cos(course)];
      const wAlong = d[0] * w[0] + d[1] * w[1];
      const airCap = Math.min(frame.max_air_mps, plan.air_cap_mps ?? cruise * 1.25);
      const disc = wAlong * wAlong - wspd * wspd + airCap ** 2;
      const vgMax = disc > 0 ? wAlong + Math.sqrt(disc) : Math.max(1, wAlong);
      let want = phase === "land" ? Math.min(3, dist / 4) : Math.min(speedCmd, vgMax);
      // Slow for a tight turn, as the guidance would.
      if (Math.abs(err) > 0.6 && phase === "mission") want = Math.min(want, cruise * 0.6);
      const accel = 3 * dt;
      vg += Math.max(-accel, Math.min(accel, want - vg));
      vg = Math.max(0, vg);
      const vgVec = [vg * d[0], vg * d[1]];
      va = Math.hypot(vgVec[0] - w[0], vgVec[1] - w[1]);
      x += vgVec[0] * dt;
      y += vgVec[1] * dt;
      if (phase === "mission") {
        along += vg * dt;
        if (!loop && along >= total) {
          // End of a one-way plan: hold at the end.
          along = total;
          vg = Math.min(vg, 0.5);
        }
      }
      // Altitude: hold the commanded height, descend over the station to land.
      const altWant = phase === "land" ? 0 : altCmd;
      const rate = phase === "land" ? (alt > 15 ? 2.5 : 1.0) : frame.max_climb_mps;
      climb = Math.max(-rate, Math.min(rate, (altWant - alt) / dt));
      alt = Math.max(0, alt + climb * dt);
      if (phase === "land" && alt <= 0.05) {
        alt = 0;
        phase = "landed";
      }
    }
    const heading = phase === "landed" ? course : Math.atan2(vg * Math.sin(course) - w[0], vg * Math.cos(course) - w[1]);
    const watts = phase === "landed" ? ASSUMED.avionics_w : power(frame, va, climb);
    e = Math.max(0, e - (watts * dt) / 3600);
    const soc = e / frame.pack_wh;
    const pitch = phase === "landed" ? 0 : -Math.atan(drag(frame, va) / (frame.mass_kg * G));
    const wf = windFrom(w);
    const leftNow = Math.max(0, e - (frame.pack_wh - usable));
    out.push({
      t,
      x,
      y,
      alt,
      along,
      course_deg: deg(course),
      heading_deg: deg(heading),
      ground_mps: vg,
      air_mps: va,
      climb_mps: climb,
      roll_deg: (roll * 180) / Math.PI,
      pitch_deg: (pitch * 180) / Math.PI,
      power_w: watts,
      energy_wh: e,
      battery_pct: soc * 100,
      pack_v: packVolts(frame, soc, watts, temp),
      endurance_min: watts > 0 ? (leftNow * 60) / watts : Infinity,
      home_min: homeS / 60,
      wind_mps: wf.speed,
      wind_from_deg: wf.from,
      phase,
      forced_landing: forced,
      bingo_at: bingoAt,
    });
  }
  return out;
}

/** Sample a flyPlan() table at any time: linear in position, nearest for the rest. */
export function sampleAt(table, t, dt = 1) {
  if (table.length === 0) return null;
  const f = Math.max(0, Math.min(table.length - 1, t / dt));
  const i = Math.floor(f);
  const a = table[i];
  const b = table[Math.min(table.length - 1, i + 1)];
  const k = f - i;
  return { ...a, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, alt: a.alt + (b.alt - a.alt) * k, along: a.along + (b.along - a.along) * k };
}

/** A circle as a closed polyline, for orbits. */
export function orbitPath(cx, cy, r, n = 64) {
  return Array.from({ length: n + 1 }, (_, k) => [cx + r * Math.cos((k / n) * Math.PI * 2), cy + r * Math.sin((k / n) * Math.PI * 2)]);
}

/** A lawnmower survey as a polyline out and back, legs east-west from the north-west corner. */
export function lawnmowerPath(c) {
  const leg = c.h / (c.legs - 1);
  const pts = [];
  for (let i = 0; i < c.legs; i += 1) {
    const yy = c.y - i * leg;
    const [a, b] = i % 2 === 0 ? [c.x, c.x + c.w] : [c.x + c.w, c.x];
    pts.push([a, yy], [b, yy]);
  }
  return [...pts, ...pts.slice(0, -1).reverse()];
}

/** The model, for pages that want to show what it assumes. */
export function describe() {
  return {
    source: "Performance model (textbook relations and assumed coefficients, not measured)",
    assumptions: ASSUMED,
    curves: Object.fromEntries(
      Object.entries(AIRFRAMES).map(([sku, f]) => [sku, Array.from({ length: Math.floor(f.max_air_mps) + 1 }, (_, v) => [v, Math.round(power(f, v))])]),
    ),
    airframes: Object.fromEntries(
      Object.entries(AIRFRAMES).map(([sku, f]) => {
        const vbr = bestRangeSpeed(f);
        return [
          sku,
          {
            ...f,
            hover_w: Math.round(power(f, 0)),
            cruise_w: Math.round(power(f, f.cruise_mps)),
            pack: f.pack,
            best_range_mps: vbr,
            best_range_w: Math.round(power(f, vbr)),
            hover_min: Math.round(((f.pack_wh * ASSUMED.usable_depth) / power(f, 0)) * 60) / 1,
            cruise_min: Math.round(((f.pack_wh * ASSUMED.usable_depth) / power(f, f.cruise_mps)) * 60) / 1,
            range_km_still_air: Math.round(((f.pack_wh * ASSUMED.usable_depth * (1 - ASSUMED.reserve)) / power(f, vbr)) * 3600 * vbr) / 1000,
          },
        ];
      }),
    ),
  };
}
