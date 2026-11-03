// The demo scenario behind the console: a scripted sortie, its operating
// picture, and training sessions. Pure JavaScript with no Node imports, so the
// same code runs behind demo/server.mjs and, for the hosted static demo, inside
// the browser (src/staticDemo.ts). All data is synthetic and labelled so.
import { createCompany } from "./company.mjs";
import { createOps, NEROS } from "./ops.mjs";
import { plan as planConfig } from "./configure.mjs";
import { nameOf, skuForTail } from "./supply.mjs";
import { denialPicture } from "./denial.mjs";
import { propose } from "./intent.mjs";
import { FLEET_SHARE, fileReport, seedReports, triage } from "./fieldvoice.mjs";
import { ACCOUNTS, birthRecord, birthVerdict, can, createLedger } from "./ledger.mjs";
import { acknowledge, RESPONSES, scorecard, startSession, visible } from "./training.mjs";

export const BANNER = "UNCLASSIFIED // DEMO DATA";

/**
 * @param {{ speed?: number, extra?: number, terrain?: object | null, assetBase?: string, attrition?: object | null }} opts
 * `who` is the signed-in demo account when the caller knows it (the hosted demo does);
 * without it every request is allowed and the actor is whatever the page sent as `by`.
 * @returns {{ handle: (method: string, url: URL, body: string, who?: { display_name: string, roles: string[] } | null) => { status: number, body: unknown } }}
 */
export function createDemo(opts = {}) {
  const SPEED = Number(opts.speed ?? 6);
  const T0 = Date.now();
  const ASSET_BASE = opts.assetBase ?? "/demo-assets/";

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
  const EXTRA = Math.max(0, Math.min(2000, Number(opts.extra ?? 0) | 0));
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
    sku: skuForTail(c.tail),
    designation: `${nameOf(skuForTail(c.tail))}${c.swarm ? " (synthetic)" : ""}`,
    group_size: "Group 1",
    portion_mark: "(U)",
    airworthiness: c.grounded ? "grounded" : c.tail === "NX-08" ? "restricted" : "airworthy",
    airworthiness_reason: c.grounded ?? (c.tail === "NX-08" ? "Prop strike on recovery; hover check before next sortie" : null),
    classification: "UNCLASSIFIED",
    // The named tails are Customer A's fleet (SIM); synthetic ones belong to no one.
    owner: c.swarm ? null : "CUS-A",
  }));

  // Factory birth records for the named tails, and the audit log. The log opens
  // with the two airworthiness calls the scenario starts with, then records
  // every proposal, approval, hold and field report made this session.
  const FRAME_LOT = { "ARCHER-5": "FR-2609", "ARCHER-8": "FR-2604", "ARCHER-10": "FR-2607" };
  const BIRTH = FLEET.map((c, i) => {
    const rec = birthRecord(c.tail, i, c.grounded);
    const sku = skuForTail(c.tail);
    // Frames and motors differ by model, so their lots follow the model (see LOTS in supply.mjs).
    rec.parts = rec.parts.map((p) => (p.part === "frame" ? { ...p, lot: FRAME_LOT[sku] } : p.part === "motor" && sku === "ARCHER-5" ? { ...p, lot: "MT-1201" } : p));
    return { ...rec, sku, verdict: birthVerdict(rec) };
  });
  // The company view: orders, production, supply chain, logistics, sustainment
  // and training around the same serials (demo/company.mjs).
  const company = createCompany({ births: BIRTH });
  const audit = createLedger();
  const opened = T0 - 40 * 60_000;
  audit.append({ actor: "EOL bench 2", action: "platform.ground", resource_type: "platform", resource_id: "NX-12", reason_codes: ["birth_record"], detail: "EOL hover test failed: IMU cal out of range", at: opened });
  audit.append({ actor: "Demo Maintainer", action: "platform.restrict", resource_type: "platform", resource_id: "NX-08", reason_codes: ["maintenance"], detail: "Prop strike on recovery; hover check before next sortie", at: opened + 9 * 60_000 });
  audit.append({ actor: "Demo Operator", action: "mission.approve", resource_type: "mission", resource_id: "Survey grid north", decision: "deny", reason_codes: ["role_denied"], at: opened + 18 * 60_000 });
  audit.append({ actor: "Demo Mission Commander", action: "mission.approve", resource_type: "mission", resource_id: "Survey grid north", detail: "Nine vehicles, survey and overwatch", at: opened + 22 * 60_000 });

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

  const meta = opts.terrain ?? null;
    const TERRAIN = meta
      ? {
          url: `${ASSET_BASE}terrain.jpg`,
          heightmap: meta.heightmap ? `${ASSET_BASE}${meta.heightmap}` : undefined,
          elevation_m: meta.elevation_m,
          south: meta.south,
          west: meta.west,
          north: meta.north,
          east: meta.east,
          attribution: meta.attribution,
        }
      : null;

    const ROUTES = {
    "/v1/session/config": () => ({ auth_mode: "dev", dev_login: true, system_high: "UNCLASSIFIED", login_url: "" }),
    // The local demo server has no sign-in and no org, so every page shows (both workspaces at once).
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
    "/v1/users": () => ({ items: ACCOUNTS }),
    "/v1/birth-records": () => ({ items: BIRTH }),
    "/v1/audit": () => ({ items: audit.items() }),
    "/v1/session/dev-login": () => ({ ok: true }),
    "/v1/session/logout": () => ({ ok: true }),
  };

  // Attrition intelligence: the report baked by `python -m a2e.attrition.report`
  // (seeded, simulated). A hold is a fleet record kept in memory; it commands nothing.
  const holds = [];
  function attrition(method, url, raw) {
    if (!opts.attrition) return { status: 404, body: { error: "attrition report not baked" } };
    if (url.pathname === "/v1/attrition") return { status: 200, body: { ...opts.attrition, holds } };
    if (url.pathname === "/v1/attrition/hold" && method === "POST") {
      let msg = {};
      try {
        msg = JSON.parse(raw);
      } catch {
        return { status: 400, body: { error: "json" } };
      }
      const alert = opts.attrition.autopsy.alerts.find((a) => a.attribute === msg.attribute && a.value === msg.value);
      if (!alert) return { status: 404, body: { error: "no such alert" } };
      const actor = caller?.display_name ?? String(msg.by ?? "operator");
      if (caller && !can(caller.roles, "fleet.write")) {
        audit.append({ actor, action: "attrition.hold", resource_type: "lot", resource_id: alert.value, decision: "deny", reason_codes: ["role_denied"] });
        return { status: 403, body: { detail: "Holding a lot needs the maintainer, mission commander or admin role." } };
      }
      if (!holds.some((h) => h.attribute === alert.attribute && h.value === alert.value)) {
        audit.append({ actor, action: "attrition.hold", resource_type: "lot", resource_id: alert.value, detail: `${alert.in_service_count} airframes in service held for inspection` });
      }
      if (!holds.some((h) => h.attribute === alert.attribute && h.value === alert.value)) {
        holds.push({ attribute: alert.attribute, value: alert.value, serials: alert.in_service_count, by: actor, at: new Date().toISOString() });
      }
      return { status: 200, body: { holds } };
    }
    return { status: 404, body: { error: "unknown" } };
  }

  // Field reports: seeded notes plus whatever the operator files this session.
  const reports = seedReports();
  function fieldReports(method, raw) {
    if (method === "POST") {
      let msg = {};
      try {
        msg = JSON.parse(raw);
      } catch {
        return { status: 400, body: { error: "json" } };
      }
      if (caller) msg.by = caller.display_name;
      const out = fileReport(reports, msg);
      if (!out.error) audit.append({ actor: out.by, action: "field_report.file", resource_type: "field_report", resource_id: out.id, detail: `${out.tail}: ${out.text.slice(0, 80)}` });
      return { status: out.error ? 400 : 200, body: out };
    }
    return {
      status: 200,
      body: {
        source: "Demo scenario (simulated): seeded reports plus any filed in this session",
        fleet_share: FLEET_SHARE,
        items: [...reports].sort((a, b) => b.at.localeCompare(a.at)),
        triage: triage(reports, FLEET_SHARE),
      },
    };
  }

  // Intent to plan: proposals wait for a person; approval files a draft for the
  // mission planner and commands nothing.
  const proposals = [];
  function briefFleet() {
    return FLEET.map((c) => {
      const x = c.kind === "lawnmower" ? c.x + c.w / 2 : c.x;
      const y = c.kind === "lawnmower" ? c.y - c.h / 2 : c.y;
      if (c.grounded) return { tail: c.tail, x, y, available: false, why: `Grounded: ${c.grounded}` };
      const battery = c.battery ?? 88;
      if (battery < 50) return { tail: c.tail, x, y, available: false, why: `Battery ${battery}%` };
      return { tail: c.tail, x, y, available: true };
    });
  }
  function intent(method, url, raw) {
    if (method !== "POST") return { status: 200, body: { items: proposals.slice().reverse() } };
    let msg = {};
    try {
      msg = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: "json" } };
    }
    if (url.pathname === "/v1/intent/propose") {
      const p = propose(String(msg.brief ?? "").slice(0, 600), briefFleet());
      proposals.push(p);
      audit.append({ actor: caller?.display_name ?? "operator", action: "brief.propose", resource_type: "proposal", resource_id: p.id, detail: String(msg.brief ?? "").slice(0, 80) });
      return { status: 200, body: p };
    }
    if (url.pathname === "/v1/intent/approve") {
      const p = proposals.find((x) => x.id === msg.id);
      if (!p) return { status: 404, body: { error: "no such proposal" } };
      if (p.status !== "awaiting approval") return { status: 409, body: { error: `proposal is ${p.status}` } };
      const action = msg.decision === "reject" ? "brief.reject" : "brief.approve";
      const actor = caller?.display_name ?? String(msg.by ?? "operator");
      if (caller && !can(caller.roles, "mission.approve")) {
        audit.append({ actor, action, resource_type: "proposal", resource_id: p.id, decision: "deny", reason_codes: ["role_denied"] });
        return { status: 403, body: { detail: "Approving or rejecting a plan needs the mission commander or admin role." } };
      }
      p.status = msg.decision === "reject" ? "rejected" : "approved";
      p.decided_by = actor;
      audit.append({ actor, action, resource_type: "proposal", resource_id: p.id, detail: p.status === "approved" ? "Filed as a draft for mission review; nothing sent to a vehicle" : "" });
      p.decided_at = new Date().toISOString();
      return { status: 200, body: p };
    }
    return { status: 404, body: { error: "unknown" } };
  }

  // Training mode: open the console with ?scenario=qual-1. One session at a time.
  let session = null;
  function training(method, url, raw) {
    const name = url.searchParams.get("scenario");
    if (url.pathname === "/v1/training/start") {
      session = startSession(name, Date.now());
      return session ? { scenario: session.name, title: session.title, responses: RESPONSES } : { error: "unknown scenario" };
    }
    if (!session) return { error: "no session" };
    if (url.pathname === "/v1/training/state") return { alerts: visible(session, Date.now()), scorecard: scorecard(session) };
    if (url.pathname === "/v1/training/ack" && method === "POST") {
      let msg = {};
      try {
        msg = JSON.parse(raw);
      } catch {
        return { error: "json" };
      }
      return acknowledge(session, String(msg.id), String(msg.action), Date.now());
    }
    if (url.pathname === "/v1/training/scorecard") return scorecard(session);
    return { error: "unknown" };
  }

  function companyRoute(method, url, raw) {
    const ctx = { holds, demand: opts.attrition?.demand ?? null, platforms: PLATFORMS };
    if (method === "GET" && url.pathname === "/v1/company") return { status: 200, body: company.overview(ctx) };
    if (method === "GET" && url.pathname === "/v1/company/thread") {
      const snap = company.overview(ctx);
      const out = company.thread(String(url.searchParams.get("tail") ?? ""), snap, PLATFORMS);
      return out ? { status: 200, body: out } : { status: 404, body: { error: "no birth record for that tail" } };
    }
    if (method !== "POST") return { status: 404, body: { error: "unknown" } };
    let msg = {};
    try {
      msg = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: "json" } };
    }
    const actor = caller?.display_name ?? String(msg.by ?? "operator");
    const action = url.pathname === "/v1/company/ship" ? "kit.ship" : url.pathname === "/v1/company/work-orders/close" ? "work_order.close" : null;
    if (!action) return { status: 404, body: { error: "unknown" } };
    const resource = String(msg.plan ?? msg.id ?? "");
    if (caller && !can(caller.roles, "fleet.write") && !caller.roles.includes("ops_lead")) {
      audit.append({ actor, action, resource_type: action === "kit.ship" ? "kit" : "work_order", resource_id: resource, decision: "deny", reason_codes: ["role_denied"] });
      return { status: 403, body: { detail: "This needs the maintainer, mission commander or admin role." } };
    }
    if (action === "kit.ship") {
      const out = company.ship(resource, ctx.demand, holds, actor);
      if (out.error) return { status: out.status, body: { detail: out.error } };
      const s = out.shipment;
      audit.append({ actor, action, resource_type: "kit", resource_id: s.id, detail: `${s.qty} ${nameOf(s.sku)} to ${s.unit} now, ${s.build_order} released to the line${s.dg ? "; lithium packs ship as dangerous goods" : ""}` });
      return { status: 200, body: out };
    }
    const out = company.closeWorkOrder(resource, holds, actor);
    if (out.error) return { status: out.status, body: { detail: out.error } };
    const wo = out.work_order;
    audit.append({ actor, action, resource_type: "work_order", resource_id: wo.id, detail: `${wo.tail}: ${wo.issued.map((x) => `${x.qty} ${x.pn} from ${x.lot}`).join(", ") || "no parts"}` });
    const platform = PLATFORMS.find((p) => p.tail_number === wo.tail);
    if (wo.returns_to_service && platform && platform.airworthiness !== "grounded") {
      platform.airworthiness = "airworthy";
      platform.airworthiness_reason = null;
      audit.append({ actor, action: "platform.return_to_service", resource_type: "platform", resource_id: wo.tail, reason_codes: ["maintenance"], detail: `${wo.id} closed` });
    }
    return { status: 200, body: out };
  }

  // Two workspaces: the Neros operations queue and each customer's portal (demo/ops.mjs).
  const ops = createOps({ company, audit, platforms: PLATFORMS });
  function opsRoute(method, url, raw) {
    const ctx = { holds, demand: opts.attrition?.demand ?? null, platforms: PLATFORMS };
    const viewer = caller ? { ...caller, org: caller.org ?? NEROS.id } : null;
    if (method === "GET" && url.pathname === "/v1/ops/queue") {
      if (viewer && viewer.org !== NEROS.id) return { status: 403, body: { detail: "The operations queue is Neros's own workspace." } };
      return { status: 200, body: ops.queue(ctx) };
    }
    if (method === "GET" && url.pathname === "/v1/ops/portal") {
      // Neros staff can open any customer's portal to see what the customer sees; customers only their own.
      const asked = url.searchParams.get("org");
      const org = viewer && viewer.org !== NEROS.id ? viewer.org : asked ?? "CUS-A";
      const out = ops.portal(org, ctx);
      return out ? { status: 200, body: out } : { status: 404, body: { detail: "no such customer" } };
    }
    if (method === "POST" && url.pathname === "/v1/ops/act") {
      let msg = {};
      try {
        msg = JSON.parse(raw);
      } catch {
        return { status: 400, body: { error: "json" } };
      }
      return ops.act(viewer, String(msg.action ?? ""), msg.args ?? {}, ctx);
    }
    return { status: 404, body: { error: "unknown" } };
  }

  let caller = null;
  return {
    extra: EXTRA,
    handle(method, url, raw = "", who = null) {
      caller = who;
      if (url.pathname === "/v1/audit" && caller && !can(caller.roles, "audit.read")) return { status: 403, body: { detail: "role_denied" } };
      const customer = caller?.org && caller.org !== NEROS.id;
      // Neros internals stay out of customer workspaces.
      if (customer && (url.pathname.startsWith("/v1/company") || url.pathname === "/v1/ops/queue")) return { status: 403, body: { detail: "That is Neros's own workspace." } };
      // Loss data is the customer's. Neros sees it only while Customer A shares it.
      if (url.pathname.startsWith("/v1/attrition") && caller && !customer && !ops.sharing["CUS-A"]) return { status: 403, body: { detail: "Customer A has turned off sharing of loss data with Neros." } };
      if (url.pathname.startsWith("/v1/attrition")) return attrition(method, url, raw);
      if (url.pathname === "/v1/field-reports") return fieldReports(method, raw);
      if (url.pathname.startsWith("/v1/company")) return companyRoute(method, url, raw);
      if (url.pathname.startsWith("/v1/ops/")) return opsRoute(method, url, raw);
      if (url.pathname === "/v1/maintenance") {
        const items = company.openWorkOrders(holds).filter((w) => w.status === "open").map((w) => ({ id: w.id, tail_number: w.tail, summary: w.summary, status: "open" }));
        return { status: 200, body: { items } };
      }
      if (url.pathname.startsWith("/v1/intent")) return intent(method, url, raw);
      if (url.pathname === "/v1/configure") {
        const q = url.searchParams;
        const num = (k, d) => (Number.isFinite(Number(q.get(k))) && q.get(k) !== null ? Number(q.get(k)) : d);
        const jam = ["none", "light", "heavy"].includes(q.get("jamming") ?? "") ? q.get("jamming") : "none";
        return { status: 200, body: planConfig({ range_km: num("range_km", 3), wind_mps: num("wind_mps", 4), temp_c: num("temp_c", 20), loiter_min: num("loiter_min", 5), jamming: jam }) };
      }
      if (url.pathname === "/v1/denial-map") return { status: 200, body: denialPicture(Number(url.searchParams.get("passes") ?? 4)) };
      if (url.pathname.startsWith("/v1/training/")) {
        const out = training(method, url, raw);
        return { status: out.error ? 400 : 200, body: out };
      }
      const route = ROUTES[url.pathname];
      return { status: 200, body: route ? route() : { items: [] } };
    },
  };
}
