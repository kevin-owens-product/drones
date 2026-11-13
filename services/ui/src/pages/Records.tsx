import { useEffect, useState } from "react";
import type { Viewer } from "../shell/types";
import { EmptyRow, Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./respond.css";

interface Fields {
  launch_at: string; recovery_at: string | null; aircraft: string; launch_location: string; incident_location: string;
  duration_min: number | null; reason: string; incident: string; approved_by: string; rpic: string; weather: string; airspace: string;
  terminated: string; observation_stopped: string; narrative?: string; anomaly?: string;
}
interface Rec {
  id: string; flight: string; call: string; status: "in_flight" | "draft" | "filed"; due_at: string; late: boolean; fields: Fields;
  versions: { v: number; at: string; by: string; why: string; hash: string }[];
}
interface Declined { call: string; incident: string; kind: string; place: string; received_at: string; by: string; by_role: string; reason: string; note: string }
interface ShiftLog {
  id: string; date: string; rpic: string; status: "open" | "signed"; staffed_h: number; scheduled_h: number; flights: number;
  declined: { reason: string; note: string }[]; gaps: string[]; discrepancies: string[]; records_unfiled: number; signed_by?: string; signed_at?: string; hash?: string;
}
interface Mishap {
  id: string; tail: string; kind: string; text: string; by: string; verbal_at: string; due_at: string; hours_left: number; late: boolean; status: "verbal" | "written";
  faa_reportable: boolean | null; faa_due: string | null; written: { at: string; by: string; text: string; injury: boolean; damage_usd: number; hash?: string } | null;
}
interface Records {
  source: string;
  shift_logs: ShiftLog[];
  mishaps: Mishap[];
  items: Rec[];
  declined: Declined[];
  chain: { rows: number; intact: boolean; head: string | null };
}

const t = (iso: string | null) => (iso ? `${iso.slice(11, 19)}Z` : "—");

/** Flight records: prefilled from the flight, written once by the pilot, corrected only by a new version beside the original. */
export function RecordsPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Records>("/v1/dfr/records", onBanner);
  const [open, setOpen] = useState<string | null>(null);
  const { load } = page;
  useEffect(() => {
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, [load]);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const pilot = !viewer.org || viewer.roles.includes("operator") || (viewer.org === "neros" && viewer.roles.includes("admin"));
  const due = d.items.filter((r) => r.status === "draft");
  const sel = d.items.find((r) => r.id === (open ?? due[0]?.id ?? d.items[0]?.id)) ?? null;

  return (
    <section className="page ins-page co-page ops-page rs-page" data-testid="records">
      <PageHead kicker="Harbor police DFR program (SIM)" title="Flight records" lede="Every flight gets a record before the shift ends. Most fields come from the flight itself; the pilot writes what happened. A filed record is never edited: a correction is a new version beside the original, sealed into the same evidence chain." />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      <div className="th-stats">
        <Stat label="To file this shift" value={String(due.length)} hint="Due before the shift ends" />
        <Stat label="Filed" value={String(d.items.filter((r) => r.status === "filed").length)} />
        <Stat label="Requests not flown" value={String(d.declined.length)} hint="Declined by the pilot or stood down" />
        <Stat label="Evidence chain" value={d.chain.intact ? "Intact" : "Broken"} hint={`${d.chain.rows} sealed versions${d.chain.head ? `, head ${d.chain.head.slice(0, 12)}…` : ""}`} />
      </div>

      <div className="rs-grid rs-grid-records">
        <section className="panel" aria-labelledby="rc-list">
          <div className="panel-head"><h2 id="rc-list">This shift's flights</h2></div>
          <div className="table-wrap" tabIndex={0}>
            <table data-testid="record-list">
              <thead><tr><th>Record</th><th>Call</th><th>Aircraft</th><th>Launched</th><th>State</th></tr></thead>
              <tbody>
                {d.items.length === 0 ? <EmptyRow text="No flights yet this shift." go={{ label: "Respond", section: "respond" }} /> : null}
                {d.items.map((r) => (
                  <tr key={r.id} className={sel?.id === r.id ? "is-selected" : undefined}>
                    <td><button type="button" className="btn btn-quiet mono" onClick={() => setOpen(r.id)} aria-pressed={sel?.id === r.id}>{r.id}</button></td>
                    <td className="mono">{r.fields.incident}</td>
                    <td className="mono">{r.fields.aircraft}</td>
                    <td className="mono">{t(r.fields.launch_at)}</td>
                    <td>
                      {r.status === "in_flight" ? <span className="th-check is-warn">In flight</span> : null}
                      {r.status === "draft" ? <span className="th-check is-fail">To file by {t(r.due_at)}</span> : null}
                      {r.status === "filed" ? <span className="th-check is-ok">Filed{r.versions.length > 1 ? `, ${r.versions.length} versions` : ""}{r.late ? ", late" : ""}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {sel ? <RecordForm key={`${sel.id}-${sel.versions.length}`} r={sel} pilot={pilot} busy={page.busy} post={(e, a, args) => { setOpen(sel.id); return page.post(e, a, args); }} /> : null}
      </div>

      <section className="panel" aria-labelledby="rc-mishaps">
        <div className="panel-head"><h2 id="rc-mishaps">Mishaps and incidents</h2><span className="meta">Verbal to the supervisor at once; written within 24 hours</span></div>
        <ul className="rs-calls" data-testid="mishaps">
          {d.mishaps.length === 0 ? <li className="meta">No mishaps on file.</li> : null}
          {d.mishaps.map((m) => <MishapCard key={m.id + m.status} m={m} pilot={pilot} busy={page.busy} post={page.post} />)}
        </ul>
      </section>

      <section className="panel" aria-labelledby="rc-shifts">
        <div className="panel-head"><h2 id="rc-shifts">Shift logs</h2><span className="meta">Built from each shift's records, signed by the pilot going off console</span></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="shift-logs">
            <thead><tr><th>Shift</th><th>Pilot</th><th>Staffed</th><th>Flights</th><th>Not flown</th><th>Gaps and discrepancies</th><th>Signed</th></tr></thead>
            <tbody>
              {d.shift_logs.map((l) => (
                <tr key={l.id + l.status}>
                  <td className="mono">{l.id}</td>
                  <td>{l.rpic}</td>
                  <td className="mono">{l.staffed_h} of {l.scheduled_h} h</td>
                  <td className="mono">{l.flights}</td>
                  <td>{l.declined.length ? l.declined.map((x) => `${x.reason}: ${x.note}`).join("; ") : "None"}</td>
                  <td>{[...l.gaps, ...l.discrepancies].join(" ") || "None"}{l.records_unfiled ? <span className="th-check is-warn"> {l.records_unfiled} records unfiled</span> : null}</td>
                  <td>{l.status === "open" ? <span className="th-check is-warn">Open: <a href="#respond">sign on Respond</a></span> : <span className="meta">{l.signed_by}, sha256 {l.hash?.slice(0, 10)}…</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="rc-declined">
        <div className="panel-head"><h2 id="rc-declined">Requests not flown, and why</h2></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="declined">
            <thead><tr><th>Call</th><th>Received</th><th>What and where</th><th>Decided by</th><th>Reason</th></tr></thead>
            <tbody>
              {d.declined.length === 0 ? <EmptyRow text="Every request this shift was flown." /> : null}
              {d.declined.map((x) => (
                <tr key={x.call}>
                  <td className="mono">{x.call}<span className="meta"> {x.incident}</span></td>
                  <td className="mono">{t(x.received_at)}</td>
                  <td>{x.kind}, {x.place}</td>
                  <td>{x.by_role}: {x.by}</td>
                  <td><span className={`th-check ${x.by_role === "RPIC" ? "is-fail" : "is-warn"}`}>{x.reason}</span> <span className="meta">{x.note}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">A pilot's decline stands: it is a safety call under Part 107 that no supervisor can override. Each one goes on the shift log with its reason.</p>
      </section>
    </section>
  );
}

function RecordForm({ r, pilot, busy, post }: { r: Rec; pilot: boolean; busy: boolean; post: (endpoint: string, action: string, args: Record<string, unknown>) => Promise<boolean> }) {
  const f = r.fields;
  const [narrative, setNarrative] = useState(f.narrative ?? "");
  const [anomaly, setAnomaly] = useState(f.anomaly ?? f.terminated ?? "");
  const [why, setWhy] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const editable = pilot && (r.status === "draft" || correcting);
  const rows: [string, string][] = [
    ["Launch", t(f.launch_at)],
    ["Recovery", t(f.recovery_at)],
    ["Duration", f.duration_min != null ? `${f.duration_min} min` : "—"],
    ["Aircraft", f.aircraft],
    ["Launched from", f.launch_location],
    ["Incident location", f.incident_location],
    ["Reason for flight", f.reason],
    ["Incident number", f.incident],
    ["Approving authority", f.approved_by],
    ["RPIC", f.rpic],
    ["Weather", f.weather],
    ["Airspace", f.airspace],
    ...(f.observation_stopped ? ([["Privacy", f.observation_stopped]] as [string, string][]) : []),
  ];
  return (
    <section className="panel" aria-labelledby="rc-form" data-testid="record-form">
      <div className="panel-head"><h2 id="rc-form">{r.id}: {f.incident}</h2><span className="meta">Filled from the flight</span></div>
      <dl className="rs-fields">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <label className="rs-label">Narrative: what you saw and what happened
        <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} disabled={!editable} rows={3} />
      </label>
      <label className="rs-label">Anomaly (loss of link, termination, damage), if any
        <input type="text" value={anomaly} onChange={(e) => setAnomaly(e.target.value)} disabled={!editable} />
      </label>
      {correcting ? (
        <label className="rs-label">Why the correction
          <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Required: kept beside the original" />
        </label>
      ) : null}
      <div className="rs-actions">
        {r.status === "in_flight" ? <span className="meta">The record opens for filing when the aircraft is back in its dock.</span> : null}
        {r.status === "draft" && pilot ? <button type="button" className="btn btn-primary" disabled={busy || narrative.trim().length < 12} onClick={() => void post("/v1/dfr/act", "record.file", { id: r.id, narrative, anomaly })}>File the record</button> : null}
        {r.status === "draft" && !pilot ? <span className="meta">The pilot who flew it files this record.</span> : null}
        {r.status === "filed" && pilot && !correcting ? <button type="button" className="btn btn-quiet" onClick={() => setCorrecting(true)}>Correct</button> : null}
        {correcting ? <button type="button" className="btn btn-primary" disabled={busy || !why.trim() || narrative.trim().length < 12} onClick={() => void post("/v1/dfr/act", "record.amend", { id: r.id, narrative, anomaly, why })}>File the correction</button> : null}
      </div>
      {r.versions.length ? (
        <ol className="rs-versions" data-testid="versions">
          {r.versions.map((v) => (
            <li key={v.v}>
              <strong>Version {v.v}</strong> <span className="meta">{t(v.at)} by {v.by}{v.why ? `: ${v.why}` : ""}</span>
              <span className="mono meta"> sha256 {v.hash.slice(0, 16)}…</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function MishapCard({ m, pilot, busy, post }: { m: Mishap; pilot: boolean; busy: boolean; post: (endpoint: string, action: string, args: Record<string, unknown>) => Promise<boolean> }) {
  const [text, setText] = useState(`${m.text} `);
  const [injury, setInjury] = useState(false);
  const [damage, setDamage] = useState("0");
  return (
    <li className={`rs-call ${m.status === "verbal" ? (m.late ? "p1" : "p2") : ""}`} data-mishap={m.id}>
      <div className="rs-call-head">
        <strong>{m.id}: {m.kind}</strong>
        <span className="mono">{m.tail}</span>
        <span className="meta">Reported by radio {t(m.verbal_at)} by {m.by}</span>
        {m.status === "verbal" ? <span className={`th-check ${m.late ? "is-fail" : "is-warn"}`}>{m.late ? "Written report overdue" : `Written report due in ${Math.max(0, Math.round(m.hours_left))} h`}</span> : <span className="th-check is-ok">Written {t(m.written?.at ?? null)}</span>}
      </div>
      {m.status === "written" && m.written ? (
        <>
          <p className="rs-call-text">{m.written.text}</p>
          <p className="meta">{m.written.injury ? "Injury reported. " : "No injury. "}Other property damage ${m.written.damage_usd}. {m.faa_reportable ? <strong>Report to the FAA by {m.faa_due?.slice(0, 10)} (14 CFR 107.9).</strong> : "Not reportable to the FAA."} <span className="mono">sha256 {m.written.hash?.slice(0, 10)}…</span></p>
        </>
      ) : pilot ? (
        <div className="rs-mishap-form">
          <label className="rs-label">What happened, the damage, and what was done<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="rs-actions">
            <label className="meta"><input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} /> Someone was injured</label>
            <label className="meta">Damage to other property, $ <input type="number" min="0" value={damage} onChange={(e) => setDamage(e.target.value)} className="rs-num" /></label>
            <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 20} onClick={() => void post("/v1/dfr/act", "mishap.file", { id: m.id, text, injury, damage_usd: Number(damage) })}>File the written report</button>
          </div>
        </div>
      ) : <p className="meta">{m.text} The pilot files the written report.</p>}
    </li>
  );
}
