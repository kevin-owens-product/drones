import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Viewer = {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
};

interface EvalRow {
  recorded_at: string;
  git_sha: string;
  metric: string;
  value: number;
  unit: string;
  phase: string;
}

export function EvalPage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [items, setItems] = useState<EvalRow[]>([]);
  const [fault, setFault] = useState("");

  useEffect(() => {
    let stopped = false;
    void api<{ items: EvalRow[] }>("/v1/eval/runs")
      .then((result) => {
        if (stopped) {
          return;
        }
        onBannerRef.current(result.banner);
        setItems(result.body.items);
      })
      .catch((error: unknown) => {
        if (!stopped) {
          setFault(error instanceof Error ? error.message : "eval failed");
        }
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
  const rows = [...latest.values()].sort((a, b) => a.phase.localeCompare(b.phase) || a.metric.localeCompare(b.metric));

  return (
    <section className="page page-fill">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Eval</h1>
          <p className="lede">The latest value of every metric `make eval-store` has recorded, by commit. The README table says which come from unit checks and which from PX4 in the loop.</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Phase</th>
                <th>Metric</th>
                <th>Value</th>
                <th>Commit</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="meta">No runs stored yet. Run `make eval-store`.</td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={`${row.recorded_at}-${row.metric}`}>
                  <td className="meta">{row.phase}</td>
                  <td>{row.metric}</td>
                  <td className="mono">
                    {row.value} {row.unit}
                  </td>
                  <td className="mono">{row.git_sha}</td>
                  <td className="meta">{row.recorded_at.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
