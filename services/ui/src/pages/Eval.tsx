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

  return (
    <section>
      <h2>Eval</h2>
      {fault ? <p>{fault}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Metric</th>
            <th>Value</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={`${row.recorded_at}-${row.metric}`}>
              <td>{row.phase}</td>
              <td>{row.metric}</td>
              <td>
                {row.value} {row.unit}
              </td>
              <td>{row.git_sha}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
