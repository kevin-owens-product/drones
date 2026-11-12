// What the camera sees from a height. A brief says "observe gate 3" or "search
// the north field"; whether the vehicle sent can do that is geometry:
//
//   Resolution  One pixel covers range times the pixel's angle (the ground
//               sample distance). What an observer can tell from a picture
//               goes by pixels across the target's critical dimension: the
//               Johnson criteria, about 2 to detect, 8 to recognise, 13 to
//               identify. Height buys nothing here: every metre up is a
//               metre further away.
//   Coverage    A search flies parallel strips. The strip a nadir camera sees
//               is 2 h tan(HFOV/2) wide; lower than the strip spacing needs
//               and the search leaves gaps it never looked at.
//   Masking     An orbit looks in from the side. The lower it flies the
//               shallower the look, and the more ground hides behind anything
//               that stands up: an obstacle of height c hides c / tan(angle)
//               of ground behind it. Terrain between the orbit and the ground
//               is checked on the range's SRTM/NED heightmap.
//   Blur        A fixed camera on a moving vehicle smears the ground by speed
//               times exposure, which a low, fast search cannot out-resolve.
//
//   Link        The picture has to get back. The video downlink is priced over
//               the same terrain as the plan check (demo/rf.mjs), so a height
//               that resolves but sits in a radio shadow is not offered as good.
//
// So a search wants to be low enough to resolve and high enough to close its
// strips, and an orbit wants to be as high as its camera still resolves from.
// Assumed cameras and thresholds, textbook geometry; nothing measured.

import { AIRFRAMES } from "./physics.mjs";
import { RF, VIDEO, ground, hop } from "./rf.mjs";

/** The day camera each airframe carries (assumed by class, not a Neros specification). */
export const CAMERAS = {
  "ARCHER-5": { label: "Fixed FPV camera, 1080p, 110° wide", hfov_deg: 110, px_w: 1920, gimbal: false },
  "ARCHER-8": { label: "Stabilised EO camera, 4K, 60° wide", hfov_deg: 60, px_w: 3840, gimbal: true },
  "ARCHER-10": { label: "Stabilised EO zoom camera, 4K, 66° wide to 30° at the long end", hfov_deg: 30, hfov_wide_deg: 66, px_w: 3840, gimbal: true },
};

export const OPTICS = {
  person_m: 0.75, // critical dimension of a standing person (the root of height times width)
  detect_px: 2, // Johnson criteria, 50% probability, as pixels across the critical dimension
  recognise_px: 8,
  identify_px: 13,
  obstacle_m: 6, // what stands up in the way: a tree line, a wall, a truck
  watch_radius_m: 150, // the ground an "observe" task cares about, around its point
  exposure_s: 1 / 500, // daylight shutter
  sidelap: 0.2, // overlap a search wants between strips
  video_margin_db: 3, // a height counts as holding video with this much in hand
  min_alt_m: 30,
  max_alt_m: 150,
  step_m: 10,
};

/** What each kind of task needs to be worth flying, and the pattern the planner flies for it (missions.mjs workPath). */
export const NEEDS = {
  search: { px: OPTICS.detect_px, says: "detect a person", does: "detects", pattern: "strips", spacing_m: 110 },
  survey: { px: OPTICS.detect_px, says: "detect a person", does: "detects", pattern: "strips", spacing_m: 110 },
  observe: { px: OPTICS.recognise_px, says: "recognise a person", does: "recognises", pattern: "orbit", radius_m: 220 },
  inspect: { px: OPTICS.identify_px, says: "identify a person", does: "identifies", pattern: "orbit", radius_m: 60 },
};

export const RELAY_ALT_M = 110;

/** Angle one pixel covers, radians. */
export const ifov = (cam, wide = false) => (2 * Math.tan((((wide ? cam.hfov_wide_deg : null) ?? cam.hfov_deg) * Math.PI) / 360)) / cam.px_w;

export function levelOf(px) {
  return px >= OPTICS.identify_px ? "identify" : px >= OPTICS.recognise_px ? "recognise" : px >= OPTICS.detect_px ? "detect" : "none";
}

/** Share of the watched ground the orbit can see over the terrain, from at least half of its positions. */
function terrainSeen(cx, cy, radius, alt) {
  const R = OPTICS.watch_radius_m;
  const eyes = Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * Math.PI * 2;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    return { x, y, z: ground(x, y) + alt };
  });
  let cells = 0;
  let seen = 0;
  for (let gx = -R; gx <= R; gx += 50) {
    for (let gy = -R; gy <= R; gy += 50) {
      if (Math.hypot(gx, gy) > R) continue;
      const tx = cx + gx;
      const ty = cy + gy;
      const tz = ground(tx, ty) + 1;
      let clear = 0;
      for (const e of eyes) {
        const d = Math.hypot(tx - e.x, ty - e.y);
        const n = Math.max(2, Math.ceil(d / 40));
        let ok = true;
        for (let i = 1; i < n; i += 1) {
          const f = i / n;
          if (ground(e.x + (tx - e.x) * f, e.y + (ty - e.y) * f) > e.z + (tz - e.z) * f) {
            ok = false;
            break;
          }
        }
        if (ok) clear += 1;
      }
      cells += 1;
      if (clear >= eyes.length / 2) seen += 1;
    }
  }
  return cells ? seen / cells : 1;
}

/** Worst video margin back to the GCS over the pattern the task flies, dB. */
function videoOver(station, place, need, alt, relays = []) {
  const pts = need.pattern === "strips" ? [[0, 0], [-360, 220], [360, 220], [-360, -220], [360, -220]] : Array.from({ length: 8 }, (_, k) => [need.radius_m * Math.cos((k * Math.PI) / 4), need.radius_m * Math.sin((k * Math.PI) / 4)]);
  const gcs = { x: station.x, y: station.y, agl: RF.gcs_mast_m };
  const ups = relays.map((r) => ({ r, up: hop(gcs, r, VIDEO.id).margin_db }));
  return Math.min(
    ...pts.map(([dx, dy]) => {
      const pt = { x: place.x + dx, y: place.y + dy, agl: alt };
      // Straight to the GCS, or through a relay the brief also asks for (the weaker of its two hops).
      return Math.max(hop(gcs, pt, VIDEO.id).margin_db, ...ups.map(({ r, up }) => Math.min(up, hop(r, pt, VIDEO.id).margin_db)));
    }),
  );
}

const r1 = (v) => Math.round(v * 10) / 10;
const cache = new Map();

/**
 * One airframe's camera against one task, at every height the planner may fly.
 *
 * @param {string} kind search | survey | observe | inspect
 * @param {{x: number, y: number}} place
 * @param {string} sku
 * @param {{x: number, y: number}} [station] the GCS, when the video link should count
 */
export function ladder(kind, place, sku, station = null, relays = []) {
  const need = NEEDS[kind];
  const cam = CAMERAS[sku];
  if (!need || !cam) return null;
  const key = `${kind}|${place.x}|${place.y}|${sku}|${station ? `${station.x},${station.y}` : ""}|${relays.map((r) => `${r.x},${r.y}`).join(";")}`;
  if (cache.has(key)) return cache.get(key);
  const frame = AIRFRAMES[sku];
  // A zoom lens searches at its wide end and watches a point at its long end.
  const hfov = (need.pattern === "strips" ? cam.hfov_wide_deg : null) ?? cam.hfov_deg;
  const rad = ifov(cam, need.pattern === "strips");
  const rows = [];
  for (let alt = OPTICS.min_alt_m; alt <= OPTICS.max_alt_m; alt += OPTICS.step_m) {
    const strips = need.pattern === "strips";
    const range = strips ? alt : Math.hypot(alt, need.radius_m);
    const gsd = range * rad;
    // A gimbal holds the picture still; a fixed camera smears it by the ground it crosses in one exposure.
    const blur = cam.gimbal ? 0 : (frame?.cruise_mps ?? 15) * OPTICS.exposure_s * (strips ? 1 : 0.5);
    const px = OPTICS.person_m / Math.hypot(gsd, blur);
    const row = { alt_m: alt, range_m: Math.round(range), gsd_cm: r1(gsd * 100), px: r1(px), level: levelOf(px) };
    if (strips) {
      const swath = 2 * alt * Math.tan((hfov * Math.PI) / 360);
      row.swath_m = Math.round(swath);
      row.cover = Math.min(1, Math.round((swath / need.spacing_m) * 100) / 100);
      row.closed = swath >= need.spacing_m * (1 + OPTICS.sidelap);
    } else {
      const look = Math.atan2(alt, need.radius_m);
      row.look_deg = Math.round((look * 180) / Math.PI);
      row.hidden_m = Math.round(OPTICS.obstacle_m / Math.tan(look));
      row.seen = Math.round(terrainSeen(place.x, place.y, need.radius_m, alt) * 100) / 100;
    }
    row.ok = px >= need.px && (strips ? row.closed : true);
    if (station) row.video_db = Math.round(videoOver(station, place, need, alt, relays));
    rows.push(row);
  }
  // Heights that also get the picture home come first; without one, the camera's own answer stands and the link is called out.
  const sees = rows.filter((r) => r.ok);
  const linked = sees.filter((r) => r.video_db === undefined || r.video_db >= OPTICS.video_margin_db);
  const good = linked.length ? linked : sees;
  const noLink = station && sees.length > 0 && linked.length === 0;
  // Strips: the lowest height that closes them is the most detail with no gaps. Orbit: the highest the camera still resolves from sees over the most.
  const best = need.pattern === "strips" ? good[0] : good.at(-1);
  // When nothing works, the height that comes closest: the first that closes the strips, or the lowest orbit.
  const fallback = need.pattern === "strips" ? (rows.find((r) => r.closed) ?? rows.at(-1)) : rows[0];
  const linkNote = noLink ? ` No height here holds video back to the GCS (${Math.max(...rows.map((r) => r.video_db))} dB at best${relays.length ? ", even through the relay" : ""}): it records, or the plan needs a relay${relays.length ? " somewhere else" : ""}.` : best && station && best.video_db !== undefined ? ` Video holds ${best.video_db} dB there${relays.length ? ", with the brief's relay up" : ""}.` : "";
  const out = {
    sku,
    airframe: frame?.label ?? sku,
    camera: cam.label,
    rows,
    recommended_m: (best ?? fallback).alt_m,
    can: Boolean(best),
    linked: !noLink,
    why: (best
      ? need.pattern === "strips"
        ? best === sees[0]
          ? `${best.alt_m} m is the lowest height where the ${best.swath_m} m strip closes the ${need.spacing_m} m spacing with ${Math.round(OPTICS.sidelap * 100)}% overlap; a person is ${best.px} px there.`
          : `The strips close from ${sees[0].alt_m} m, but video only gets home from ${best.alt_m} m: a person is ${best.px} px there, ${sees[0].px} px lower down.`
        : best === sees.at(-1)
          ? `${best.alt_m} m is the highest orbit this camera still ${need.does} a person from (${best.px} px at ${best.range_m} m): it looks down at ${best.look_deg}°, so a ${OPTICS.obstacle_m} m obstacle hides ${best.hidden_m} m of ground.`
          : `${best.alt_m} m is the highest orbit that both ${need.does} a person (${best.px} px) and holds video: it looks down at ${best.look_deg}°, so a ${OPTICS.obstacle_m} m obstacle hides ${best.hidden_m} m of ground.`
      : need.pattern === "strips"
        ? rows.some((r) => r.closed)
          ? `Where the strips close, a person is under ${need.px} px with this camera: it flies the pattern but cannot ${need.says}.`
          : `Even at ${rows.at(-1).alt_m} m this camera's strip is ${rows.at(-1).swath_m} m wide, short of the ${Math.round(need.spacing_m * (1 + OPTICS.sidelap))} m the ${need.spacing_m} m spacing needs: it leaves ${Math.round((1 - rows.at(-1).cover) * 100)}% of the ground unseen.`
        : `This camera cannot ${need.says} from a ${need.radius_m} m orbit at any height: ${rows[0].px} px at best, ${need.px} needed.`) + linkNote,
  };
  cache.set(key, out);
  return out;
}

/** The look for one task of a brief: what it needs and each assigned tail's ladder, with the height chosen for it. */
export function lookFor(task, place, skuOf, station = null, relays = []) {
  const need = NEEDS[task.kind];
  if (!need || !place) return null;
  const tails = (task.tails ?? [])
    .map((tail) => {
      const l = ladder(task.kind, place, skuOf(tail), station, relays);
      if (!l) return null;
      const alt = task.alt_m?.[tail] ?? l.recommended_m;
      const row = l.rows.find((r) => r.alt_m === alt) ?? l.rows.find((r) => r.alt_m === l.recommended_m);
      return { tail, ...l, alt_m: row.alt_m, at: row };
    })
    .filter(Boolean);
  if (!tails.length) return null;
  return {
    needs: need.says,
    need_px: need.px,
    pattern: need.pattern === "strips" ? `Strips ${need.spacing_m} m apart, camera straight down` : `Orbit ${need.radius_m} m out, camera on the point`,
    strips: need.pattern === "strips",
    tails,
  };
}

/** The height a filed plan flies a task's leg at. */
export function heightFor(task, place, tail, skuOf, station = null, relays = []) {
  if (task.alt_m?.[tail]) return task.alt_m[tail];
  return ladder(task.kind, place, skuOf(tail), station, relays)?.recommended_m ?? null;
}

/** Where a brief's own relay tasks put a relay, at the height the planner files them. */
export function relaysOf(plan, placeOf) {
  return plan
    .filter((t) => t.kind === "relay" && (t.tails ?? []).length)
    .map((t) => placeOf(t.place))
    .filter(Boolean)
    .map((p) => ({ x: p.x, y: p.y, agl: RELAY_ALT_M }));
}

export function describeOptics() {
  return { source: "Camera geometry (SIM): ground sample distance, Johnson criteria, strip width and look-angle masking over SRTM/NED terrain. Assumed cameras and thresholds, not measured.", assumptions: OPTICS, cameras: CAMERAS, needs: NEEDS };
}
