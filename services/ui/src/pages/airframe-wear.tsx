// Wear by flight load, on the airframe it belongs to: each motor's bearing life
// used, the arms' fatigue, how both grew sortie by sortie against what a flat
// hours schedule would assume, and the maintainer's call.
import { useEffect, useState } from "react";
import { api } from "../api";
import "./physics.css";

interface Wear {
  tail: string;
  airframe: string;
  sorties: number;
  hours: number;
  eq_hours: number;
  load_factor: number;
  motors: { id: string; where: string; life_pct: number; eq_hours: number }[];
  worst: { id: string; where: string; life_pct: number };
  by_hours_pct: number;
  bearing: "ok" | "inspect" | "replace";
  inspect_in: number;
  replace_in: number;
  hours_schedule_in: number;
  frame: { fatigue_pct: number; state: "ok" | "inspect" | "replace"; hard_landings: { sortie: number; g: number; share_pct: number }[]; from_hard_pct: number };
  state: "ok" | "inspect" | "replace";
  curve: { n: number; hours: number; by_load: number; by_hours: number; frame: number }[];
  lines: { inspect_pct: number; frame_inspect_pct: number; l10_h: number };
  verdict: string;
}

const tone = (s: string) => (s === "replace" ? "no-go" : s === "inspect" ? "caution" : "go");

function WearChart({ w }: { w: Wear }) {
  const W = 640;
  const H = 170;
  const rows = w.curve;
  const last = rows.at(-1);
  if (!last) return null;
  const top = Math.max(110, ...rows.map((r) => Math.max(r.by_load, r.frame))) * 1.05;
  const sx = (n: number) => (n / last.n) * W;
  const sy = (v: number) => H - (Math.min(v, top) / top) * H;
  const line = (pick: (r: (typeof rows)[number]) => number) => rows.map((r, i) => `${i ? "L" : "M"}${sx(r.n)},${sy(pick(r))}`).join(" ");
  // The frame's fatigue moves in steps: draw it as one.
  const steps = rows.map((r, i) => (i ? `H${sx(r.n)}V${sy(r.frame)}` : `M${sx(r.n)},${sy(r.frame)}`)).join(" ");
  return (
    <figure className="ph-profile" data-testid="wear-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${w.tail} wear over ${w.sorties} sorties: bearing life by load and by hours, and frame fatigue`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={sy(100)} y2={sy(100)} className="ph-cutoff" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={sy(w.lines.inspect_pct)} y2={sy(w.lines.inspect_pct)} className="wr-inspect" vectorEffect="non-scaling-stroke" />
        <path d={line((r) => r.by_hours)} className="wr-hours" vectorEffect="non-scaling-stroke" />
        <path d={steps} className="wr-frame" vectorEffect="non-scaling-stroke" />
        <path d={line((r) => r.by_load)} className="ph-warm" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="meta">
        {w.sorties} sorties, {w.hours} h. Bearing life used on {w.worst.id} by load (amber) against the same hours counted flat (grey, {w.by_hours_pct}%); frame fatigue (violet) steps at each hard landing. Lines at {w.lines.inspect_pct}% (inspect) and 100%.
      </figcaption>
    </figure>
  );
}

/** The selected tail's wear, with the maintainer's action when something is due. */
export function WearPanel({ tail, canGround, busy, onGround }: { tail: string; canGround: boolean; busy: boolean; onGround: (reason: string) => void }) {
  const [w, setW] = useState<Wear | null>(null);
  useEffect(() => {
    let stopped = false;
    setW(null);
    void api<Wear>(`/v1/wear?tail=${encodeURIComponent(tail)}`)
      .then((r) => {
        if (!stopped && Array.isArray(r.body.motors)) setW(r.body);
      })
      .catch(() => {
        /* a tail with no flight log shows nothing */
      });
    return () => {
      stopped = true;
    };
  }, [tail]);
  if (!w) return null;
  const sooner = w.hours_schedule_in - w.inspect_in;
  return (
    <div className="birth" data-testid="wear">
      <h3>
        Wear by flight load <span className={`ms-lv ms-lv-${tone(w.state)}`}>{w.state === "ok" ? "nothing due" : w.state}</span>
      </h3>
      <p className={w.state === "ok" ? "meta" : `ph-v-${tone(w.state)}`}>{w.verdict}</p>
      <ul className="ph-bars wr-bars">
        {w.motors.map((m) => (
          <li key={m.id}>
            <span className="ph-bar-label">
              {m.id} <span className="meta">{m.where}</span>
            </span>
            <span className="ph-bar">
              <span className={`ph-bar-fill wr-fill-${m.life_pct >= 100 ? "replace" : m.life_pct >= w.lines.inspect_pct ? "inspect" : "ok"}`} style={{ width: `${Math.max(2, Math.min(100, m.life_pct))}%` }} />
              <span className="ph-bar-mark" style={{ left: `${w.lines.inspect_pct}%` }} />
            </span>
            <span className="ph-bar-value">{m.life_pct}%</span>
          </li>
        ))}
        <li>
          <span className="ph-bar-label">
            Arms <span className="meta">fatigue</span>
          </span>
          <span className="ph-bar">
            <span className={`ph-bar-fill wr-fill-${w.frame.state}`} style={{ width: `${Math.max(2, Math.min(100, w.frame.fatigue_pct))}%` }} />
            <span className="ph-bar-mark" style={{ left: `${w.lines.frame_inspect_pct}%` }} />
          </span>
          <span className="ph-bar-value">{w.frame.fatigue_pct}%</span>
        </li>
      </ul>
      <WearChart w={w} />
      <p className="meta ins-note">
        {w.hours} h flown count as {w.eq_hours} h of hover on {w.worst.id} ({w.load_factor}×): wind, payload and the rear rotors' extra share in forward flight.{" "}
        {sooner > 0 ? `A flat hours schedule would reach the inspection line ${w.hours_schedule_in} sorties from now; by load it is ${w.inspect_in === 0 ? "due now" : `${w.inspect_in} sorties away`}. ` : ""}
        {w.frame.hard_landings.length ? `Hard landings: ${w.frame.hard_landings.map((h) => `sortie ${h.sortie} at ${h.g} g (${h.share_pct}%)`).join(", ")}. ` : "No hard landings logged. "}
        Bearing life goes with thrust to the 3.5 (ISO 281, rated {w.lines.l10_h} h at hover); arm fatigue with landing load to the tenth. Synthetic flight log and assumed life figures (SIM).
      </p>
      {canGround && w.state !== "ok" ? (
        <button type="button" className="btn" disabled={busy} onClick={() => onGround(`Wear by flight load: ${w.verdict}`)}>
          Ground {w.tail} for {w.bearing !== "ok" ? "a motor check" : "a frame check"}
        </button>
      ) : null}
    </div>
  );
}
