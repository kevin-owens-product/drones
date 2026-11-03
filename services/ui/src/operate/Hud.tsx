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

export function Hud({ vehicle }: { vehicle: Vehicle | null }): JSX.Element {
  const p = vehicle?.live ?? null;
  const denied = p?.gnss_trusted === false;
  return (
    <figure className="hud" aria-label="Flight display">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden={p ? undefined : true}>
        <defs>
          <pattern id="hud-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" className="hud-grid" />
          </pattern>
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
