import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";
import "./plan.css";
import "./physics.css";

type Pt = [number, number];

interface Picture {
  source: string;
  area: { x0: number; x1: number; y0: number; y1: number; cell: number; cols: number; rows: number };
  station: { x: number; y: number };
  target: { id: string; label: string; x: number; y: number };
  zones: { id: string; kind: string; briefed: boolean; x: number; y: number; r: number }[];
  residual_m: number;
  passes: { tail: string; path: Pt[] }[];
  total_passes: number;
  samples: number;
  denied_samples: number;
  cells: { i: number; x: number; y: number; n: number; p: number }[];
  route: Pt[];
  route_exposure: { length_m: number; in_zone_m: Record<string, number> };
  brief_route: Pt[];
  brief_exposure: { length_m: number; in_zone_m: Record<string, number> };
  score: { mapped: number; precision: number | null; recall: number | null };
}

interface Coverage {
  source: string;
  link: "c2" | "video";
  band: string;
  band_label: string;
  bands: { id: string; label: string }[];
  agl_m: number;
  ew: boolean;
  cell_m: number;
  need_db: number;
  emitter: { x: number; y: number; label: string; on: boolean };
  held_pct: number;
  cells: { x: number; y: number; m: number }[];
}

type Layer = "gnss" | "c2" | "video";

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

export function DenialMapPage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [passes, setPasses] = useState(0);
  const [truth, setTruth] = useState(false);
  const [pic, setPic] = useState<Picture | null>(null);
  const [fault, setFault] = useState("");
  const [layer, setLayer] = useState<Layer>("gnss");
  const [agl, setAgl] = useState(100);
  const [band, setBand] = useState("915");
  const [ew, setEw] = useState(false);
  const [cov, setCov] = useState<Coverage | null>(null);

  useEffect(() => {
    if (layer === "gnss") return;
    const q = new URLSearchParams({ link: layer, band, agl_m: String(agl), ew: ew ? "1" : "0" });
    void api<Coverage>(`/v1/coverage?${q}`)
      .then((r) => setCov(r.body))
      .catch(() => setCov(null));
  }, [layer, band, agl, ew]);

  useEffect(() => {
    void api<Picture>(`/v1/denial-map?passes=${passes}`)
      .then((r) => {
        onBannerRef.current(r.banner);
        setPic(r.body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "map failed"));
  }, [passes]);

  if (!pic) return <section className="page">{fault ? <p className="fault">{fault}</p> : <p className="meta">Loading…</p>}</section>;

  const { area } = pic;
  const W = area.x1 - area.x0;
  const H = area.y1 - area.y0;
  // SVG y grows down; north is up.
  const sx = (x: number) => x - area.x0;
  const sy = (y: number) => area.y1 - y;
  const line = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x)},${sy(y)}`).join("");
  const s1 = pic.route_exposure.in_zone_m;
  const b1 = pic.brief_exposure.in_zone_m;
  const unbriefedBefore = pic.zones.filter((z) => !z.briefed).reduce((m, z) => m + (b1[z.id] ?? 0), 0);
  const unbriefedNow = pic.zones.filter((z) => !z.briefed).reduce((m, z) => m + (s1[z.id] ?? 0), 0);

  return (
    <section className="page ins-page" data-testid="denial-map">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Denial map</h1>
          <p className="lede">
            Where position fails and where the radio does. Every vehicle that flies on VIO also learns where GNSS dropped out or disagreed with VIO by more than {pic.residual_m} m; the fleet shares that, and the next route bends around it. The radio layers show where the control and video links hold over the terrain, with the jammer on or off.
          </p>
        </div>
        <span className="pill pill-warn" title={pic.source}>
          SIM
        </span>
      </header>
      <p className="ins-source">{pic.source}. The jamming zone J1 was in the brief; the spoofing zone S1 was not.</p>

      <div className="dm-controls" role="group" aria-label="Layer">
        <span className="ms-seg">
          {(
            [
              ["gnss", "GNSS"],
              ["c2", "Control link"],
              ["video", "Video link"],
            ] as [Layer, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" className={layer === k ? "is-on" : ""} aria-pressed={layer === k} onClick={() => setLayer(k)}>
              {label}
            </button>
          ))}
        </span>
        {layer !== "gnss" ? (
          <>
            <label htmlFor="dm-agl">
              Drone at <strong>{agl} m</strong> above ground
            </label>
            <input id="dm-agl" type="range" min={30} max={150} step={10} value={agl} onChange={(e) => setAgl(Number(e.target.value))} />
            {layer === "c2" ? (
              <select aria-label="Control band" value={band} onChange={(e) => setBand(e.target.value)}>
                {(cov?.bands ?? [{ id: "915", label: "900 MHz" }]).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="dm-check">
              <input type="checkbox" checked={ew} onChange={(e) => setEw(e.target.checked)} /> EW emitter on (900 MHz, 2.4 GHz)
            </label>
          </>
        ) : null}
      </div>

      <div className="dm-controls">
        <label htmlFor="dm-passes">
          After <strong>{passes}</strong> of {pic.total_passes} scout passes
        </label>
        <input id="dm-passes" type="range" min={0} max={pic.total_passes} step={1} value={passes} onChange={(e) => setPasses(Number(e.target.value))} />
        <label className="dm-check">
          <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Show the simulation's true zones
        </label>
      </div>

      <div className="grid-stats">
        <div className="stat">
          <p className="stat-value">{unbriefedNow} m</p>
          <p className="stat-label">Route inside the unbriefed zone (brief alone: {unbriefedBefore} m)</p>
        </div>
        <div className="stat">
          <p className="stat-value">{(pic.route_exposure.length_m / 1000).toFixed(2)} km</p>
          <p className="stat-label">Route length (brief alone: {(pic.brief_exposure.length_m / 1000).toFixed(2)} km)</p>
        </div>
        <div className="stat">
          <p className="stat-value">
            {pic.denied_samples} / {pic.samples}
          </p>
          <p className="stat-label">Samples denied</p>
        </div>
        <div className="stat">
          <p className="stat-value">
            {pct(pic.score.precision)} / {pct(pic.score.recall)}
          </p>
          <p className="stat-label">Precision / recall on {pic.score.mapped} mapped cells</p>
        </div>
      </div>

      <section className="panel">
        <svg className="dm-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of where GNSS was denied, with the planned route">
          <rect width={W} height={H} className="dm-bg" />
          {layer !== "gnss" && cov
            ? cov.cells.map((c, i) => (
                <rect
                  key={`cov-${i}`}
                  x={sx(c.x - cov.cell_m / 2)}
                  y={sy(c.y + cov.cell_m / 2)}
                  width={cov.cell_m}
                  height={cov.cell_m}
                  className="dm-cov"
                  style={{ fill: c.m < cov.need_db ? "var(--danger)" : c.m < cov.need_db + 10 ? "var(--warn)" : "var(--ok)", fillOpacity: c.m < cov.need_db ? 0.38 : 0.26 }}
                >
                  <title>{`${c.m} dB margin`}</title>
                </rect>
              ))
            : null}
          {layer === "gnss" && pic.cells.map((c) => (
            <rect
              key={c.i}
              x={sx(c.x - area.cell / 2)}
              y={sy(c.y + area.cell / 2)}
              width={area.cell}
              height={area.cell}
              className="dm-cell"
              style={{ fillOpacity: Math.min(1, c.n / 6) * (0.15 + 0.75 * c.p), fill: c.p >= 0.5 ? "var(--danger)" : "var(--ok)" }}
            >
              <title>{`${c.n} samples, ${Math.round(c.p * 100)}% chance denied`}</title>
            </rect>
          ))}
          {pic.zones
            .filter((z) => z.briefed || truth)
            .map((z) => (
              <g key={z.id}>
                <circle cx={sx(z.x)} cy={sy(z.y)} r={z.r} className={z.briefed ? "dm-brief" : "dm-truth"} />
                <text x={sx(z.x)} y={z.briefed ? sy(z.y) + z.r + 140 : sy(z.y) + z.r + 140} className="dm-label" textAnchor="middle">
                  {z.id} {z.kind}
                  {z.briefed ? " (briefed)" : " (truth)"}
                </text>
              </g>
            ))}
          {pic.passes.map((p) => (
            <path key={p.tail} d={line(p.path)} className="dm-pass">
              <title>{`Scout pass ${p.tail}`}</title>
            </path>
          ))}
          <path d={line(pic.brief_route)} className="dm-route-brief" />
          <path d={line(pic.route)} className="dm-route" />
          {layer !== "gnss" && cov?.emitter.on ? (
            <g>
              <circle cx={sx(cov.emitter.x)} cy={sy(cov.emitter.y)} r={110} className="ph-emitter" />
              <text x={sx(cov.emitter.x) + 150} y={sy(cov.emitter.y) + 40} className="dm-label">
                {cov.emitter.label}
              </text>
            </g>
          ) : null}
          <circle cx={sx(pic.station.x)} cy={sy(pic.station.y)} r={70} className="dm-station" />
          <text x={sx(pic.station.x)} y={sy(pic.station.y) + 190} className="dm-label" textAnchor="middle">
            GCS
          </text>
          <circle cx={sx(pic.target.x)} cy={sy(pic.target.y)} r={70} className="dm-target" />
          <text x={sx(pic.target.x) + 120} y={sy(pic.target.y) - 120} className="dm-label" textAnchor="start">
            {pic.target.id} {pic.target.label}
          </text>
        </svg>
        {layer !== "gnss" && cov ? (
          <p className="dm-cov-line" role="status" data-testid="coverage-line">
            {cov.link === "video" ? "Video" : `Control on ${cov.band_label}`} holds over {cov.held_pct}% of the map with the drone at {cov.agl_m} m{cov.ew ? ", the emitter on" : ""}.{" "}
            <span className="ins-key" style={{ background: "var(--ok)" }} /> {cov.need_db + 10} dB or more <span className="ins-key" style={{ background: "var(--warn)" }} /> Thin <span className="ins-key" style={{ background: "var(--danger)" }} /> Lost
          </p>
        ) : null}
        <p className="ins-legend" hidden={layer !== "gnss"}>
          <span className="ins-key dm-key-route" /> Route from the shared map <span className="ins-key dm-key-brief" /> Route from the brief alone <span className="ins-key dm-key-pass" /> Scout
          passes <span className="ins-key dm-key-denied" /> Denied <span className="ins-key dm-key-clear" /> Clear (shade grows with samples)
        </p>
        <p className="meta ins-note">
          Each 200 m cell holds a Beta(1,1) estimate of how often GNSS was denied there. The planner is A* on that grid, with each cell's cost raised by its risk; cells with under 3 samples use the brief, or 10%
          if the brief says nothing, and a cell next to a denied one takes 60% of its risk. Precision and recall score cells with 3 or more samples against the simulation's zones. Across 100 seeds, four passes kept
          both zones off the route every time (demo/denial.test.mjs). Real jamming and spoofing are patchier than circles. The radio layers price the path from the GCS mast to each 200 m cell over the SRTM/NED terrain
          (Bullington diffraction, Fresnel clearance, Earth bulge) and count the emitter as interference; control needs {cov?.need_db ?? 10} dB of margin, video needs a signal at all. Assumed link budgets (SIM), not measured. Plans get the same
          check along their own tracks on Missions.
        </p>
      </section>
    </section>
  );
}
