// Small SVG/HTML chart primitives for the console. No chart library: each one
// is drawn from the page's own data, reads in the console's dark palette, and
// ends in something the user can click (a filter, a row, a tail).
import { useState, type KeyboardEvent } from "react";
import "./viz.css";

export type Tone = "ok" | "warn" | "bad" | "accent" | "muted";

const onKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/* ------------------------------------------------------------------ Donut */

export interface Slice { label: string; value: number; tone: Tone }

/** Ring chart with a big number in the middle. Slices are clickable when onPick is given. */
export function Donut({ slices, center, sub, size = 132, active, onPick }: { slices: Slice[]; center: string; sub?: string; size?: number; active?: string | null; onPick?: (label: string | null) => void }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <svg className="viz-donut" viewBox="0 0 132 132" width={size} height={size} role="img" aria-label={`${center} ${sub ?? ""}: ${slices.map((s) => `${s.value} ${s.label}`).join(", ")}`}>
      <circle cx="66" cy="66" r={r} className="viz-donut-track" />
      {slices.map((s) => {
        const len = (s.value / total) * c;
        const gap = slices.filter((x) => x.value > 0).length > 1 ? 2 : 0;
        const el = (
          <circle
            key={s.label}
            cx="66"
            cy="66"
            r={r}
            className={`viz-donut-seg tone-${s.tone}${active && active !== s.label ? " is-dim" : ""}${onPick ? " is-pick" : ""}`}
            strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
            strokeDashoffset={-at}
            transform="rotate(-90 66 66)"
            onClick={onPick ? () => onPick(active === s.label ? null : s.label) : undefined}
          >
            <title>{`${s.value} ${s.label}`}</title>
          </circle>
        );
        at += len;
        return el;
      })}
      <text x="66" y={sub ? 66 : 72} className="viz-donut-num">{center}</text>
      {sub ? <text x="66" y="86" className="viz-donut-sub">{sub}</text> : null}
    </svg>
  );
}

/* --------------------------------------------------------------- FlowRail */

export interface Stage { key: string; label: string; high: number; medium: number; low: number }

/**
 * Factory-to-field pipeline: one node per area of work, ringed by how urgent
 * its open items are, with work flowing left to right and field findings
 * looping back into engineering. Clicking a node filters the queue.
 */
export function FlowRail({ stages, loop, active, onPick }: { stages: Stage[]; loop?: Stage; active: string; onPick: (key: string) => void }) {
  const W = 1000;
  const y = 64;
  const x0 = 70;
  const step = (W - 2 * x0) / Math.max(1, stages.length - 1);
  const xs = stages.map((_, i) => x0 + i * step);
  const max = Math.max(1, ...stages.map((s) => s.high + s.medium + s.low), loop ? loop.high + loop.medium + loop.low : 0);
  const radius = (s: Stage) => 15 + 11 * Math.sqrt((s.high + s.medium + s.low) / max);
  const from = loop ? stages.findIndex((s) => s.key === "Sustainment") : -1;
  const to = loop ? stages.findIndex((s) => s.key === "Production") : -1;
  const loopX = from >= 0 && to >= 0 ? (xs[from]! + xs[to]!) / 2 : 0;

  function node(s: Stage, cx: number, cy: number) {
    const total = s.high + s.medium + s.low;
    const r = radius(s);
    const c = 2 * Math.PI * (r + 5);
    const parts: [number, Tone][] = [[s.high, "bad"], [s.medium, "warn"], [s.low, "accent"]];
    let at = 0;
    const on = active === s.key;
    return (
      <g
        key={s.key}
        className={`viz-flow-node${on ? " is-on" : ""}${total === 0 ? " is-empty" : ""}${s.high ? " has-now" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={`${s.label}: ${total} open, ${s.high} now`}
        onClick={() => onPick(on ? "All" : s.key)}
        onKeyDown={onKey(() => onPick(on ? "All" : s.key))}
      >
        {s.high ? <circle cx={cx} cy={cy} r={r + 5} className="viz-flow-pulse" /> : null}
        <circle cx={cx} cy={cy} r={r + 5} className="viz-flow-ringtrack" />
        {total
          ? parts.map(([n, tone]) => {
              if (!n) return null;
              const len = (n / total) * c;
              const el = <circle key={tone} cx={cx} cy={cy} r={r + 5} className={`viz-flow-ring tone-${tone}`} strokeDasharray={`${len} ${c}`} strokeDashoffset={-at} transform={`rotate(-90 ${cx} ${cy})`} />;
              at += len;
              return el;
            })
          : null}
        <circle cx={cx} cy={cy} r={r} className="viz-flow-core" />
        <text x={cx} y={cy + 6} className="viz-flow-count">{total}</text>
        <text x={cx} y={cy + r + 26} className="viz-flow-label">{s.label}</text>
        {s.high ? <text x={cx} y={cy - r - 13} className="viz-flow-now">{s.high} now</text> : null}
      </g>
    );
  }

  return (
    <div className="viz-flow">
      <svg viewBox={`0 0 ${W} ${loop ? 244 : 132}`} role="group" aria-label="Where today's work sits, factory to field">
        <defs>
          <marker id="viz-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="viz-flow-arrow" />
          </marker>
        </defs>
        {xs.slice(1).map((x, i) => (
          <g key={i}>
            <line x1={xs[i]! + radius(stages[i]!) + 8} x2={x - radius(stages[i + 1]!) - 10} y1={y} y2={y} className="viz-flow-pipe" />
            <line x1={xs[i]! + radius(stages[i]!) + 8} x2={x - radius(stages[i + 1]!) - 10} y1={y} y2={y} className="viz-flow-dash" markerEnd="url(#viz-arrow)" />
          </g>
        ))}
        {loop && from >= 0 && to >= 0 ? (
          <g>
            <path d={`M ${xs[from]!} ${y + radius(stages[from]!) + 34} C ${xs[from]!} 198, ${xs[to]!} 198, ${xs[to]!} ${y + radius(stages[to]!) + 34}`} className="viz-flow-pipe" fill="none" />
            <path d={`M ${xs[from]!} ${y + radius(stages[from]!) + 34} C ${xs[from]!} 198, ${xs[to]!} 198, ${xs[to]!} ${y + radius(stages[to]!) + 34}`} className="viz-flow-dash is-loop" fill="none" markerEnd="url(#viz-arrow)" />
            <text x={loopX} y={238} className="viz-flow-loopnote">field findings feed engineering change</text>
          </g>
        ) : null}
        {stages.map((s, i) => node(s, xs[i]!, y))}
        {loop && loopX ? node({ ...loop }, loopX, 178) : null}
      </svg>
      <div className="viz-legend">
        <span><i className="tone-bad" /> Now</span>
        <span><i className="tone-warn" /> Today</span>
        <span><i className="tone-accent" /> This week</span>
        <span className="meta">Ring size is open items; click a stage to filter the queue.</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ TimelineRows */

export interface Lane { id: string; label: string; sub: string; due: string; projected: string | null; done: number; total: number; risk: boolean; why?: string }

const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
const fmt = (d: number) => new Date(d * 86_400_000).toISOString().slice(5, 10);

/** Delivery lanes: today to projected ship, the due date as a flag, and how much has shipped. */
export function TimelineRows({ lanes, today, onPick, picked }: { lanes: Lane[]; today: string; onPick?: (id: string) => void; picked?: string | null }) {
  const t0 = day(today) - 3;
  const ends = lanes.flatMap((l) => [day(l.due), l.projected ? day(l.projected) : day(l.due)]);
  const t1 = Math.max(t0 + 14, ...ends) + 4;
  const at = (d: number) => `${((d - t0) / (t1 - t0)) * 100}%`;
  const ticks: number[] = [];
  for (let d = Math.ceil(t0 / 7) * 7; d <= t1; d += 7) ticks.push(d);
  return (
    <div className="viz-lanes" role="table" aria-label="Delivery timeline">
      <div className="viz-lane viz-lane-axis" role="row">
        <span />
        <div className="viz-lane-track">
          {ticks.filter((d) => Math.abs(d - day(today)) > 3).map((d) => (
            <span key={d} className="viz-tick" style={{ left: at(d) }}>{fmt(d)}</span>
          ))}
          <span className="viz-today-tag" style={{ left: at(day(today)) }}>Today</span>
        </div>
      </div>
      {lanes.map((l) => {
        const p = l.projected ? day(l.projected) : null;
        const late = p != null && p > day(l.due);
        return (
          <div
            key={l.id}
            role="row"
            className={`viz-lane${l.risk ? " is-risk" : ""}${picked === l.id ? " is-on" : ""}${onPick ? " is-pick" : ""}`}
            tabIndex={onPick ? 0 : undefined}
            onClick={onPick ? () => onPick(l.id) : undefined}
            onKeyDown={onPick ? onKey(() => onPick(l.id)) : undefined}
          >
            <span className="viz-lane-label">
              <strong className="mono">{l.id}</strong> {l.label}
              <span className="meta">{l.sub}</span>
              <span className="viz-progress" aria-label={`${l.done} of ${l.total} delivered`}>
                <i style={{ width: `${(l.done / Math.max(1, l.total)) * 100}%` }} />
                <em className="mono">{l.done}/{l.total}</em>
              </span>
            </span>
            <div className="viz-lane-track">
              {ticks.map((d) => <span key={d} className="viz-grid" style={{ left: at(d) }} />)}
              <span className="viz-today" style={{ left: at(day(today)) }} />
              {p != null ? (
                <span
                  className={`viz-bar ${late || l.risk ? "tone-bad" : "tone-ok"}`}
                  style={{ left: at(day(today)), width: `calc(${at(p)} - ${at(day(today))})` }}
                  title={`Projected ${l.projected}${late ? `, ${p - day(l.due)} days after due` : `, ${day(l.due) - p} days early`}`}
                />
              ) : (
                <span className="viz-bar tone-bad is-open" style={{ left: at(day(today)), right: 0 }} title={l.why ?? "No ship date yet"} />
              )}
              {late && p != null ? <span className="viz-slip" style={{ left: at(day(l.due)), width: `calc(${at(p)} - ${at(day(l.due))})` }} /> : null}
              <span className={`viz-due${late || l.risk ? " is-bad" : ""}`} style={{ left: at(day(l.due)) }} title={`Due ${l.due}`}>
                <b>Due {fmt(day(l.due))}</b>
              </span>
              {l.risk && l.why ? <span className="viz-why" style={{ left: at(p ?? day(today)) }}>{l.why}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- LineChart */

export interface Series { label: string; tone: Tone; points: [number, number][]; dashed?: boolean }
export interface Marker { x: number; y?: number; label: string; tone: Tone }
export interface Rule { x?: number; y?: number; label: string; tone: Tone }

/** Lines over a numeric x axis, with vertical rules (phase prices, a goal) and a live marker. */
export function LineChart({ series, markers = [], rules = [], xFmt = String, yFmt = String, xLabel, yLabel, height = 240, yMin }: { series: Series[]; markers?: Marker[]; rules?: Rule[]; xFmt?: (n: number) => string; yFmt?: (n: number) => string; xLabel?: string; yLabel?: string; height?: number; yMin?: number }) {
  const W = 640;
  const H = height;
  const L = 62, R = 16, T = 18, B = 40;
  const all = series.flatMap((s) => s.points);
  const xa = Math.min(...all.map((p) => p[0]));
  const xb = Math.max(...all.map((p) => p[0]));
  const ya = yMin ?? 0;
  const yb = Math.max(...all.map((p) => p[1]), ...markers.map((m) => m.y ?? 0), ...rules.map((r) => r.y ?? 0)) * 1.08;
  const sx = (x: number) => L + ((x - xa) / (xb - xa || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - ya) / (yb - ya || 1)) * (H - T - B);
  const yt = niceTicks(ya, yb, 4);
  const xt = niceTicks(xa, xb, 6);
  return (
    <svg className="viz-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(" and ")}>
      {yt.map((v) => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="viz-gridline" />
          <text x={L - 8} y={sy(v) + 4} className="viz-axis is-y">{yFmt(v)}</text>
        </g>
      ))}
      {xt.map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - B + 18} className="viz-axis">{xFmt(v)}</text>
      ))}
      {xLabel ? <text x={(L + W - R) / 2} y={H - 4} className="viz-axis-title">{xLabel}</text> : null}
      {yLabel ? <text x={14} y={(T + H - B) / 2} className="viz-axis-title" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>{yLabel}</text> : null}
      {rules.map((r) =>
        r.x != null ? (
          <g key={r.label}>
            <line x1={sx(r.x)} x2={sx(r.x)} y1={T} y2={H - B} className={`viz-rule tone-${r.tone}`} />
            <text x={sx(r.x) + 4} y={T + 10} className={`viz-rule-label tone-${r.tone}`}>{r.label}</text>
          </g>
        ) : r.y != null ? (
          <g key={r.label}>
            <line x1={L} x2={W - R} y1={sy(r.y)} y2={sy(r.y)} className={`viz-rule tone-${r.tone}`} />
            <text x={W - R - 4} y={sy(r.y) - 5} className={`viz-rule-label tone-${r.tone} is-end`}>{r.label}</text>
          </g>
        ) : null,
      )}
      {series.map((s) => (
        <g key={s.label}>
          <path d={`M ${s.points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" L ")} L ${sx(s.points[s.points.length - 1]![0])},${H - B} L ${sx(s.points[0]![0])},${H - B} Z`} className={`viz-area tone-${s.tone}`} />
          <path d={`M ${s.points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" L ")}`} className={`viz-stroke tone-${s.tone}${s.dashed ? " is-dashed" : ""}`} />
        </g>
      ))}
      {markers.map((m) =>
        m.y != null ? (
          <g key={m.label} className="viz-marker">
            <line x1={sx(m.x)} x2={sx(m.x)} y1={sy(m.y)} y2={H - B} className={`viz-drop tone-${m.tone}`} />
            <circle cx={sx(m.x)} cy={sy(m.y)} r="9" className={`viz-halo tone-${m.tone}`} />
            <circle cx={sx(m.x)} cy={sy(m.y)} r="4.5" className={`viz-dot tone-${m.tone}`} />
            <text x={sx(m.x) + (sx(m.x) > W * 0.7 ? -12 : 12)} y={sy(m.y) - 10} className={`viz-marker-label${sx(m.x) > W * 0.7 ? " is-end" : ""}`}>{m.label}</text>
          </g>
        ) : null,
      )}
    </svg>
  );
}

export function niceTicks(a: number, b: number, n: number): number[] {
  const span = b - a || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/* ---------------------------------------------------------------- Scatter */

export interface Dot { id: string; x: number; y: number; size: number; tone: Tone; label: string; title: string; ring?: boolean }

/**
 * Evidence against effect: x is how much evidence (sorties), y how far from
 * family (ratio, on a square-root scale so 1x and 12x both read). Bands mark
 * the family and the out-of-family threshold.
 */
export function Scatter({ dots, xLabel, yLabel, threshold, picked, onPick, yTicks, xFmt = String, height = 260, label }: { dots: Dot[]; xLabel: string; yLabel: string; threshold?: { y: number; label: string }; picked?: string | null; onPick?: (id: string) => void; yTicks: number[]; xFmt?: (n: number) => string; height?: number; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 900, H = height, L = 64, R = 24, T = 16, B = 44;
  const xb = Math.max(...dots.map((d) => d.x)) * 1.06;
  const yb = Math.max(...yTicks, ...dots.map((d) => d.y)) * 1.05;
  const sx = (x: number) => L + (x / (xb || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - Math.sqrt(Math.max(0, y)) / Math.sqrt(yb || 1)) * (H - T - B);
  const xt = niceTicks(0, xb, 6);
  const focus = dots.find((d) => d.id === (hover ?? picked));
  return (
    <div className="viz-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
        {threshold ? <rect x={L} y={T} width={W - L - R} height={sy(threshold.y) - T} className="viz-band tone-bad" /> : null}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className={v === 1 ? "viz-gridline is-strong" : "viz-gridline"} />
            <text x={L - 8} y={sy(v) + 4} className="viz-axis is-y">{v}x</text>
          </g>
        ))}
        {threshold ? (
          <g>
            <line x1={L} x2={W - R} y1={sy(threshold.y)} y2={sy(threshold.y)} className="viz-rule tone-bad" />
            <text x={W - R - 4} y={sy(threshold.y) - 6} className="viz-rule-label tone-bad is-end">{threshold.label}</text>
          </g>
        ) : null}
        <text x={L + 6} y={sy(1) - 6} className="viz-rule-label">1x: same as the other lots</text>
        {xt.map((v) => <text key={v} x={sx(v)} y={H - B + 18} className="viz-axis">{xFmt(v)}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} className="viz-axis-title">{xLabel}</text>
        <text x={14} y={(T + H - B) / 2} className="viz-axis-title" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>{yLabel}</text>
        {dots.map((d) => (
          <g
            key={d.id}
            className={`viz-pt${picked === d.id ? " is-on" : ""}${onPick ? " is-pick" : ""}`}
            role={onPick ? "button" : undefined}
            tabIndex={onPick ? 0 : undefined}
            aria-label={d.title}
            onMouseEnter={() => setHover(d.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(d.id)}
            onBlur={() => setHover(null)}
            onClick={onPick ? () => onPick(d.id) : undefined}
            onKeyDown={onPick ? onKey(() => onPick(d.id)) : undefined}
          >
            {d.ring ? <circle cx={sx(d.x)} cy={sy(d.y)} r={d.size + 8} className={`viz-flow-pulse tone-${d.tone}`} /> : null}
            <circle cx={sx(d.x)} cy={sy(d.y)} r={d.size} className={`viz-pt-dot tone-${d.tone}`} />
            {d.ring || picked === d.id ? <text x={sx(d.x) + d.size + 6} y={sy(d.y) + 4} className="viz-pt-label">{d.label}</text> : null}
          </g>
        ))}
      </svg>
      <p className="viz-readout mono" aria-live="polite">{focus ? focus.title : "Hover or tab to a lot for its numbers; click to act on it below."}</p>
    </div>
  );
}

/* -------------------------------------------------------------- TileGrid */

export interface Tile { id: string; title: string; sub: string; tone: Tone; group?: string; badge?: string | undefined; note?: string | undefined }

/** One tile per asset, coloured by state. Selecting a tile selects that row elsewhere on the page. */
export function TileGrid({ tiles, picked, onPick, dim }: { tiles: Tile[]; picked?: string | null; onPick: (id: string) => void; dim?: (t: Tile) => boolean }) {
  return (
    <ul className="viz-tiles" role="listbox" aria-label="Airframes">
      {tiles.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            role="option"
            aria-selected={picked === t.id}
            className={`viz-tile tone-${t.tone}${picked === t.id ? " is-on" : ""}${dim?.(t) ? " is-dim" : ""}`}
            title={t.note ?? t.sub}
            onClick={() => onPick(t.id)}
          >
            <span className="viz-tile-top">
              <strong>{t.title}</strong>
              {t.badge ? <em>{t.badge}</em> : null}
            </span>
            <span className="viz-tile-sub">{t.sub}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
