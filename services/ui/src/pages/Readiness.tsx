import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, pct, Stat, useCustomerOrg, usePageData } from "./thread";

interface Operator {
  id: string; unit: string; course: string; course_done: string | null; instructor: boolean; sessions: number;
  sim: { scenario: string; correct_rate: number; mean_time_to_act_s: number; passed: boolean; at: string };
  refresher: { on: string; kind: string } | null;
  sorties: number; completed: number; rate: number | null; jam_sorties: number; jam_rate: number | null;
  last_sortie: string | null; current: boolean; flags: string[]; ready: boolean;
}
interface Group { label: string; operators: number; sorties: number; rate: number | null; jam_rate: number | null }
interface Readiness {
  source: string; today: string; bundled_sessions: number; currency_rule: string; sharing: boolean;
  operators: Operator[];
  counts: { operators: number; ready: number; not_current: number; sim_failed: number; refreshers: number };
  effect: { by_sessions: Group[]; by_sim: { passed: boolean; operators: number; sorties: number; rate: number | null }[] };
}

/** Who is ready to fly: each operator's training joined to what their sorties did. */
export function ReadinessPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker } = useCustomerOrg(viewer);
  const page = usePageData<Readiness>(`/v1/thread/readiness${query}`, onBanner);
  const [unit, setUnit] = useState("All");
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer", "ops_lead"].includes(r));
  const units = ["All", ...new Set(d.operators.map((o) => o.unit))];
  const shown = d.operators.filter((o) => unit === "All" || o.unit === unit).sort((a, b) => Number(a.ready) - Number(b.ready) || b.flags.length - a.flags.length);
  const maxRate = Math.max(0.01, ...d.effect.by_sessions.map((g) => g.rate ?? 0));

  return (
    <section className="page ins-page co-page ops-page" data-testid="readiness">
      <PageHead
        kicker="Your fleet"
        title="Crew readiness"
        lede="Each operator's training record joined to how their sorties ended: who is current, who needs a refresher, and whether the training sessions bundled with each order changed results."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />

      <div className="th-stats">
        <Stat label="Operators ready" value={`${d.counts.ready} of ${d.counts.operators}`} />
        <Stat label="Simulator qualification not passed" value={String(d.counts.sim_failed)} />
        <Stat label="Not current" value={String(d.counts.not_current)} hint={d.currency_rule} />
        <Stat label="Refreshers booked" value={String(d.counts.refreshers)} />
      </div>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Completed sorties by training taken</h2>
          </div>
          <ul className="th-bars" data-testid="training-effect">
            {d.effect.by_sessions.map((g) => (
              <li key={g.label}>
                <span>{g.label} sessions</span>
                <span className="th-bar is-ok" style={{ width: `${((g.rate ?? 0) / maxRate) * 100}%` }} />
                <span className="mono">{pct(g.rate)}</span>
              </li>
            ))}
          </ul>
          <p className="meta">
            {d.effect.by_sessions.map((g) => `${g.label}: ${g.operators} operators, ${g.sorties} sorties, ${pct(g.jam_rate)} completed under jamming`).join(". ")}.
          </p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Simulator qualification against the field</h2>
          </div>
          <ul className="th-bars">
            {d.effect.by_sim.map((g) => (
              <li key={String(g.passed)}>
                <span>{g.passed ? "Passed" : "Not passed"} ({g.operators})</span>
                <span className={`th-bar ${g.passed ? "is-ok" : "is-warn"}`} style={{ width: `${((g.rate ?? 0) / maxRate) * 100}%` }} />
                <span className="mono">{pct(g.rate)}</span>
              </li>
            ))}
          </ul>
          <p className="meta">Qualification runs in Operate (Training): scripted link, GNSS and battery alerts, scored on the right response and time to act. {d.sharing ? "Neros sees these group results, never operator rows." : "You do not share with Neros."}</p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Operators</h2>
          <div className="ops-filter">
            {units.map((u) => (
              <button key={u} type="button" className={unit === u ? "ops-chip is-on" : "ops-chip"} onClick={() => setUnit(u)}>{u}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table data-testid="readiness-operators">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Unit</th>
                <th>Course</th>
                <th>Sessions</th>
                <th>Simulator</th>
                <th>Sorties, 28 days</th>
                <th>Completed</th>
                <th>Under jamming</th>
                <th>Last sortie</th>
                <th>Needs</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} className={o.ready ? undefined : "th-row-fail"}>
                  <td className="mono">{o.id}{o.instructor ? <span className="meta"> instructor</span> : null}</td>
                  <td>{o.unit}</td>
                  <td>{o.course_done ? `${o.course} ${o.course_done}` : <span className="th-check is-fail">None</span>}</td>
                  <td className="mono">{o.sessions} of {d.bundled_sessions}</td>
                  <td>
                    <span className={`th-check ${o.sim.passed ? "is-ok" : "is-fail"}`}>{o.sim.passed ? "Passed" : "Not passed"}</span>
                    <span className="meta"> {pct(o.sim.correct_rate)} right, {o.sim.mean_time_to_act_s} s</span>
                  </td>
                  <td className="mono">{o.sorties}</td>
                  <td className="mono">{pct(o.rate)}</td>
                  <td className="mono">{pct(o.jam_rate)}</td>
                  <td className="mono">{o.last_sortie ?? "—"}</td>
                  <td>
                    {o.flags.map((f) => (
                      <span key={f} className={`th-check ${f.includes("bundled") ? "is-warn" : "is-fail"}`}>{f}</span>
                    ))}
                    {o.refresher ? (
                      <span className="meta">{o.refresher.kind} on {o.refresher.on}</span>
                    ) : o.flags.length ? (
                      <span className="th-inline">
                        <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void page.post("/v1/thread/act", "readiness.refresher", { org, operator: o.id, kind: o.sim.passed ? "session" : "sim" })}>
                          Book {o.sim.passed ? "a session" : "requalification"}
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Operators are designators, not names. Sorties come from the end-of-flight records on Accountability; a course or class booking goes through Supply &amp; support.</p>
      </section>
    </section>
  );
}
