import { useEffect, useState } from "react";
import type { Viewer } from "../shell/types";
import { EmptyRow, Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./respond.css";
import { ChainStrip, type Block } from "./respondViz";

interface Fields {
  launch_at: string; recovery_at: string | null; aircraft: string; launch_location: string; incident_location: string;
  duration_min: number | null; reason: string; incident: string; approved_by: string; rpic: string; weather: string; airspace: string;
  terminated: string; observation_stopped: string; narrative?: string; anomaly?: string;
}
interface Retention { until: string | null; rule: string; hold: { matter: string; by: string; at: string } | null }
interface Rec {
  id: string; flight: string; call: string; status: "in_flight" | "draft" | "filed"; due_at: string; late: boolean; fields: Fields;
  versions: { v: number; at: string; by: string; why: string; hash: string }[];
  retention: Retention;
}
interface CareEntry { tail: string; date: string; by: string; cycles: number; health_pct: number; spread_mv: number; swelling: boolean; props: string; notes: string; pass: boolean; fail_reason?: string; hash: string }
interface CareAircraft { tail: string; due: string; overdue: boolean; overdue_days: number; grounded: boolean; why: string | null; last: CareEntry | null; history: CareEntry[] }
interface RequestItem { id: string; type: string; version: number; versions: number; sha256: string; fields: Record<string, unknown>; redacted: string[] }
interface RecordsRequest {
  id: string; requester: string; number: string; scope: string; created_at: string; created_by: string; status: "review" | "released";
  items: RequestItem[]; manifest: { id: string; version: number; sha256: string; redactions: number }[]; package_sha256: string; released_at: string | null; released_by: string | null; hash?: string;
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
  shift_logs_total: number;
  mishaps: Mishap[];
  care: { limits: { health_pct: number; spread_mv: number }; every_days: number; aircraft: CareAircraft[] };
  retention: { type: string; label: string; years: number; from: string }[];
  requests: RecordsRequest[];
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
  // The supervisor is also the program's records custodian: legal holds and records requests are theirs.
  const custodian = !viewer.org || viewer.roles.some((r) => r === "mission_commander" || r === "admin");
  const due = d.items.filter((r) => r.status === "draft");
  const sel = d.items.find((r) => r.id === (open ?? due[0]?.id ?? d.items[0]?.id)) ?? null;

  return (
    <section className="page ins-page co-page ops-page rs-page" data-testid="records">
      <PageHead kicker="Harbor police DFR program (SIM)" title="Flight records" lede="Every flight gets a record before the shift ends. Most fields come from the flight itself; the pilot writes what happened. A filed record is never edited: a correction is a new version beside the original, sealed into the same evidence chain." />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      <div className="th-stats">
        <Stat label="To file" value={String(due.length)} hint={due.some((r) => r.late) ? `${due.filter((r) => r.late).length} overdue, holding invoice hours` : "Due before the shift ends"} />
        <Stat label="Filed" value={String(d.items.filter((r) => r.status === "filed").length)} />
        <Stat label="Requests not flown" value={String(d.declined.length)} hint="Declined by the pilot or stood down" />
        <Stat label="Evidence chain" value={d.chain.intact ? "Intact" : "Broken"} hint={`${d.chain.rows} sealed versions${d.chain.head ? `, head ${d.chain.head.slice(0, 12)}…` : ""}`} />
      </div>

      <section className="panel" aria-labelledby="rc-chain">
        <div className="panel-head"><h2 id="rc-chain">Evidence chain</h2><span className="meta">Flight records, corrections, shift logs and mishap reports, sealed in the order they were written</span></div>
        <ChainStrip blocks={chainBlocks(d)} intact={d.chain.intact} rows={d.chain.rows} />
      </section>

      <div className="rs-grid rs-grid-records">
        <section className="panel" aria-labelledby="rc-list">
          <div className="panel-head"><h2 id="rc-list">Flight records</h2></div>
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
                    <td className="mono">{r.fields.launch_at.slice(5, 10)} {t(r.fields.launch_at)}</td>
                    <td>
                      {r.status === "in_flight" ? <span className="th-check is-warn">In flight</span> : null}
                      {r.status === "draft" ? <span className="th-check is-fail">{r.late ? `Overdue since ${r.due_at.slice(0, 10)}` : `To file by ${t(r.due_at)}`}</span> : null}
                      {r.retention.hold ? <span className="th-check is-warn">Legal hold</span> : null}
                      {r.status === "filed" ? <span className="th-check is-ok">Filed{r.versions.length > 1 ? `, ${r.versions.length} versions` : ""}{r.late ? ", late" : ""}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {sel ? <RecordForm key={`${sel.id}-${sel.versions.length}-${sel.retention.hold ? 1 : 0}`} r={sel} pilot={pilot} custodian={custodian} busy={page.busy} post={(e, a, args) => { setOpen(sel.id); return page.post(e, a, args); }} /> : null}
      </div>

      <section className="panel" aria-labelledby="rc-care">
        <div className="panel-head"><h2 id="rc-care">Battery and aircraft care</h2><span className="meta">Every {d.care.every_days} days per aircraft, signed by the pilot. A pack under {d.care.limits.health_pct}% health, over {d.care.limits.spread_mv} mV cell spread, or swollen is retired and the aircraft grounded.</span></div>
        <ul className="rs-calls" data-testid="care-log">
          {d.care.aircraft.map((a) => <CareCard key={a.tail + (a.last?.date ?? "") + (a.last?.hash ?? "")} a={a} pilot={pilot} busy={page.busy} post={page.post} />)}
        </ul>
      </section>

      <section className="panel" aria-labelledby="rc-mishaps">
        <div className="panel-head"><h2 id="rc-mishaps">Mishaps and incidents</h2><span className="meta">Verbal to the supervisor at once; written within 24 hours</span></div>
        <ul className="rs-calls" data-testid="mishaps">
          {d.mishaps.length === 0 ? <li className="meta">No mishaps on file.</li> : null}
          {d.mishaps.map((m) => <MishapCard key={m.id + m.status} m={m} pilot={pilot} busy={page.busy} post={page.post} />)}
        </ul>
      </section>

      <section className="panel" aria-labelledby="rc-shifts">
        <div className="panel-head"><h2 id="rc-shifts">Shift logs</h2><span className="meta">The open shift and the last {d.shift_logs.length - 1} of {d.shift_logs_total} signed. The month is on <a href="#contract">Report and invoice</a>.</span></div>
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

      <Requests d={d} custodian={custodian} busy={page.busy} post={page.post} />

      <section className="panel" aria-labelledby="rc-retention">
        <div className="panel-head"><h2 id="rc-retention">How long records are kept</h2><span className="meta">A legal hold stops the clock until it is lifted</span></div>
        <ul className="rs-checks">{d.retention.map((x) => <li key={x.type} className="th-check is-ok">{x.label}: {x.years} years from {x.from}</li>)}</ul>
      </section>
    </section>
  );
}

type Post = (endpoint: string, action: string, args: Record<string, unknown>) => Promise<boolean>;

function RecordForm({ r, pilot, custodian, busy, post }: { r: Rec; pilot: boolean; custodian: boolean; busy: boolean; post: Post }) {
  const f = r.fields;
  const [matter, setMatter] = useState("");
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
      <div className="rs-actions" data-testid="retention">
        {r.retention.hold ? (
          <span className="th-check is-warn">On legal hold for {r.retention.hold.matter} since {r.retention.hold.at.slice(0, 10)} ({r.retention.hold.by})</span>
        ) : (
          <span className="meta">{r.retention.until ? `Kept until ${r.retention.until}` : "Kept from filing"} ({r.retention.rule}).</span>
        )}
        {custodian && !r.retention.hold ? (
          <>
            <input type="text" value={matter} onChange={(e) => setMatter(e.target.value)} placeholder="Matter or case number" aria-label={`Legal hold matter for ${r.id}`} />
            <button type="button" className="btn btn-quiet" disabled={busy || matter.trim().length < 4} onClick={() => void post("/v1/dfr/act", "record.hold", { id: r.id, matter })}>Place a legal hold</button>
          </>
        ) : null}
        {custodian && r.retention.hold ? <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void post("/v1/dfr/act", "record.release_hold", { id: r.id })}>Lift the hold</button> : null}
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

function CareCard({ a, pilot, busy, post }: { a: CareAircraft; pilot: boolean; busy: boolean; post: Post }) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState(String(a.last?.health_pct ?? ""));
  const [spread, setSpread] = useState(String(a.last?.spread_mv ?? ""));
  const [swelling, setSwelling] = useState(false);
  const [propsOk, setPropsOk] = useState(true);
  const [notes, setNotes] = useState("");
  return (
    <li className={`rs-call ${a.grounded ? "p1" : a.overdue ? "p2" : ""}`} data-tail={a.tail}>
      <div className="rs-call-head">
        <strong className="mono">{a.tail}</strong>
        {a.grounded ? <span className="th-check is-fail">Grounded: {a.why}</span> : a.overdue ? <span className="th-check is-warn">Overdue since {a.due}</span> : <span className="th-check is-ok">Next due {a.due}</span>}
        {a.last ? <span className="meta">Last {a.last.date} by {a.last.by}: pack {a.last.health_pct}% health, {a.last.spread_mv} mV spread, {a.last.cycles} cycles{a.last.notes ? `. ${a.last.notes}` : ""}</span> : null}
        {pilot ? <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "Sign this week's check"}</button> : null}
      </div>
      {open ? (
        <div className="rs-actions">
          <label className="meta">Pack health, % <input type="number" min="1" max="100" value={health} onChange={(e) => setHealth(e.target.value)} className="rs-num" /></label>
          <label className="meta">Cell spread, mV <input type="number" min="0" value={spread} onChange={(e) => setSpread(e.target.value)} className="rs-num" /></label>
          <label className="meta"><input type="checkbox" checked={swelling} onChange={(e) => setSwelling(e.target.checked)} /> Pack swollen</label>
          <label className="meta"><input type="checkbox" checked={propsOk} onChange={(e) => setPropsOk(e.target.checked)} /> Propellers free of nicks and cracks</label>
          <input type="text" className="rs-grow" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (motors, dock seals, filter)" aria-label={`Care notes for ${a.tail}`} />
          <button type="button" className="btn btn-primary" disabled={busy || !health || !spread} onClick={() => void post("/v1/dfr/act", "care.sign", { tail: a.tail, health_pct: Number(health), spread_mv: Number(spread), swelling, props_ok: propsOk, notes }).then((ok) => ok && setOpen(false))}>Sign the check</button>
        </div>
      ) : null}
    </li>
  );
}

function download(req: RecordsRequest) {
  const blob = new Blob([JSON.stringify({ id: req.id, requester: req.requester, number: req.number, scope: req.scope, released_at: req.released_at, released_by: req.released_by, package_sha256: req.package_sha256, manifest: req.manifest, items: req.items, note: "Simulated program (SIM). Each item's sha256 is the hash of the version sealed in the evidence chain; redactions are marked in place." }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${req.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Requests({ d, custodian, busy, post }: { d: Records; custodian: boolean; busy: boolean; post: Post }) {
  const [requester, setRequester] = useState("");
  const [number, setNumber] = useState("");
  const [incident, setIncident] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="panel" aria-labelledby="rc-requests" data-testid="requests">
      <div className="panel-head"><h2 id="rc-requests">Records requests</h2><span className="meta">Gathered from the filed records, redacted, reviewed, then released with a hash manifest</span></div>
      {custodian ? (
        <div className="rs-request-form">
          <input type="text" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Requester" aria-label="Requester" />
          <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Request number" aria-label="Request number" />
          <input type="text" value={incident} onChange={(e) => setIncident(e.target.value)} placeholder="Incident number, or dates" aria-label="Incident number" />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <button type="button" className="btn btn-primary" disabled={busy || requester.trim().length < 3 || (!incident.trim() && !from)} onClick={() => void post("/v1/dfr/act", "request.create", { requester, number, incident: incident.trim(), from, to }).then((ok) => ok && (setRequester(""), setNumber(""), setIncident(""), setFrom(""), setTo("")))}>Gather the records</button>
        </div>
      ) : <p className="meta">The records custodian answers records requests.</p>}
      <ul className="rs-calls">
        {d.requests.length === 0 ? <li className="meta">No requests on file. Try incident {d.items.find((r) => r.status === "filed")?.fields.incident ?? "26-…"}.</li> : null}
        {d.requests.map((q) => (
          <li key={q.id} className={`rs-call ${q.status === "review" ? "p2" : ""}`} data-request={q.id}>
            <div className="rs-call-head">
              <strong className="mono">{q.id}</strong>
              <span>{q.requester}{q.number ? ` (${q.number})` : ""}: {q.scope}</span>
              <span className="meta">{q.items.length} item{q.items.length === 1 ? "" : "s"}, {q.manifest.reduce((s, m) => s + m.redactions, 0)} redactions</span>
              {q.status === "released" ? <span className="th-check is-ok">Released {q.released_at?.slice(0, 10)} by {q.released_by}</span> : <span className="th-check is-warn">In review</span>}
              <button type="button" className="btn btn-quiet" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? null : q.id)}>{open === q.id ? "Hide" : "Review"}</button>
              {custodian && q.status === "review" ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void post("/v1/dfr/act", "request.release", { id: q.id })}>Release</button> : null}
              {custodian && q.status === "released" ? <button type="button" className="btn btn-quiet" onClick={() => download(q)}>Download the package</button> : null}
            </div>
            {open === q.id ? (
              <div className="rs-log">
                <p className="mono meta">Package sha256 {q.package_sha256}</p>
                <ul className="rs-disc">
                  {q.items.map((x) => (
                    <li key={x.id}>
                      <strong className="mono">{x.id}</strong> <span className="meta">version {x.version} of {x.versions}, sha256 {x.sha256.slice(0, 12)}…{x.redacted.length ? `, redacted: ${x.redacted.join(", ")}` : ""}</span>
                      {typeof x.fields.narrative === "string" ? <p className="rs-call-text">{x.fields.narrative}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The newest sealed versions across the program, oldest first, for the chain picture. */
function chainBlocks(d: Records): Block[] {
  const out: (Block & { at: string })[] = [];
  for (const r of d.items) for (const v of r.versions) out.push({ id: `${r.id}-v${v.v}`, label: v.v > 1 ? `${r.id} v${v.v}` : r.id, sub: v.v > 1 ? "Correction" : "Flight record", hash: v.hash, kind: v.v > 1 ? "correction" : "record", at: v.at });
  for (const l of d.shift_logs) if (l.status === "signed" && l.hash && l.signed_at) out.push({ id: l.id, label: l.id.replace(/^SH-/, "Log "), sub: `Shift log, ${l.rpic}`, hash: l.hash, kind: "log", at: l.signed_at });
  for (const m of d.mishaps) if (m.written?.hash) out.push({ id: m.id, label: m.id, sub: "Mishap report", hash: m.written.hash, kind: "mishap", at: m.written.at });
  return out.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(-6);
}
