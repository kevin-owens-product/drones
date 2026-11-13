import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./respond.css";

interface Item { key: string; label: string; value: string; level: "ok" | "warn" | "fail"; note: string }
interface Pilot { id: string; name: string; items: Item[]; assignable: boolean; solo: boolean; certifiable: boolean; blocking: string[]; warnings: string[]; recurrent_due: string; rate: string }
interface Day { date: string; pilot: string | null; pilot_name: string | null; supervised_by: string | null; supervised_by_name: string | null; flags: string[] }
interface Crew {
  source: string; today: string; on_console: string | null;
  rules: { recurrent_months: number; hours: number; docked_hours: number; supervised_shifts: number; supervised_flights: number };
  shift_hours: { start: string; end: string; hours: number };
  pilots: Pilot[];
  roster: Day[];
  counts: { pilots: number; solo: number; not_assignable: number; coverage_gaps: number; roster_flags: number; scheduled_hours: number; staffed_hours: number };
}

const LV = { ok: "is-ok", warn: "is-warn", fail: "is-fail" } as const;

/** Who can sit at the console, and who is rostered: each pilot's currency file and the next fourteen days of shifts. */
export function CrewPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Crew>("/v1/dfr/crew", onBanner);
  const [open, setOpen] = useState<string | null>(null);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const manager = !viewer.org || viewer.roles.some((r) => ["mission_commander", "admin"].includes(r));
  const act = (action: string, args: Record<string, unknown>) => page.post("/v1/dfr/act", action, args);
  const solo = d.pilots.filter((p) => p.solo);

  return (
    <section className="page ins-page co-page ops-page rs-page" data-testid="crew">
      <PageHead kicker="Harbor police DFR program (SIM)" title="Pilots and roster" lede={`One pilot on console ${d.shift_hours.start} to ${d.shift_hours.end}, every day, and never an unstaffed shift. A pilot works only while their file holds, and works alone only after ${d.rules.supervised_shifts} supervised shifts, ${d.rules.supervised_flights} supervised flights and the program manager's sign-off.`} />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      <div className="th-stats">
        <Stat label="Cleared for solo" value={`${d.counts.solo} of ${d.counts.pilots}`} />
        <Stat label="Cannot be rostered" value={String(d.counts.not_assignable)} hint="A credential or currency item has lapsed" />
        <Stat label="Coverage gaps, 14 days" value={String(d.counts.coverage_gaps)} hint="Unstaffed hours are not payable" />
        <Stat label="Hours staffed as rostered" value={`${d.counts.staffed_hours} of ${d.counts.scheduled_hours}`} />
      </div>

      <section className="panel" aria-labelledby="cr-roster">
        <div className="panel-head"><h2 id="cr-roster">Roster, next 14 days</h2><span className="meta">Changes within 24 hours go to the program manager</span></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="roster">
            <thead><tr><th>Day</th><th>On console</th><th>Supervising pilot</th><th>Problems</th></tr></thead>
            <tbody>
              {d.roster.map((r) => (
                <tr key={r.date} className={r.flags.length ? "th-row-fail" : undefined} data-day={r.date}>
                  <td className="mono">{r.date}{r.date === d.today ? <span className="meta"> today</span> : null}</td>
                  <td>
                    {manager ? (
                      <select aria-label={`Pilot on ${r.date}`} value={r.pilot ?? ""} disabled={page.busy} onChange={(e) => void act("roster.assign", { date: r.date, pilot: e.target.value || null, supervised_by: r.supervised_by })}>
                        <option value="">Nobody (gap)</option>
                        {d.pilots.map((p) => <option key={p.id} value={p.id}>{p.name}{p.assignable ? (p.solo ? "" : " (needs supervision)") : " (cannot work)"}</option>)}
                      </select>
                    ) : r.pilot_name ?? "Nobody"}
                  </td>
                  <td>
                    {manager && r.pilot && !d.pilots.find((p) => p.id === r.pilot)?.solo ? (
                      <select aria-label={`Supervising pilot on ${r.date}`} value={r.supervised_by ?? ""} disabled={page.busy} onChange={(e) => void act("roster.assign", { date: r.date, pilot: r.pilot, supervised_by: e.target.value || null })}>
                        <option value="">None</option>
                        {solo.filter((p) => p.id !== r.pilot).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : r.supervised_by_name ?? <span className="meta">Not needed</span>}
                  </td>
                  <td>{r.flags.length ? r.flags.map((f) => <span key={f} className="th-check is-fail">{f}</span>) : <span className="th-check is-ok">Covered</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="cr-files">
        <div className="panel-head"><h2 id="cr-files">Personnel and currency files</h2><span className="meta">Updated within 5 business days of any change</span></div>
        <ul className="rs-calls" data-testid="pilot-files">
          {d.pilots.map((p) => (
            <li key={p.id} className={`rs-call ${!p.assignable ? "p1" : p.warnings.length || !p.solo ? "p2" : ""}`} data-pilot={p.id}>
              <div className="rs-call-head">
                <strong>{p.name}</strong>
                <span className="mono meta">{p.id}{d.on_console === p.id ? " · on console now" : ""}</span>
                {!p.assignable ? <span className="th-check is-fail">Cannot be rostered</span> : p.solo ? <span className="th-check is-ok">Cleared for solo</span> : <span className="th-check is-warn">Supervised shifts only</span>}
                {p.warnings.map((w) => <span key={w} className="th-check is-warn">{w}</span>)}
                <button type="button" className="btn btn-quiet" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide file" : "Open file"}</button>
                {p.certifiable ? <button type="button" className="btn btn-primary" disabled={!manager || page.busy} title={manager ? undefined : "The program manager signs pilots off"} onClick={() => void act("crew.certify", { pilot: p.id })}>Sign off for solo shifts</button> : null}
              </div>
              {!p.assignable ? <p className="meta">{p.blocking.join("; ")}</p> : null}
              {open === p.id ? (
                <dl className="rs-fields">
                  {p.items.map((x) => <div key={x.key}><dt>{x.label}</dt><dd><span className={`th-check ${LV[x.level]}`}>{x.value}</span>{x.note ? <span className="meta"> {x.note}</span> : null}</dd></div>)}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
