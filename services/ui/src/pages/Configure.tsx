import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";

type Jamming = "none" | "light" | "heavy";

interface Option {
  ok: boolean;
  reason: string;
  variant: string;
  battery: string;
  band: string;
  mass_kg: number;
  flight_min: number;
  need_wh: number;
  usable_wh: number;
  energy_margin: number;
  hop_km: number;
  relays: number;
  margin_at_range_db: number;
  price_usd: number;
}

interface Result {
  source: string;
  summary: string;
  best: Option | null;
  options: Option[];
  assumptions: Record<string, number>;
}

const BANDS: Record<string, string> = { "915": "900 MHz", "2400": "2.4 GHz", "5800": "5.8 GHz" };

interface Airframe {
  label: string;
  mass_kg: number;
  pack_wh: number;
  pack?: string;
  cruise_mps: number;
  max_air_mps: number;
  hover_w: number;
  cruise_w: number;
  best_range_mps: number;
  best_range_w: number;
  hover_min: number;
  cruise_min: number;
  range_km_still_air: number;
}

interface Physics {
  source: string;
  airframes: Record<string, Airframe>;
  curves?: Record<string, [number, number][]>;
}

const CURVE_COLORS = ["#7dffc4", "#6cb4ff", "#ffb86b"];

/** Power against airspeed for each airframe, with the best-range speed marked. */
function PowerCurves({ physics }: { physics: Physics }) {
  const W = 640;
  const H = 240;
  const L = 48;
  const B = 32;
  const skus = Object.keys(physics.airframes);
  const curves = physics.curves ?? {};
  const maxV = Math.max(...skus.map((k) => physics.airframes[k]!.max_air_mps));
  const maxW = Math.max(...skus.flatMap((k) => (curves[k] ?? []).map(([, w]) => w)), 100);
  const x = (v: number) => L + ((W - L - 12) * v) / maxV;
  const y = (w: number) => H - B - ((H - B - 14) * w) / maxW;
  return (
    <figure className="cf-curves" aria-label="Power against airspeed">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Power against airspeed for each airframe">
        {[0, 100, 200, 300, 400].filter((w) => w <= maxW).map((w) => (
          <g key={w}>
            <line x1={L} x2={W - 12} y1={y(w)} y2={y(w)} className="cf-grid" />
            <text x={L - 6} y={y(w) + 4} textAnchor="end" className="cf-axis">{w}</text>
          </g>
        ))}
        {[0, 5, 10, 15, 20, 25].filter((v) => v <= maxV).map((v) => (
          <text key={v} x={x(v)} y={H - B + 16} textAnchor="middle" className="cf-axis">{v}</text>
        ))}
        <text x={W - 12} y={H - 4} textAnchor="end" className="cf-axis">airspeed m/s</text>
        <text x={L - 6} y={12} textAnchor="end" className="cf-axis">W</text>
        {skus.map((k, i) => {
          const pts = curves[k] ?? [];
          const f = physics.airframes[k]!;
          return (
            <g key={k} style={{ color: CURVE_COLORS[i % CURVE_COLORS.length] }}>
              <polyline points={pts.map(([v, w]) => `${x(v)},${y(w)}`).join(" ")} className="cf-curve" />
              <circle cx={x(f.best_range_mps)} cy={y(f.best_range_w)} r={4} className="cf-mark" />
              <text x={x(f.best_range_mps) + 7} y={y(f.best_range_w) - 7} className="cf-label">{`${f.label} · ${f.best_range_mps} m/s, ${f.cruise_min} min`}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="meta">
        Electrical power to fly each airframe at an airspeed, from the same model the live sortie and the debrief use. The dot is the best-range speed and the minutes a pack gives at cruise. Into a headwind the best speed moves right. Assumed coefficients, not measured.
      </figcaption>
    </figure>
  );
}

export function ConfigurePage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [m, setM] = useState({ range_km: 3, wind_mps: 4, temp_c: 20, loiter_min: 5, jamming: "none" as Jamming });
  const [r, setR] = useState<Result | null>(null);
  const [physics, setPhysics] = useState<Physics | null>(null);
  const [fault, setFault] = useState("");

  useEffect(() => {
    void api<Physics>("/v1/physics")
      .then((res) => setPhysics(res.body))
      .catch(() => setPhysics(null));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(m).map(([k, v]) => [k, String(v)]));
    void api<Result>(`/v1/configure?${q}`)
      .then((res) => {
        onBannerRef.current(res.banner);
        setR(res.body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "configure failed"));
  }, [m]);

  const num = (k: keyof typeof m, label: string, min: number, max: number, step: number, unit: string) => (
    <label className="cf-field">
      <span>
        {label} <strong className="mono">{String(m[k])}</strong> {unit}
      </span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={Number(m[k])} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })} />
    </label>
  );

  return (
    <section className="page ins-page" data-testid="configure">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Loadout planner</h1>
          <p className="lede">Which airframe variant, battery and radio band to send on a mission, given its range, wind, temperature and expected jamming, with the margins left over.</p>
        </div>
        <span className="pill pill-warn" title={r?.source}>
          MODEL
        </span>
      </header>
      {fault ? <p className="fault">{fault}</p> : null}
      <div className="panel cf-inputs">
        {num("range_km", "Range, one way", 1, 15, 0.5, "km")}
        {num("wind_mps", "Wind", 0, 14, 1, "m/s")}
        {num("temp_c", "Temperature", -20, 40, 1, "°C")}
        {num("loiter_min", "Time on station", 0, 20, 1, "min")}
        <label className="cf-field">
          <span>Expected jamming</span>
          <select aria-label="Expected jamming" value={m.jamming} onChange={(e) => setM({ ...m, jamming: e.target.value as Jamming })}>
            <option value="none">None</option>
            <option value="light">Light</option>
            <option value="heavy">Heavy</option>
          </select>
        </label>
      </div>
      {r ? (
        <>
          <p className={`cf-answer${r.best ? "" : " is-none"}`} role="status">
            {r.summary}
          </p>
          {physics && physics.curves ? (
            <section className="panel">
              <div className="panel-head">
                <h2>What a sortie costs</h2>
                <span className="pill pill-warn">SIM</span>
              </div>
              <PowerCurves physics={physics} />
              <div className="table-wrap" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>Airframe</th>
                      <th>Mass</th>
                      <th>Pack</th>
                      <th>Hover</th>
                      <th>Cruise</th>
                      <th>Best range</th>
                      <th>Endurance at cruise</th>
                      <th>Still-air range with reserve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(physics.airframes).map(([sku, f]) => (
                      <tr key={sku}>
                        <td>{f.label}</td>
                        <td className="mono">{f.mass_kg} kg</td>
                        <td>{f.pack ?? `${f.pack_wh} Wh`}</td>
                        <td className="mono">{f.hover_w} W</td>
                        <td className="mono">{f.cruise_w} W at {f.cruise_mps} m/s</td>
                        <td className="mono">{f.best_range_w} W at {f.best_range_mps} m/s</td>
                        <td className="mono">{f.cruise_min} min</td>
                        <td className="mono">{f.range_km_still_air.toFixed(1)} km</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          <section className="panel">
            <div className="panel-head">
              <h2>Every option</h2>
            </div>
            <div className="table-wrap" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Battery</th>
                    <th>Band</th>
                    <th>Sortie</th>
                    <th>Energy left</th>
                    <th>Hop / relays</th>
                    <th>Price</th>
                    <th>Why not</th>
                  </tr>
                </thead>
                <tbody>
                  {r.options.map((o) => (
                    <tr key={`${o.variant}-${o.battery}-${o.band}`} className={o === r.best || (r.best && o.variant === r.best.variant && o.battery === r.best.battery && o.band === r.best.band) ? "cf-best" : o.ok ? "" : "cf-no"}>
                      <td>{o.variant}</td>
                      <td>{o.battery}</td>
                      <td>{BANDS[o.band] ?? o.band}</td>
                      <td className="mono">{o.flight_min ?? "–"} min</td>
                      <td className="mono">{o.energy_margin === undefined ? "–" : o.energy_margin < 0 ? "Runs out" : `${Math.round(o.energy_margin * 100)}%`}</td>
                      <td className="mono">
                        {o.hop_km} km / {o.relays}
                      </td>
                      <td className="mono">${o.price_usd}</td>
                      <td className="meta">{o.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta ins-note">
              Ranked feasible first, then fewest relays, then price. Power comes from the shared performance model (momentum theory plus a drag area scaled with mass) at {r.assumptions.cruise_mps} m/s airspeed, flown into the wind one way. Packs give{" "}
              {Math.round((r.assumptions.usable_depth ?? 0) * 100)}% of rated energy, 7.5% less per 10 °C below 20 °C, and must keep a {Math.round((r.assumptions.reserve ?? 0) * 100)}% reserve. Links need{" "}
              {r.assumptions.link_margin_db} dB of margin over free-space loss with a clutter allowance; jamming costs each band an assumed number of dB. Video bandwidth, terrain masking and pack ageing are not modelled.
              These are textbook approximations, not measured figures.
            </p>
          </section>
        </>
      ) : null}
    </section>
  );
}
