import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";
import "./plan.css";

interface EvalRow {
  recorded_at: string;
  git_sha: string;
  metric: string;
  value: number | string;
  unit: string;
  phase: string;
  /** "Unit check" or "PX4 SITL". The demo serves it from the README table; the API may not. */
  measured_in?: string;
}

const OPEN_PROBLEMS = new Set(["Runs that held the target, tracker v2", "Frames on target, tracker v1, median run", "Runs that held the target, tracker v1"]);

export function EvalPage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [items, setItems] = useState<EvalRow[]>([]);
  const [source, setSource] = useState("");
  const [where, setWhere] = useState("all");
  const [fault, setFault] = useState("");

  useEffect(() => {
    let stopped = false;
    void api<{ items: EvalRow[]; source?: string }>("/v1/eval/runs")
      .then((result) => {
        if (stopped) return;
        onBannerRef.current(result.banner);
        setItems(Array.isArray(result.body.items) ? result.body.items : []);
        setSource(result.body.source ?? "");
      })
      .catch((error: unknown) => {
        if (!stopped) setFault(error instanceof Error ? error.message : "eval failed");
      });
    return () => {
      stopped = true;
    };
  }, []);

  const latest = new Map<string, EvalRow>();
  for (const row of items) {
    const seen = latest.get(row.metric);
    if (!seen || seen.recorded_at < row.recorded_at) latest.set(row.metric, row);
  }
  const all = [...latest.values()].sort((a, b) => a.phase.localeCompare(b.phase) || a.metric.localeCompare(b.metric));
  const rows = all.filter((r) => where === "all" || r.measured_in === where);
  const sitl = all.filter((r) => r.measured_in === "PX4 SITL").length;
  const unit = all.filter((r) => r.measured_in === "Unit check").length;
  const phases = [...new Set(all.map((r) => r.phase))];

  return (
    <section className="page ins-page" data-testid="eval">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Evidence</h1>
          <p className="lede">Every number the platform claims, and where it was measured. Unit checks run a module open loop on a synthetic or recorded stream; PX4 SITL rows fly PX4 in SIH with its own EKF2 and close the loop through MAVLink. None of these are field results.</p>
        </div>
      </header>
      {fault ? (
        <p className="fault" role="alert">
          {fault}
        </p>
      ) : null}
      {all.length ? (
        <div className="grid-stats">
          <div className="stat">
            <p className="stat-value">{all.length}</p>
            <p className="stat-label">Metrics across {phases.length} phases</p>
          </div>
          <div className="stat">
            <p className="stat-value">{sitl}</p>
            <p className="stat-label">Closed loop in PX4 SITL</p>
          </div>
          <div className="stat">
            <p className="stat-value">{unit}</p>
            <p className="stat-label">Open-loop unit checks</p>
          </div>
          <div className="stat">
            <p className="stat-value">0</p>
            <p className="stat-label">Field-flight results (none claimed)</p>
          </div>
        </div>
      ) : null}
      {all.length ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Open problem</h2>
          </div>
          <p className="ins-callout">
            Tracker v2 keeps a target in PX4 SITL in 3 of 5 runs; in the other 2 it swaps to a parked look-alike. Tracking is operator-designated and runs in simulation only. It never cues a weapon (ADR-0016).
          </p>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-head">
          <h2>Results</h2>
          {all.some((r) => r.measured_in) ? (
            <div className="db-filters" role="group" aria-label="Where measured">
              {[
                ["all", "All"],
                ["PX4 SITL", "PX4 SITL"],
                ["Unit check", "Unit check"],
              ].map(([k, label]) => (
                <button key={k} type="button" className={where === k ? "chip is-on" : "chip"} aria-pressed={where === k} onClick={() => setWhere(k as string)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Phase</th>
                <th>Metric</th>
                <th>Value</th>
                <th>Measured in</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="meta">
                    No runs stored yet. Run `make eval-store`.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={`${row.recorded_at}-${row.metric}`} className={OPEN_PROBLEMS.has(row.metric) ? "ins-short" : undefined}>
                  <td className="meta">{row.phase}</td>
                  <td>{row.metric}</td>
                  <td className="mono">
                    {row.value} {row.unit}
                  </td>
                  <td>
                    <span className={row.measured_in === "PX4 SITL" ? "pill pill-ok" : "pill"}>{row.measured_in ?? "–"}</span>
                  </td>
                  <td className="meta mono">{row.recorded_at ? `${row.git_sha} · ${row.recorded_at.slice(0, 16).replace("T", " ")}` : row.git_sha}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {source ? <p className="ins-source">{source}. Method: docs/design/sitl.md; full results: docs/eval/sitl.md.</p> : null}
      </section>
    </section>
  );
}
