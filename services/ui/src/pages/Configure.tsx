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

export function ConfigurePage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [m, setM] = useState({ range_km: 3, wind_mps: 4, temp_c: 20, loiter_min: 5, jamming: "none" as Jamming });
  const [r, setR] = useState<Result | null>(null);
  const [fault, setFault] = useState("");

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
          <h1 className="page-title">Configure</h1>
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
          <section className="panel">
            <div className="panel-head">
              <h2>Every option</h2>
            </div>
            <div className="table-wrap">
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
              Ranked feasible first, then fewest relays, then price. Power is hover power scaled by mass^1.5 plus a drag term at {r.assumptions.cruise_mps} m/s, flown into the wind one way. Packs give{" "}
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
