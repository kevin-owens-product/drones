import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { inCustomerView } from "../shell/workspace";
import "./insights.css";

interface Sample {
  t: number;
  alt_m?: number;
  battery_pct?: number;
  ground_mps?: number;
  nav_source?: string;
}

interface Report {
  id: string;
  at: string;
  tail: string;
  unit: string;
  firmware: string;
  by: string;
  text: string;
  themes: string[];
  samples: Sample[];
  seeded: boolean;
}

interface Group {
  theme: string;
  label: string;
  count: number;
  units: string[];
  top_build: string;
  top_build_count: number;
  top_build_fleet_share: number;
  concentrated: boolean;
  latest: string;
  ids: string[];
}

interface Body {
  source: string;
  fleet_share: Record<string, number>;
  items: Report[];
  triage: Group[];
}

function Spark({ samples, field, label }: { samples: Sample[]; field: "alt_m" | "battery_pct"; label: string }) {
  const pts = samples.filter((s) => typeof s[field] === "number");
  if (pts.length < 2) return null;
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const vals = pts.map((s) => s[field] as number);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const W = 120;
  const H = 28;
  const d = pts
    .map((s, i) => {
      const x = t1 > t0 ? ((s.t - t0) / (t1 - t0)) * W : 0;
      const y = hi > lo ? H - 2 - (((s[field] as number) - lo) / (hi - lo)) * (H - 4) : H / 2;
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
  return (
    <span className="fr-spark">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} over the last 30 seconds`}>
        <path d={d} />
      </svg>
      <span className="meta">
        {label} {Math.round(vals[0]!)}→{Math.round(vals[vals.length - 1]!)}
      </span>
    </span>
  );
}

export function FieldReportsPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [body, setBody] = useState<Body | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [fault, setFault] = useState("");

  useEffect(() => {
    void api<Body>("/v1/field-reports")
      .then((r) => {
        onBannerRef.current(r.banner);
        setBody(r.body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "reports failed"));
  }, []);

  if (!body) {
    return <section className="page">{fault ? <p className="fault">{fault}</p> : <p className="meta">Loading…</p>}</section>;
  }
  const picked = theme ? body.triage.find((g) => g.theme === theme) : null;
  const items = picked ? body.items.filter((r) => picked.ids.includes(r.id)) : body.items;

  return (
    <section className="page ins-page" data-testid="field-reports">
      <header className="page-head">
        <div>
          <p className="kicker">Fleet</p>
          <h1 className="page-title">Field reports</h1>
          <p className="lede">
            What operators flagged, grouped by theme. Each report carries the vehicle's firmware build and, when filed from Operate with <kbd>R</kbd>, its last 30 seconds of telemetry.
          </p>
          {inCustomerView(viewer) ? null : <p className="meta">Reports Customer A shares with Neros. Customers B and C don't share field reports yet.</p>}
        </div>
        <span className="pill pill-warn" title={body.source}>
          SIM
        </span>
      </header>
      <p className="ins-source">
        {body.source}. Themes come from keyword rules, so a note can sit in two themes or in none. Fleet build mix:{" "}
        {Object.entries(body.fleet_share)
          .map(([b, s]) => `${b} ${Math.round(s * 100)}%`)
          .join(", ")}
        .
      </p>

      <div className="fr-themes" role="group" aria-label="Themes">
        {body.triage.map((g) => (
          <button
            type="button"
            key={g.theme}
            className={`fr-theme${g.concentrated ? " is-hot" : ""}${theme === g.theme ? " is-on" : ""}`}
            aria-pressed={theme === g.theme}
            onClick={() => setTheme(theme === g.theme ? null : g.theme)}
          >
            <span className="fr-count">{g.count}</span>
            <span className="fr-label">{g.label}</span>
            <span className="meta">
              {g.top_build_count} of {g.count} on {g.top_build} ({Math.round(g.top_build_fleet_share * 100)}% of fleet)
            </span>
            {g.concentrated ? <span className="fr-flag">Look at build {g.top_build}</span> : null}
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{picked ? `${picked.label}: ${picked.count} reports` : `All reports (${body.items.length})`}</h2>
          {picked ? (
            <button type="button" className="btn" onClick={() => setTheme(null)}>
              Show all
            </button>
          ) : null}
        </div>
        <ul className="fr-list">
          {items.map((r) => (
            <li key={r.id} className="fr-item">
              <div className="fr-meta">
                <span className="mono">{r.id}</span>
                <span className="mono">{r.tail}</span>
                <span>Unit {r.unit}</span>
                <span className="mono">fw {r.firmware}</span>
                <span className="meta">{r.at.slice(0, 16).replace("T", " ")}Z</span>
                {r.seeded ? <span className="pill">seeded</span> : <span className="pill pill-ok">filed by {r.by}</span>}
              </div>
              <p className="fr-text">{r.text}</p>
              {r.samples.length ? (
                <div className="fr-tele">
                  <Spark samples={r.samples} field="alt_m" label="alt m" />
                  <Spark samples={r.samples} field="battery_pct" label="batt %" />
                  <span className="meta">{r.samples.length} samples pinned</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
