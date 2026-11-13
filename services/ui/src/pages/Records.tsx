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
interface Records {
  source: string;
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
