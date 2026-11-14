// Pictures for the first responder program: the harbor, the shift, the chain, the roster and the month.
// Drawn in SVG from the page's own data, like src/viz; every one points at a decision on the page.

import type { ReactNode } from "react";

/* ------------------------------------------------------------ shared bits */

/** A ring that fills to a fraction: a dock's charge, an aircraft's battery. */
export function Ring({ pct, size = 44, tone, label, children }: { pct: number; size?: number; tone: "ok" | "warn" | "bad" | "accent" | "muted"; label: string; children?: ReactNode }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className={`rv-ring tone-${tone}`} role="img" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="rv-ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="rv-ring-fill" strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="rv-ring-in">{children ?? `${Math.round(p)}`}</span>
    </span>
  );
}

/* ------------------------------------------------------------ Respond */

interface MapDock { id: string; name: string; x: number; y: number; tail: string; charge: number; state: string }
interface MapCall { id: string; kind: string; priority: number; x: number; y: number; place: string }
interface MapFlight { id: string; tail: string; dock: string; phase: string; x: number; y: number; eta_s: number; target: { x: number; y: number }; alert: { level: string } | null; terminated: unknown }
export interface HarborData {
  map: { width_m: number; height_m: number; water: number[][][]; places: { id: string; label: string; x: number; y: number }[]; structures: { id: string; label: string; x0: number; y0: number; x1: number; y1: number; height_m: number }[] };
  docks: MapDock[];
  queue: MapCall[];
  flights: MapFlight[];
  weather: { wind_mps: number; gust_mps: number; wind_from_deg?: number };
}

const VW = 600;
const VH = 400;
/** Reach in 90 s from a ready dock: 20 s to launch, then 70 s at the 15 m/s cruise (the server's own model). */
const REACH_M = 70 * 15;

/** The harbor as the supervisor and pilot see it: docks with their charge and 90-second reach, calls waiting, aircraft on their routes. */
export function HarborMap({ d }: { d: HarborData }) {
  const W = d.map.width_m;
  const H = d.map.height_m;
  const X = (x: number) => (x / W) * VW;
  const Y = (y: number) => VH - (y / H) * VH;
  const R = (m: number) => (m / W) * VW;
  const dockOf = (id: string) => d.docks.find((k) => k.id === id);
  const windFrom = d.weather.wind_from_deg ?? 270;
  const ready = d.docks.filter((k) => k.state === "ready");
  return (
    <div className="rv-map-wrap">
      <svg className="rs-map rv-map" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`Harbor map: ${d.docks.length} docks (${ready.length} ready), ${d.queue.length} calls waiting, ${d.flights.length} aircraft in flight`} data-testid="harbor-map">
        <defs>
          <pattern id="rv-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" className="rv-gridline" /></pattern>
          <pattern id="rv-waves" width="24" height="12" patternUnits="userSpaceOnUse"><path d="M0 8 Q6 4 12 8 T24 8" className="rv-wave" /></pattern>
          <pattern id="rv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="rv-hatchline" /></pattern>
          <linearGradient id="rv-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0e2a3b" /><stop offset="1" stopColor="#0a1f2c" /></linearGradient>
          <radialGradient id="rv-reach"><stop offset="0" stopColor="rgba(63,214,154,0.10)" /><stop offset="1" stopColor="rgba(63,214,154,0.02)" /></radialGradient>
          <marker id="rv-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" className="rv-arrowhead" /></marker>
        </defs>
        <rect width={VW} height={VH} className="rv-land" />
        <rect width={VW} height={VH} fill="url(#rv-grid)" />
        {d.map.water.map((poly, i) => {
          const pts = poly.map((pt) => `${X(pt[0] ?? 0)},${Y(pt[1] ?? 0)}`).join(" ");
          return (
            <g key={i}>
              <polygon points={pts} fill="url(#rv-water)" className="rv-water" />
              <polygon points={pts} fill="url(#rv-waves)" className="rv-waves" />
            </g>
          );
        })}
        {d.map.places.map((p) => <circle key={p.id} cx={X(p.x)} cy={Y(p.y)} r="1.6" className="rv-place" />)}
        {ready.map((k) => <circle key={`r-${k.id}`} cx={X(k.x)} cy={Y(k.y)} r={R(REACH_M)} fill="url(#rv-reach)" className="rv-reach" />)}
        {d.map.structures.map((s) => (
          <g key={s.id} className="rv-struct">
            <rect x={X(s.x0)} y={Y(s.y1)} width={X(s.x1) - X(s.x0)} height={Y(s.y0) - Y(s.y1)} fill="url(#rv-hatch)" />
            <rect x={X(s.x0)} y={Y(s.y1)} width={X(s.x1) - X(s.x0)} height={Y(s.y0) - Y(s.y1)} className="rv-struct-edge" />
            <text x={X(s.x0)} y={Y(s.y1) - 5}>{s.label}<tspan className="rv-h"> {s.height_m} m</tspan></text>
          </g>
        ))}
        {d.flights.map((f) => {
          const k = dockOf(f.dock);
          const kx = X(k?.x ?? f.x);
          const ky = Y(k?.y ?? f.y);
          const back = f.phase === "returning";
          return (
            <g key={`route-${f.id}`}>
              <line className="rv-route" x1={kx} y1={ky} x2={X(f.target.x)} y2={Y(f.target.y)} />
              <line className={`rv-trail${back ? " is-back" : ""}`} x1={back ? X(f.target.x) : kx} y1={back ? Y(f.target.y) : ky} x2={X(f.x)} y2={Y(f.y)} />
            </g>
          );
        })}
        {d.queue.map((c) => {
          const cx = X(c.x);
          const cy = Y(c.y);
          const right = cx > 430;
          const label = `${c.id} ${c.kind}`;
          const w = label.length * 6.1 + 12;
          return (
            <g key={c.id} className={`rv-call p${c.priority}`}>
              <circle cx={cx} cy={cy} r="7" className="rv-pulse" />
              <circle cx={cx} cy={cy} r="7" className="rv-pulse rv-pulse-2" />
              <circle cx={cx} cy={cy} r="5" className="rv-pin" />
              <g transform={`translate(${right ? cx - 12 - w : cx + 12} ${cy - 22})`}>
                <rect width={w} height="16" rx="8" className="rv-pill" />
                <text x="6" y="11.5">{label}</text>
              </g>
            </g>
          );
        })}
        {d.flights.map((f) => {
          const tx = X(f.target.x);
          const ty = Y(f.target.y);
          return (
            <g key={`scene-${f.id}`} className={`rv-scene${f.phase === "on_scene" ? " is-on" : ""}`}>
              <circle cx={tx} cy={ty} r="14" className="rv-orbit" />
              <circle cx={tx} cy={ty} r="3" className="rv-scene-dot" />
            </g>
          );
        })}
        {d.docks.map((k) => {
          const x = X(k.x);
          const y = Y(k.y);
          const r = 10;
          const c = 2 * Math.PI * r;
          return (
            <g key={k.id} className={`rv-dock is-${k.state}`}>
              <circle cx={x} cy={y} r={r} className="rv-dock-track" />
              <circle cx={x} cy={y} r={r} className="rv-dock-charge" strokeDasharray={`${(Math.min(100, k.charge) / 100) * c} ${c}`} transform={`rotate(-90 ${x} ${y})`} />
              <rect x={x - 5} y={y - 5} width="10" height="10" rx="2" className="rv-dock-pad" />
              <text x={x + 15} y={y + 4} className="rv-dock-label">{k.id}<tspan className="rv-h"> {k.state === "out" ? "out" : `${Math.round(k.charge)}%`}</tspan></text>
            </g>
          );
        })}
        {d.flights.map((f) => {
          const k = dockOf(f.dock);
          const toX = f.phase === "returning" ? X(k?.x ?? f.x) : X(f.target.x);
          const toY = f.phase === "returning" ? Y(k?.y ?? f.y) : Y(f.target.y);
          const x = X(f.x);
          const y = Y(f.y);
          const deg = (Math.atan2(toY - y, toX - x) * 180) / Math.PI;
          const bad = f.alert?.level === "no-go" && !f.terminated;
          return (
            <g key={f.id} className={`rv-ac${bad ? " is-bad" : ""}`}>
              <circle cx={x} cy={y} r="11" className="rv-ac-halo" />
              <path d="M7 0 L-5 -5 L-2 0 L-5 5 Z" transform={`translate(${x} ${y}) rotate(${f.phase === "on_scene" ? 0 : deg})`} className="rv-ac-body" />
              <g transform={`translate(${x + 12} ${y + 8})`}>
                <rect width={f.eta_s ? 92 : 50} height="16" rx="4" className="rv-tag" />
                <text x="5" y="11.5">{f.tail}{f.eta_s ? <tspan className="rv-h"> {f.eta_s} s</tspan> : null}</text>
              </g>
            </g>
          );
        })}
        <g className="rv-compass" transform={`translate(${VW - 34} 34)`}>
          <circle r="20" className="rv-compass-ring" />
          <text y="-24" textAnchor="middle">N</text>
          <line x1="0" y1="0" x2="0" y2="-26" transform={`rotate(${windFrom + 180})`} className="rv-wind" markerEnd="url(#rv-arrow)" />
          <text y="34" textAnchor="middle" className="rv-h">{d.weather.wind_mps}/{d.weather.gust_mps} m/s</text>
        </g>
        <g className="rv-scale" transform={`translate(14 ${VH - 16})`}>
          <line x1="0" y1="0" x2={R(1000)} y2="0" />
          <line x1="0" y1="-4" x2="0" y2="4" />
          <line x1={R(1000)} y1="-4" x2={R(1000)} y2="4" />
          <text x={R(1000) + 6} y="4">1 km</text>
        </g>
      </svg>
      <div className="rv-legend" aria-hidden="true">
        <span><i className="rv-k-dock" /> Dock, ring is charge</span>
        <span><i className="rv-k-reach" /> 90 s reach from a ready dock</span>
        <span><i className="rv-k-call" /> Call waiting</span>
        <span><i className="rv-k-ac" /> Aircraft and route</span>
        <span><i className="rv-k-struct" /> Tall structure, height AGL</span>
        <span className="meta">Schematic harbor, not a real port's layout</span>
      </div>
    </div>
  );
}

/** Wind and gust against the waiver limits, as two arcs on one dial. */
export function WindDial({ wind, gust, windLimit, gustLimit }: { wind: number; gust: number; windLimit: number; gustLimit: number }) {
  const max = Math.max(gustLimit * 1.25, gust + 1);
  const arc = (v: number, r: number) => {
    const a = Math.PI * (1 - Math.min(v, max) / max);
    return `M ${50 - r} 50 A ${r} ${r} 0 0 1 ${50 + r * Math.cos(a)} ${50 - r * Math.sin(a)}`;
  };
  const tick = (v: number, r0: number, r1: number) => {
    const a = Math.PI * (1 - v / max);
    return { x1: 50 + r0 * Math.cos(a), y1: 50 - r0 * Math.sin(a), x2: 50 + r1 * Math.cos(a), y2: 50 - r1 * Math.sin(a) };
  };
  const tone = gust > gustLimit || wind > windLimit ? "bad" : gust >= gustLimit - 1 || wind >= windLimit - 1 ? "warn" : "ok";
  return (
    <svg viewBox="0 0 100 58" className={`rv-dial tone-${tone}`} role="img" aria-label={`Wind ${wind} m/s against a ${windLimit} m/s limit, gusts ${gust} against ${gustLimit}`}>
      <path d={arc(max, 40)} className="rv-dial-track" />
      <path d={arc(max, 30)} className="rv-dial-track" />
      <path d={arc(gust, 40)} className="rv-dial-gust" />
      <path d={arc(wind, 30)} className="rv-dial-wind" />
      <line {...tick(gustLimit, 34, 46)} className="rv-dial-limit" />
      <line {...tick(windLimit, 24, 36)} className="rv-dial-limit" />
    </svg>
  );
}

/** Where the aircraft is in its flight: launching, en route, on scene, returning, docked. */
export function PhaseSteps({ phase }: { phase: string }) {
  const steps = [["launching", "Launch"], ["en_route", "En route"], ["on_scene", "On scene"], ["returning", "Return"], ["docked", "Docked"]] as const;
  const at = steps.findIndex(([k]) => k === phase);
  return (
    <ol className="rv-steps" aria-label={`Flight phase: ${steps[at]?.[1] ?? phase}`}>
      {steps.map(([k, label], i) => <li key={k} className={i < at ? "is-done" : i === at ? "is-now" : undefined}><i />{label}</li>)}
    </ol>
  );
}

interface ShiftCall { id: string; kind: string; received_at: number; status: string; priority?: number }
/** The shift from start to end: every call so far as a mark, coloured by what happened to it, and where now is. */
export function ShiftLine({ start, end, now, calls }: { start: string; end: string; now: number; calls: ShiftCall[] }) {
  const t0 = Date.parse(start);
  const t1 = Date.parse(end);
  const span = Math.max(1, t1 - t0);
  const pos = (t: number) => `${Math.max(0, Math.min(100, ((t - t0) / span) * 100))}%`;
  const hours: number[] = [];
  for (let t = Math.ceil(t0 / 3_600_000) * 3_600_000; t <= t1; t += 3_600_000 * 2) hours.push(t);
  const tone = (s: string) => (s === "flown" ? "ok" : s === "declined" ? "bad" : s === "cancelled" ? "muted" : s === "approved" ? "accent" : "warn");
  return (
    <div className="rv-shiftline" data-testid="shift-line">
      <div className="rv-shiftline-bar">
        <span className="rv-shiftline-done" style={{ width: pos(now) }} />
        {calls.map((c) => (
          <span key={c.id} className={`rv-mark tone-${tone(c.status)}`} style={{ left: pos(c.received_at) }} title={`${c.id} ${c.kind}: ${c.status}`} />
        ))}
        <span className="rv-now" style={{ left: pos(now) }}><em>now</em></span>
      </div>
      <div className="rv-shiftline-axis" aria-hidden="true">
        {hours.map((h) => <span key={h} style={{ left: pos(h) }}>{new Date(h).toISOString().slice(11, 16)}Z</span>)}
      </div>
      <div className="rv-legend" aria-hidden="true">
        <span><i className="tone-ok" /> Flown</span>
        <span><i className="tone-warn" /> Waiting</span>
        <span><i className="tone-accent" /> Approved</span>
        <span><i className="tone-bad" /> Declined by the pilot</span>
        <span><i className="tone-muted" /> Stood down</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Flight records */

export interface Block { id: string; label: string; sub: string; hash: string; kind: "record" | "correction" | "log" | "mishap" }

/** The newest sealed versions as linked blocks: each one carries the hash of the one before, so a changed record breaks the chain. */
export function ChainStrip({ blocks, intact, rows }: { blocks: Block[]; intact: boolean; rows: number }) {
  return (
    <div className="rv-chain" data-testid="chain-strip">
      <div className="rv-chain-row">
        {rows > blocks.length ? <span className="rv-chain-more">+{rows - blocks.length} earlier</span> : null}
        {blocks.map((b, i) => (
          <span key={b.id + b.hash} className="rv-chain-cell">
            {i > 0 || rows > blocks.length ? <i className={`rv-link${intact ? "" : " is-broken"}`} aria-hidden="true" /> : null}
            <span className={`rv-block is-${b.kind}${i === blocks.length - 1 ? " is-head" : ""}`}>
              <strong>{b.label}</strong>
              <span className="meta">{b.sub}</span>
              <code>{b.hash.slice(0, 10)}</code>
            </span>
          </span>
        ))}
      </div>
      <p className={`rv-chain-verdict ${intact ? "is-ok" : "is-bad"}`}>{intact ? `Intact: all ${rows} sealed versions verify, each against the hash of the one before.` : "Broken: a sealed version no longer matches the hash that follows it."}</p>
    </div>
  );
}

/* ------------------------------------------------------------ Pilots and roster */

interface RosterDay { date: string; pilot: string | null; pilot_name: string | null; supervised_by_name: string | null; flags: string[] }
/** Fourteen days of console cover at a glance: who sits each day, who supervises, and the days with a problem. */
export function RosterStrip({ days, today, solo }: { days: RosterDay[]; today: string; solo: (id: string) => boolean }) {
  const initials = (n: string | null) => (n ? n.replace(/^[A-Z]\.\s*/, "") : "—");
  return (
    <ol className="rv-roster" aria-label="Roster, next 14 days" data-testid="roster-strip">
      {days.map((d) => {
        const tone = d.flags.length ? (d.pilot ? "bad" : "gap") : d.pilot && !solo(d.pilot) ? "warn" : "ok";
        const dt = new Date(`${d.date}T12:00:00Z`);
        return (
          <li key={d.date} className={`rv-day tone-${tone}${d.date === today ? " is-today" : ""}`} title={`${d.date}: ${d.pilot_name ?? "nobody"}${d.supervised_by_name ? `, supervised by ${d.supervised_by_name}` : ""}${d.flags.length ? `. ${d.flags.join(" ")}` : ""}`}>
            <span className="rv-dow">{dt.toUTCString().slice(0, 3)}</span>
            <span className="rv-dom">{d.date.slice(8)}</span>
            <strong>{d.pilot ? initials(d.pilot_name) : "Gap"}</strong>
            <span className="rv-sub">{d.flags.length ? (d.pilot ? "Can't work" : "Unstaffed") : d.supervised_by_name ? `+ ${initials(d.supervised_by_name)}` : d.date === today ? "Today" : " "}</span>
          </li>
        );
      })}
    </ol>
  );
}

const SHORT: Record<string, string> = { cert: "Part 107", recurrent: "Recurrent", hours: "PIC hours", airspace: "Airspace", background: "Background", twic: "TWIC", cjis: "CJIS", supervised: "Supervised", solo: "Solo sign-off" };
interface FileItem { key: string; label: string; value: string; level: "ok" | "warn" | "fail" }
/** Every pilot's file in one grid: a row per pilot, a cell per credential, so a lapsed item stands out before it costs a shift. */
export function CurrencyGrid({ pilots, onPick }: { pilots: { id: string; name: string; items: FileItem[]; assignable: boolean; solo: boolean }[]; onPick: (id: string) => void }) {
  const cols = pilots[0]?.items.map((x) => ({ key: x.key, label: x.label })) ?? [];
  return (
    <div className="table-wrap" tabIndex={0}>
      <table className="rv-grid" data-testid="currency-grid">
        <thead><tr><th>Pilot</th>{cols.map((c) => <th key={c.key} title={c.label}>{SHORT[c.key] ?? c.label}</th>)}<th>Status</th></tr></thead>
        <tbody>
          {pilots.map((p) => (
            <tr key={p.id}>
              <th scope="row"><button type="button" className="btn btn-quiet" onClick={() => onPick(p.id)}>{p.name}</button></th>
              {cols.map((c) => {
                const it = p.items.find((x) => x.key === c.key);
                return <td key={c.key}><span className={`rv-cell is-${it?.level ?? "ok"}`} title={`${c.label}: ${it?.value ?? ""}`}>{it?.level === "ok" ? "✓" : it?.level === "warn" ? "!" : "✕"}</span></td>;
              })}
              <td>{!p.assignable ? <span className="th-check is-fail">Can't be rostered</span> : p.solo ? <span className="th-check is-ok">Solo</span> : <span className="th-check is-warn">Supervised</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ Report and invoice */

interface DayLine { shift: string; date: string; pilot: string; scheduled_h: number; staffed_h: number; billable_h: number; held_h: number; excluded_h: number; notes: string[] }
/** The month a shift at a time: each bar is one day's scheduled console hours, split into payable, held, not payable and unstaffed. */
export function MonthBars({ lines, picked, onPick }: { lines: DayLine[]; picked: string | null; onPick: (shift: string) => void }) {
  const max = Math.max(...lines.map((l) => l.scheduled_h), 1);
  return (
    <div className="rv-month" data-testid="month-bars">
      <div className="rv-bars" role="group" aria-label="Console hours by day">
        {lines.map((l) => {
          const unstaffed = Math.max(0, l.scheduled_h - l.staffed_h);
          // Unstaffed hours are also counted as not payable on the line; draw them once, as the gap.
          const lapsed = Math.max(0, Math.round((l.excluded_h - unstaffed) * 10) / 10);
          const seg = (h: number) => `${(h / max) * 100}%`;
          return (
            <button
              key={l.shift}
              type="button"
              className={`rv-bar${picked === l.shift ? " is-on" : ""}${l.notes.length ? " has-note" : ""}`}
              aria-pressed={picked === l.shift}
              aria-label={`${l.date}, ${l.pilot}: ${l.billable_h} h payable${l.held_h ? `, ${l.held_h} h held` : ""}${lapsed ? `, ${lapsed} h not payable` : ""}${unstaffed ? `, ${unstaffed} h unstaffed` : ""}`}
              onClick={() => onPick(l.shift)}
            >
              <span className="rv-seg is-gap" style={{ height: seg(unstaffed) }} />
              <span className="rv-seg is-ex" style={{ height: seg(lapsed) }} />
              <span className="rv-seg is-held" style={{ height: seg(l.held_h) }} />
              <span className="rv-seg is-pay" style={{ height: seg(l.billable_h) }} />
              <em>{l.date.slice(8)}</em>
            </button>
          );
        })}
      </div>
      <div className="rv-legend" aria-hidden="true">
        <span><i className="tone-ok" /> Payable</span>
        <span><i className="tone-warn" /> Held until a record is filed</span>
        <span><i className="tone-bad" /> Not payable: pilot not current</span>
        <span><i className="rv-k-gap" /> Unstaffed</span>
        <span className="meta">Pick a day to see its invoice line.</span>
      </div>
    </div>
  );
}

/** One bar for the month's money: what bills, what waits, what never bills. */
export function PayBar({ pay, held, excluded: allOut, gap }: { pay: number; held: number; excluded: number; gap: number }) {
  // The invoice counts unstaffed hours as not payable too; show them once, as the gap.
  const excluded = Math.max(0, Math.round((allOut - gap) * 10) / 10);
  const total = Math.max(1, pay + held + excluded + gap);
  const w = (h: number) => `${(h / total) * 100}%`;
  return (
    <div className="rv-paybar" role="img" aria-label={`${pay} h payable, ${held} h held, ${excluded} h not payable, ${gap} h unstaffed`}>
      <span className="is-pay" style={{ width: w(pay) }}>{pay > total * 0.2 ? `${pay} h payable` : ""}</span>
      <span className="is-held" style={{ width: w(held) }} />
      <span className="is-ex" style={{ width: w(excluded) }} />
      <span className="is-gap" style={{ width: w(gap) }} />
    </div>
  );
}
