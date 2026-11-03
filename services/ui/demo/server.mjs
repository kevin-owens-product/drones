// A self-contained demo of the operator console: serves the built UI and a
// mock of the API it reads, with a scripted sortie. No database, broker, or
// PX4 needed. The data is synthetic and the console says so in the banner.
//
//   npm run build && node demo/server.mjs   (then open http://localhost:4173)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
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
  { tail: "NX-04", kind: "orbit", x: 300, y: -600, r: 380, v: 18, alt: 90, denied: true },
  { tail: "NX-05", kind: "orbit", x: -1300, y: -700, r: 260, v: 14, alt: 80 },
  { tail: "NX-06", kind: "transit", x: 2600, y: -1500, tx: 900, ty: 200, v: 20, alt: 150, battery: 22 },
  { tail: "NX-07", kind: "orbit", x: 1900, y: -300, r: 200, v: 12, alt: 60, stale: true },
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

function state(c, t, tp) {
  const s = t * (c.v ?? 0);
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
  const lag = c.stale ? 45_000 : 400;
  const pad = c.kind === "pad";
  const acquiring = pad && tp < c.fix;
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
    battery_pct: pad ? c.battery : Math.max(5, (c.battery ?? 88) - t / 90),
    mode: pad ? "PREFLIGHT" : c.mode ?? (c.kind === "transit" ? "RTL" : "MISSION"),
    armed: pad ? false : c.armed ?? true,
    nav_source: acquiring ? "none" : c.denied ? "vio" : "gnss",
    gnss_trusted: acquiring ? undefined : !c.denied,
  };
}

const PLATFORMS = FLEET.map((c, i) => ({
  id: `p${i}`,
  tail_number: c.tail,
  designation: i < 7 || c.kind === "pad" ? "Quad, 7 in, VIO + GNSS" : "Quad, 5 in, GNSS",
  group_size: "Group 1",
  portion_mark: "(U)",
  airworthiness: c.grounded ? "grounded" : c.tail === "NX-08" ? "restricted" : "airworthy",
  airworthiness_reason: c.grounded ?? null,
  classification: "UNCLASSIFIED",
}));

const ROUTES = {
  "/v1/session/config": () => ({ auth_mode: "dev", dev_login: true, system_high: "UNCLASSIFIED", login_url: "" }),
  "/v1/me": () => ({ id: "u1", username: "demo.operator", display_name: "Demo Operator", citizenship: "USA", clearance: "UNCLASSIFIED", ntk_programs: [], roles: ["operator"] }),
  "/v1/platforms": () => ({ items: PLATFORMS }),
  "/v1/telemetry/live": () => {
    // The sortie loops every ten minutes of demo time so it never runs dry.
    const t = ((((Date.now() - T0) / 1000) * SPEED) % 600) + 60;
    const tp = (((Date.now() - T0) / 1000) * SPEED) % PAD_CYCLE;
    const up = FLEET.filter((c) => c.kind !== "pad" || (tp >= c.boot && tp < PAD_DOWN));
    return { items: up.map((c) => state(c, t, tp)), withheld: 0 };
  },
  "/v1/operations/board": () => ({ items: [] }),
  "/v1/session/dev-login": () => ({ ok: true }),
  "/v1/session/logout": () => ({ ok: true }),
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
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
}).listen(PORT, () => console.log(`demo console on http://localhost:${PORT}`));
