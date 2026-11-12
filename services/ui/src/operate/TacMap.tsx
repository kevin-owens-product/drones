import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import type { Layers, Picture, RadioGrid } from "./picture";
import type { Vehicle } from "./vehicle";

/**
 * A local tactical picture: a flat east/north plane in metres around the
 * fleet, with a metric grid, range rings on the selected vehicle, trails and
 * heading glyphs. Optional layers come from the operating picture: terrain,
 * survey coverage, planned paths, task allocation, link quality and hazard
 * zones. It needs no map tiles from the network, so it works air-gapped.
 *
 * Positions arrive about once a second. Between samples each glyph glides
 * from where it was drawn to the new sample over one poll interval, so the
 * picture runs about a second behind the last report and never ahead of it.
 */

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;
const TWEEN_MS = 1000;
const SNAP_M = 400;
const SIGMA_95 = 2.45; // 2D Gaussian: 95% of fixes fall inside 2.45 sigma.

export type Trail = readonly (readonly [number, number])[];

export interface Pulse {
  id: number;
  level: "info" | "warn" | "alert";
}

interface View {
  cx: number;
  cy: number;
  scale: number; // px per metre
}

interface Tween {
  from: [number, number, number | undefined];
  to: [number, number, number | undefined];
  t0: number;
  key: unknown;
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

function ease(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

const COLORS: Record<Vehicle["health"], string> = {
  ok: "#3fd69a",
  warn: "#f4b443",
  alert: "#ff6b5b",
  offline: "#5b6775",
};

function linkClass(q: number): string {
  if (q <= 0) return "tac-link is-down";
  if (q < 0.3) return "tac-link is-weak";
  if (q < 0.6) return "tac-link is-fair";
  return "tac-link";
}

export function TacMap({
  fleet,
  trails,
  selected,
  follow,
  onSelect,
  picture,
  layers,
  pulses,
  density,
  radio = null,
}: {
  fleet: readonly Vehicle[];
  trails: ReadonlyMap<string, Trail>;
  selected: string | null;
  follow: boolean;
  onSelect: (tail: string | null) => void;
  picture: Picture | null;
  radio?: RadioGrid | null;
  layers: Layers;
  pulses: ReadonlyMap<string, Pulse>;
  density: boolean;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [manual, setManual] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [, setFrame] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.max(200, entry.contentRect.width), h: Math.max(200, entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Redraw at up to ~30 fps while anything is moving. Reduced-motion users get
  // the samples as they arrive.
  const still = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true, []);
  useEffect(() => {
    if (still) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 32) {
        last = t;
        setFrame((n) => (n + 1) % 1_000_000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [still]);

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

  // Glide each vehicle from where it was drawn to its newest sample.
  const tweens = useRef(new Map<string, Tween>());
  const clock = still ? Number.POSITIVE_INFINITY : performance.now();
  const drawn = (tw: Tween, t: number): [number, number, number | undefined] => {
    const k = ease(Math.min(1, Math.max(0, (t - tw.t0) / TWEEN_MS)));
    const [fx, fy, fh] = tw.from;
    const [tx, ty, th] = tw.to;
    const h = typeof fh === "number" && typeof th === "number" ? lerpAngle(fh, th, k) : th;
    return [fx + (tx - fx) * k, fy + (ty - fy) * k, h];
  };
  useLayoutEffect(() => {
    const t = performance.now();
    const next = new Map<string, Tween>();
    for (const v of live) {
      const p = v.live!;
      const [x, y] = toXY(p.lat, p.lon);
      const to: Tween["to"] = [x, y, p.heading_deg];
      const old = tweens.current.get(v.tail);
      if (old && old.key === p) {
        next.set(v.tail, old);
        continue;
      }
      const from = old ? drawn(old, t) : to;
      const jump = Math.hypot(from[0] - x, from[1] - y) > SNAP_M;
      next.set(v.tail, { from: jump ? to : from, to, t0: t, key: p });
    }
    tweens.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet]);
  const pos = (tail: string): [number, number, number | undefined] | null => {
    const tw = tweens.current.get(tail);
    if (tw) return drawn(tw, clock);
    const p = fleet.find((v) => v.tail === tail)?.live;
    if (!p) return null;
    const [x, y] = toXY(p.lat, p.lon);
    return [x, y, p.heading_deg];
  };

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

  const focusPos = follow && selected ? pos(selected) : null;
  let view: View = manual ?? auto;
  if (focusPos) {
    view = { cx: focusPos[0], cy: focusPos[1], scale: manual?.scale ?? Math.max(auto.scale, size.w / 1500) };
  }

  const sx = (x: number) => size.w / 2 + (x - view.cx) * view.scale;
  const sy = (y: number) => size.h / 2 - (y - view.cy) * view.scale;
  const ll = (lat: number, lon: number): [number, number] => {
    const [x, y] = toXY(lat, lon);
    return [sx(x), sy(y)];
  };
  const polyline = (pts: readonly (readonly [number, number])[]) =>
    pts.map(([la, lo], i) => {
      const [px, py] = ll(la, lo);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`;
    }).join(" ");

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

  // ---- Operating picture layers, drawn under the vehicles.
  const terrain = (() => {
    const b = picture?.basemap;
    if (!b || !layers.terrain) return null;
    const [x0, y0] = ll(b.north, b.west);
    const [x1, y1] = ll(b.south, b.east);
    return <image href={b.url} x={x0} y={y0} width={x1 - x0} height={y1 - y0} preserveAspectRatio="none" className="tac-terrain" />;
  })();

  const zones = (picture?.zones ?? []).map((z) => {
    const [cx, cy] = ll(z.lat, z.lon);
    const r = z.radius_m * view.scale;
    return (
      <g key={z.id} className="tac-zone">
        <circle cx={cx} cy={cy} r={r} fill="url(#tac-hatch)" />
        <circle cx={cx} cy={cy} r={r} className="tac-zone-edge" />
        <text x={cx} y={cy - r - 6} textAnchor="middle" className="tac-label tac-zone-label">{z.label}</text>
      </g>
    );
  });

  // Radio shadow: cells where the station's control link is thin (under 10 dB over what it needs) or lost at 100 m.
  const shadow = radio
    ? radio.cells
        .filter((c) => c.m < radio.need_db + 10)
        .map((c, i) => {
          const [dla, dlo] = radio.half_deg;
          const [x0, y0] = ll(c.ll[0] + dla, c.ll[1] - dlo);
          const [x1, y1] = ll(c.ll[0] - dla, c.ll[1] + dlo);
          return <rect key={`rs-${i}`} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} className={c.m < radio.need_db ? "tac-shadow is-lost" : "tac-shadow"} />;
        })
    : [];

  const areas = layers.coverage
    ? (picture?.areas ?? []).map((a) => {
        // Label the bottom-left corner: vehicles enter at the first corner, so a label there sits under them.
        const pts = a.ring.map(([la, lo]) => ll(la, lo));
        const lx = pts.length ? Math.min(...pts.map((q) => q[0])) : 0;
        const ly = pts.length ? Math.max(...pts.map((q) => q[1])) - 28 : 0;
        return (
          <g key={a.id} className="tac-area">
            <path d={`${polyline(a.ring)} Z`} className="tac-area-edge" />
            <path d={polyline(a.flown)} className="tac-swath" strokeWidth={Math.max(2, a.swath_m * view.scale)} />
            {a.ahead.length > 1 ? <path d={polyline(a.ahead)} className="tac-ahead" /> : null}
            <text x={lx + 6} y={ly + 14} className="tac-label tac-area-label">
              Area {a.id} <tspan className="tac-area-pct">{a.covered_pct}%</tspan>
            </text>
            <rect x={lx + 6} y={ly + 19} width={64} height={3} rx={1.5} className="tac-meter" />
            <rect x={lx + 6} y={ly + 19} width={(64 * Math.min(100, a.covered_pct)) / 100} height={3} rx={1.5} className="tac-meter-fill" />
          </g>
        );
      })
    : [];

  const routes = layers.coverage
    ? (picture?.routes ?? []).map((r) => {
        const v = fleet.find((f) => f.tail === r.tail);
        const isSel = r.tail === selected;
        let d = polyline(r.path);
        if (r.kind === "transit") {
          const here = pos(r.tail);
          const end = r.path[r.path.length - 1];
          if (here && end) {
            const [ex, ey] = ll(end[0], end[1]);
            d = `M${sx(here[0]).toFixed(1)} ${sy(here[1]).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`;
          }
        }
        return <path key={`r-${r.tail}`} d={d} className={isSel ? "tac-route is-sel" : "tac-route"} stroke={v ? COLORS[v.health] : undefined} />;
      })
    : [];

  const nodeXY = (id: string): [number, number] | null => {
    if (id === "GCS" && picture?.station) return ll(picture.station.lat, picture.station.lon);
    const p = pos(id);
    return p ? [sx(p[0]), sy(p[1])] : null;
  };

  const links = layers.links
    ? (picture?.links ?? []).flatMap((l) => {
        const a = nodeXY(l.a);
        const b = nodeXY(l.b);
        if (!a || !b) return [];
        const touchesSel = selected !== null && (l.a === selected || l.b === selected);
        return [
          <line
            key={`l-${l.a}-${l.b}`}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            className={`${linkClass(l.quality)}${touchesSel ? " is-sel" : ""}`}
            strokeOpacity={l.quality <= 0 ? undefined : touchesSel ? 0.35 + 0.5 * l.quality : 0.08 + 0.3 * l.quality}
          >
            <title>{`${l.a} ↔ ${l.b}: link quality ${Math.round(l.quality * 100)}%`}</title>
          </line>,
        ];
      })
    : [];

  const station = picture?.station
    ? (() => {
        const [x, y] = ll(picture.station.lat, picture.station.lon);
        return (
          <g className="tac-station">
            <rect x={x - 6} y={y - 6} width={12} height={12} rx={2} />
            <text x={x + 11} y={y + 4} className="tac-label">{picture.station.label}</text>
          </g>
        );
      })()
    : null;

  // Task allocation. Lines that just changed owner draw in, so a re-plan is
  // something the operator sees happen rather than has to spot.
  const owners = useRef(new Map<string, { tail: string | null; at: number }>());
  for (const t of picture?.tasks ?? []) {
    const old = owners.current.get(t.id);
    if (!old) owners.current.set(t.id, { tail: t.tail, at: 0 });
    else if (old.tail !== t.tail) owners.current.set(t.id, { tail: t.tail, at: performance.now() });
  }
  const tasks = layers.tasks
    ? (picture?.tasks ?? []).map((t) => {
        const [x, y] = ll(t.lat, t.lon);
        const owner = t.tail ? pos(t.tail) : null;
        const fresh = performance.now() - (owners.current.get(t.id)?.at ?? 0) < 4000;
        return (
          <g key={`t-${t.id}`} className={`tac-task${fresh ? " is-fresh" : ""}${t.tail === null ? " is-open" : ""}`}>
            {owner ? <line key={`${t.id}-${t.tail}`} x1={sx(owner[0])} y1={sy(owner[1])} x2={x} y2={y} className="tac-task-line" /> : null}
            <path d={`M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z`} className="tac-task-mark" />
            <text x={x + 10} y={y + 4} className="tac-label tac-task-label">
              {t.id}
              <tspan className="tac-faint"> {t.label}{t.tail ? ` · ${t.tail}` : " · unassigned"}</tspan>
            </text>
          </g>
        );
      })
    : [];

  // ---- Vehicles.
  const sel = selected ? fleet.find((v) => v.tail === selected)?.live ?? null : null;
  const selPos = selected ? pos(selected) : null;
  const rings: JSX.Element[] = [];
  if (sel && selPos) {
    const [x, y] = selPos;
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

  const shownIndividually = (v: Vehicle) => !density || v.tail === selected || v.health === "warn" || v.health === "alert" || pulses.has(v.tail);
  const labelAll = live.length <= 40;

  const trailSegments = (tail: string, color: string, head: [number, number] | null, strong: boolean): JSX.Element[] => {
    const trail = trails.get(tail);
    if (!trail || trail.length < 2) return [];
    const pts = trail.map(([la, lo]) => ll(la, lo));
    if (head) pts.push(head);
    const chunk = 8;
    const out: JSX.Element[] = [];
    for (let i = 0; i < pts.length - 1; i += chunk) {
      const seg = pts.slice(i, i + chunk + 1);
      const k = (i + chunk) / pts.length;
      out.push(
        <path
          key={`${tail}-tr${i}`}
          d={seg.map(([px, py], j) => `${j === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ")}
          className="tac-trail"
          stroke={color}
          strokeOpacity={(strong ? 0.9 : 0.5) * Math.min(1, k) ** 1.6}
        />,
      );
    }
    return out;
  };

  const glyphs = live.map((v) => {
    if (!shownIndividually(v)) return null;
    const p = v.live!;
    const here = pos(v.tail);
    if (!here) return null;
    const px = sx(here[0]);
    const py = sy(here[1]);
    const isSel = v.tail === selected;
    const margin = 40 + (typeof p.pos_sigma_m === "number" ? SIGMA_95 * p.pos_sigma_m * view.scale : 0);
    if (px < -margin || py < -margin || px > size.w + margin || py > size.h + margin) return null;
    const color = COLORS[v.health];
    const pulse = pulses.get(v.tail);
    const sigmaPx = typeof p.pos_sigma_m === "number" ? SIGMA_95 * p.pos_sigma_m * view.scale : 0;
    const showError = p.gnss_trusted === false && sigmaPx > 0;
    return (
      <g key={v.tail} className={isSel ? "tac-v is-sel" : "tac-v"} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onSelect(v.tail); }}>
        {trailSegments(v.tail, color, [px, py], isSel)}
        {showError ? (
          <g className="tac-error">
            <circle cx={px} cy={py} r={Math.max(6, sigmaPx)} />
            <text x={px} y={py + Math.max(6, sigmaPx) + 13} textAnchor="middle" className="tac-label tac-error-label">
              ±{Math.round(SIGMA_95 * (p.pos_sigma_m ?? 0))} m (95%)
            </text>
          </g>
        ) : null}
        {pulse ? (
          <g key={`p${pulse.id}`} className={`tac-pulse pulse-${pulse.level}`}>
            <circle cx={px} cy={py} r={10} />
            <circle cx={px} cy={py} r={10} />
          </g>
        ) : null}
        {isSel ? <circle cx={px} cy={py} r={15} className="tac-halo" /> : null}
        {typeof here[2] === "number" ? (
          <path d="M0 -9 L6 7 L0 3 L-6 7 Z" transform={`translate(${px} ${py}) rotate(${here[2]})`} fill={color} className="tac-glyph" />
        ) : (
          <circle cx={px} cy={py} r={5} fill={color} className="tac-glyph" />
        )}
        <circle cx={px} cy={py} r={14} fill="transparent" />
        {labelAll || isSel || density ? (
          <text x={px + 12} y={py + 4} className={isSel ? "tac-label tac-strong" : "tac-label"}>
            {v.tail}
            {isSel && p.alt_m !== undefined ? <tspan className="tac-faint"> {Math.round(p.alt_m)} m</tspan> : null}
          </text>
        ) : null}
      </g>
    );
  });

  // Fleet-scale density: everyone nominal goes on a canvas as a hex density
  // field plus a fine dot each, so hundreds of vehicles stay readable and the
  // ones that need the operator stand out as glyphs.
  const crowd = density ? live.filter((v) => !shownIndividually(v)) : [];
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    if (!density || crowd.length === 0) return;
    const R = 16;
    const w = Math.sqrt(3) * R;
    const bins = new Map<string, { q: number; r: number; n: number }>();
    const dots: [number, number][] = [];
    for (const v of crowd) {
      const here = pos(v.tail);
      if (!here) continue;
      const px = sx(here[0]);
      const py = sy(here[1]);
      if (px < -R || py < -R || px > size.w + R || py > size.h + R) continue;
      dots.push([px, py]);
      // Pointy-top axial hex coordinates, rounded in cube space.
      const qf = ((Math.sqrt(3) / 3) * px - py / 3) / R;
      const rf = ((2 / 3) * py) / R;
      let q = Math.round(qf);
      let r = Math.round(rf);
      const s = Math.round(-qf - rf);
      const dq = Math.abs(q - qf);
      const dr = Math.abs(r - rf);
      const ds = Math.abs(s + qf + rf);
      if (dq > dr && dq > ds) q = -r - s;
      else if (dr > ds) r = -q - s;
      const key = `${q},${r}`;
      const bin = bins.get(key) ?? { q, r, n: 0 };
      bin.n += 1;
      bins.set(key, bin);
    }
    const max = Math.max(1, ...[...bins.values()].map((b) => b.n));
    for (const b of bins.values()) {
      const cx = w * (b.q + b.r / 2);
      const cy = 1.5 * R * b.r;
      const a = 0.08 + 0.42 * (b.n / max);
      g.beginPath();
      for (let k = 0; k < 6; k += 1) {
        const ang = (Math.PI / 180) * (60 * k - 30);
        const hx = cx + (R - 1) * Math.cos(ang);
        const hy = cy + (R - 1) * Math.sin(ang);
        if (k === 0) g.moveTo(hx, hy);
        else g.lineTo(hx, hy);
      }
      g.closePath();
      g.fillStyle = `rgba(63, 214, 154, ${a.toFixed(3)})`;
      g.fill();
      g.strokeStyle = `rgba(63, 214, 154, ${(a * 0.9).toFixed(3)})`;
      g.lineWidth = 1;
      g.stroke();
    }
    g.fillStyle = "rgba(210, 255, 236, 0.85)";
    for (const [px, py] of dots) g.fillRect(px - 1, py - 1, 2, 2);
  });

  const nearestCrowd = (clientX: number, clientY: number): string | null => {
    const rect = host.current?.getBoundingClientRect();
    if (!rect) return null;
    let best: string | null = null;
    let bestD = 10;
    for (const v of crowd) {
      const here = pos(v.tail);
      if (!here) continue;
      const d = Math.hypot(sx(here[0]) - (clientX - rect.left), sy(here[1]) - (clientY - rect.top));
      if (d < bestD) {
        bestD = d;
        best = v.tail;
      }
    }
    return best;
  };

  const bar = niceStep(120 / view.scale);
  const exceptions = live.filter((v) => v.health === "warn" || v.health === "alert").length;
  const notes = picture ? Object.values(picture.notes ?? {}) : [];
  const layersOn = picture && (layers.coverage || layers.links || layers.tasks || Boolean(radio) || (picture.zones?.length ?? 0) > 0);

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
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) onSelect(density ? nearestCrowd(e.clientX, e.clientY) : null);
      }}
      onDoubleClick={() => setManual(null)}
    >
      <svg width={size.w} height={size.h} role="img" aria-label={`Tactical picture, ${live.length} vehicles`}>
        <defs>
          <radialGradient id="tac-bg" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#0d1620" />
            <stop offset="100%" stopColor="#070a0e" />
          </radialGradient>
          <radialGradient id="tac-vignette" cx="50%" cy="50%" r="75%">
            <stop offset="60%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
          <pattern id="tac-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="9" height="9" fill="rgba(244, 180, 67, 0.05)" />
            <line x1="0" y1="0" x2="0" y2="9" stroke="rgba(244, 180, 67, 0.22)" strokeWidth="2" />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#tac-bg)" />
        {terrain}
        {grid}
        {shadow.length ? <g className="tac-shadows">{shadow}</g> : null}
        {zones}
        {areas}
        {routes}
        {links}
        {station}
        {tasks}
        {rings}
      </svg>
      <canvas ref={canvas} className="tac-canvas" style={{ width: size.w, height: size.h }} aria-hidden="true" />
      <svg width={size.w} height={size.h} className="tac-top" aria-hidden="true">
        {glyphs}
        <rect width={size.w} height={size.h} fill="url(#tac-vignette)" pointerEvents="none" />
      </svg>
      {density ? (
        <div className="tac-crowd" data-testid="density-summary">
          <strong className="mono">{live.length}</strong> vehicles · <strong className="mono">{exceptions}</strong> need you · density view, exceptions drawn individually
        </div>
      ) : null}
      {layersOn || (picture?.basemap && layers.terrain) ? (
        <details className="tac-legend" data-testid="map-legend" onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
          <summary>
            {layersOn ? (
              <>
                <span className="tag tag-sim">SIM</span> Overlays: {[(picture?.zones?.length ?? 0) > 0 ? "jamming zone" : null, layers.coverage ? "coverage" : null, layers.tasks ? "tasks" : null, layers.links ? "links" : null, radio ? "radio shadow at 100 m" : null].filter(Boolean).join(", ")}
              </>
            ) : (
              "Terrain"
            )}
          </summary>
          {layersOn ? <p>{picture?.source}. Not field data.</p> : null}
          {layersOn ? notes.map((n) => <p key={n}>{n}</p>) : null}
          {picture?.basemap && layers.terrain ? <p className="tac-attrib">{picture.basemap.attribution}</p> : null}
        </details>
      ) : null}
      <div className="tac-scale" aria-hidden="true">
        <span style={{ width: `${bar * view.scale}px` }} />
        {distance(bar)}
      </div>
      <div className="tac-hint meta">{manual ? "Double-click to refit" : focusPos ? "Following" : "Scroll to zoom · drag to pan"}</div>
    </div>
  );
}
