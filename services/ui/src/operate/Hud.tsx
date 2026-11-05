import type { JSX } from "react";
import type { Vehicle } from "./vehicle";
import { fmt } from "./vehicle";

const W = 480;
const H = 300;

function headingTape(heading: number | undefined): JSX.Element[] {
  const marks: JSX.Element[] = [];
  if (typeof heading !== "number") return marks;
  const pxPerDeg = 3;
  const names: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
  for (let d = Math.floor((heading - 70) / 5) * 5; d <= heading + 70; d += 5) {
    const x = W / 2 + (d - heading) * pxPerDeg;
    const deg = ((d % 360) + 360) % 360;
    const major = deg % 30 === 0;
    marks.push(<line key={`t${d}`} x1={x} x2={x} y1={28} y2={major ? 40 : 34} className="hud-ink" />);
    if (major) {
      marks.push(
        <text key={`l${d}`} x={x} y={22} className={names[deg] ? "hud-text hud-strong" : "hud-text"} textAnchor="middle">
          {names[deg] ?? String(deg / 10).padStart(2, "0")}
        </text>,
      );
    }
  }
  return marks;
}

function ladder(value: number | undefined, side: "left" | "right", step: number, major: number, pxPerUnit: number): JSX.Element[] {
  const out: JSX.Element[] = [];
  if (typeof value !== "number") return out;
  const x0 = side === "left" ? 64 : W - 64;
  const dir = side === "left" ? -1 : 1;
  const top = 78;
  const bottom = H - 46;
  out.push(<line key={`${side}-spine`} x1={x0} x2={x0} y1={top} y2={bottom} className="hud-ink hud-dim" />);
  const span = (H / 2) / pxPerUnit;
  for (let v = Math.ceil((value - span) / step) * step; v <= value + span; v += step) {
    const y = H / 2 - (v - value) * pxPerUnit;
    if (y < top || y > bottom) continue;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    out.push(<line key={`${side}${v}`} x1={x0} x2={x0 + dir * (isMajor ? 9 : 5)} y1={y} y2={y} className="hud-ink" />);
    if (isMajor && Math.abs(y - H / 2) > 16) {
      out.push(
        <text key={`${side}t${v}`} x={x0 + dir * 13} y={y + 4} className="hud-text" textAnchor={side === "left" ? "end" : "start"}>
          {Math.round(v)}
        </text>,
      );
    }
  }
  return out;
}

/** Horizon line and pitch ladder, rolled and shifted the way a flight display does. Degrees to pixels: 4 px per degree of pitch. */
function horizon(roll: number | undefined, pitch: number | undefined): JSX.Element | null {
  if (typeof roll !== "number" || typeof pitch !== "number") return null;
  const cx = W / 2;
  const cy = H / 2;
  const pxPerDeg = 4;
  const dy = pitch * pxPerDeg; // nose down (negative pitch) raises the horizon line on the display
  const rungs: JSX.Element[] = [];
  for (const d of [-10, -5, 5, 10]) {
    const y = cy + dy + d * pxPerDeg;
    const half = d % 10 === 0 ? 34 : 20;
    rungs.push(<line key={d} x1={cx - half} x2={cx + half} y1={y} y2={y} className="hud-ink hud-dim" />);
    if (d % 10 === 0) rungs.push(<text key={`t${d}`} x={cx + half + 6} y={y + 4} className="hud-text hud-dim">{Math.abs(d)}</text>);
  }
  return (
    <g transform={`rotate(${-roll} ${cx} ${cy})`} aria-hidden="true">
      <line x1={cx - 150} x2={cx - 60} y1={cy + dy} y2={cy + dy} className="hud-horizon" />
      <line x1={cx + 60} x2={cx + 150} y1={cy + dy} y2={cy + dy} className="hud-horizon" />
      {rungs}
    </g>
  );
}

/** Wind as an arrow the way it blows across the display, with its speed. */
function windArrow(speed: number | undefined, from: number | undefined, heading: number | undefined): JSX.Element | null {
  if (typeof speed !== "number" || typeof from !== "number") return null;
  // Relative to the nose when we know it, so the operator reads crosswind at a glance.
  const rel = ((from - (heading ?? 0)) * Math.PI) / 180;
  const cx = 56;
  const cy = H - 60;
  const len = 10 + Math.min(16, speed * 1.6);
  // The arrow points the way the air moves: away from "from".
  const tx = cx - Math.sin(rel) * len;
  const ty = cy + Math.cos(rel) * len;
  const hx = cx + Math.sin(rel) * len * 0.5;
  const hy = cy - Math.cos(rel) * len * 0.5;
  return (
    <g className="hud-wind">
      <circle cx={cx} cy={cy} r={22} className="hud-ink hud-dim" fill="none" />
      <line x1={hx} y1={hy} x2={tx} y2={ty} className="hud-accent" markerEnd="url(#hud-arrow)" />
      <text x={cx} y={cy + 36} textAnchor="middle" className="hud-text">{`WIND ${Math.round(speed)} m/s`}</text>
    </g>
  );
}

export function Hud({ vehicle }: { vehicle: Vehicle | null }): JSX.Element {
  const p = vehicle?.live ?? null;
  const denied = p?.gnss_trusted === false;
  const flying = p?.armed !== false;
  const spare = typeof p?.endurance_min === "number" && typeof p?.home_min === "number" ? p.endurance_min - p.home_min : null;
  return (
    <figure className="hud" aria-label="Flight display">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden={p ? undefined : true}>
        <defs>
          <pattern id="hud-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" className="hud-grid" />
          </pattern>
          <marker id="hud-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="hud-arrowhead" />
          </marker>
          <radialGradient id="hud-vignette" cx="50%" cy="50%" r="70%">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} className="hud-bg" />
        <rect width={W} height={H} fill="url(#hud-grid)" />
        <rect width={W} height={H} fill="url(#hud-vignette)" />
        {p ? (
          <>
            {flying ? horizon(p.roll_deg, p.pitch_deg) : null}
            {headingTape(p.heading_deg)}
            <path d={`M${W / 2 - 6} 46 L${W / 2} 40 L${W / 2 + 6} 46`} className="hud-accent" fill="none" />
            <text x={W / 2} y={62} textAnchor="middle" className="hud-num">{fmt(p.heading_deg, 0, "°")}</text>
            {ladder(p.ground_mps, "left", 1, 5, 7)}
            {ladder(p.alt_m, "right", 5, 20, 1.6)}
            <path d={`M10 ${H / 2 - 13} H58 L66 ${H / 2} L58 ${H / 2 + 13} H10 Z`} className="hud-box" />
            <text x={34} y={H / 2 + 5} textAnchor="middle" className="hud-num">{fmt(p.ground_mps, 1, "")}</text>
            <text x={14} y={70} className="hud-text">GS m/s</text>
            <path d={`M${W - 10} ${H / 2 - 13} H${W - 58} L${W - 66} ${H / 2} L${W - 58} ${H / 2 + 13} H${W - 10} Z`} className="hud-box" />
            <text x={W - 34} y={H / 2 + 5} textAnchor="middle" className="hud-num">{fmt(p.alt_m, 0, "")}</text>
            <text x={W - 14} y={70} textAnchor="end" className="hud-text">ALT m</text>
            <g className="hud-accent" fill="none">
              <circle cx={W / 2} cy={H / 2} r={18} />
              <line x1={W / 2 - 40} x2={W / 2 - 22} y1={H / 2} y2={H / 2} />
              <line x1={W / 2 + 22} x2={W / 2 + 40} y1={H / 2} y2={H / 2} />
              <line x1={W / 2} x2={W / 2} y1={H / 2 + 22} y2={H / 2 + 32} />
            </g>
            {flying ? windArrow(p.wind_mps, p.wind_from_deg, p.heading_deg) : null}
            {typeof p.roll_deg === "number" && flying ? <text x={W / 2} y={H / 2 + 50} textAnchor="middle" className="hud-text hud-dim">{`BANK ${Math.abs(p.roll_deg).toFixed(0)}° ${p.roll_deg > 0.5 ? "R" : p.roll_deg < -0.5 ? "L" : ""} · AIR ${fmt(p.air_mps, 0, "")} m/s`}</text> : null}
            {spare !== null && flying ? (
              <text x={W / 2} y={H - 34} textAnchor="middle" className={spare < 2 ? "hud-text hud-alert" : spare < 5 ? "hud-text hud-warn" : "hud-text"}>
                {`${fmt(p.power_w, 0, " W")} · ${Math.max(0, p.endurance_min ?? 0).toFixed(0)} MIN LEFT · ${(p.home_min ?? 0).toFixed(0)} MIN HOME${p.bingo ? " · BINGO" : ""}`}
              </text>
            ) : null}
            <text x={14} y={H - 16} className="hud-text hud-strong">{p.mode ?? "MODE —"}{p.armed === false ? " · DISARMED" : ""}</text>
            <text x={W / 2} y={H - 16} textAnchor="middle" className={denied || p.nav_source === "none" ? "hud-text hud-warn" : "hud-text"}>
              {p.nav_source === "none"
                ? "NO POSITION FIX"
                : denied
                  ? `GNSS REJECTED · ${(p.nav_source ?? "dead reckoning").toUpperCase()}${typeof p.pos_sigma_m === "number" ? ` ±${Math.round(2.45 * p.pos_sigma_m)} m` : ""}`
                  : "GNSS"}
            </text>
            <text x={W - 14} y={H - 16} textAnchor="end" className={(p.battery_pct ?? 100) < 25 ? "hud-text hud-alert" : "hud-text"}>
              BAT {fmt(p.battery_pct, 0, "%")}
            </text>
          </>
        ) : (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="hud-text hud-big">{vehicle ? "No link" : "Select a vehicle"}</text>
        )}
      </svg>
      <figcaption className="meta">Flight display from telemetry. No video on this link.</figcaption>
    </figure>
  );
}
