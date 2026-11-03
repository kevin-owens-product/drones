// Mission plans for the demo: a seeded board (draft, review, approved, active,
// closed), launch checks, the approval chain with the two-person rule, and a
// replayable debrief for every plan that has flown. Pure JavaScript, no Node
// imports, so it runs behind demo/server.mjs and inside the hosted static demo.
//
// Everything here is simulated and labelled so. Plans survey, observe, relay and
// inspect; nothing arms, releases or engages (ADR-0016). Moving a plan only
// changes its state on the board and writes the audit log: no vehicle is
// commanded from here.

const MIN = 60_000;
const SIM = "Simulated replay (SIM): scripted plan flown by the demo kinematics, not a field log.";

/** Speeds by model, m/s. Assumptions for the demo, not measured. */
const CRUISE = { "ARCHER-5": 14, "ARCHER-8": 16, "ARCHER-10": 15 };
/** Battery used per minute airborne, percent. Assumption. */
const DRAIN = { "ARCHER-5": 2.4, "ARCHER-8": 1.9, "ARCHER-10": 1.7 };

export const TEAM = { id: "11111111-1111-4111-8111-111111111104", level: "team", name: "Team North (SIM)" };

/**
 * @param {object} o
 * @param {(x: number, y: number) => [number, number]} o.toLL local metres to lat/lon
 * @param {(lat: number, lon: number) => [number, number]} o.fromLL lat/lon to local metres
 * @param {{x: number, y: number}} o.station ground station, local metres
 * @param {{x: number, y: number, r: number}} o.jamming the scenario's GNSS jamming zone
 * @param {object[]} o.places named places (demo/intent.mjs PLACES)
 * @param {object[]} o.platforms the fleet register
 * @param {Record<string, number>} o.padBattery battery of vehicles on the pad
 * @param {() => Map<string, string>} o.heldTails tail -> held lot, from the attrition holds
 * @param {Record<string, {lot: string, ratio: number}>} o.watchTails tail -> flagged lot not yet held
 * @param {(tail: string) => string} o.skuForTail
 * @param {{append: Function}} o.audit
 * @param {(roles: string[], perm: string) => boolean} o.can
 * @param {object | null} o.basemap terrain image and its bounds in lat/lon
 * @param {number} [o.now]
 */
export function createMissions(o) {
  const NOW = o.now ?? Date.now();
  const place = (id) => o.places.find((p) => p.id === id);
  const ll = (x, y) => o.toLL(x, y).map((v) => Number(v.toFixed(6)));
  const J = o.jamming;
  const S = o.station;

  // ---- seed --------------------------------------------------------------
  // Objectives name a place; the store keeps lat/lon like the real API does.
  function obj(kind, where, tail, offset, duration, alt = 110) {
    const p = typeof where === "string" ? place(where) : where;
    const [lat, lon] = kind === "rtb" ? ll(S.x, S.y) : ll(p.x, p.y);
    const label = kind === "rtb" ? "Recover at GCS" : p.label;
    return { kind, label, tail, lat, lon, alt_m: kind === "rtb" ? 0 : alt, offset_min: offset, duration_min: duration };
  }
  const step = (action, by, minsAgo, note = "") => ({ action, by, at: new Date(NOW - minsAgo * MIN).toISOString(), note });

  const missions = [
    {
      id: "M-1031",
      name: "Survey grid north",
      summary: "Eight-vehicle survey of Areas A to D with overwatch on the road junction, a ridge relay and a look at Gate 3. NX-04 works inside the jamming zone on VIO.",
      state: "active",
      created_by: "Demo Planner",
      planned_start: NOW - 15 * MIN,
      operators: 2,
      history: [
        step("mission.draft", "Demo Planner", 55),
        step("mission.review", "Demo Planner", 45, "Sent for review with launch checks green"),
        step("mission.approve", "Demo Operator", 22, "Refused: operators cannot approve (role)"),
        step("mission.approve", "Demo Mission Commander", 18, "Eight vehicles, survey and overwatch"),
        step("mission.execute", "Demo Operator", 15, "Launched from the GCS pad"),
      ],
      objectives: [
        obj("search", "A", "NX-01", 0, 24),
        obj("rtb", null, "NX-01", 26, 4),
        obj("search", "B", "NX-02", 1, 24),
        obj("rtb", null, "NX-02", 27, 4),
        obj("search", "C", "NX-03", 2, 24),
        obj("rtb", null, "NX-03", 28, 4),
        obj("search", "D", "NX-09", 1, 20, 100),
        obj("rtb", null, "NX-09", 23, 4),
        obj("loiter", "T4", "NX-04", 2, 20, 90),
        obj("rtb", null, "NX-04", 24, 5),
        obj("loiter", "T3", "NX-05", 1, 26, 140),
        obj("rtb", null, "NX-05", 28, 4),
        obj("loiter", "T2", "NX-07", 3, 20, 70),
        obj("rtb", null, "NX-07", 25, 5),
        obj("transit", "T1", "NX-06", 2, 6, 150),
        obj("rtb", null, "NX-06", 10, 6),
      ],
      keepouts: [],
      incidents: {
        "NX-07": { linkGaps: [[410, 650]] },
        "NX-06": { abort: { t: 470, why: "Battery 22% at the culvert, below the 25% return reserve. Returned on RTL." } },
      },
      scripted: [
        { t: 455, tail: "NX-05", kind: "replan", severity: "info", label: "CBBA re-plan: Gate 3 watch moved from NX-07 to NX-05 while NX-07 is off the link. Consensus in 3 rounds." },
        { t: 520, tail: "NX-07", kind: "operator", severity: "info", label: "Operator acknowledged the NX-07 link alert; vehicle continues its last plan on its own." },
        { t: 700, tail: "NX-04", kind: "report", severity: "info", label: "Field report filed: \"VIO jumps ~10 m when GNSS comes back near the junction\"", link: "#reports" },
      ],
    },
    {
      id: "M-1032",
      name: "Culvert and Gate 3 check",
      summary: "Inspect the culvert after last night's rain, then hold on Gate 3 for fifteen minutes. Two vehicles, one person flying.",
      state: "approved",
      created_by: "Demo Planner",
      planned_start: NOW + 40 * MIN,
      operators: 1,
      history: [
        step("mission.draft", "Demo Planner", 190),
        step("mission.review", "Demo Planner", 160),
        step("mission.approve", "Demo Mission Commander", 120, "Approved; check NX-05 ESC lot before launch"),
      ],
      objectives: [
        obj("transit", "T1", "NX-05", 0, 8, 60),
        obj("loiter", "T2", "NX-05", 10, 15, 80),
        obj("rtb", null, "NX-05", 26, 4),
        obj("loiter", "T2", "NX-07", 2, 15, 70),
        obj("rtb", null, "NX-07", 18, 4),
      ],
      keepouts: [{ name: "Water tank access road", lat: ll(1900, -300)[0], lon: ll(1900, -300)[1], radius_km: 0.15, floor_m: 0, ceiling_m: 60 }],
    },
    {
      id: "M-1033",
      name: "Ridge relay under GNSS denial (rehearsal)",
      summary: "Rehearse holding the ridge relay when the transit crosses the jamming zone. NX-04 flies through J1 on VIO; NX-09 holds the relay on GNSS.",
      state: "review",
      created_by: "Demo Planner",
      planned_start: NOW + 3 * 60 * MIN,
      operators: 1,
      history: [step("mission.draft", "Demo Planner", 70), step("mission.review", "Demo Planner", 60, "Needs a commander: crosses the jamming zone")],
      objectives: [
        obj("transit", "T4", "NX-04", 0, 4, 90),
        obj("loiter", "T3", "NX-04", 6, 20, 140),
        obj("rtb", null, "NX-04", 27, 4),
        obj("loiter", "T3", "NX-09", 0, 25, 140),
        obj("rtb", null, "NX-09", 26, 4),
      ],
      keepouts: [],
    },
    {
      id: "M-1034",
      name: "Road junction overwatch, second shift",
      summary: "Relieve the junction overwatch with the three vehicles on the pad and re-survey Area B.",
      state: "draft",
      created_by: "Demo Mission Commander",
      planned_start: null,
      operators: 1,
      history: [step("mission.draft", "Demo Mission Commander", 25)],
      objectives: [
        obj("loiter", "T4", "NX-10", 0, 30, 90),
        obj("rtb", null, "NX-10", 31, 4),
        obj("loiter", "T4", "NX-11", 0, 30, 90),
        obj("rtb", null, "NX-11", 31, 4),
        obj("search", "B", "NX-12", 0, 20),
        obj("rtb", null, "NX-12", 21, 4),
      ],
      keepouts: [],
    },
    {
      id: "M-1029",
      name: "Night survey, Area A and west pasture",
      summary: "Night survey at 8 °C. NX-07 lost the link for four minutes, NX-11 came home early on a sagging pack, and NX-08 struck a prop on recovery.",
      state: "closed",
      created_by: "Demo Planner",
      planned_start: NOW - 2 * 24 * 60 * MIN - 5 * 60 * MIN,
      operators: 2,
      history: [
        step("mission.draft", "Demo Planner", 2 * 24 * 60 + 9 * 60),
        step("mission.review", "Demo Planner", 2 * 24 * 60 + 8 * 60),
        step("mission.approve", "Demo Mission Commander", 2 * 24 * 60 + 6 * 60),
        step("mission.execute", "Demo Operator", 2 * 24 * 60 + 5 * 60),
        step("mission.close", "Demo Operator", 2 * 24 * 60 + 4 * 60, "Debriefed; NX-08 to maintenance"),
      ],
      objectives: [
        obj("search", "A", "NX-01", 0, 22),
        obj("rtb", null, "NX-01", 24, 4),
        obj("search", "A", "NX-02", 1, 22),
        obj("rtb", null, "NX-02", 25, 4),
        obj("search", "D", "NX-09", 0, 22, 100),
        obj("rtb", null, "NX-09", 24, 4),
        obj("loiter", "T3", "NX-07", 1, 24, 140),
        obj("rtb", null, "NX-07", 26, 4),
        obj("search", "D", "NX-11", 2, 20, 100),
        obj("rtb", null, "NX-11", 23, 4),
        obj("loiter", "T2", "NX-08", 2, 22, 70),
        obj("rtb", null, "NX-08", 25, 4),
      ],
      keepouts: [],
      incidents: {
        "NX-07": { linkGaps: [[620, 860]] },
        "NX-11": { abort: { t: 760, why: "Pack sagged to 3.41 V/cell at 8 °C; returned with 31% showing. Configure predicted 19 min at this temperature." } },
        "NX-08": { hardLanding: "Hard landing on recovery: 2.6 g at touchdown, prop 3 struck the pad edge." },
      },
      scripted: [
        { t: 640, tail: "NX-09", kind: "replan", severity: "info", label: "CBBA re-plan: ridge relay handed to NX-09 while NX-07 was off the link." },
        { t: 780, tail: "NX-11", kind: "operator", severity: "warn", label: "Operator approved early return for NX-11; Area D coverage finished by NX-09." },
        { t: 2080, tail: "NX-08", kind: "report", severity: "warn", label: "Maintainer restricted NX-08: hover check before next sortie.", link: "#fleet" },
      ],
    },
    {
      id: "M-1027",
      name: "GNSS-denied trial 3",
      summary: "Fly NX-04 through the jamming zone to the culvert and back on VIO; NX-05 holds the ridge relay. Measures VIO error at the GNSS handover.",
      state: "closed",
      created_by: "Demo Planner",
      planned_start: NOW - 5 * 24 * 60 * MIN - 3 * 60 * MIN,
      operators: 1,
      history: [
        step("mission.draft", "Demo Planner", 5 * 24 * 60 + 6 * 60),
        step("mission.review", "Demo Planner", 5 * 24 * 60 + 5 * 60),
        step("mission.approve", "Demo Mission Commander", 5 * 24 * 60 + 4 * 60),
        step("mission.execute", "Demo Operator", 5 * 24 * 60 + 3 * 60),
        step("mission.close", "Demo Operator", 5 * 24 * 60 + 2 * 60),
      ],
      objectives: [
        obj("loiter", "T1", "NX-04", 0, 8, 90),
        obj("loiter", "T4", "NX-04", 12, 8, 90),
        obj("rtb", null, "NX-04", 22, 5),
        obj("loiter", "T3", "NX-05", 0, 24, 140),
        obj("rtb", null, "NX-05", 25, 4),
      ],
      keepouts: [],
      scripted: [{ t: 300, tail: "NX-04", kind: "operator", severity: "info", label: "Operator marked the VIO handover for the denial map." }],
    },
    {
      id: "M-1024",
      name: "Culvert bridge inspection, Bravo",
      summary: "Bravo's three Archer 5s inspected the culvert bridge and the junction. BR-28 was lost to an ESC desync; its ESC lot is the one the attrition autopsy later flagged.",
      state: "closed",
      created_by: "Bravo planner (SIM)",
      planned_start: NOW - 8 * 24 * 60 * MIN - 2 * 60 * MIN,
      operators: 1,
      history: [
        step("mission.draft", "Bravo planner (SIM)", 8 * 24 * 60 + 6 * 60),
        step("mission.review", "Bravo planner (SIM)", 8 * 24 * 60 + 5 * 60),
        step("mission.approve", "Demo Mission Commander", 8 * 24 * 60 + 3 * 60),
        step("mission.execute", "Bravo operator (SIM)", 8 * 24 * 60 + 2 * 60),
        step("mission.close", "Bravo operator (SIM)", 8 * 24 * 60 + 60, "Loss reported; airframe recovered for autopsy"),
      ],
      objectives: [
        obj("loiter", "T1", "BR-23", 0, 14, 50),
        obj("rtb", null, "BR-23", 16, 5),
        obj("loiter", "T1", "BR-28", 1, 14, 50),
        obj("rtb", null, "BR-28", 17, 5),
        obj("search", "C", "BR-46", 0, 16),
        obj("rtb", null, "BR-46", 18, 5),
      ],
      keepouts: [],
      incidents: { "BR-28": { lost: { t: 640, why: "ESC desync on motor 3, uncommanded yaw, descended into the creek bed. ESC lot ESC-2611." } } },
      scripted: [
        { t: 660, tail: "BR-23", kind: "operator", severity: "warn", label: "Operator marked the last known position of BR-28 and continued the inspection with BR-23." },
        { t: 1300, tail: "BR-28", kind: "report", severity: "warn", label: "Autopsy: ESC-2611 losses run at 2.1x the fleet baseline (p = 0.003). See Attrition.", link: "#attrition" },
      ],
    },
  ];
  const SKU = { "BR-23": "ARCHER-5", "BR-28": "ARCHER-5", "BR-46": "ARCHER-5" };
  const skuOf = (tail) => SKU[tail] ?? o.skuForTail(tail);
  let nextId = 1036;

  // ---- reads --------------------------------------------------------------
  const tailsOf = (m) => [...new Set(m.objectives.map((x) => x.tail).filter(Boolean))];
  const lastBy = (m, action) => [...m.history].reverse().find((h) => h.action === action && !h.note.startsWith("Refused"));

  function row(m) {
    const ready = m.state === "closed" || m.state === "active" ? null : readiness(m);
    return {
      id: m.id,
      name: m.name,
      summary: m.summary,
      state: m.state,
      tenant_id: TEAM.id,
      classification: "UNCLASSIFIED",
      portion_mark: "(U) SIM",
      tails: tailsOf(m),
      planned_start: m.planned_start ? new Date(m.planned_start).toISOString() : null,
      created_by: m.created_by,
      approved_by: lastBy(m, "mission.approve")?.by ?? null,
      objective_count: m.objectives.length,
      go: ready ? ready.go : null,
      no_go: ready ? ready.checks.filter((c) => c.level === "no-go").length : 0,
      cautions: ready ? ready.checks.filter((c) => c.level === "caution").length : 0,
      source: m.source ?? null,
      sim: true,
    };
  }

  function inJamming(x, y) {
    return Math.hypot(x - J.x, y - J.y) <= J.r;
  }

  /** Length of a straight leg that lies inside the jamming circle, metres. */
  function deniedLength(a, b) {
    const n = 40;
    let inside = 0;
    for (let i = 0; i < n; i += 1) {
      const f = (i + 0.5) / n;
      if (inJamming(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)) inside += 1;
    }
    return (Math.hypot(b[0] - a[0], b[1] - a[1]) * inside) / n;
  }

  function readiness(m) {
    const checks = [];
    const add = (level, detail) => checks.push({ pass: level !== "no-go", level, detail });
    const tails = tailsOf(m);
    const held = o.heldTails();
    if (tails.length === 0) add("no-go", "The package has no aircraft.");
    for (const tail of tails) {
      const p = o.platforms.find((x) => x.tail_number === tail);
      if (!p) {
        add(m.state === "closed" ? "go" : "no-go", `${tail} is not on this range's register${m.state === "closed" ? " (unit airframe, flown under its own register)" : ""}.`);
        continue;
      }
      if (p.airworthiness === "grounded") add("no-go", `${tail} grounded: ${p.airworthiness_reason}`);
      else if (p.airworthiness === "restricted") add("no-go", `${tail} restricted: ${p.airworthiness_reason}`);
      else if (held.has(tail)) add("no-go", `${tail} carries held lot ${held.get(tail)}. Released from Attrition or swapped before launch.`);
      else if (o.watchTails[tail]) add("caution", `${tail} carries lot ${o.watchTails[tail].lot}, flagged by the attrition autopsy at ${o.watchTails[tail].ratio}x the loss baseline and not held.`);
      else add("go", `${tail} airworthy (${p.designation}).`);
      const pad = o.padBattery[tail];
      if (pad !== undefined && pad < 50) add("no-go", `${tail} battery ${pad}% at last report on the pad; needs 50% to launch.`);
    }
    for (const tail of tails) {
      const legs = m.objectives.filter((x) => x.tail === tail);
      if (legs.at(-1)?.kind !== "rtb") add("no-go", `${tail} has no recovery leg.`);
    }
    if (!m.planned_start) add("no-go", "No H-hour set.");
    // VIO exposure: fly the plan through the same kinematics the debrief uses.
    for (const tail of tails) {
      const { inside, drift } = exposure(m, tail);
      if (inside > 50) add("caution", `${tail} flies ~${(inside / 1000).toFixed(1)} km inside the GNSS jamming zone on VIO; expect up to ${Math.round(drift)} m position error before GNSS returns (assumed 1% of distance).`);
    }
    for (const k of m.keepouts) add("go", `Keep-out "${k.name}" loaded (${k.radius_km} km, ${k.floor_m}-${k.ceiling_m} m).`);
    const drafter = m.created_by;
    if (m.state === "review") add("go", `Two-person rule: drafted by ${drafter}; someone else approves.`);
    add("go", "Payload: sensors only. No release or arming path exists (ADR-0016).");
    return { go: !checks.some((c) => c.level === "no-go"), checks };
  }

  function exposure(m, tail) {
    const { segs, end } = segments(m, tail, 0);
    let inside = 0;
    let run = 0;
    let drift = 0;
    let prev = null;
    for (let t = 0; t <= end; t += 5) {
      const p = sample(segs, t);
      if (inJamming(p[0], p[1])) {
        const d = prev ? Math.hypot(p[0] - prev[0], p[1] - prev[1]) : 0;
        inside += d;
        run += d;
        drift = Math.max(drift, 1.5 + 0.01 * run);
      } else run = 0;
      prev = p;
    }
    return { inside, drift };
  }

  // ---- debrief: deterministic replay --------------------------------------
  function polyAt(pts, d) {
    let left = d;
    for (let i = 1; i < pts.length; i += 1) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (left <= len) return [x0 + ((x1 - x0) * left) / (len || 1), y0 + ((y1 - y0) * left) / (len || 1)];
      left -= len;
    }
    return pts.at(-1);
  }
  const polyLen = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

  function workPath(kind, [cx, cy]) {
    if (kind === "search") {
      const w = 720;
      const h = 440;
      const legs = 5;
      const pts = [];
      for (let i = 0; i < legs; i += 1) {
        const y = cy + h / 2 - (i * h) / (legs - 1);
        pts.push(i % 2 ? [cx + w / 2, y] : [cx - w / 2, y], i % 2 ? [cx - w / 2, y] : [cx + w / 2, y]);
      }
      return [...pts, ...pts.slice().reverse()];
    }
    const r = kind === "transit" ? 60 : 220;
    return Array.from({ length: 33 }, (_, k) => [cx + r * Math.cos((k / 32) * Math.PI * 2), cy + r * Math.sin((k / 32) * Math.PI * 2)]);
  }

  /** Build each tail's flown path as segments: transit then work, ending in recovery. */
  function segments(m, tail, launchAt) {
    const sku = skuOf(tail);
    const v = CRUISE[sku] ?? 15;
    const segs = [];
    let at = [S.x, S.y];
    let t = launchAt;
    for (const x of m.objectives.filter((q) => q.tail === tail)) {
      const goal = x.kind === "rtb" ? [S.x, S.y] : o.fromLL(x.lat, x.lon);
      const work = x.kind === "rtb" ? null : workPath(x.kind, goal);
      const entry = work ? work[0] : goal;
      const dur = Math.hypot(entry[0] - at[0], entry[1] - at[1]) / v;
      segs.push({ t0: t, t1: t + dur, pts: [at, entry], phase: x.kind === "rtb" ? "recover" : "transit", alt: x.kind === "rtb" ? 60 : x.alt_m, label: x.label });
      t += dur;
      if (work) {
        const wdur = x.duration_min * 60;
        segs.push({ t0: t, t1: t + wdur, pts: work, loop: true, v, phase: x.kind, alt: x.alt_m, label: x.label });
        t += wdur;
        at = work.at(-1);
      } else {
        at = goal;
      }
    }
    return { segs, end: t, sku, v };
  }

  function debrief(m) {
    if (m.state !== "active" && m.state !== "closed") return null;
    const tails = tailsOf(m);
    const inc = m.incidents ?? {};
    const elapsed = m.state === "active" ? Math.max(60, (Date.now() - m.planned_start) / 1000) : Infinity;
    const DT = 5;
    const tracks = [];
    const events = [];
    const ev = (t, tail, kind, severity, label, link) => events.push({ t_s: Math.round(t), tail, kind, severity, label, ...(link ? { link } : {}) });

    tails.forEach((tail, i) => {
      const launch = i * 20;
      let { segs, end, sku, v } = segments(m, tail, launch);
      const x = inc[tail] ?? {};
      let stop = end;
      let outcome = "recovered";
      if (x.abort) {
        // Cut the plan at the abort time and fly straight home.
        const keep = segs.filter((s) => s.t0 < x.abort.t);
        const last = keep.at(-1);
        last.t1 = Math.min(last.t1, x.abort.t);
        const from = sample(keep, x.abort.t);
        const dur = Math.hypot(from[0] - S.x, from[1] - S.y) / v;
        keep.push({ t0: x.abort.t, t1: x.abort.t + dur, pts: [from, [S.x, S.y]], phase: "recover", alt: 60, label: "RTL" });
        segs = keep;
        stop = x.abort.t + dur;
        outcome = "aborted";
        ev(x.abort.t, tail, "abort", "warn", x.abort.why);
      }
      if (x.lost) {
        stop = x.lost.t;
        outcome = "lost";
        ev(x.lost.t, tail, "loss", "danger", `Lost: ${x.lost.why}`, "#attrition");
      }
      ev(launch, tail, "launch", "info", `Launched (${sku.replace("ARCHER-", "Archer ")})`);
      for (const s of segs) if (s.phase !== "transit" && s.phase !== "recover" && s.t0 < stop) ev(s.t0, tail, "station", "info", `On station: ${s.label}`);
      if (outcome !== "lost") ev(stop, tail, "recover", x.hardLanding ? "warn" : "info", x.hardLanding ?? "Recovered at the GCS");

      const pts = [];
      let vioRun = 0;
      let wasVio = false;
      let drift = 0;
      let maxDrift = 0;
      let vioS = 0;
      let linkS = 0;
      const gaps = x.linkGaps ?? [];
      let prev = null;
      const startBatt = o.padBattery[tail] ?? 98 - (i % 3);
      for (let t = launch; t <= Math.min(stop, elapsed) + 1e-6; t += DT) {
        const [px, py] = sample(segs, t);
        const seg = segs.find((s) => t >= s.t0 && t < s.t1) ?? segs.at(-1);
        const vio = inJamming(px, py);
        if (prev && vio) vioRun += Math.hypot(px - prev[0], py - prev[1]);
        if (vio) {
          drift = 1.5 + 0.01 * vioRun;
          maxDrift = Math.max(maxDrift, drift);
          vioS += DT;
        }
        if (vio && !wasVio) ev(t, tail, "gnss", "warn", "GNSS rejected (jamming, SIM). Navigating on VIO.", "#denial");
        if (!vio && wasVio) {
          ev(t, tail, "gnss", "info", `GNSS trusted again. VIO error at handover ${drift.toFixed(1)} m after ${(vioRun / 1000).toFixed(2)} km.`, "#denial");
          vioRun = 0;
        }
        wasVio = vio;
        const link = gaps.some(([a, b]) => t >= a && t < b) ? 0 : 1;
        if (!link) linkS += DT;
        const climb = Math.min(1, (t - launch) / 25);
        const landing = seg.phase === "recover" ? Math.max(0, Math.min(1, (stop - t) / 25)) : 1;
        const alt = Math.round((seg.alt || 60) * climb * landing);
        const batt = Math.max(5, startBatt - ((t - launch) / 60) * (DRAIN[sku] ?? 2) * (x.abort ? 1.6 : 1));
        pts.push([Math.round(t), Math.round(px), Math.round(py), alt, Math.round(batt), vio ? 1 : 0, link]);
        prev = [px, py];
      }
      for (const [a, b] of gaps) {
        if (a < elapsed) ev(a, tail, "link", "warn", "Link lost. Vehicle continues its last plan on its own.");
        if (b < elapsed) ev(b, tail, "link", "info", `Link restored after ${Math.round((b - a) / 60)} min ${Math.round((b - a) % 60)} s.`);
      }
      tracks.push({ tail, sku, outcome: m.state === "active" && Math.min(stop, elapsed) < stop ? "airborne" : outcome, points: pts, max_vio_m: Number(maxDrift.toFixed(1)), vio_s: vioS, link_lost_s: linkS, flight_s: Math.max(0, Math.min(stop, elapsed) - launch) });
    });
    for (const s of m.scripted ?? []) if (s.t <= elapsed) ev(s.t, s.tail, s.kind, s.severity, s.label, s.link);
    const shown = events.filter((e) => e.t_s <= elapsed).sort((a, b) => a.t_s - b.t_s || a.tail.localeCompare(b.tail));
    const duration = Math.max(...tracks.map((t) => t.points.at(-1)?.[0] ?? 0), ...shown.map((e) => e.t_s), 60);

    const lost = tracks.filter((t) => t.outcome === "lost").length;
    const aborted = tracks.filter((t) => t.outcome === "aborted").length;
    const airborne = tracks.filter((t) => t.outcome === "airborne").length;
    const effective = tracks.length - lost - aborted - airborne;
    const opHours = (m.operators * duration) / 3600;
    const stats = {
      sorties: tracks.length,
      effective,
      aborted,
      lost,
      airborne,
      flight_min: Math.round(tracks.reduce((s, t) => s + t.flight_s, 0) / 60),
      operators: m.operators,
      operator_hours: Number(opHours.toFixed(2)),
      effective_per_operator_hour: opHours > 0 ? Number((effective / opHours).toFixed(1)) : 0,
      interventions: shown.filter((e) => e.kind === "operator").length,
      link_lost_s: tracks.reduce((s, t) => s + t.link_lost_s, 0),
      vio_s: tracks.reduce((s, t) => s + t.vio_s, 0),
      max_vio_m: Math.max(0, ...tracks.map((t) => t.max_vio_m)),
    };

    const findings = [];
    if (stats.max_vio_m > 0)
      findings.push({ title: `VIO error reached ${stats.max_vio_m} m inside the jamming zone`, detail: "Modelled at the assumed 1% of distance flown. The denial map uses these passes to brief the zone for the next plan.", link: "#denial", cta: "Denial map" });
    if (stats.link_lost_s > 0)
      findings.push({ title: `${Math.round(stats.link_lost_s / 60)} min with a vehicle off the link`, detail: "The vehicle kept flying its last plan and CBBA re-assigned its task to a connected neighbour. Nobody had to re-task by hand.", link: "#operate", cta: "Operate" });
    if (aborted)
      findings.push({ title: `${aborted} early return${aborted > 1 ? "s" : ""}`, detail: "Battery reserve tripped before the plan finished. Check the configuration margin for the temperature flown.", link: "#configure", cta: "Configure" });
    if (lost)
      findings.push({ title: `${lost} airframe lost`, detail: "Fed to the attrition autopsy with its part lots. Hold the lot there if the signal holds.", link: "#attrition", cta: "Attrition" });
    if (tracks.some((t) => inc[t.tail]?.hardLanding))
      findings.push({ title: "Hard landing on recovery", detail: "Maintainer restricted the airframe until a hover check passes. Shows on Fleet and blocks launch checks.", link: "#fleet", cta: "Fleet" });
    findings.push({ title: `${stats.effective_per_operator_hour} effective sorties per operator-hour`, detail: `${effective} of ${tracks.length} sorties did the job, flown by ${m.operators} operator${m.operators > 1 ? "s" : ""}. This is the north-star metric; it is a simulated value here.`, link: null, cta: null });

    const cues = shown.map((e) => ({ time_us: e.t_s * 1_000_000, kind: e.kind, label: e.label, tail: e.tail }));
    const frame = frameOf(o.basemap);
    return {
      source: SIM,
      mission: row(m),
      live: m.state === "active",
      started_at: m.planned_start ? new Date(m.planned_start).toISOString() : null,
      duration_s: duration,
      basemap: frame,
      station: S,
      zones: [{ id: "J1", label: "GNSS jamming (SIM)", x: J.x, y: J.y, r: J.r }],
      places: o.places.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })),
      columns: ["t_s", "x_m", "y_m", "alt_m", "battery_pct", "vio", "link"],
      tracks,
      events: shown,
      stats,
      findings,
      cues,
    };
  }

  function sample(segs, t) {
    const s = segs.find((q) => t >= q.t0 && t < q.t1) ?? (t < segs[0].t0 ? segs[0] : segs.at(-1));
    const span = Math.max(1e-6, s.t1 - s.t0);
    const f = Math.max(0, Math.min(1, (t - s.t0) / span));
    if (!s.loop) return polyAt(s.pts, f * polyLen(s.pts));
    const len = polyLen(s.pts);
    // Work patterns repeat at cruise speed for as long as the objective lasts.
    const d = ((t - s.t0) * (s.v ?? 15)) % len;
    return polyAt(s.pts, d);
  }

  function frameOf(bm) {
    if (!bm) return null;
    const [w, so] = o.fromLL(bm.south, bm.west);
    const [e, n] = o.fromLL(bm.north, bm.east);
    return { west: w, east: e, south: so, north: n, url: bm.url };
  }

  // ---- writes -------------------------------------------------------------
  const NEXT = { draft: ["mission.review", "review"], review: ["mission.approve", "approved"], approved: ["mission.execute", "active"], active: ["mission.execute", "closed"] };

  function transition(m, action, who) {
    const actor = who?.display_name ?? "Demo Operator";
    const step = NEXT[m.state];
    if (!step || step[0] !== action) return { status: 409, body: { detail: "illegal_transition" } };
    const deny = (code, status = 403) => {
      o.audit.append({ actor, action, resource_type: "mission", resource_id: m.name, decision: "deny", reason_codes: [code] });
      return { status, body: { detail: code } };
    };
    if (who && !o.can(who.roles, action)) return deny("role_denied");
    if (action === "mission.approve" && actor === m.created_by) return deny("two_person_required");
    if (m.state === "approved") {
      const r = readiness(m);
      const bad = r.checks.find((c) => c.level === "no-go");
      if (bad) {
        const code = /grounded|restricted|held lot/.test(bad.detail) ? "tail_not_airworthy" : /recovery/.test(bad.detail) ? "package_incomplete" : /H-hour/.test(bad.detail) ? "h_hour_set" : "not_approved";
        return deny(code, 409);
      }
    }
    const verb = m.state === "active" ? "mission.close" : action;
    m.state = step[1];
    if (m.state === "active") m.planned_start = Date.now();
    m.history.push({ action: verb, by: actor, at: new Date().toISOString(), note: m.state === "active" ? "Plan released to the operators; the console monitors, it does not fly the vehicles" : "" });
    o.audit.append({ actor, action: verb, resource_type: "mission", resource_id: m.name, detail: `${m.id} now ${m.state}` });
    return { status: 200, body: { id: m.id, state: m.state } };
  }

  function create({ name, summary = "", objectives = [], source = null, at = Date.now() }, who) {
    const actor = who?.display_name ?? "Demo Planner";
    if (who && !o.can(who.roles, "mission.draft")) {
      o.audit.append({ actor, action: "mission.draft", resource_type: "mission", resource_id: String(name), decision: "deny", reason_codes: ["role_denied"] });
      return { status: 403, body: { detail: "role_denied" } };
    }
    const m = { id: `M-${nextId++}`, name: String(name).slice(0, 120), summary: String(summary).slice(0, 600), state: "draft", created_by: actor, planned_start: null, operators: 1, history: [{ action: "mission.draft", by: actor, at: new Date(at).toISOString(), note: source ? `Filed from Brief ${source}` : "" }], objectives, keepouts: [], source };
    missions.unshift(m);
    o.audit.append({ actor, action: "mission.draft", resource_type: "mission", resource_id: m.name, detail: source ? `${m.id} filed from Brief ${source}` : m.id, at });
    return { status: 200, body: { id: m.id, state: m.state } };
  }

  /** Turn an approved Brief proposal into a draft plan, one leg per assigned tail. */
  function fromProposal(p, who, at = Date.now()) {
    const objectives = [];
    let offset = 0;
    const KIND = { search: "search", survey: "search", observe: "loiter", relay: "loiter", inspect: "transit" };
    const used = new Set();
    for (const t of p.plan) {
      const pl = place(t.place);
      if (!pl) continue;
      for (const tail of t.tails ?? []) {
        objectives.push(obj(KIND[t.kind] ?? "transit", pl, tail, offset, t.minutes ?? (t.kind === "inspect" ? 6 : 20)));
        used.add(tail);
      }
      offset += 2;
    }
    for (const tail of used) {
      const legs = objectives.filter((x) => x.tail === tail);
      const end = Math.max(...legs.map((x) => x.offset_min + x.duration_min));
      objectives.push(obj("rtb", null, tail, end + 1, 4));
    }
    const name = p.brief.length > 60 ? `${p.brief.slice(0, 57)}…` : p.brief;
    const out = create({ name: name.charAt(0).toUpperCase() + name.slice(1), summary: `From Brief ${p.id}: "${p.brief}"`, objectives, source: p.id, at }, who ? { ...who, roles: [...who.roles, "planner"] } : null);
    return out.body.id;
  }

  function exportDebrief(msg, who) {
    const actor = who?.display_name ?? "Demo Operator";
    const m = missions.find((x) => x.id === msg.mission_id);
    if (who && !o.can(who.roles, "release.export")) {
      o.audit.append({ actor, action: "debrief.release", resource_type: "mission", resource_id: m?.name ?? "", decision: "deny", reason_codes: ["role_denied"] });
      return { status: 403, body: { detail: "role_denied" } };
    }
    const d = m ? debrief(m) : null;
    const format = String(msg.format ?? "csv");
    let body;
    if (format === "csv") {
      const rows = d ? d.events : (msg.rows ?? []);
      body = ["# UNCLASSIFIED // DEMO DATA. " + SIM, "t_s,tail,kind,severity,label", ...rows.map((e) => [e.t_s ?? e.time, e.tail ?? "", e.kind ?? e.event, e.severity ?? "", `"${String(e.label ?? "").replace(/"/g, '""')}"`].join(","))].join("\n");
    } else if (format === "json") {
      body = d;
    } else if (format === "xapi") {
      body = { actor: { name: actor }, verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "debriefed" } }, object: { id: `urn:a2e:mission:${m?.id ?? "unknown"}`, definition: { name: { "en-US": m?.name ?? "" } } }, result: d ? { extensions: { "urn:a2e:effective_per_operator_hour": d.stats.effective_per_operator_hour } } : {}, timestamp: new Date().toISOString() };
    } else return { status: 400, body: { detail: "format_unavailable" } };
    o.audit.append({ actor, action: "debrief.release", resource_type: "mission", resource_id: m?.name ?? "", detail: `${format.toUpperCase()} released, marked UNCLASSIFIED // DEMO DATA` });
    return { status: 200, body: { banner: "UNCLASSIFIED // DEMO DATA", format, body } };
  }

  function json(raw) {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return null;
    }
  }

  /** Tails flying an active plan right now, so a new brief does not take them by surprise. */
  function busyTails() {
    const out = new Map();
    for (const m of missions.filter((x) => x.state === "active")) for (const o of m.objectives) if (o.tail && !out.has(o.tail)) out.set(o.tail, { id: m.id, name: m.name });
    return out;
  }

  return {
    fromProposal,
    busyTails,
    list: () => missions.map(row),
    handle(method, url, raw, who) {
      const path = url.pathname;
      if (path === "/v1/org") return { status: 200, body: { items: [TEAM] } };
      if (path === "/v1/debrief/export" && method === "POST") {
        const msg = json(raw);
        return msg ? exportDebrief(msg, who) : { status: 400, body: { detail: "json" } };
      }
      if (path === "/v1/missions") {
        if (method === "POST") {
          const msg = json(raw);
          if (!msg || !String(msg.name ?? "").trim()) return { status: 400, body: { detail: "name" } };
          return create({ name: msg.name, summary: msg.summary }, who);
        }
        const now = Date.now();
        return { status: 200, body: { source: "Demo plans (SIM)", items: missions.map(row), range: rangeInfo(), generated_at: new Date(now).toISOString() } };
      }
      const hit = path.match(/^\/v1\/missions\/([^/]+)(?:\/(objectives|readiness|transition|debrief|history))?$/);
      if (!hit) return null;
      const m = missions.find((x) => x.id === decodeURIComponent(hit[1]));
      if (!m) return { status: 404, body: { detail: "not_found" } };
      const sub = hit[2];
      if (!sub && method === "PATCH") {
        if (m.state !== "draft") return { status: 409, body: { detail: "not_draft" } };
        const msg = json(raw) ?? {};
        if (typeof msg.name === "string" && msg.name.trim()) m.name = msg.name.trim().slice(0, 120);
        if (typeof msg.summary === "string") m.summary = msg.summary.slice(0, 600);
        if ("planned_start" in msg) m.planned_start = msg.planned_start ? Date.parse(msg.planned_start) || null : null;
        return { status: 200, body: { id: m.id, name: m.name, summary: m.summary } };
      }
      if (!sub) return { status: 200, body: row(m) };
      if (sub === "objectives") {
        if (method === "PUT") {
          if (m.state !== "draft") return { status: 409, body: { detail: "not_draft" } };
          const msg = json(raw) ?? {};
          if (Array.isArray(msg.objectives)) m.objectives = msg.objectives.slice(0, 60);
          if (Array.isArray(msg.keepouts)) m.keepouts = msg.keepouts.slice(0, 12);
          return { status: 200, body: { count: m.objectives.length } };
        }
        return { status: 200, body: { items: m.objectives, keepouts: m.keepouts, planned_start: m.planned_start ? new Date(m.planned_start).toISOString() : null } };
      }
      if (sub === "readiness") return { status: 200, body: readiness(m) };
      if (sub === "history") return { status: 200, body: { items: m.history } };
      if (sub === "transition" && method === "POST") return transition(m, String((json(raw) ?? {}).action ?? ""), who);
      if (sub === "debrief") {
        const d = debrief(m);
        return d ? { status: 200, body: d } : { status: 200, body: { mission: row(m), cues: [], tracks: [], events: [], source: "Not flown yet." } };
      }
      return { status: 404, body: { detail: "not_found" } };
    },
  };

  function rangeInfo() {
    const [lat0, lon0] = o.toLL(0, 0);
    const [lat1] = o.toLL(0, 1000);
    const [, lon1] = o.toLL(1000, 0);
    return {
      frame: { lat0, lon0, m_lat: 1000 / (lat1 - lat0), m_lon: 1000 / (lon1 - lon0) },
      basemap: frameOf(o.basemap),
      station: S,
      zones: [{ id: "J1", label: "GNSS jamming (SIM)", x: J.x, y: J.y, r: J.r }],
      places: o.places.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })),
    };
  }

}
