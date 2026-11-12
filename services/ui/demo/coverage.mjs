// Where the radio links hold over the range, as a grid: from the GCS mast to a
// drone at a set height above the ground, priced over the real terrain (rf.mjs:
// Bullington diffraction, Fresnel clearance, Earth bulge) with the EW emitter
// as interference when it is on. The denial map shows it beside the GNSS layer,
// because a route planner needs both: where position fails and where the link does.

import { BANDS, EMITTER, RF, VIDEO, ground, hop } from "./rf.mjs";

const cache = new Map();

/**
 * @param {{x: number, y: number}} station
 * @param {{x0: number, x1: number, y0: number, y1: number}} area
 * @param {{link?: "c2"|"video", band?: string, agl_m?: number, ew?: boolean, cell_m?: number}} o
 */
export function coverage(station, area, o = {}) {
  const link = o.link === "video" ? "video" : "c2";
  const band = link === "video" ? VIDEO.id : BANDS[o.band] ? o.band : "915";
  const agl = Math.max(20, Math.min(150, Number(o.agl_m) || 100));
  const ew = Boolean(o.ew);
  const cell = o.cell_m ?? 200;
  const key = JSON.stringify([station, area, link, band, agl, ew, cell]);
  if (cache.has(key)) return cache.get(key);
  const gcs = { x: station.x, y: station.y, agl: RF.gcs_mast_m };
  const emitter = ew ? EMITTER : null;
  const need = link === "video" ? 0 : RF.required_db;
  const cells = [];
  let held = 0;
  for (let y = area.y0 + cell / 2; y < area.y1; y += cell) {
    for (let x = area.x0 + cell / 2; x < area.x1; x += cell) {
      const m = Math.round(hop(gcs, { x, y, agl }, band, emitter).margin_db * 10) / 10;
      if (m >= need) held += 1;
      cells.push({ x, y, m });
    }
  }
  const out = {
    source: "Terrain radio model (SIM): SRTM/NED heightmap, Bullington diffraction, free-space loss, emitter as interference. Assumed link budgets, not measured.",
    link,
    band,
    band_label: link === "video" ? VIDEO.label : BANDS[band].label,
    bands: Object.values(BANDS).map((b) => ({ id: b.id, label: b.label })),
    agl_m: agl,
    ew,
    cell_m: cell,
    need_db: need,
    station: { ...station, ground_m: Math.round(ground(station.x, station.y)) },
    emitter: { x: EMITTER.x, y: EMITTER.y, label: EMITTER.label, on: ew && EMITTER.erp_dbm[band] !== null && EMITTER.erp_dbm[band] !== undefined },
    held_pct: Math.round((held / Math.max(1, cells.length)) * 100),
    cells,
  };
  if (cache.size > 32) cache.clear();
  cache.set(key, out);
  return out;
}
