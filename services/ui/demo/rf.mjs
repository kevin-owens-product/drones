// The C2 radio link over real terrain, with a jammer in the picture.
//
// Small drones are lost to the link more than to anything else, and at the
// altitudes they fly the link is decided by line of sight, not by distance: a
// 1 W radio at 900 MHz has tens of dB to spare over 5 km of clear air and
// nothing left behind one ridge. This model samples the range's real terrain
// (demo/terrain-grid.mjs, SRTM/NED), checks Fresnel-zone clearance along the
// path with the 4/3-Earth bulge, prices obstructions as Bullington's
// equivalent knife edge (ITU-R P.526), and, when an emitter is on, treats what it puts
// into the receiver as interference the radio's frequency hopping only partly
// rejects. Pure JavaScript, no imports beyond the grid, deterministic.
//
// Textbook relations, assumed radio figures. Nothing here is a measured Neros
// figure, and pages that show these numbers say "SIM".

import { DATA, GRID } from "./terrain-grid.mjs";

export const C_MPS = 299_792_458;
/** Effective Earth radius for a standard atmosphere (k = 4/3). */
export const EARTH_EFF_M = (4 / 3) * 6_371_000;

/**
 * C2 radios by band. `budget_db` is transmit EIRP minus receiver sensitivity,
 * the same figures as the loadout planner's catalog (demo/configure.mjs);
 * `rejection_db` is how much a barrage jammer is knocked down by hopping and
 * filtering before it counts as noise. Assumed, not measured.
 */
export const BANDS = {
  915: { id: "915", label: "900 MHz", f_mhz: 915, budget_db: 142, sens_dbm: -110, rejection_db: 20 },
  2400: { id: "2400", label: "2.4 GHz", f_mhz: 2400, budget_db: 146, sens_dbm: -106, rejection_db: 20 },
  5800: { id: "5800", label: "5.8 GHz", f_mhz: 5800, budget_db: 148, sens_dbm: -104, rejection_db: 20 },
};

/**
 * The video downlink. It carries megabits where C2 carries kilobits, so it
 * needs about 20 dB more signal: the same ridge that leaves C2 thin takes the
 * picture away first. Digital video at 5.8 GHz, received at the GCS (or the relay).
 */
export const VIDEO = { id: "5800v", label: "5.8 GHz video", f_mhz: 5800, budget_db: 128, sens_dbm: -88, rejection_db: 10 };
export const bandOf = (id) => (id === VIDEO.id ? VIDEO : (BANDS[id] ?? BANDS[915]));

export const RF = {
  gcs_mast_m: 3, // ground station antenna above the ground
  fade_db: 6, // multipath and body-shadowing allowance on every path
  required_db: 10, // margin a planner should hold; under it the link is "thin"
  snr_req_db: 3, // the demodulator wants this much above noise plus interference
  clearance_f1: 0.6, // the rule of thumb: keep 60% of the first Fresnel zone clear
  step_m: 40, // terrain profile spacing, half the grid cell
};

/**
 * The range's EW emitter (SIM): the trailer at the J1 GNSS jamming site also
 * radiates on the 900 MHz and 2.4 GHz C2 bands during EW trials. It does not
 * reach 5.8 GHz. ERP in dBm; null means the band is clear of it.
 */
export const EMITTER = { id: "E1", label: "Range EW emitter (SIM)", x: 300, y: -600, mast_m: 8, erp_dbm: { 915: 37, 2400: 37, 5800: null } };

// ---- terrain ----------------------------------------------------------------

let heights = null;
function grid() {
  if (heights) return heights;
  const bin = atob(DATA);
  const scale = (GRID.e1 - GRID.e0) / 255;
  heights = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) heights[i] = GRID.e0 + bin.charCodeAt(i) * scale;
  return heights;
}

/** Ground elevation, metres above sea level, at local metres east (x) and north (y). Bilinear on the 80 m grid. */
export function ground(x, y) {
  const h = grid();
  const fc = ((x - GRID.x0) / (GRID.x1 - GRID.x0)) * GRID.cols - 0.5;
  const fr = ((GRID.y1 - y) / (GRID.y1 - GRID.y0)) * GRID.rows - 0.5;
  const c = Math.max(0, Math.min(GRID.cols - 1.001, fc));
  const r = Math.max(0, Math.min(GRID.rows - 1.001, fr));
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const u = c - c0;
  const v = r - r0;
  const at = (rr, cc) => h[rr * GRID.cols + cc];
  return (1 - v) * ((1 - u) * at(r0, c0) + u * at(r0, c0 + 1)) + v * ((1 - u) * at(r0 + 1, c0) + u * at(r0 + 1, c0 + 1));
}

// ---- propagation --------------------------------------------------------------

/** Free-space path loss, dB, for a distance in metres at a frequency in MHz. */
export function fspl(distanceM, fMhz) {
  return 32.45 + 20 * Math.log10(fMhz) + 20 * Math.log10(Math.max(1, distanceM) / 1000);
}

/** Single knife-edge diffraction loss, dB, for the Fresnel-Kirchhoff parameter nu (ITU-R P.526 approximation). */
export function knifeEdgeDb(nu) {
  if (nu <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1);
}

/**
 * Terrain profile between two points: distance along the path and the height
 * an obstacle presents there (ground plus the 4/3-Earth bulge), metres.
 */
export function profile(a, b, step = RF.step_m) {
  const D = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(D / step));
  const d = new Float64Array(n + 1);
  const z = new Float64Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    d[i] = D * f;
    z[i] = ground(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f) + (d[i] * (D - d[i])) / (2 * EARTH_EFF_M);
  }
  return { D, d, z };
}

/**
 * Bullington's equivalent knife edge (ITU-R P.526 section 4.5): when terrain
 * blocks the line of sight, the edge sits where the steepest ray from each
 * end meets; when it does not, the point that intrudes most on the Fresnel
 * zone. One edge, so rolling hills are not priced as a row of separate
 * mountains, which is where Deygout overstates the loss.
 */
function bullington(d, z, h0, h1, lambda) {
  const n = d.length - 1;
  const D = d[n];
  const slopeLos = (h1 - h0) / D;
  let sTx = -Infinity;
  let nuMax = -Infinity;
  for (let i = 1; i < n; i += 1) {
    sTx = Math.max(sTx, (z[i] - h0) / d[i]);
    const los = h0 + slopeLos * d[i];
    nuMax = Math.max(nuMax, (z[i] - los) * Math.sqrt((2 * D) / (lambda * d[i] * (D - d[i]))));
  }
  if (sTx < slopeLos) return { nu: nuMax, loss: knifeEdgeDb(nuMax) };
  let sRx = -Infinity;
  for (let i = 1; i < n; i += 1) sRx = Math.max(sRx, (z[i] - h1) / (D - d[i]));
  const db = Math.max(1, Math.min(D - 1, (h1 - h0 + sRx * D) / (sTx + sRx)));
  const edge = h0 + sTx * db;
  const los = h0 + slopeLos * db;
  const nu = (edge - los) * Math.sqrt((2 * D) / (lambda * db * (D - db)));
  return { nu, loss: knifeEdgeDb(nu) };
}

/**
 * Path from a transmitter to a receiver over the terrain at one frequency.
 * Heights are above ground. Returns the loss and why: free space, diffraction,
 * and the worst clearance as a fraction of the first Fresnel zone (negative
 * means terrain stands in the line of sight).
 */
export function path(a, b, fMhz) {
  const pr = profile(a, b);
  const lambda = C_MPS / (fMhz * 1e6);
  const n = pr.d.length - 1;
  const h0 = pr.z[0] + a.agl;
  const h1 = pr.z[n] + b.agl;
  let clearance = Infinity;
  let worstAt = 0;
  for (let i = 1; i < n; i += 1) {
    const d1 = pr.d[i];
    const d2 = pr.D - d1;
    const los = h0 + ((h1 - h0) * d1) / pr.D;
    const f1 = Math.sqrt((lambda * d1 * d2) / pr.D);
    const c = (los - pr.z[i]) / f1;
    if (c < clearance) [clearance, worstAt] = [c, i];
  }
  const D3 = Math.hypot(pr.D, h1 - h0);
  const free = fspl(D3, fMhz);
  const diff = bullington(pr.d, pr.z, h0, h1, lambda).loss;
  return { distance_m: pr.D, free_db: free, diffraction_db: diff, loss_db: free + diff + RF.fade_db, clearance_f1: Number.isFinite(clearance) ? clearance : 9, worst_at_m: pr.d[worstAt] ?? 0, profile: pr, h0, h1 };
}

const dbSum = (...dbm) => 10 * Math.log10(dbm.reduce((s, v) => s + 10 ** (v / 10), 0));

/**
 * One C2 hop: the uplink from a transmitter at `a` to a vehicle at `b`, on a
 * band, with the emitter on or off. Margin is what the received signal has
 * over the floor the receiver needs: its sensitivity, or the jammer's leftover
 * power plus the required SNR, whichever is worse.
 */
export function hop(a, b, bandId = "915", emitter = null) {
  const band = bandOf(bandId);
  const p = path(a, b, band.f_mhz);
  const eirp = band.budget_db + band.sens_dbm;
  const signal = eirp - p.loss_db;
  let floor = band.sens_dbm;
  let jam = null;
  const erp = emitter?.erp_dbm?.[band.id];
  if (emitter && erp !== null && erp !== undefined) {
    const pj = path({ x: emitter.x, y: emitter.y, agl: emitter.mast_m }, b, band.f_mhz);
    const leftover = erp - pj.loss_db - band.rejection_db;
    floor = dbSum(band.sens_dbm, leftover + RF.snr_req_db);
    jam = { received_dbm: Math.round((erp - pj.loss_db) * 10) / 10, clearance_f1: Math.round(pj.clearance_f1 * 100) / 100, diffraction_db: Math.round(pj.diffraction_db * 10) / 10 };
  }
  const margin = signal - floor;
  return {
    margin_db: margin,
    signal_dbm: signal,
    floor_dbm: floor,
    distance_m: p.distance_m,
    free_db: p.free_db,
    diffraction_db: p.diffraction_db,
    clearance_f1: p.clearance_f1,
    worst_at_m: p.worst_at_m,
    jam,
    _path: p,
  };
}

/** The terrain profile of a hop as a chart wants it: ground, line of sight and the 60% Fresnel line. */
export function profileChart(a, b, fMhz = 915, points = 120) {
  const p = path(a, b, fMhz);
  const lambda = C_MPS / (fMhz * 1e6);
  const n = p.profile.d.length - 1;
  const stride = Math.max(1, Math.ceil(n / points));
  const rows = [];
  for (let i = 0; i <= n; i += stride) {
    const d1 = p.profile.d[i];
    const d2 = p.distance_m - d1;
    const los = p.h0 + ((p.h1 - p.h0) * d1) / p.distance_m;
    const f1 = d1 > 0 && d2 > 0 ? Math.sqrt((lambda * d1 * d2) / p.distance_m) : 0;
    rows.push({ d_m: Math.round(d1), ground_m: Math.round(p.profile.z[i] * 10) / 10, los_m: Math.round(los * 10) / 10, fresnel60_m: Math.round((los - RF.clearance_f1 * f1) * 10) / 10 });
  }
  if (rows.at(-1)?.d_m !== Math.round(p.distance_m)) {
    rows.push({ d_m: Math.round(p.distance_m), ground_m: Math.round(p.profile.z[n] * 10) / 10, los_m: Math.round(p.h1 * 10) / 10, fresnel60_m: Math.round(p.h1 * 10) / 10 });
  }
  return { distance_m: Math.round(p.distance_m), clearance_f1: Math.round(p.clearance_f1 * 100) / 100, diffraction_db: Math.round(p.diffraction_db * 10) / 10, worst_at_m: Math.round(p.worst_at_m), rows };
}

/**
 * The best a vehicle can do at one moment: straight to the GCS, or through any
 * relay airborne then (decode and forward, so the weaker of its two hops).
 */
export function linkAt(gcs, pt, bandId, emitter, relays = []) {
  const direct = hop(gcs, pt, bandId, emitter);
  let best = { margin_db: direct.margin_db, via: "direct", hop: direct };
  for (const r of relays) {
    const up = r.gcs_hop ?? hop(gcs, r, bandId, emitter);
    const down = hop(r, pt, bandId, emitter);
    const m = Math.min(up.margin_db, down.margin_db);
    if (m > best.margin_db) best = { margin_db: m, via: r.label ?? "relay", hop: down.margin_db < up.margin_db ? down : up };
  }
  return { ...best, direct };
}

/**
 * Search the ground for a relay site: candidates on a grid over the area,
 * relay at `agl` metres, scored by the worst margin it gives the samples that
 * need it. Returns the best few, best first.
 */
export function relaySites(gcs, needs, bandId, emitter, box, opts = {}) {
  const agl = opts.agl ?? 120;
  const stride = opts.cell_m ?? 300;
  const samples = needs.length > 40 ? needs.filter((_, i) => i % Math.ceil(needs.length / 40) === 0) : needs;
  const sites = [];
  for (let x = box.x0; x <= box.x1; x += stride) {
    for (let y = box.y0; y <= box.y1; y += stride) {
      const r = { x, y, agl };
      const up = hop(gcs, r, bandId, emitter);
      if (up.margin_db < RF.required_db) continue;
      let worst = Infinity;
      let sum = 0;
      for (const s of samples) {
        const m = Math.min(up.margin_db, hop(r, s, bandId, emitter).margin_db);
        worst = Math.min(worst, m);
        sum += m;
      }
      sites.push({ x, y, agl, ground_m: Math.round(ground(x, y)), worst_db: worst, mean_db: sum / samples.length, gcs_db: up.margin_db });
    }
  }
  sites.sort((a, b) => b.worst_db - a.worst_db || b.mean_db - a.mean_db);
  return sites.slice(0, opts.keep ?? 3);
}

/** The model, for pages that show what it assumes. */
export function describeRf() {
  return {
    source: "Radio model over SRTM/NED terrain: free space, 4/3-Earth bulge, Bullington equivalent knife edge (ITU-R P.526), assumed radio figures, not measured",
    assumptions: RF,
    bands: Object.values(BANDS),
    video: VIDEO,
    emitter: EMITTER,
    terrain: { cell_m: (GRID.x1 - GRID.x0) / GRID.cols, elevation_m: [GRID.e0, GRID.e1] },
  };
}
