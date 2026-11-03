import { useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";

interface Task {
  kind: string;
  place: string;
  label: string;
  vehicles: number;
  minutes: number | null;
  from: string;
  tails?: string[];
}

interface Proposal {
  id: string;
  brief: string;
  parser: string;
  intent: { tasks: Task[]; reserve: number; deadline: string | null; avoid: string[]; unread: string[]; refused: string | null };
  plan: Task[];
  reserve: string[];
  idle: string[];
  unavailable: { tail: string; why: string }[];
  short: string[];
  status: string;
  decided_by?: string;
}

const EXAMPLES = [
  "Search the north field with two vehicles before 14:00, then check the culvert, keep two in reserve",
  "Observe gate 3 with 2 drones for 20 minutes, relay on the ridge, avoid the jamming zone",
  "Survey area a and area d, inspect the road junction",
];

const VERB: Record<string, string> = { search: "Search", survey: "Survey", observe: "Observe", relay: "Relay at", inspect: "Inspect" };

export function BriefPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const [brief, setBrief] = useState(EXAMPLES[0]!);
  const [p, setP] = useState<Proposal | null>(null);
  const [fault, setFault] = useState("");

  async function submit() {
    setFault("");
    try {
      const r = await api<Proposal>("/v1/intent/propose", { method: "POST", body: JSON.stringify({ brief }) });
      onBanner(r.banner);
      setP(r.body);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "could not read the brief");
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!p) return;
    try {
      const r = await api<Proposal>("/v1/intent/approve", { method: "POST", body: JSON.stringify({ id: p.id, decision, by: viewer.display_name }) });
      setP(r.body);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "decision failed");
    }
  }

  return (
    <section className="page ins-page" data-testid="brief">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Brief</h1>
          <p className="lede">Type the mission the way you would say it. The console reads it into tasks, picks vehicles, shows you exactly what it understood, and does nothing until you approve.</p>
        </div>
        <span className="pill pill-warn">OFFLINE PARSER</span>
      </header>
      <form
        className="panel br-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="br-text">Mission brief</label>
        <textarea id="br-text" rows={3} maxLength={600} value={brief} onChange={(e) => setBrief(e.target.value)} />
        <div className="br-row">
          <div className="br-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => setBrief(ex)}>
                {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!brief.trim()}>
            Read brief
          </button>
        </div>
      </form>
      {fault ? <p className="fault">{fault}</p> : null}

      {p ? (
        <section className="panel br-result" aria-label="Proposal">
          <div className="panel-head">
            <h2>
              Proposal <span className="mono">{p.id}</span>
            </h2>
            <span className={`pill${p.status === "approved" ? " pill-ok" : p.status === "refused" ? " pill-warn" : ""}`}>{p.status}</span>
          </div>
          {p.intent.refused ? <p className="br-refused">{p.intent.refused}</p> : null}
          {p.plan.length ? (
            <ol className="br-tasks">
              {p.plan.map((t, i) => (
                <li key={i}>
                  <p className="br-task">
                    <strong>
                      {VERB[t.kind] ?? t.kind} {t.label}
                    </strong>
                    {t.minutes ? ` for ${t.minutes} min` : ""}: {t.tails?.length ? t.tails.join(", ") : "no vehicle free"}
                  </p>
                  <p className="meta">From: “{t.from}”</p>
                </li>
              ))}
            </ol>
          ) : null}
          {!p.intent.refused ? (
            <ul className="br-facts">
              {p.intent.deadline ? <li>Done by {p.intent.deadline}</li> : null}
              <li>Reserve: {p.reserve.length ? p.reserve.join(", ") : "none"}</li>
              {p.intent.avoid.length ? <li>Avoid: {p.intent.avoid.join(", ")} (the planner treats it as a no-go area)</li> : null}
              {p.idle.length ? <li>Left idle: {p.idle.join(", ")}</li> : null}
              {p.unavailable.map((u) => (
                <li key={u.tail}>
                  Not used: {u.tail}, {u.why}
                </li>
              ))}
              {p.short.map((s) => (
                <li key={s} className="br-warn">
                  Short: {s}
                </li>
              ))}
              {p.intent.unread.map((u) => (
                <li key={u} className="br-warn">
                  Not understood: {u}
                </li>
              ))}
            </ul>
          ) : null}
          {p.status === "awaiting approval" ? (
            <div className="br-row">
              <span className="meta">{p.parser} Approving files this as a draft for the mission planner.</span>
              <div className="br-actions">
                <button type="button" className="btn" onClick={() => void decide("reject")}>
                  Reject
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void decide("approve")}>
                  Approve
                </button>
              </div>
            </div>
          ) : null}
          {p.status === "approved" || p.status === "rejected" ? (
            <p className="ins-held" role="status">
              {p.status === "approved" ? "Approved" : "Rejected"} by {p.decided_by}.{" "}
              {p.status === "approved" ? "Filed as a draft for the mission planner; it goes through mission review like any plan. " : ""}Nothing was sent to a vehicle.
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
