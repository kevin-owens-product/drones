// Fleet-sourced GNSS denial map. Every vehicle navigating on VIO also knows
// where its GNSS fix disagreed with VIO or dropped out. Shared, those samples
// become a map of where GNSS cannot be trusted, and the planner routes the next
// sortie around it. Pure JavaScript, seeded, simulated: the zones, the spoof
// offsets and the VIO noise are assumptions, and the page says so.

/** Area mapped, local metres east (x) and north (y) of the demo origin. */
export const AREA = { x0: -3000, x1: 3600, y0: -2600, y1: 1600, cell: 200 };
export const STATION = { x: -2400, y: -1350 };
export const TARGET = { id: "T1", label: "Culvert check", x: 2300, y: -50 };

/** Ground truth for the simulation. The jamming zone was briefed; the spoofing zone was not. */
export const ZONES = [
  { id: "J1", kind: "jamming", briefed: true, x: 300, y: -600, r: 650 },
  { id: "S1", kind: "spoofing", briefed: false, x: 1550, y: -280, r: 420 },
];

/** Scout passes flown before the target sortie, in order. */
export const PASSES = [
  { tail: "NX-01", path: [[-2400, -1350], [-400, -1600], [1200, -1400], [3200, -900]] },
  { tail: "NX-03", path: [[-2600, 600], [600, 300], [1500, -200], [2400, -1800]] },
  { tail: "NX-05", path: [[-1500, -2300], [1000, -300], [1900, 700], [3300, 1200]] },
  { tail: "NX-09", path: [[3400, -400], [1800, -500], [900, 900], [-2000, 1300]] },
];

/** Disagreement above this, or no fix, counts as denied. Assumed, not tuned on data. */
export const RESIDUAL_M = 15;
const PRIOR_UNKNOWN = 0.1;
const PRIOR_BRIEFED = 0.9;
const RISK_WEIGHT = 25;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const inside = (z, x, y) => (x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r;

/** Samples every `step` metres along a pass: where it was and what GNSS said. */
export function fly(pass, seed, step = 25) {
  const r = rng(seed);
  const out = [];
  for (let i = 1; i < pass.path.length; i++) {
    const [ax, ay] = pass.path[i - 1];
    const [bx, by] = pass.path[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const y = ay + ((by - ay) * k) / n;
      let fix = true;
      // VIO and GNSS both carry a few metres of noise when nothing is wrong.
      let residual = Math.abs(gauss(r) * 4) + Math.abs(gauss(r) * 3);
      for (const z of ZONES) {
        if (!inside(z, x, y)) continue;
        if (z.kind === "jamming") fix = r() < 0.05;
        else residual = 30 + 60 * (1 - Math.hypot(x - z.x, y - z.y) / z.r) + Math.abs(gauss(r) * 8);
      }
      out.push({ x, y, fix, residual: fix ? residual : null, denied: !fix || residual > RESIDUAL_M });
    }
  }
  return out;
}

const cols = () => Math.ceil((AREA.x1 - AREA.x0) / AREA.cell);
const rows = () => Math.ceil((AREA.y1 - AREA.y0) / AREA.cell);
const cellOf = (x, y) => {
  const c = Math.floor((x - AREA.x0) / AREA.cell);
  const r = Math.floor((y - AREA.y0) / AREA.cell);
  return c >= 0 && r >= 0 && c < cols() && r < rows() ? r * cols() + c : -1;
};
const centre = (i) => ({ x: AREA.x0 + ((i % cols()) + 0.5) * AREA.cell, y: AREA.y0 + (Math.floor(i / cols()) + 0.5) * AREA.cell });

/** Per-cell counts and a Beta(1,1) posterior mean of "denied". */
export function buildMap(samples) {
  const n = new Array(cols() * rows()).fill(0);
  const d = new Array(cols() * rows()).fill(0);
  for (const s of samples) {
    const i = cellOf(s.x, s.y);
    if (i < 0) continue;
    n[i] += 1;
    d[i] += s.denied ? 1 : 0;
  }
  return n.map((count, i) => ({ i, ...centre(i), n: count, denied: d[i], p: (d[i] + 1) / (count + 2) }));
}

/**
 * Risk the planner uses per cell: the map where it has data, the brief or a
 * small prior where not. A cell next to a mapped denied cell takes 60% of that
 * risk, because a zone seen at its edge usually goes on past where anyone flew.
 */
export function riskOf(map, minSamples = 3) {
  const base = map.map((c) => {
    if (c.n >= minSamples) return c.p;
    return ZONES.some((z) => z.briefed && inside(z, c.x, c.y)) ? PRIOR_BRIEFED : PRIOR_UNKNOWN;
  });
  const C = cols();
  return base.map((v, i) => {
    let near = 0;
    const r = Math.floor(i / C);
    const c = i % C;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const j = (r + dr) * C + (c + dc);
        if ((dr || dc) && r + dr >= 0 && c + dc >= 0 && c + dc < C && j < base.length && map[j].n >= minSamples) near = Math.max(near, base[j]);
      }
    return Math.max(v, 0.6 * near);
  });
}

/** A* over the grid, 8-connected; step cost is distance times (1 + weight * risk). */
export function plan(risk, from = STATION, to = TARGET) {
  const C = cols();
  const R = rows();
  const start = cellOf(from.x, from.y);
  const goal = cellOf(to.x, to.y);
  const g = new Map([[start, 0]]);
  const prev = new Map();
  const open = new Set([start]);
  const h = (i) => {
    const a = centre(i);
    const b = centre(goal);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const f = new Map([[start, h(start)]]);
  while (open.size) {
    let cur = -1;
    let best = Infinity;
    for (const i of open) if ((f.get(i) ?? Infinity) < best) [cur, best] = [i, f.get(i)];
    if (cur === goal) break;
    open.delete(cur);
    const cr = Math.floor(cur / C);
    const cc = cur % C;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r2 = cr + dr;
        const c2 = cc + dc;
        if (r2 < 0 || c2 < 0 || r2 >= R || c2 >= C) continue;
        const j = r2 * C + c2;
        const step = Math.hypot(dr, dc) * AREA.cell * (1 + RISK_WEIGHT * risk[j]);
        const cand = (g.get(cur) ?? Infinity) + step;
        if (cand < (g.get(j) ?? Infinity)) {
          g.set(j, cand);
          prev.set(j, cur);
          f.set(j, cand + h(j));
          open.add(j);
        }
      }
  }
  const cells = [goal];
  while (cells[0] !== start && prev.has(cells[0])) cells.unshift(prev.get(cells[0]));
  const pts = [[from.x, from.y], ...cells.slice(1, -1).map((i) => [centre(i).x, centre(i).y]), [to.x, to.y]];
  return pts;
}

/** Route length and metres flown inside each true zone, sampled every 10 m. */
export function exposure(route) {
  let length = 0;
  const inZone = Object.fromEntries(ZONES.map((z) => [z.id, 0]));
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = route[i - 1];
    const [bx, by] = route[i];
    const seg = Math.hypot(bx - ax, by - ay);
    length += seg;
    const n = Math.max(1, Math.round(seg / 10));
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * (k + 0.5)) / n;
      const y = ay + ((by - ay) * (k + 0.5)) / n;
      for (const z of ZONES) if (inside(z, x, y)) inZone[z.id] += seg / n;
    }
  }
  return { length_m: Math.round(length), in_zone_m: Object.fromEntries(Object.entries(inZone).map(([k, v]) => [k, Math.round(v)])) };
}

/** Cells with enough samples, scored against the simulation's truth. */
export function score(map, minSamples = 3, threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const c of map) {
    if (c.n < minSamples) continue;
    const truth = ZONES.some((z) => inside(z, c.x, c.y));
    const call = c.p >= threshold;
    if (call && truth) tp++;
    else if (call) fp++;
    else if (truth) fn++;
    else tn++;
  }
  return { mapped: tp + fp + fn + tn, tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}

/** The whole picture after the first `passes` scout passes. */
export function denialPicture(passes, seed = 11) {
  const flown = PASSES.slice(0, Math.max(0, Math.min(PASSES.length, passes)));
  const samples = flown.flatMap((p, i) => fly(p, seed + i));
  const map = buildMap(samples);
  const route = plan(riskOf(map));
  const briefOnly = plan(riskOf(buildMap([])));
  return {
    source: "Demo scenario (simulated): zones, spoof offsets and VIO noise are assumptions",
    area: { ...AREA, cols: cols(), rows: rows() },
    station: STATION,
    target: TARGET,
    zones: ZONES,
    residual_m: RESIDUAL_M,
    passes: flown.map((p) => ({ tail: p.tail, path: p.path })),
    total_passes: PASSES.length,
    samples: samples.length,
    denied_samples: samples.filter((s) => s.denied).length,
    cells: map.filter((c) => c.n > 0).map((c) => ({ i: c.i, x: c.x, y: c.y, n: c.n, p: Math.round(c.p * 100) / 100 })),
    route,
    route_exposure: exposure(route),
    brief_route: briefOnly,
    brief_exposure: exposure(briefOnly),
    score: score(map),
  };
}
