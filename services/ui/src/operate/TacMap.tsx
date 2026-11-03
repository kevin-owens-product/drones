import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { Vehicle } from "./vehicle";

/**
 * A local tactical picture: a flat east/north plane in metres around the
 * fleet, with a metric grid, range rings on the selected vehicle, trails and
 * heading glyphs. It needs no map tiles, so it works on an air-gapped console.
 */

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;

export type Trail = readonly (readonly [number, number])[];

interface View {
  cx: number;
  cy: number;
  scale: number; // px per metre
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * pow;
}

function distance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

const COLORS: Record<Vehicle["health"], string> = {
  ok: "#3fd69a",
  warn: "#f4b443",
  alert: "#ff6b5b",
  offline: "#5b6775",
};

export function TacMap({
  fleet,
  trails,
  selected,
  follow,
  onSelect,
}: {
  fleet: readonly Vehicle[];
  trails: ReadonlyMap<string, Trail>;
  selected: string | null;
  follow: boolean;
  onSelect: (tail: string | null) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [manual, setManual] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.max(200, entry.contentRect.width), h: Math.max(200, entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const live = fleet.filter((v) => v.live !== null);

  // Origin stays put so the plane does not swim between polls. It moves only
  // when the fleet's median drifts far from it.
  const originRef = useRef<{ lat: number; lon: number } | null>(null);
  if (live.length > 0) {
    const lat = quantile(live.map((v) => v.live!.lat).sort((a, b) => a - b), 0.5);
    const lon = quantile(live.map((v) => v.live!.lon).sort((a, b) => a - b), 0.5);
    const o = originRef.current;
    if (!o || Math.abs(o.lat - lat) > 0.5 || Math.abs(o.lon - lon) > 0.5) originRef.current = { lat, lon };
  }
  const origin = originRef.current ?? { lat: 0, lon: 0 };

  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const toXY = (lat: number, lon: number): [number, number] => [(lon - origin.lon) * cosLat * M_PER_DEG_LON, (lat - origin.lat) * M_PER_DEG_LAT];

  const auto = useMemo<View>(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const v of live) {
      const [x, y] = toXY(v.live!.lat, v.live!.lon);
      xs.push(x);
      ys.push(y);
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const trim = live.length > 20 ? 0.03 : 0;
    const x0 = quantile(xs, trim);
    const x1 = quantile(xs, 1 - trim);
    const y0 = quantile(ys, trim);
    const y1 = quantile(ys, 1 - trim);
    const span = Math.max(400, (x1 - x0) * 1.25, ((y1 - y0) * 1.25 * size.w) / size.h);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: size.w / span };
    // Refit on fleet size, viewport, or every ten seconds, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.length, origin.lat, origin.lon, size.w, size.h, Math.round(Date.now() / 10_000)]);

  const focus = follow && selected ? fleet.find((v) => v.tail === selected)?.live ?? null : null;
  let view: View = manual ?? auto;
  if (focus) {
    const [fx, fy] = toXY(focus.lat, focus.lon);
    view = { cx: fx, cy: fy, scale: manual?.scale ?? Math.max(auto.scale, size.w / 1500) };
  }

  const sx = (x: number) => size.w / 2 + (x - view.cx) * view.scale;
  const sy = (y: number) => size.h / 2 - (y - view.cy) * view.scale;

  const step = niceStep(110 / view.scale);
  const gx0 = Math.floor((view.cx - size.w / 2 / view.scale) / step) * step;
  const gy0 = Math.floor((view.cy - size.h / 2 / view.scale) / step) * step;
  const grid: JSX.Element[] = [];
  for (let x = gx0; sx(x) <= size.w; x += step) {
    grid.push(<line key={`gx${x}`} x1={sx(x)} x2={sx(x)} y1={0} y2={size.h} className={Math.abs(x) < step / 2 ? "tac-axis" : "tac-grid"} />);
  }
  for (let y = gy0; sy(y) >= 0; y += step) {
    grid.push(<line key={`gy${y}`} y1={sy(y)} y2={sy(y)} x1={0} x2={size.w} className={Math.abs(y) < step / 2 ? "tac-axis" : "tac-grid"} />);
  }

  const sel = selected ? fleet.find((v) => v.tail === selected)?.live ?? null : null;
  const rings: JSX.Element[] = [];
  if (sel) {
    const [x, y] = toXY(sel.lat, sel.lon);
    const ringStep = niceStep(Math.min(size.w, size.h) / 6 / view.scale);
    for (let k = 1; k <= 3; k += 1) {
      const r = k * ringStep * view.scale;
      rings.push(<circle key={`r${k}`} cx={sx(x)} cy={sy(y)} r={r} className="tac-ring" />);
      rings.push(
        <text key={`rt${k}`} x={sx(x) + r * 0.707 + 4} y={sy(y) - r * 0.707 - 4} className="tac-label tac-faint">
          {distance(k * ringStep)}
        </text>,
      );
    }
  }

  const labelAll = live.length <= 40;
  const glyphs = live.map((v) => {
    const p = v.live!;
    const [x, y] = toXY(p.lat, p.lon);
    const px = sx(x);
    const py = sy(y);
    if (px < -40 || py < -40 || px > size.w + 40 || py > size.h + 40) return null;
    const isSel = v.tail === selected;
    const color = COLORS[v.health];
    const trail = trails.get(v.tail);
    const path = trail && trail.length > 1 ? trail.map(([la, lo], i) => {
      const [tx, ty] = toXY(la, lo);
      return `${i === 0 ? "M" : "L"}${sx(tx).toFixed(1)} ${sy(ty).toFixed(1)}`;
    }).join(" ") : null;
    return (
      <g key={v.tail} className={isSel ? "tac-v is-sel" : "tac-v"} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onSelect(v.tail); }}>
        {path ? <path d={path} className="tac-trail" stroke={color} /> : null}
        {isSel ? <circle cx={px} cy={py} r={15} className="tac-halo" /> : null}
        {typeof p.heading_deg === "number" ? (
          <path d="M0 -9 L6 7 L0 3 L-6 7 Z" transform={`translate(${px} ${py}) rotate(${p.heading_deg})`} fill={color} className="tac-glyph" />
        ) : (
          <circle cx={px} cy={py} r={5} fill={color} className="tac-glyph" />
        )}
        <circle cx={px} cy={py} r={14} fill="transparent" />
        {labelAll || isSel ? (
          <text x={px + 12} y={py + 4} className={isSel ? "tac-label tac-strong" : "tac-label"}>
            {v.tail}
            {isSel && p.alt_m !== undefined ? <tspan className="tac-faint"> {Math.round(p.alt_m)} m</tspan> : null}
          </text>
        ) : null}
      </g>
    );
  });

  const bar = niceStep(120 / view.scale);

  return (
    <div
      ref={host}
      className="tac"
      onWheel={(e) => {
        const rect = host.current?.getBoundingClientRect();
        if (!rect) return;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const mx = (e.clientX - rect.left - size.w / 2) / view.scale + view.cx;
        const my = -(e.clientY - rect.top - size.h / 2) / view.scale + view.cy;
        const scale = Math.min(50, Math.max(1e-5, view.scale * factor));
        setManual({ scale, cx: mx - (mx - view.cx) * (view.scale / scale), cy: my - (my - view.cy) * (view.scale / scale) });
      }}
      onMouseDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, view };
      }}
      onMouseMove={(e) => {
        const d = drag.current;
        if (!d || (e.buttons & 1) === 0) return;
        setManual({ scale: d.view.scale, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy + (e.clientY - d.y) / d.view.scale });
      }}
      onMouseUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) onSelect(null);
      }}
      onDoubleClick={() => setManual(null)}
    >
      <svg width={size.w} height={size.h} role="img" aria-label={`Tactical picture, ${live.length} vehicles`}>
        <defs>
          <radialGradient id="tac-bg" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#0d1620" />
            <stop offset="100%" stopColor="#070a0e" />
          </radialGradient>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#tac-bg)" />
        {grid}
        {rings}
        {glyphs}
      </svg>
      <div className="tac-scale" aria-hidden="true">
        <span style={{ width: `${bar * view.scale}px` }} />
        {distance(bar)}
      </div>
      <div className="tac-hint meta">{manual ? "Double-click to refit" : focus ? "Following" : "Scroll to zoom · drag to pan"}</div>
    </div>
  );
}
