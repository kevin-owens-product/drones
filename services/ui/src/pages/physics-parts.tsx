// The physics pieces the plan, the loadout planner and the airframe pages share:
// the check's shape as the API returns it, and the charts that draw it.
import type { ReactNode } from "react";
import type { MapMarker, MapPath, RangeFrame } from "./RangeMap";
import "./insights.css";
import "./physics.css";

export type Severity = "no-go" | "caution" | "info";
export interface Fix {
  id: string;
  kind: "altitude" | "relay" | "band" | "preheat" | "swap";
  label: string;
  detail?: string;
  changes_plan: boolean;
}
export interface Finding {
  id: string;
  area: "link" | "pack" | "thrust";
  severity: Severity;
  tail: string;
  title: string;
  detail: string;
  fixes: Fix[];
}
export interface PackSide {
  min_v: number;
  climb_out_v: number | null;
  climb_out_punch_v: number | null;
  cutoff: { t: number; v_cell: number; soc: number } | null;
  end_soc: number | null;
  end_temp_c: number | null;
  max_temp_c: number;
}
export interface TailCheck {
  tail: string;
  sku: string;
  airframe: string;
  minutes: number;
  link: { c2_min_db: number | null; video_min_db: number | null; c2_lost_s: number; c2_thin_s: number; video_lost_s: number; cause: string };
  track: [number, number, number, number, number][];
  pack: {
    label: string;
    cutoff_v: number;
    start_pct: number;
    cold: PackSide;
    warm: PackSide;
    preheat: { needed: boolean; launch_c: number | null; out_c: number | null; warm_min: number | null; planned: number | null; done: boolean };
    trace: { t: number; v: number; temp: number; soc: number; v_warm: number | null; temp_warm: number | null }[];
  };
  thrust: { verdict: string; headroom: number; thrust_max_n: number; thrust_gust_n: number; tilt_gust_deg: number; gust_mps: number; density_altitude_m: number; cell_v: number; max_wind_mps: number };
}
export interface PhysicsCheck {
  source: string;
  forecast: { temp_c: number; wind_mps: number; wind_from_deg: number; gust_mps: number; ew: boolean };
  band: string;
  bands: { id: string; label: string }[];
  emitter: { x: number; y: number; label: string; on: boolean };
  relays: { tail: string; x: number; y: number; agl: number }[];
  tails: TailCheck[];
  findings: Finding[];
  verdict: "go" | "caution" | "no-go";
  profile: { tail: string; from: string; to: string; distance_m: number; clearance_f1: number; diffraction_db: number; rows: { d_m: number; ground_m: number; los_m: number; fresnel60_m: number }[] } | null;
  envelope?: EnvelopeGrid;
  range: RangeFrame;
}


export interface EnvelopeGrid {
  airframe: string;
  tail?: string;
  temps: number[];
  winds: number[];
  cells: { temp_c: number; wind_mps: number; headroom: number; verdict: string }[];
  now: { temp_c: number; wind_mps: number };
}

export const AREA_LABEL: Record<Finding["area"], string> = { link: "Link", pack: "Pack", thrust: "Thrust" };
export const marginColor = (db: number) => (db < 0 ? "var(--danger)" : db < 10 ? "var(--warn)" : "var(--ok)");
export const fmtMin = (s: number) => (s < 90 ? `${s} s` : `${(s / 60).toFixed(1)} min`);

/** Each tail's planned track as map paths, split into runs coloured by video margin, plus relay markers. */
export function linkLayer(check: PhysicsCheck, selected: string): { paths: MapPath[]; markers: MapMarker[] } {
  const paths: MapPath[] = [];
  const markers: MapMarker[] = [];
  for (const t of check.tails) {
    let run: [number, number][] = [];
    let cls = "";
    const flush = (k: number) => {
      if (run.length > 1) paths.push({ id: `${t.tail}-${k}`, color: cls, pts: run, faded: selected !== "" && t.tail !== selected });
    };
    t.track.forEach(([x, y, , video], k) => {
      const c = marginColor(video);
      if (c !== cls && run.length) {
        run.push([x, y]);
        flush(k);
        run = [];
      }
      cls = c;
      run.push([x, y]);
    });
    flush(t.track.length);
    const mid = t.track[Math.floor(t.track.length / 2)];
    if (mid) markers.push({ id: t.tail, label: t.tail, x: mid[0], y: mid[1], color: t.tail === selected ? "var(--accent)" : "#c9d4df", dim: selected !== "" && t.tail !== selected });
  }
  for (const r of check.relays) markers.push({ id: `relay-${r.tail}`, label: `${r.tail} relay`, x: r.x, y: r.y, color: "#b6a5ff" });
  return { paths, markers };
}

/** The EW emitter drawn on a RangeMap, when it is on. */
export function EmitterMark({ emitter }: { emitter: PhysicsCheck["emitter"] }): ReactNode {
  if (!emitter.on) return null;
  return (
    <g>
      <circle cx={emitter.x} cy={-emitter.y} r={120} className="ph-emitter" />
      <text x={emitter.x + 160} y={-emitter.y + 40} className="rm-place-label" fontSize={70}>
        {emitter.label}
      </text>
    </g>
  );
}

/** Thrust in hand per tail against the 30% line. */
export function ThrustBars({ rows }: { rows: { tail: string; headroom: number; verdict: string; detail: string }[] }) {
  return (
    <ul className="ph-bars">
      {rows.map((t) => (
        <li key={t.tail}>
          <span className="ph-bar-label">{t.tail}</span>
          <span className="ph-bar">
            <span className={`ph-bar-fill ph-v-${t.verdict}`} style={{ width: `${Math.max(2, Math.min(100, t.headroom * 100))}%` }} />
            <span className="ph-bar-mark" style={{ left: "30%" }} />
          </span>
          <span className="ph-bar-value">{t.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function Profile({ p }: { p: NonNullable<PhysicsCheck["profile"]> }) {
  const W = 640;
  const H = 170;
  const lo = Math.min(...p.rows.map((r) => r.ground_m)) - 10;
  const hi = Math.max(...p.rows.map((r) => Math.max(r.ground_m, r.los_m))) + 15;
  const sx = (d: number) => (d / Math.max(1, p.distance_m)) * W;
  const sy = (z: number) => H - ((z - lo) / Math.max(1, hi - lo)) * H;
  const ground = `M0,${H} ${p.rows.map((r) => `L${sx(r.d_m)},${sy(r.ground_m)}`).join(" ")} L${W},${H} Z`;
  const los = p.rows.map((r, i) => `${i ? "L" : "M"}${sx(r.d_m)},${sy(r.los_m)}`).join(" ");
  const fz = p.rows.map((r, i) => `${i ? "L" : "M"}${sx(r.d_m)},${sy(r.fresnel60_m)}`).join(" ");
  return (
    <figure className="ph-profile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Terrain profile from ${p.from} to ${p.tail} at ${p.to}`} preserveAspectRatio="none">
        <path d={ground} className="ph-ground" />
        <path d={fz} className="ph-fresnel" vectorEffect="non-scaling-stroke" />
        <path d={los} className="ph-los" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="meta">
        Worst video point: {p.from} to {p.tail} at {p.to}, {(p.distance_m / 1000).toFixed(1)} km. Line of sight (solid) and the 60% Fresnel line (dashed) against the ground; clearance {p.clearance_f1} of the first Fresnel zone, {p.diffraction_db} dB lost to diffraction.
      </figcaption>
    </figure>
  );
}

export function PackChart({ t }: { t: TailCheck }) {
  const W = 640;
  const H = 170;
  const rows = t.pack.trace;
  if (!rows.length) return null;
  const T = rows.at(-1)!.t || 1;
  const vs = rows.flatMap((r) => [r.v, r.v_warm ?? r.v]);
  const lo = Math.min(t.pack.cutoff_v - 0.2, ...vs);
  const hi = Math.max(...vs) + 0.05;
  const sx = (s: number) => (s / T) * W;
  const sy = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (pick: (r: (typeof rows)[number]) => number | null) =>
    rows
      .filter((r) => pick(r) !== null)
      .map((r, i) => `${i ? "L" : "M"}${sx(r.t)},${sy(pick(r) as number)}`)
      .join(" ");
  const warm = rows.some((r) => r.v_warm !== null);
  return (
    <figure className="ph-profile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.tail} cell voltage through the sortie, cold-soaked and preheated`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={sy(t.pack.cutoff_v)} y2={sy(t.pack.cutoff_v)} className="ph-cutoff" vectorEffect="non-scaling-stroke" />
        <path d={line((r) => r.v)} className="ph-cold" vectorEffect="non-scaling-stroke" />
        {warm ? <path d={line((r) => r.v_warm)} className="ph-warm" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <figcaption className="meta">
        {t.tail} volts per cell over {t.minutes} min: cold-soaked at launch (blue){warm ? `, preheated to ${t.pack.preheat.launch_c ?? 35} °C (amber)` : ""}, cutoff {t.pack.cutoff_v} V (red). The pack ends at {t.pack.cold.end_temp_c} °C cold-soaked; it warms itself in flight.
      </figcaption>
    </figure>
  );
}

export function Envelope({ e }: { e: EnvelopeGrid }) {
  const cw = 100 / e.winds.length;
  const ch = 100 / e.temps.length;
  const temps = [...e.temps].reverse();
  const nearT = e.temps.reduce((a, b) => (Math.abs(b - e.now.temp_c) < Math.abs(a - e.now.temp_c) ? b : a), e.temps[0] ?? 0);
  const nearW = e.winds.reduce((a, b) => (Math.abs(b - e.now.wind_mps) < Math.abs(a - e.now.wind_mps) ? b : a), e.winds[0] ?? 0);
  return (
    <figure className="ph-envelope">
      <div className="ph-env-grid" role="img" aria-label={`${e.airframe} flight envelope`} aria-describedby={`env-cap-${e.airframe.replace(/\W+/g, "-")}`}>
        {temps.map((t, ti) =>
          e.winds.map((w, wi) => {
            const c = e.cells.find((x) => x.temp_c === t && x.wind_mps === w);
            const now = t === nearT && w === nearW;
            return (
              <span
                key={`${t}-${w}`}
                className={`ph-env-cell ph-v-${c?.verdict ?? "go"}${now ? " ph-env-now" : ""}`}
                style={{ left: `${wi * cw}%`, top: `${ti * ch}%`, width: `${cw}%`, height: `${ch}%` }}
                title={`${t} °C, ${w} m/s: ${Math.round((c?.headroom ?? 0) * 100)}% in hand`}
              >
                {Math.round((c?.headroom ?? 0) * 100)}
              </span>
            );
          }),
        )}
      </div>
      <figcaption className="meta" id={`env-cap-${e.airframe.replace(/\W+/g, "-")}`}>
        {e.airframe}{e.tail ? ` (${e.tail})` : ""}: % of thrust in hand by air temperature (rows, {temps[0]} °C at the top) and steady wind (columns, {e.winds[0]} to {e.winds.at(-1)} m/s), pack cold-soaked at half charge. The outlined cell is tonight.
      </figcaption>
    </figure>
  );
}
