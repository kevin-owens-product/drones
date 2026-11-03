import type { ReactNode } from "react";

/** The demo range in local metres (east = x, north = y), as the demo's /v1/missions and debrief return it. */
export interface RangeFrame {
  frame?: { lat0: number; lon0: number; m_lat: number; m_lon: number };
  basemap: { west: number; east: number; south: number; north: number; url: string } | null;
  station: { x: number; y: number };
  zones: { id: string; label: string; x: number; y: number; r: number }[];
  places: { id: string; label: string; x: number; y: number }[];
}

export interface MapPath {
  id: string;
  color: string;
  pts: [number, number][];
  dashed?: boolean;
  faded?: boolean;
}

export interface MapMarker {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  /** VIO error radius in metres, drawn as a ring when navigating without GNSS. */
  ring?: number;
  dim?: boolean;
  cross?: boolean;
}

export interface MapZone {
  name: string;
  x: number;
  y: number;
  r: number;
}

export const TAIL_COLORS = ["#5cc8ff", "#3fd69a", "#b6a5ff", "#f6b98a", "#8eb4ff", "#f28fb5", "#e6d36b", "#7fe0d6", "#c7e07f", "#ffa36b"];

export function colorFor(tails: readonly string[], tail: string): string {
  const i = Math.max(0, tails.indexOf(tail));
  return TAIL_COLORS[i % TAIL_COLORS.length] ?? "#5cc8ff";
}

/** lat/lon to range metres with the frame the demo sends. */
export function toMetres(frame: RangeFrame["frame"], lat: number, lon: number): [number, number] {
  if (!frame) return [lon, lat];
  return [(lon - frame.lon0) * frame.m_lon, (lat - frame.lat0) * frame.m_lat];
}

/**
 * The range as an SVG: terrain image, the jamming zone, named places, the
 * ground station, flown or planned paths and live markers. North is up.
 */
export function RangeMap({
  range,
  paths = [],
  markers = [],
  keepouts = [],
  label,
  children,
}: {
  range: RangeFrame;
  paths?: MapPath[];
  markers?: MapMarker[];
  keepouts?: MapZone[];
  label: string;
  children?: ReactNode;
}) {
  const xs: number[] = [range.station.x];
  const ys: number[] = [range.station.y];
  for (const p of range.places) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const path of paths)
    for (const [x, y] of path.pts) {
      xs.push(x);
      ys.push(y);
    }
  const pad = 450;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const w = maxX - minX;
  const h = maxY - minY;
  const bm = range.basemap;
  const text = Math.max(w, h) / 95;
  return (
    <svg className="rm-map" viewBox={`${minX} ${-maxY} ${w} ${h}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {bm ? <image href={bm.url} x={bm.west} y={-bm.north} width={bm.east - bm.west} height={bm.north - bm.south} preserveAspectRatio="none" className="rm-bg" /> : null}
      <rect x={minX} y={-maxY} width={w} height={h} className="rm-shade" />
      {range.zones.map((z) => (
        <g key={z.id}>
          <circle cx={z.x} cy={-z.y} r={z.r} className="rm-jam" />
          <text x={z.x} y={-z.y - z.r - text * 0.6} className="rm-zone-label" fontSize={text} textAnchor="middle">
            {z.label}
          </text>
        </g>
      ))}
      {keepouts.map((k, i) => (
        <g key={`${k.name}-${i}`}>
          <circle cx={k.x} cy={-k.y} r={k.r} className="rm-keepout" />
          <text x={k.x} y={-k.y - k.r - text * 0.4} className="rm-keepout-label" fontSize={text * 0.85} textAnchor="middle">
            {k.name}
          </text>
        </g>
      ))}
      {range.places.map((p) => (
        <g key={p.id}>
          <circle cx={p.x} cy={-p.y} r={text * 0.35} className="rm-place" />
          <text x={p.x + text * 0.6} y={-p.y + text * 0.35} className="rm-place-label" fontSize={text * 0.9}>
            {p.label}
          </text>
        </g>
      ))}
      {paths.map((p) => (
        <polyline
          key={p.id}
          points={p.pts.map(([x, y]) => `${x},${-y}`).join(" ")}
          fill="none"
          stroke={p.color}
          strokeWidth={p.faded ? 1.2 : 2}
          strokeOpacity={p.faded ? 0.35 : 0.9}
          strokeDasharray={p.dashed ? "6 5" : undefined}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      ))}
      <g>
        <rect x={range.station.x - text * 0.6} y={-range.station.y - text * 0.6} width={text * 1.2} height={text * 1.2} className="rm-station" />
        <text x={range.station.x} y={-range.station.y + text * 1.9} className="rm-place-label" fontSize={text} textAnchor="middle">
          GCS
        </text>
      </g>
      {markers.map((m) => (
        <g key={m.id} opacity={m.dim ? 0.45 : 1}>
          {m.ring && m.ring > 3 ? <circle cx={m.x} cy={-m.y} r={Math.max(m.ring * 4, text * 0.9)} className="rm-ring" stroke={m.color} /> : null}
          {m.cross ? (
            <path d={`M${m.x - text * 0.6},${-m.y - text * 0.6}L${m.x + text * 0.6},${-m.y + text * 0.6}M${m.x - text * 0.6},${-m.y + text * 0.6}L${m.x + text * 0.6},${-m.y - text * 0.6}`} stroke="var(--danger)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          ) : (
            <circle cx={m.x} cy={-m.y} r={text * 0.5} fill={m.color} stroke="#04131c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
          <text x={m.x + text * 0.8} y={-m.y - text * 0.5} className="rm-tail" fontSize={text * 1.05} fill={m.color}>
            {m.label}
          </text>
        </g>
      ))}
      {children}
    </svg>
  );
}
