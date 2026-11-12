// The physics check: fly a plan through the three models that decide whether
// a small drone actually does its job tonight, and turn what they find into
// fixes the planner can apply.
//
//   Link    the C2 and video links over the range's real terrain, with the EW
//           emitter on or off (demo/rf.mjs).
//   Pack    the battery as an electro-thermal system: voltage sag, cutoff,
//           self-heating, and what preheating buys (demo/pack.mjs).
//   Thrust  headroom against gusts in tonight's air density on tonight's
//           pack voltage (demo/envelope.mjs).
//
// A fix changes the plan (an altitude, a relay, a band, a different airframe),
// so a plan in review or approved goes back to draft and needs a second person
// again. Preheating is a launch task, not a plan change. Everything is SIM:
// textbook relations and assumed coefficients, flown over SRTM/NED terrain.

import { AIRFRAMES, power, windAt } from "./physics.mjs";
import { BANDS, EMITTER, RF, VIDEO, ground, hop, linkAt, profileChart, relaySites } from "./rf.mjs";
import { PACK, PACKS, preheat } from "./pack.mjs";
import { ENVELOPE, TWR, density, envelopeGrid, headroom, maxWind, powerAtThrust } from "./envelope.mjs";

export const SOURCE = "Physics check (SIM): plan flown through the terrain radio, electro-thermal pack and thrust models. Textbook relations, assumed coefficients, SRTM/NED terrain; not field data.";
const DT = 10;
const ALT_CEILING = 150;
const r1 = (v) => Math.round(v * 10) / 10;

/** The forecast a plan is checked against. A plan can carry its own; the page can ask "what if". */
export function forecastOf(m, ask = {}) {
  const base = { temp_c: m.temp_c ?? 18, wind_mps: 5, wind_from_deg: 290, gust_mps: 9, ew: false, ...(m.forecast ?? {}) };
  const num = (v, lo, hi) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Math.max(lo, Math.min(hi, Number(v))));
  const f = { ...base };
  const t = num(ask.temp_c, -30, 45);
  const w = num(ask.wind_mps, 0, 20);
  const g = num(ask.gust_mps, 0, 30);
  if (t !== undefined) f.temp_c = t;
  if (w !== undefined) f.wind_mps = w;
  if (g !== undefined) f.gust_mps = g;
  if (ask.ew !== undefined && ask.ew !== null && ask.ew !== "") f.ew = ask.ew === true || ask.ew === "1" || ask.ew === "true";
  f.gust_mps = Math.max(f.gust_mps, f.wind_mps);
  return f;
}

const envOf = (f) => ({ wind_mps: f.wind_mps, wind_from_deg: f.wind_from_deg, gust: f.wind_mps > 0 ? Math.min(0.6, (f.gust_mps - f.wind_mps) / Math.max(1, f.wind_mps) / 2) : 0, phase: 1 });

/**
 * @param {object} c
 * @param {(m: object, tail: string, at: number) => {segs: object[], end: number}} c.segments
 * @param {(segs: object[], t: number) => [number, number]} c.sample
 * @param {(tail: string) => string} c.skuOf
 * @param {(m: object) => string[]} c.tailsOf
 * @param {{x: number, y: number}} c.station
 * @param {{x: number, y: number, r: number}} c.jamming GNSS jamming zone (relays need GNSS to hold station)
 * @param {object[]} c.platforms
 * @param {Record<string, number>} c.padBattery
 * @param {() => Map<string, string>} c.heldTails
 * @param {object[]} c.places
 * @param {(x: number, y: number) => [number, number]} c.toLL
 * @param {(lat: number, lon: number) => [number, number]} c.fromLL
 */
export function createPhysicsCheck(c) {
  const gcs = { x: c.station.x, y: c.station.y, agl: RF.gcs_mast_m, label: "GCS" };
  const gcsElev = ground(c.station.x, c.station.y);
  const cache = new Map();

  /** Each tail's flight as samples every 10 s: where, how high, doing what, at what power. */
  function flight(m, tail, f) {
    const sku = c.skuOf(tail);
    const frame = AIRFRAMES[sku] ?? AIRFRAMES["ARCHER-8"];
    const { segs, end } = c.segments(m, tail, 0);
    const env = envOf(f);
    const rho = density(gcsElev + 100, f.temp_c);
    const sigma = rho / 1.225;
    const hoverW = power(frame, 0);
    const punch = powerAtThrust(hoverW, ENVELOPE.punch_fraction * TWR[sku] * sigma, sigma);
    const pts = [];
    let prev = null;
    for (let t = 0; t <= end + 1e-6; t += DT) {
      const p = c.sample(segs, t);
      const seg = segs.find((s) => t >= s.t0 && t < s.t1) ?? segs.at(-1);
      const alt = seg.alt || 60;
      const climb = t < 25 ? alt / 25 : end - t < 25 ? -alt / 25 : 0;
      let watts = hoverW;
      let air = 0;
      if (prev) {
        const [wx, wy] = windAt(env, t, alt);
        const gx = (p[0] - prev[0]) / DT;
        const gy = (p[1] - prev[1]) / DT;
        // The guidance slows upwind rather than chase ground speed: airspeed holds near cruise (as the launch energy check does).
        air = Math.min(frame.cruise_mps * 1.15, Math.hypot(gx - wx, gy - wy));
        watts = power(frame, air, climb);
      } else watts = power(frame, 0, climb);
      pts.push({ t, x: p[0], y: p[1], agl: alt, phase: seg.phase, label: seg.label, watts, air, punch_w: punch });
      prev = p;
    }
    return { sku, frame, end, pts, hoverW, sigma };
  }

  /** Relays the plan already flies: objectives marked as relays, relaying from take-off to the end of their station time, wherever they are. */
  function relaysOf(m, flights) {
    const out = [];
    for (const [tail, fl] of flights) {
      const legs = m.objectives.filter((o) => o.tail === tail && o.relay);
      for (const leg of legs) {
        const [x, y] = c.fromLL(leg.lat, leg.lon);
        const work = fl.pts.filter((p) => p.label === leg.label && p.phase !== "transit" && p.phase !== "recover");
        if (!work.length) continue;
        const track = new Map(fl.pts.map((p) => [p.t, p]));
        out.push({ tail, label: `${tail} relay`, x, y, agl: leg.alt_m, t0: 30, t1: work.at(-1).t, track });
      }
    }
    return out;
  }

  /** Relays airborne at a time, at the position they are flying through then. */
  function relaysAt(relays, tail, t) {
    return relays
      .filter((r) => r.tail !== tail && t >= r.t0 && t <= r.t1)
      .map((r) => {
        const p = r.track.get(t);
        return p ? { label: r.label, x: p.x, y: p.y, agl: Math.max(60, p.agl) } : r;
      });
  }

  function linkFor(fl, tail, relays, f, band) {
    const emitter = f.ew ? EMITTER : null;
    const active = (t) => relaysAt(relays, tail, t);
    return fl.pts.map((p) => {
      const rs = active(p.t);
      const ctl = linkAt(gcs, p, band, emitter, rs);
      const vid = linkAt(gcs, p, VIDEO.id, emitter, rs);
      return { t: p.t, x: p.x, y: p.y, agl: p.agl, phase: p.phase, label: p.label, c2: ctl.margin_db, c2_direct: ctl.direct.margin_db, c2_via: ctl.via, video: vid.margin_db, video_via: vid.via, jam: ctl.direct.jam };
    });
  }

  const working = (s) => s.phase !== "recover" && s.t > 30;

  function summarize(samples) {
    const w = samples.filter(working);
    const secs = (pred) => w.filter(pred).length * DT;
    const worst = w.reduce((a, s) => (a === null || s.video < a.video ? s : a), null);
    return {
      c2_min_db: w.length ? r1(Math.min(...w.map((s) => s.c2))) : null,
      video_min_db: w.length ? r1(Math.min(...w.map((s) => s.video))) : null,
      c2_lost_s: secs((s) => s.c2 < 0),
      c2_thin_s: secs((s) => s.c2 < RF.required_db),
      video_lost_s: secs((s) => s.video < 0),
      worst,
    };
  }

  function placeNear(x, y) {
    let best = null;
    for (const p of c.places) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 450 && (!best || d < best.d)) best = { p, d };
    }
    if (best) return `near the ${best.p.label} (${best.p.id})`;
    const dx = x - c.station.x;
    const dy = y - c.station.y;
    const dir = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) / 45) % 8];
    return `on high ground ${(Math.hypot(dx, dy) / 1000).toFixed(1)} km ${dir} of the GCS`;
  }

  /** Airframes that could join or replace in this plan, best for the job first. */
  function spares(m, prefer) {
    const held = c.heldTails();
    const inPlan = new Set(c.tailsOf(m));
    return c.platforms
      .filter((p) => p.airworthiness !== "grounded" && p.airworthiness !== "restricted" && !held.has(p.tail_number) && !inPlan.has(p.tail_number) && (c.padBattery[p.tail_number] ?? 95) >= 50)
      .map((p) => ({ tail: p.tail_number, sku: c.skuOf(p.tail_number) }))
      .sort((a, b) => prefer(b.sku) - prefer(a.sku) || a.tail.localeCompare(b.tail));
  }

  // ---- the check ------------------------------------------------------------

  function run(m, ask = {}, full = true) {
    const f = forecastOf(m, ask);
    const band = BANDS[m.band] ? m.band : "915";
    const key = JSON.stringify([m.objectives, f, band, m.preheat ?? {}, full, c.tailsOf(m).map((t) => c.padBattery[t] ?? null)]);
    if (cache.has(key)) return cache.get(key);
    const tails = c.tailsOf(m).filter((t) => AIRFRAMES[c.skuOf(t)]);
    const flights = new Map(tails.map((t) => [t, flight(m, t, f)]));
    const relays = relaysOf(m, flights);
    const findings = [];
    const per = [];

    for (const tail of tails) {
      const fl = flights.get(tail);
      const samples = linkFor(fl, tail, relays, f, band);
      const link = summarize(samples);
      // Is the worst C2 point jamming or terrain? Price it again with the emitter off.
      link.cause = "terrain";
      link.c2_clear_db = null;
      if (f.ew && samples.length) {
        const w = samples.filter(working).reduce((a, s) => (a === null || s.c2 < a.c2 ? s : a), null);
        if (w && w.c2 < RF.required_db) {
          const clear = linkAt(gcs, w, band, null, relaysAt(relays, tail, w.t)).margin_db;
          if (clear >= RF.required_db) [link.cause, link.c2_clear_db] = ["jamming", r1(clear)];
        }
      }
      // Pack: cold-soaked unless the plan has a preheat for this tail.
      const pack = PACKS[fl.sku];
      const startSoc = (m.start_pct?.[tail] ?? c.padBattery[tail] ?? 95) / 100;
      const trace = fl.pts.map((p) => ({ t: p.t, watts: p.watts, air_mps: p.air, punch_w: p.punch_w }));
      const advice = preheat(pack, trace, { ambient_c: f.temp_c, start_soc: startSoc });
      const planned = m.preheat?.[tail];
      const flown = planned !== undefined && advice.warm.rows.length ? (planned >= (advice.launch_c ?? Infinity) ? advice.warm : advice.cold) : advice.cold;
      const preheated = planned !== undefined && advice.launch_c !== null && planned >= advice.launch_c;
      // Thrust: in the climb-out, on the pack voltage the climb-out sees.
      const elev = Math.max(gcsElev, ...fl.pts.map((p) => ground(p.x, p.y)));
      const aglMax = Math.max(...fl.pts.map((p) => p.agl));
      const climbV = (preheated ? advice.warm : advice.cold).climb_out_v_cell ?? 3.8;
      const env = headroom(fl.frame, fl.sku, { elev_m: elev, agl_m: aglMax, temp_c: f.temp_c, wind_mps: f.wind_mps, gust_mps: f.gust_mps, cell_v: climbV });
      const windLimit = maxWind(fl.frame, fl.sku, { elev_m: elev, agl_m: aglMax, temp_c: f.temp_c, cell_v: climbV });
      per.push({
        tail,
        sku: fl.sku,
        airframe: fl.frame.label,
        minutes: Math.round(fl.end / 60),
        link: { ...link, cause: link.cause, worst: link.worst ? { t: link.worst.t, x: Math.round(link.worst.x), y: Math.round(link.worst.y), agl: link.worst.agl, label: link.worst.label, video: r1(link.worst.video), c2: r1(link.worst.c2), via: link.worst.video_via } : null },
        track: full ? samples.map((s) => [Math.round(s.x), Math.round(s.y), r1(s.c2), r1(s.video), s.agl]) : undefined,
        pack: {
          label: pack.label,
          chem: pack.chem,
          cutoff_v: pack.cutoff_v,
          start_pct: Math.round(startSoc * 100),
          cold: packSummary(advice.cold),
          warm: packSummary(advice.warm),
          preheat: { needed: advice.needed, launch_c: advice.launch_c, out_c: advice.out_c, warm_min: advice.warm_min, planned: planned ?? null, done: preheated },
          trace: full ? downsample(advice.cold.rows, preheated || advice.needed ? advice.warm.rows : null) : undefined,
        },
        thrust: { ...env, max_wind_mps: windLimit, elev_m: Math.round(elev) },
      });
    }

    // ---- findings and fixes ---------------------------------------------------
    for (const p of per) {
      const L = p.link;
      if (L.video_lost_s > 0 || L.c2_thin_s > 0) {
        const where = L.worst?.label ?? "the work area";
        const sev = L.c2_lost_s > 0 ? "no-go" : "caution";
        const parts = [];
        if (L.video_lost_s > 0) parts.push(`no video for ${minutes(L.video_lost_s)}`);
        if (L.c2_lost_s > 0) parts.push(`C2 lost for ${minutes(L.c2_lost_s)}, so it flies its failsafe`);
        else if (L.c2_thin_s > 0) parts.push(`C2 under the ${RF.required_db} dB planning margin for ${minutes(L.c2_thin_s)}`);
        const jammed = L.cause === "jamming";
        findings.push({
          id: `link:${p.tail}`,
          area: "link",
          severity: sev,
          tail: p.tail,
          title: jammed ? `${p.tail} loses C2 inside the EW emitter's reach at ${where}` : `${p.tail} drops out behind terrain at ${where}`,
          detail: `${cap(parts.join("; "))}. Worst point: video ${L.worst?.video} dB, C2 ${L.worst?.c2} dB at ${L.worst?.agl} m above the ground. ${jammed ? `Without the emitter C2 would hold ${L.c2_clear_db} dB there: this is jamming, not range.` : `Terrain stands in the first Fresnel zone between it and ${L.worst?.via === "direct" ? "the GCS" : L.worst?.via}.`}`,
          fixes: [],
        });
      }
    }
    const linkFindings = findings.filter((x) => x.area === "link");
    if (full && linkFindings.length) addLinkFixes(m, f, band, per, flights, relays, linkFindings);

    for (const p of per) {
      const P = p.pack;
      const pre = P.preheat;
      if (P.cold.collapse || (pre.needed && !pre.done)) {
        const fix = pre.launch_c !== null ? { id: `preheat:${p.tail}:${pre.launch_c}`, kind: "preheat", label: `Warm ${p.tail}'s pack to ${pre.out_c} °C (${pre.warm_min} min in the ${PACK.warmer_c} °C warmer), launch within ${PACK.pad_window_min} min`, changes_plan: false } : null;
        findings.push({
          id: `pack:${p.tail}`,
          area: "pack",
          severity: "caution",
          tail: p.tail,
          title: `${p.tail}'s cold pack sags under the cutoff on the climb-out`,
          detail: `At ${f.temp_c} °C the ${P.label} starts cold-soaked; a full-rate climb in the first five minutes ${P.cold.climb_out_punch_v < 2.5 ? "asks for more power than it can deliver, and the voltage collapses" : `pulls it to ${P.cold.climb_out_punch_v} V per cell`} against a ${P.cutoff_v} V cutoff. ${pre.launch_c !== null ? `Launching at ${pre.launch_c} °C holds ${P.warm.climb_out_punch_v} V.` : `Even at ${PACK.warmer_c - 5} °C it does not hold: change the pack or the airframe.`} The current heats it in flight, so after the first minutes the risk falls.`,
          fixes: fix ? [fix] : [],
        });
      }
      const late = pre.done ? P.warm.cutoff : P.cold.cutoff;
      if (late && late.soc <= 12) {
        findings.push({
          id: `cutoff:${p.tail}`,
          area: "pack",
          severity: "no-go",
          tail: p.tail,
          title: `${p.tail}'s pack is empty at minute ${Math.round(late.t / 60)} of ${p.minutes}`,
          detail: `The controller lands it where it is at ${late.v_cell} V per cell with ${late.soc}% left: the plan is longer than the ${P.label} gives at ${f.temp_c} °C from ${P.start_pct}%. Split the leg or give it to an airframe with a bigger pack.`,
          fixes: [],
        });
      } else if (late) {
        findings.push({
          id: `cutoff:${p.tail}`,
          area: "pack",
          severity: "no-go",
          tail: p.tail,
          title: `${p.tail} reaches the voltage cutoff at minute ${Math.round(late.t / 60)} of ${p.minutes}`,
          detail: `The controller lands it where it is at ${late.v_cell} V per cell with ${late.soc}% still in the pack: in the cold the voltage, not the energy, sets bingo. Land it earlier, give the leg to an airframe with a bigger pack, or warm the air it flies in (a later launch).`,
          fixes: [],
        });
      }
    }

    for (const p of per) {
      const T = p.thrust;
      if (T.verdict === "go") continue;
      findings.push({
        id: `thrust:${p.tail}`,
        area: "thrust",
        severity: T.verdict === "no-go" ? "no-go" : "caution",
        tail: p.tail,
        title: `${p.tail} has ${Math.round(T.headroom * 100)}% thrust in hand in a ${T.gust_mps} m/s gust`,
        detail: `${p.airframe} at density altitude ${T.density_altitude_m} m on ${T.cell_v} V per cell: a gust needs ${T.thrust_gust_n} N of ${T.thrust_max_n} N and ${T.tilt_gust_deg}° of tilt (limit ${ENVELOPE.max_tilt_deg}°). Planning keeps ${Math.round(ENVELOPE.headroom_go * 100)}%. Go limit tonight: ${T.max_wind_mps} m/s steady wind.`,
        fixes: [],
      });
    }
    if (full) addSwapFixes(m, f, per, findings);

    const order = { "no-go": 0, caution: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.area.localeCompare(b.area));
    const sample = per.find((p) => p.thrust.verdict !== "go") ?? per[0];
    const out = {
      source: SOURCE,
      forecast: f,
      band,
      bands: Object.values(BANDS).map((b) => ({ id: b.id, label: b.label })),
      video: { id: VIDEO.id, label: VIDEO.label },
      station: c.station,
      emitter: { ...EMITTER, on: f.ew },
      relays: relays.map((r) => ({ tail: r.tail, x: Math.round(r.x), y: Math.round(r.y), agl: r.agl })),
      tails: per,
      findings,
      verdict: findings.some((x) => x.severity === "no-go") ? "no-go" : findings.length ? "caution" : "go",
      profile: full ? worstProfile(per, relays, f) : undefined,
      envelope: full && sample ? { tail: sample.tail, airframe: sample.airframe, ...envelopeGrid(AIRFRAMES[sample.sku], sample.sku, { elev_m: sample.thrust.elev_m, agl_m: 100 }, power(AIRFRAMES[sample.sku], 0)), now: { temp_c: f.temp_c, wind_mps: f.wind_mps } } : undefined,
      assumptions: full ? { radio: RF, pack: PACK, envelope: ENVELOPE, twr: TWR } : undefined,
    };
    cache.set(key, out);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return out;
  }

  function packSummary(r) {
    return { min_v: r.min_v_cell, climb_out_v: r.climb_out_v_cell, climb_out_punch_v: r.climb_out_punch_v_cell, cutoff: r.cutoff, collapse: r.collapse, end_soc: r.end?.soc ?? null, end_temp_c: r.end?.temp_c ?? null, max_temp_c: Math.max(...r.rows.map((x) => x.temp_c)) };
  }

  function downsample(cold, warm) {
    const n = Math.max(1, Math.ceil(cold.length / 80));
    return cold.filter((_, i) => i % n === 0 || i === cold.length - 1).map((row) => {
      const w = warm?.find((x) => x.t === row.t);
      return { t: row.t, v: row.v_cell, temp: row.temp_c, soc: row.soc, v_warm: w ? w.v_cell : null, temp_warm: w ? w.temp_c : null };
    });
  }

  function worstProfile(per, relays, f) {
    const p = per.filter((x) => x.link.worst).sort((a, b) => a.link.worst.video - b.link.worst.video)[0];
    if (!p) return null;
    const w = p.link.worst;
    const from = relays.find((r) => r.label === w.via) ?? gcs;
    const chart = profileChart(from, { x: w.x, y: w.y, agl: w.agl }, VIDEO.f_mhz);
    return { tail: p.tail, from: from.label ?? "GCS", to: w.label, ...chart, ew: f.ew };
  }

  /** Altitude per leg, then a relay, then (under EW) a band that the emitter does not reach. */
  function addLinkFixes(m, f, band, per, flights, relays, linkFindings) {
    const emitter = f.ew ? EMITTER : null;
    const needs = [];
    for (const fd of linkFindings) {
      const p = per.find((x) => x.tail === fd.tail);
      const fl = flights.get(fd.tail);
      const samples = linkFor(fl, fd.tail, relays, f, band);
      // Altitude: the lowest height, in 10 m steps up to the ceiling, that holds every sample of each bad leg.
      const legs = [...new Set(samples.filter((s) => working(s) && (s.video < 0 || s.c2 < RF.required_db)).map((s) => s.label))];
      for (const label of legs) {
        const idx = m.objectives.findIndex((o) => o.tail === fd.tail && o.label === label && o.kind !== "rtb");
        if (idx < 0) continue;
        const leg = m.objectives[idx];
        const pts = samples.filter((s) => s.label === label && working(s));
        let fixAlt = null;
        for (let a = Math.ceil((leg.alt_m + 10) / 10) * 10; a <= ALT_CEILING; a += 10) {
          const ok = pts.every((s) => {
            const q = { x: s.x, y: s.y, agl: a };
            const rs = relaysAt(relays, fd.tail, s.t);
            return linkAt(gcs, q, VIDEO.id, emitter, rs).margin_db >= 0 && linkAt(gcs, q, band, emitter, rs).margin_db >= RF.required_db;
          });
          if (ok) {
            fixAlt = a;
            break;
          }
        }
        if (fixAlt !== null) {
          const extraWh = r1((AIRFRAMES[p.sku].mass_kg * 9.81 * (fixAlt - leg.alt_m)) / ASSUMED_EFF / 3600);
          fd.fixes.push({ id: `alt:${fd.tail}:${idx}:${fixAlt}`, kind: "altitude", label: `Fly ${fd.tail}'s ${label} leg at ${fixAlt} m instead of ${leg.alt_m} m`, detail: `Clears the Fresnel zone over the ridge; about ${extraWh} Wh more to climb.`, changes_plan: true });
        }
      }
      for (const s of samples) if (working(s) && (s.video < 0 || s.c2 < RF.required_db)) needs.push({ x: s.x, y: s.y, agl: s.agl, t: s.t, tail: fd.tail });
    }
    // Relay: one site for the whole package, on high ground with GNSS (outside the jamming zone).
    if (needs.length) {
      const xs = [c.station.x, ...needs.map((n) => n.x)];
      const ys = [c.station.y, ...needs.map((n) => n.y)];
      const box = { x0: Math.min(...xs) - 600, x1: Math.max(...xs) + 600, y0: Math.min(...ys) - 600, y1: Math.max(...ys) + 600 };
      const sites = relaySites(gcs, needs, VIDEO.id, emitter, box, { agl: 120, keep: 8 }).filter((s) => Math.hypot(s.x - c.jamming.x, s.y - c.jamming.y) > c.jamming.r + 100);
      const site = sites.find((s) => s.worst_db >= 0) ?? sites[0];
      const end = Math.max(...m.objectives.map((o) => o.offset_min + o.duration_min));
      const endurance = (sku) => ({ "ARCHER-10": 3, "ARCHER-8": 2, "ARCHER-5": 1 })[sku] ?? 0;
      const spare = site ? spares(m, endurance)[0] : null;
      if (site && spare) {
        const where = placeNear(site.x, site.y);
        const up = { c2: hop(gcs, site, band, emitter).margin_db, video: hop(gcs, site, VIDEO.id, emitter).margin_db };
        for (const fd of linkFindings) {
          const mine = needs.filter((n) => n.tail === fd.tail);
          if (!mine.length) continue;
          const video = Math.min(up.video, ...mine.map((n) => hop(site, n, VIDEO.id, emitter).margin_db));
          const c2 = Math.min(up.c2, ...mine.map((n) => hop(site, n, band, emitter).margin_db));
          const p = per.find((x) => x.tail === fd.tail);
          const fixesVideo = p.link.video_lost_s === 0 || video >= 0;
          const fixesC2 = p.link.c2_thin_s === 0 || c2 >= RF.required_db;
          if (!fixesVideo || !fixesC2) continue;
          fd.fixes.push({
            id: `relay:${spare.tail}:${site.x}:${site.y}`,
            kind: "relay",
            label: `Add ${spare.tail} (${AIRFRAMES[spare.sku].label}) as a relay ${where}, 120 m up, for the whole package`,
            detail: `From there ${fd.tail}'s worst video margin is ${r1(video)} dB and C2 ${r1(c2)} dB. The relay holds ${end + 2} minutes on station, outside the GNSS jamming zone.`,
            changes_plan: true,
            _apply: { tail: spare.tail, x: site.x, y: site.y, minutes: end + 2 },
          });
        }
      }
    }
    // Band: under EW, a C2 band the emitter does not reach, if it holds over the terrain.
    if (f.ew) {
      for (const alt of Object.values(BANDS)) {
        if (alt.id === band || EMITTER.erp_dbm[alt.id] !== null) continue;
        const worst = Math.min(...needs.map((n) => hop(gcs, n, alt.id, emitter).margin_db));
        for (const fd of linkFindings) {
          const p = per.find((x) => x.tail === fd.tail);
          if (p.link.c2_lost_s === 0 && p.link.c2_thin_s === 0) continue;
          fd.fixes.push({ id: `band:${alt.id}`, kind: "band", label: `Move the package's C2 to ${alt.label}, out of the emitter's bands`, detail: worst >= RF.required_db ? `Holds ${r1(worst)} dB at the worst point without the jammer in it.` : `The emitter cannot reach it, but over this terrain it is ${r1(worst)} dB at the worst point: pair it with the relay.`, changes_plan: true });
        }
      }
    }
  }

  /** Thrust: swap a tail for a spare that has the headroom. */
  function addSwapFixes(m, f, per, findings) {
    for (const fd of findings.filter((x) => x.area === "thrust" || x.id.startsWith("cutoff:"))) {
      const p = per.find((x) => x.tail === fd.tail);
      const score = (sku) => {
        const h = headroom(AIRFRAMES[sku], sku, { elev_m: p.thrust.elev_m, agl_m: 100, temp_c: f.temp_c, wind_mps: f.wind_mps, gust_mps: f.gust_mps });
        return h.verdict === "go" ? 10 + (fd.area === "thrust" ? h.headroom : AIRFRAMES[sku].pack_wh / 100) : h.headroom;
      };
      const spare = spares(m, score).find((s) => s.sku !== p.sku);
      if (!spare) continue;
      fd.fixes.push({ id: `swap:${fd.tail}:${spare.tail}`, kind: "swap", label: `Give ${fd.tail}'s legs to ${spare.tail} (${AIRFRAMES[spare.sku].label})`, detail: `${AIRFRAMES[spare.sku].label}: ${AIRFRAMES[spare.sku].pack_wh} Wh, thrust to weight ${TWR[spare.sku]}.`, changes_plan: true });
    }
  }

  // ---- launch checks ----------------------------------------------------------

  /** The physics check as launch-check lines. Cautions: the planner decides; the check page has the fixes. */
  function launchChecks(m) {
    const r = run(m, {}, false);
    const out = [];
    for (const fd of r.findings) out.push({ level: "caution", detail: `${fd.title}: ${firstSentence(fd.detail)}`, area: "physics", finding: fd.id });
    const warmed = r.tails.filter((t) => t.pack.preheat.done);
    for (const t of warmed) out.push({ level: "go", detail: `${t.tail} pack preheat planned: out of the warmer at ${t.pack.preheat.out_c} °C, launch within ${PACK.pad_window_min} min.`, area: "physics" });
    if (!r.findings.length && r.tails.length) out.push({ level: "go", detail: `Terrain, packs and thrust: links hold over the terrain, packs hold the cutoff, thrust headroom ${Math.round(Math.min(...r.tails.map((t) => t.thrust.headroom)) * 100)}% or better at ${r.forecast.temp_c} °C and ${r.forecast.wind_mps} m/s (SIM).`, area: "physics" });
    return out;
  }

  // ---- fixes ------------------------------------------------------------------

  /** Apply one fix to the plan. Returns a sentence for the history, or null when the fix is not on offer. */
  function apply(m, fixId, ask = {}) {
    const r = run(m, ask, true);
    const fix = r.findings.flatMap((x) => x.fixes).find((x) => x.id === fixId);
    if (!fix) return null;
    const [kind, ...rest] = fixId.split(":");
    if (kind === "alt") {
      const [tail, idx, alt] = [rest[0], Number(rest[1]), Number(rest[2])];
      const leg = m.objectives[idx];
      if (!leg || leg.tail !== tail) return null;
      leg.alt_m = alt;
      return { note: `${tail} ${leg.label} leg raised to ${alt} m for line of sight`, changes_plan: true };
    }
    if (kind === "relay") {
      const a = fix._apply;
      const [lat, lon] = c.toLL(a.x, a.y).map((v) => Number(v.toFixed(6)));
      const [slat, slon] = c.toLL(c.station.x, c.station.y).map((v) => Number(v.toFixed(6)));
      m.objectives.push({ kind: "loiter", label: `Relay (${placeNear(a.x, a.y)})`, tail: a.tail, lat, lon, alt_m: 120, offset_min: 0, duration_min: a.minutes, relay: true });
      m.objectives.push({ kind: "rtb", label: "Recover at GCS", tail: a.tail, lat: slat, lon: slon, alt_m: 0, offset_min: a.minutes + 1, duration_min: 4 });
      return { note: `${a.tail} added as a relay ${placeNear(a.x, a.y)}`, changes_plan: true };
    }
    if (kind === "band") {
      m.band = rest[0];
      return { note: `C2 moved to ${BANDS[rest[0]].label}`, changes_plan: true };
    }
    if (kind === "preheat") {
      m.preheat = { ...(m.preheat ?? {}), [rest[0]]: Number(rest[1]) };
      const t = r.tails.find((x) => x.tail === rest[0]);
      return { note: `${rest[0]} pack preheat added to the launch tasks: out of the warmer at ${t?.pack.preheat.out_c} °C`, changes_plan: false };
    }
    if (kind === "swap") {
      const [from, to] = rest;
      for (const o of m.objectives) if (o.tail === from) o.tail = to;
      if (m.preheat?.[from] !== undefined) delete m.preheat[from];
      return { note: `${from}'s legs given to ${to} for thrust and energy margin`, changes_plan: true };
    }
    return null;
  }

  return { run, apply, launchChecks, forecastOf };
}

const ASSUMED_EFF = 0.6;
const minutes = (s) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstSentence = (s) => `${s.split(". ")[0].replace(/\.$/, "")}.`;
