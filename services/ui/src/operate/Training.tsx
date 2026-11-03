// Training panel. Shown only when the console is opened with ?scenario=<name>
// against the demo server. It shows scripted alerts, records the operator's
// response, and shows a scorecard. Responses are training records: the
// console never sends a command to a vehicle (ADR 0016).
import { useEffect, useState, type CSSProperties } from "react";

type Ack = { action: string; time_to_act_s: number; correct: boolean };
type Alert = { id: string; tail: string; kind: string; text: string; ack: Ack | null };
type Row = { id: string; kind: string; tail: string; action: string | null; time_to_act_s: number | null; correct: boolean | null };
type Card = { title: string; alerts: number; acknowledged: number; complete: boolean; correct_rate: number | null; mean_time_to_act_s: number | null; rows: Row[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  return (await r.json()) as T;
}

export function scenarioParam(): string | null {
  return new URLSearchParams(window.location.search).get("scenario");
}

export function Training({ scenario }: { scenario: string }) {
  const [responses, setResponses] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void call<{ responses?: string[]; error?: string }>(`/v1/training/start?scenario=${encodeURIComponent(scenario)}`).then((r) => {
      if (r.error) setError(r.error);
      else setResponses(r.responses ?? []);
    });
    const id = window.setInterval(() => {
      void call<{ alerts?: Alert[]; scorecard?: Card }>("/v1/training/state").then((r) => {
        if (!live) return;
        setAlerts(r.alerts ?? []);
        setCard(r.scorecard ?? null);
      });
    }, 500);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [scenario]);

  const respond = (id: string, action: string) => {
    void call("/v1/training/ack", { method: "POST", body: JSON.stringify({ id, action }) });
  };

  const box: CSSProperties = { position: "fixed", right: 16, bottom: 16, width: 360, maxHeight: "70vh", overflow: "auto", zIndex: 1000, padding: 12, background: "rgba(16,20,24,0.94)", color: "#e8eef2", border: "1px solid #3a4650", borderRadius: 6, font: "12px/1.4 var(--font-mono, monospace)" };
  if (error) return <div style={box}>Training: {error}</div>;
  const pending = alerts.filter((a) => !a.ack);
  return (
    <div style={box} aria-label="Training scenario">
      <strong>TRAINING · {card?.title ?? scenario}</strong>
      <div style={{ opacity: 0.7 }}>Responses are recorded for scoring. Nothing is sent to a vehicle.</div>
      {pending.length === 0 && !card?.complete && <p>Watching. Next alert will appear here.</p>}
      {pending.map((a) => (
        <div key={a.id} style={{ margin: "8px 0", padding: 8, border: "1px solid #b5651d" }}>
          <div>{a.text}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {responses.map((r) => (
              <button key={r} type="button" onClick={() => respond(a.id, r)}>{r.replace(/_/g, " ")}</button>
            ))}
          </div>
        </div>
      ))}
      {card && card.acknowledged > 0 && (
        <table style={{ width: "100%", marginTop: 8 }}>
          <thead>
            <tr><th align="left">Alert</th><th align="left">Response</th><th align="right">Time to act</th></tr>
          </thead>
          <tbody>
            {card.rows.filter((r) => r.action).map((r) => (
              <tr key={r.id}>
                <td>{r.tail} {r.kind}</td>
                <td>{r.action} {r.correct ? "✓" : "✗"}</td>
                <td align="right">{r.time_to_act_s?.toFixed(1)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {card?.complete && (
        <p>
          Scorecard: {Math.round((card.correct_rate ?? 0) * 100)} % correct, mean time to act {card.mean_time_to_act_s?.toFixed(1)} s over {card.alerts} alerts.
        </p>
      )}
    </div>
  );
}
