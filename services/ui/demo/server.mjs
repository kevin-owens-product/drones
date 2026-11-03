// A self-contained demo of the operator console: serves the built UI and a
// mock of the API it reads, with a scripted sortie. No database, broker, or
// PX4 needed. The data is synthetic and the console says so in the banner.
//
//   npm run build && node demo/server.mjs   (then open http://localhost:4173)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { acknowledge, RESPONSES, scorecard, startSession, visible } from "./training.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const ASSETS = fileURLToPath(new URL("./assets/", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const SPEED = Number(process.env.A2E_DEMO_SPEED ?? 6);
const BANNER = "UNCLASSIFIED // DEMO DATA";
const T0 = Date.now();

// A small range in the California central coast. Origin of the local plane.
const LAT0 = 35.7392;
const LON0 = -120.7654;
const M_LAT = 110_540;
const M_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

const FLEET = [
  { tail: "NX-01", kind: "lawnmower", x: -1800, y: 900, w: 1200, h: 700, legs: 6, v: 15, alt: 120 },
  { tail: "NX-02", kind: "lawnmower", x: -500, y: 900, w: 1200, h: 700, legs: 6, v: 15, alt: 125 },
  { tail: "NX-03", kind: "lawnmower", x: 800, y: 900, w: 1200, h: 700, legs: 6, v: 15, alt: 120 },
  // NX-04 orbits inside the scenario's GNSS jamming zone and navigates on VIO.
  { tail: "NX-04", kind: "orbit", x: 300, y: -600, r: 380, v: 18, alt: 90, denied: true },
  { tail: "NX-05", kind: "orbit", x: -1300, y: -700, r: 260, v: 14, alt: 80 },
  { tail: "NX-06", kind: "transit", x: 2600, y: -1500, tx: 900, ty: 200, v: 20, alt: 150, battery: 22 },
  // NX-07 drops off the link for part of every sortie loop (see LINK_GAP).
  { tail: "NX-07", kind: "orbit", x: 1900, y: -300, r: 200, v: 12, alt: 60, gap: true },
  { tail: "NX-08", kind: "hold", x: -2400, y: -1600, alt: 0, mode: "HOLD", armed: false },
  { tail: "NX-09", kind: "lawnmower", x: -1800, y: -200, w: 900, h: 500, legs: 4, v: 13, alt: 110 },
  // On the pad: taken out of the case, powered on, waiting for a position fix.
  // They cycle every PAD_CYCLE demo seconds so the launch view always has something to show.
  { tail: "NX-10", kind: "pad", x: -2400, y: -1250, boot: 60, fix: 210, battery: 97 },
  { tail: "NX-11", kind: "pad", x: -2650, y: -1450, boot: 90, fix: 140, battery: 41 },
  // NX-12 is grounded by its factory birth record, so it stays NO-GO with the reason shown.
  { tail: "NX-12", kind: "pad", x: -2150, y: -1450, boot: 30, fix: 90, battery: 100, grounded: "EOL hover test failed: IMU cal out of range" },
];
const PAD_CYCLE = 360;
// Demo seconds within the sortie loop when NX-07 stops reporting. The console
// calls a link stale after 20 s of real time, LOST_AFTER demo seconds in.
const LINK_GAP = [280, 520];
const LOST_AFTER = LINK_GAP[0] + 20 * SPEED;

// Scenario overlays. All simulated, and the console labels them so.
const STATION = { x: -2400, y: -1350 };
const JAMMING = { x: 300, y: -600, r: 650 };
// VIO error growth is an assumption, not a measurement: 1% of distance flown.
const VIO_DRIFT = 0.01;
const TASKS = [
  { id: "T1", label: "Culvert check", x: 2300, y: -50, reward: 10 },
  { id: "T2", label: "Gate 3", x: 1600, y: -700, reward: 8 },
  { id: "T3", label: "Ridge relay", x: -900, y: -1100, reward: 7 },
  { id: "T4", label: "Road junction", x: 700, y: -200, reward: 9 },
];

// Fleet-scale mode: A2E_DEMO_FLEET=300 adds that many synthetic survey
// vehicles spread over the range, each with seeded exception windows.
const EXTRA = Math.max(0, Math.min(2000, Number(process.env.A2E_DEMO_FLEET ?? 0) | 0));
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SWARM = Array.from({ length: EXTRA }, (_, i) => {
  const rnd = seeded(i + 1);
  const cols = Math.ceil(Math.sqrt(EXTRA * 1.5));
  const cw = 11_000 / cols;
  const ch = 7_000 / Math.ceil(EXTRA / cols);
  const x = -5500 + (i % cols) * cw + rnd() * cw * 0.2;
  const y = 3500 - Math.floor(i / cols) * ch - rnd() * ch * 0.2;
  const w = cw * (0.5 + rnd() * 0.3);
  const h = ch * (0.5 + rnd() * 0.3);
  const window = (p) => (rnd() < p ? [60 + rnd() * 400, 0] : null);
  const denied = window(0.04);
  const low = window(0.03);
  const gap = window(0.025);
  if (denied) denied[1] = denied[0] + 60 + rnd() * 120;
  if (low) low[1] = 9999;
  if (gap) gap[1] = gap[0] + 150 + rnd() * 100;
  return {
    tail: `SX-${String(i + 1).padStart(3, "0")}`,
    kind: "lawnmower",
    x, y, w, h,
    legs: 4,
    v: 11 + rnd() * 5,
    alt: 90 + Math.round(rnd() * 60),
    phase: rnd() * 4000,
    battery: low ? 40 : 92 - rnd() * 10,
    lowAt: low?.[0],
    deniedWin: denied,
    gapWin: gap,
    swarm: true,
  };
});
const PAD_DOWN = 330;

function lawnmower(c, s) {
  const leg = c.h / (c.legs - 1);
  const loop = 2 * (c.w * c.legs + c.h);
  let d = s % loop;
  const back = d > loop / 2;
  if (back) d = loop - d;
  for (let i = 0; i < c.legs; i += 1) {
    if (d <= c.w) {
      const east = i % 2 === 0 ? c.x + d : c.x + c.w - d;
      return [east, c.y - i * leg, (i % 2 === 0) !== back ? 90 : 270];
    }
    d -= c.w;
    if (i < c.legs - 1) {
      if (d <= leg) return [i % 2 === 0 ? c.x + c.w : c.x, c.y - i * leg - d, back ? 0 : 180];
      d -= leg;
    }
  }
  return [c.x, c.y - c.h, 0];
}

function within(win, t) {
  return Array.isArray(win) && t >= win[0] && t < win[1];
}

function state(c, tNow, tp) {
  // A vehicle off the link last reported when its gap began.
  const gapWin = c.gap ? LINK_GAP : c.gapWin;
  const inGap = within(gapWin, tNow);
  const t = inGap ? gapWin[0] : tNow;
  const s = t * (c.v ?? 0) + (c.phase ?? 0);
  let x = c.x;
  let y = c.y;
  let hdg = 0;
  if (c.kind === "lawnmower") [x, y, hdg] = lawnmower(c, s);
  if (c.kind === "orbit") {
    const a = s / c.r;
    x = c.x + c.r * Math.cos(a);
    y = c.y + c.r * Math.sin(a);
    hdg = (((90 - (a * 180) / Math.PI - 90) % 360) + 360) % 360;
  }
  if (c.kind === "transit") {
    const len = Math.hypot(c.tx - c.x, c.ty - c.y);
    const f = Math.min(1, s / len);
    x = c.x + (c.tx - c.x) * f;
    y = c.y + (c.ty - c.y) * f;
    hdg = ((Math.atan2(c.tx - c.x, c.ty - c.y) * 180) / Math.PI + 360) % 360;
  }
  const lag = inGap ? 400 + ((tNow - gapWin[0]) / SPEED) * 1000 : 400;
  const pad = c.kind === "pad";
  const acquiring = pad && tp < c.fix;
  const denied = c.denied || within(c.deniedWin, t);
  // 1-sigma horizontal position error. GNSS: a couple of metres. VIO: grows
  // with distance flown since GNSS was rejected (assumed rate, see VIO_DRIFT).
  const onVio = c.denied ? t * (c.v ?? 0) : within(c.deniedWin, t) ? (t - c.deniedWin[0]) * (c.v ?? 0) : 0;
  const sigma = acquiring ? undefined : denied ? 1.5 + VIO_DRIFT * onVio : 1.2;
  const battery = pad ? c.battery : c.lowAt !== undefined && t > c.lowAt ? Math.max(8, 30 - (t - c.lowAt) / 40) : Math.max(5, (c.battery ?? 88) - t / 90);
  return {
    tail_number: c.tail,
    tenant_id: "demo",
    time: new Date(Date.now() - lag).toISOString(),
    lat: LAT0 + y / M_LAT,
    lon: LON0 + x / M_LON,
    alt_m: pad ? 0 : c.alt + 2 * Math.sin(t / 7),
    classification: "UNCLASSIFIED",
    caveats: [],
    heading_deg: c.kind === "hold" || pad ? undefined : hdg,
    ground_mps: c.v ?? 0,
    climb_mps: pad ? 0 : 0.1 * Math.sin(t / 5),
    battery_pct: battery,
    mode: pad ? "PREFLIGHT" : c.mode ?? (c.kind === "transit" ? "RTL" : "MISSION"),
    armed: pad ? false : c.armed ?? true,
    nav_source: acquiring ? "none" : denied ? "vio" : "gnss",
    gnss_trusted: acquiring ? undefined : !denied,
    pos_sigma_m: sigma,
  };
}

const PLATFORMS = [...FLEET, ...SWARM].map((c, i) => ({
  id: `p${i}`,
  tail_number: c.tail,
  designation: c.swarm ? "Quad, 7 in, VIO + GNSS (synthetic)" : i < 7 || c.kind === "pad" ? "Quad, 7 in, VIO + GNSS" : "Quad, 5 in, GNSS",
  group_size: "Group 1",
  portion_mark: "(U)",
  airworthiness: c.grounded ? "grounded" : c.tail === "NX-08" ? "restricted" : "airworthy",
  airworthiness_reason: c.grounded ?? null,
  classification: "UNCLASSIFIED",
}));

function loopTime() {
  // The sortie loops every ten minutes of demo time so it never runs dry.
  return ((((Date.now() - T0) / 1000) * SPEED) % 600) + 60;
}

const toLL = (x, y) => [LAT0 + y / M_LAT, LON0 + x / M_LON];
const round = ([lat, lon]) => [Number(lat.toFixed(6)), Number(lon.toFixed(6))];

// The lawnmower's outbound pass as waypoints, and how far along it the vehicle is.
function survey(c, t) {
  const leg = c.h / (c.legs - 1);
  const pts = [];
  for (let i = 0; i < c.legs; i += 1) {
    const yy = c.y - i * leg;
    const [a, b] = i % 2 === 0 ? [c.x, c.x + c.w] : [c.x + c.w, c.x];
    pts.push([a, yy], [b, yy]);
  }
  const total = c.w * c.legs + c.h;
  const loop = 2 * total;
  const d = (t * c.v) % loop;
  const along = Math.min(total, d);
  const flown = [pts[0]];
  const ahead = [];
  let left = along;
  let here = null;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (here) {
      ahead.push(pts[i]);
    } else if (left >= len) {
      flown.push(pts[i]);
      left -= len;
    } else {
      here = [x0 + ((x1 - x0) * left) / len, y0 + ((y1 - y0) * left) / len];
      flown.push(here);
      ahead.push(here, pts[i]);
    }
  }
  return { flown, ahead, pct: Math.round((100 * along) / total), swath: leg, returning: d > total };
}

// The assignment CBBA converges to on a connected, lossless network: sequential
// greedy with the same discounted score as onboard/alloc and sim/scale
// (reward * 0.98^seconds at 10 m/s, best insertion, two tasks per vehicle).
function allocate(agents) {
  const score = (a, path) => {
    let [x, y] = [a.x, a.y];
    let s = 0;
    let total = 0;
    for (const task of path) {
      s += Math.hypot(task.x - x, task.y - y) / 10;
      total += task.reward * 0.98 ** s;
      [x, y] = [task.x, task.y];
    }
    return total;
  };
  const paths = new Map(agents.map((a) => [a.tail, []]));
  const open = new Set(TASKS);
  while (open.size > 0) {
    let best = null;
    for (const a of agents) {
      const path = paths.get(a.tail);
      if (path.length >= 2) continue;
      const base = score(a, path);
      for (const task of open) {
        for (let pos = 0; pos <= path.length; pos += 1) {
          const trial = [...path.slice(0, pos), task, ...path.slice(pos)];
          const gain = score(a, trial) - base;
          if (!best || gain > best.gain + 1e-9) best = { gain, a, task, trial };
        }
      }
    }
    if (!best) break;
    paths.set(best.a.tail, best.trial);
    open.delete(best.task);
  }
  const owner = new Map();
  for (const [tail, path] of paths) for (const task of path) owner.set(task.id, tail);
  return owner;
}

function picture() {
  const t = loopTime();
  const tp = (((Date.now() - T0) / 1000) * SPEED) % PAD_CYCLE;
  const airborne = FLEET.filter((c) => c.kind !== "pad" && c.kind !== "hold");
  const pos = new Map(FLEET.map((c) => {
    const p = state(c, t, tp);
    return [c.tail, { x: (p.lon - LON0) * M_LON, y: (p.lat - LAT0) * M_LAT }];
  }));
  const lost = t >= LOST_AFTER && t < LINK_GAP[1];

  const areas = FLEET.filter((c) => c.kind === "lawnmower").map((c, i) => {
    const sv = survey(c, t);
    const pad = sv.swath / 2;
    const ring = [[c.x - pad, c.y + pad], [c.x + c.w + pad, c.y + pad], [c.x + c.w + pad, c.y - c.h - pad], [c.x - pad, c.y - c.h - pad]];
    return {
      id: String.fromCharCode(65 + i),
      tail: c.tail,
      ring: ring.map(([x, y]) => round(toLL(x, y))),
      covered_pct: sv.pct,
      swath_m: sv.swath,
      flown: sv.flown.map(([x, y]) => round(toLL(x, y))),
      ahead: sv.returning ? [] : sv.ahead.map(([x, y]) => round(toLL(x, y))),
    };
  });

  const routes = [];
  for (const c of FLEET) {
    if (c.kind === "orbit") {
      const ring = Array.from({ length: 49 }, (_, k) => {
        const a = (k / 48) * Math.PI * 2;
        return round(toLL(c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a)));
      });
      routes.push({ tail: c.tail, kind: "orbit", path: ring });
    }
    if (c.kind === "transit") {
      const here = pos.get(c.tail);
      routes.push({ tail: c.tail, kind: "transit", path: [round(toLL(here.x, here.y)), round(toLL(c.tx, c.ty))] });
    }
  }

  // Link quality falls off with range. Each vehicle shows its station link and
  // its two best mesh neighbours. NX-07's links read zero during its gap.
  const links = [];
  const q = (d, range) => Math.max(0, 1 - (d / range) ** 2);
  for (const c of airborne) {
    const a = pos.get(c.tail);
    const down = c.gap && within(LINK_GAP, t);
    links.push({ a: "GCS", b: c.tail, quality: down ? 0 : Number(q(Math.hypot(a.x - STATION.x, a.y - STATION.y), 5200).toFixed(2)) });
    const near = airborne
      .filter((o) => o.tail > c.tail)
      .map((o) => {
        const b = pos.get(o.tail);
        const off = down || (o.gap && within(LINK_GAP, t));
        return { a: c.tail, b: o.tail, quality: off ? 0 : Number(q(Math.hypot(a.x - b.x, a.y - b.y), 2600).toFixed(2)) };
      })
      .filter((l) => l.quality > 0.05)
      .sort((x, y) => y.quality - x.quality)
      .slice(0, 2);
    links.push(...near);
  }

  const agents = FLEET.filter((c) => c.kind === "orbit" && !(c.gap && lost)).map((c) => ({ tail: c.tail, x: c.x, y: c.y }));
  const owner = allocate(agents);
  const tasks = TASKS.map((k) => {
    const [lat, lon] = round(toLL(k.x, k.y));
    return { id: k.id, label: k.label, lat, lon, tail: owner.get(k.id) ?? null };
  });

  return {
    source: "Demo scenario (simulated)",
    basemap: TERRAIN,
    station: { label: "GCS", lat: toLL(STATION.x, STATION.y)[0], lon: toLL(STATION.x, STATION.y)[1] },
    zones: [{ id: "J1", kind: "gnss_jamming", label: "GNSS jamming (sim)", lat: toLL(JAMMING.x, JAMMING.y)[0], lon: toLL(JAMMING.x, JAMMING.y)[1], radius_m: JAMMING.r }],
    areas,
    routes,
    links,
    tasks,
    notes: {
      allocation: "CBBA's converged assignment (sequential greedy, onboard/alloc score), from orbit centres. Re-plans when a vehicle leaves the network.",
      drift: "VIO error assumed to grow 1% of distance flown.",
    },
  };
}

let TERRAIN = null;
try {
  const meta = JSON.parse(await readFile(join(ASSETS, "terrain.json"), "utf8"));
  TERRAIN = { url: "/demo-assets/terrain.jpg", south: meta.south, west: meta.west, north: meta.north, east: meta.east, attribution: meta.attribution };
} catch {
  TERRAIN = null;
}

const ROUTES = {
  "/v1/session/config": () => ({ auth_mode: "dev", dev_login: true, system_high: "UNCLASSIFIED", login_url: "" }),
  "/v1/me": () => ({ id: "u1", username: "demo.operator", display_name: "Demo Operator", citizenship: "USA", clearance: "UNCLASSIFIED", ntk_programs: [], roles: ["operator"] }),
  "/v1/platforms": () => ({ items: PLATFORMS }),
  "/v1/telemetry/live": () => {
    const t = loopTime();
    const tp = (((Date.now() - T0) / 1000) * SPEED) % PAD_CYCLE;
    const up = [...FLEET, ...SWARM].filter((c) => c.kind !== "pad" || (tp >= c.boot && tp < PAD_DOWN));
    return { items: up.map((c) => state(c, t, tp)), withheld: 0 };
  },
  "/v1/operations/picture": picture,
  "/v1/operations/board": () => ({ items: [] }),
  "/v1/session/dev-login": () => ({ ok: true }),
  "/v1/session/logout": () => ({ ok: true }),
};

const TYPES = { ".jpg": "image/jpeg", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

// Training mode: open the console with ?scenario=qual-1. One session at a time.
let session = null;
async function training(req, url) {
  const name = url.searchParams.get("scenario");
  if (url.pathname === "/v1/training/start") {
    session = startSession(name, Date.now());
    return session ? { scenario: session.name, title: session.title, responses: RESPONSES } : { error: "unknown scenario" };
  }
  if (!session) return { error: "no session" };
  if (url.pathname === "/v1/training/state") return { alerts: visible(session, Date.now()), scorecard: scorecard(session) };
  if (url.pathname === "/v1/training/ack" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let msg = {};
    try {
      msg = JSON.parse(body);
    } catch {
      return { error: "json" };
    }
    return acknowledge(session, String(msg.id), String(msg.action), Date.now());
  }
  if (url.pathname === "/v1/training/scorecard") return scorecard(session);
  return { error: "unknown" };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  if (path.startsWith("/v1/training/")) {
    const out = await training(req, url);
    res.setHeader("X-A2E-Banner", BANNER);
    res.setHeader("content-type", "application/json");
    res.statusCode = out.error ? 400 : 200;
    res.end(JSON.stringify(out));
    return;
  }
  if (path.startsWith("/v1/")) {
    const route = ROUTES[path];
    res.setHeader("X-A2E-Banner", BANNER);
    res.setHeader("content-type", "application/json");
    if (!route) {
      res.statusCode = 200;
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    res.end(JSON.stringify(route()));
    return;
  }
  if (path.startsWith("/demo-assets/")) {
    const asset = normalize(join(ASSETS, path.slice("/demo-assets/".length)));
    try {
      if (!asset.startsWith(ASSETS)) throw new Error("outside");
      const body = await readFile(asset);
      res.setHeader("content-type", TYPES[extname(asset)] ?? "application/octet-stream");
      res.setHeader("cache-control", "max-age=3600");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
  const file = normalize(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.setHeader("content-type", "text/html");
    res.end(await readFile(join(DIST, "index.html")));
  }
}).listen(PORT, () => console.log(`demo console on http://localhost:${PORT}${EXTRA ? ` with ${EXTRA} synthetic vehicles` : ""}`));
