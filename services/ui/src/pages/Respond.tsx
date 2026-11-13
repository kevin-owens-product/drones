import { useEffect, useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, usePageData } from "./thread";
import "./respond.css";

interface Check { level: "go" | "caution" | "no-go"; text: string }
interface DockOption { dock: string; name: string; eta_s: number; go: boolean; why: string[] }
interface Call {
  id: string; incident: string; kind: string; priority: number; text: string; place: string; x: number; y: number;
  received_at: number; status: string; waited_s: number; dock: string | null; dock_name: string | null; eta_s: number | null;
  options: DockOption[]; preflight: { go: boolean; checks: Check[] } | null; flight: string | null; approved_by?: string;
  declined?: { by: string; reason: string; note: string }; cancelled?: { by: string; note: string };
}
interface Flight {
  id: string; call: string; incident: string; kind: string; place: string; dock: string; tail: string; rpic: string; approver: string;
  phase: "launching" | "en_route" | "on_scene" | "returning" | "docked"; x: number; y: number; battery: number; eta_s: number;
  alert: { level: string; text: string } | null; wind: { wind_mps: number; gust_mps: number }; released: boolean;
  terminated: { by: string; reason: string } | null; observe_stopped: boolean; target: { x: number; y: number };
}
interface Dock { id: string; name: string; x: number; y: number; tail: string; charge: number; state: string; out_on: string | null; comms: string; power: string; care?: { due: string; overdue: boolean; grounded: boolean } }
interface ChecklistItem { group: string; level: "ok" | "caution" | "fail"; text: string }
interface ShiftLog {
  id: string; rpic: string; staffed_h: number; scheduled_h: number; flights: number; declined: { call: string; reason: string; note: string; by: string }[];
  gaps: string[]; discrepancies: string[]; aircraft_start: string; aircraft_end: string; records_unfiled: number;
}
interface Mishap { id: string; tail: string; kind: string; hours_left: number; late: boolean }
interface Console {
  source: string;
  checklist: ChecklistItem[];
  shift_log: ShiftLog;
  mishaps_open: Mishap[];
  transit_m: number;
  program: { name: string };
  role: { supervisor: boolean; pilot: boolean; preview: boolean };
  shift: { id: string; date: string; start: string; end: string; rpic: string | null; rpic_name: string; supervisor: string; started: boolean; started_at: string | null; discrepancies: { at: string; text: string; reported_to: string }[] };
  limits: { wind_mps: number; gust_mps: number };
  weather: { wind_mps: number; gust_mps: number; visibility_km: number; ceiling_ft: number };
  map: { width_m: number; height_m: number; water: number[][][]; places: { id: string; label: string; x: number; y: number }[]; structures: { id: string; label: string; x0: number; y0: number; x1: number; y1: number; height_m: number }[] };
  docks: Dock[];
  queue: Call[];
  flights: Flight[];
  recent: Call[];
  records_due: { id: string; call: string; due_at: string }[];
  feed_next: string;
  decline_reasons: string[];
}

const PHASE: Record<Flight["phase"], string> = { launching: "Launching", en_route: "En route", on_scene: "On scene", returning: "Returning", docked: "Docked" };
const hhmm = (iso: string) => `${iso.slice(11, 16)}Z`;
const secs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

/** The responder console: calls in from dispatch, a supervisor approves, the pilot launches the nearest dock and flies it. */
export function RespondPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Console>("/v1/dfr", onBanner);
  const { load } = page;
  useEffect(() => {
    const t = window.setInterval(load, 1500);
    return () => window.clearInterval(t);
  }, [load]);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const act = (action: string, args: Record<string, unknown>) => page.post("/v1/dfr/act", action, args);
  const seat = d.role.supervisor && d.role.pilot && !d.role.preview ? "Local demo: you hold both seats, supervisor and pilot. Signed in, each person holds only their own." : d.role.preview ? "Neros preview: you play both seats here. In the program they are two people, and the server holds each to their own." : d.role.supervisor ? "You are the supervisor: you approve launches and direct the flight." : d.role.pilot ? "You are the remote pilot in command: you launch, fly, and decide whether a flight is safe." : "View only.";

  return (
    <section className="page ins-page co-page ops-page rs-page" data-testid="respond">
      <PageHead kicker={d.program.name} title="Respond" lede="Calls come in from dispatch. A supervisor approves each launch, the nearest ready dock is picked by flight time, and the pilot flies it. The pilot can decline or end any flight for safety, and no one can override that." />
      <p className="ins-source">{d.source}</p>
      <div className="rs-shift" data-testid="shift-bar">
        <span><strong>On console</strong> {d.shift.rpic_name}</span>
        <span><strong>Approving</strong> {d.shift.supervisor}</span>
        <span><strong>Shift</strong> {hhmm(d.shift.start)} to {hhmm(d.shift.end)}</span>
        <span><strong>Wind</strong> {d.weather.wind_mps} m/s gusting {d.weather.gust_mps} (limits {d.limits.wind_mps} and {d.limits.gust_mps})</span>
        {d.records_due.length ? <a href="#records" className="th-check is-warn">{d.records_due.length} flight record{d.records_due.length === 1 ? "" : "s"} to file this shift</a> : <span className="th-check is-ok">Records up to date</span>}
      </div>
      <p className="meta rs-seat">{seat}</p>
      <Note note={page.note} />
      {d.mishaps_open.map((m) => (
        <p key={m.id} className={`rs-alert ${m.late ? "is-no-go" : "is-caution"}`} role="status" data-testid="mishap-due">
          {m.id}: {m.kind}, {m.tail}. Reported by radio; the written report is {m.late ? "overdue" : `due in ${Math.max(0, Math.round(m.hours_left))} h`}. <a href="#records">Write it on Flight records</a>
        </p>
      ))}
      <ShiftPanel d={d} busy={page.busy} act={act} />

      <div className="rs-grid">
        <section className="panel" aria-labelledby="rs-queue">
          <div className="panel-head">
            <h2 id="rs-queue">Calls waiting</h2>
            <button type="button" className="btn btn-quiet" disabled={page.busy || !(d.role.supervisor || d.role.pilot)} onClick={() => void act("feed.next", {})} title="The dispatch feed is simulated: each press sends the next scripted call">
              Next call from dispatch (SIM): {d.feed_next}
            </button>
          </div>
          {d.queue.length === 0 ? <p className="meta">No calls waiting. Each call from dispatch lands here for the supervisor.</p> : null}
          <ol className="rs-calls" data-testid="call-queue">
            {d.queue.map((c) => <CallCard key={c.id} c={c} d={d} busy={page.busy} act={act} />)}
          </ol>
        </section>

        <section className="panel" aria-labelledby="rs-air">
          <div className="panel-head">
            <h2 id="rs-air">In the air</h2>
            <span className="meta">Schematic harbor, not to a real port's layout</span>
          </div>
          <HarborMap d={d} />
          {d.flights.length === 0 ? <p className="meta">Nothing flying. An approved call launches from its dock once the pilot runs the pre-flight checks.</p> : null}
          <ul className="rs-flights" data-testid="flights">
            {d.flights.map((f) => <FlightCard key={f.id} f={f} d={d} busy={page.busy} act={act} />)}
          </ul>
        </section>
      </div>

      <section className="panel" aria-labelledby="rs-docks">
        <div className="panel-head"><h2 id="rs-docks">Docks</h2></div>
        <ul className="rs-docks" data-testid="docks">
          {d.docks.map((k) => (
            <li key={k.id} className={`rs-dock is-${k.state}`}>
              <strong>{k.name}</strong>
              <span className="mono">{k.tail}</span>
              <span className="rs-batt" role="img" aria-label={`Charge ${k.charge}%`}><span style={{ width: `${k.charge}%` }} /></span>
              <span className="meta">{k.state === "out" ? `Out on ${k.out_on}` : k.state === "charging" ? `Charging, ${k.charge}% (60% to launch)` : k.state === "fault" ? `Fault: ${k.power !== "on" ? "no power" : "comms"}` : k.state === "grounded" ? "Grounded at its care check" : `Ready, ${k.charge}%`}</span>
              {k.care?.overdue && !k.care.grounded ? <a href="#records" className="th-check is-warn">Care check due {k.care.due}</a> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="rs-recent">
        <div className="panel-head"><h2 id="rs-recent">Earlier this shift</h2><a href="#records" className="meta">Flight records and requests not flown</a></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="recent">
            <thead><tr><th>Call</th><th>Received</th><th>What</th><th>Where</th><th>Outcome</th></tr></thead>
            <tbody>
              {d.recent.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}<span className="meta"> {c.incident}</span></td>
                  <td className="mono">{hhmm(new Date(c.received_at).toISOString())}</td>
                  <td>{c.kind}</td>
                  <td>{c.place}</td>
                  <td>
                    {c.status === "flown" ? <span className="th-check is-ok">Flown{c.flight ? `, ${c.flight}` : ""}</span> : null}
                    {c.status === "declined" ? <><span className="th-check is-fail">Declined by RPIC ({c.declined?.reason})</span><span className="meta"> {c.declined?.note}</span></> : null}
                    {c.status === "cancelled" ? <><span className="th-check is-warn">Stood down</span><span className="meta"> {c.cancelled?.note}</span></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

type Act = (action: string, args: Record<string, unknown>) => Promise<boolean>;

const LEVEL = { ok: "is-ok", caution: "is-warn", fail: "is-fail" } as const;

/** Start of shift: the checks before the first call, discrepancies as they come, and the log the pilot signs going off. */
function ShiftPanel({ d, busy, act }: { d: Console; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [ending, setEnding] = useState(false);
  const watch = d.checklist.filter((x) => x.level !== "ok");
  const groups = [...new Set(d.checklist.map((x) => x.group))];
  const log = d.shift_log;
  if (!d.shift.started) {
    return (
      <section className="panel rs-start" aria-labelledby="rs-start" data-testid="shift-start">
        <div className="panel-head"><h2 id="rs-start">Start of shift {d.shift.id}: {d.shift.rpic_name}</h2><span className="meta">Nothing launches until the pilot on console has run these</span></div>
        {groups.map((g) => (
          <div key={g} className="rs-check-group">
            <h3>{g}</h3>
            <ul className="rs-checks">{d.checklist.filter((x) => x.group === g).map((x) => <li key={x.text} className={`th-check ${LEVEL[x.level]}`}>{x.text}</li>)}</ul>
          </div>
        ))}
        <div className="rs-actions">
          {d.role.pilot ? <button type="button" className="btn btn-primary" disabled={busy || !d.shift.rpic} onClick={() => void act("shift.start", {})}>Checks done: start the shift</button> : <span className="meta">Waiting for the pilot to come on console.</span>}
          {!d.shift.rpic ? <a href="#crew">No pilot rostered: fill the gap</a> : null}
          {watch.length ? <span className="meta">{watch.length} to watch; dock problems are reported to the supervisor and logged when the shift starts.</span> : null}
        </div>
      </section>
    );
  }
  return (
    <section className="panel rs-start" aria-labelledby="rs-shiftp" data-testid="shift-panel">
      <div className="panel-head">
        <h2 id="rs-shiftp">Shift {d.shift.id}</h2>
        <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Start-of-shift checks: {d.checklist.length - watch.length} clear, {watch.length} to watch
        </button>
      </div>
      {open ? (
        <div className="rs-check-cols">
          {groups.map((g) => (
            <div key={g} className="rs-check-group">
              <h3>{g}</h3>
              <ul className="rs-checks">{d.checklist.filter((x) => x.group === g).map((x) => <li key={x.text} className={`th-check ${LEVEL[x.level]}`}>{x.text}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : null}
      {d.shift.discrepancies.length ? (
        <ul className="rs-disc" data-testid="discrepancies">
          {d.shift.discrepancies.map((x) => <li key={x.at + x.text}><span className="mono meta">{x.at.slice(11, 16)}Z</span> {x.text} <span className="meta">Reported to {x.reported_to}.</span></li>)}
        </ul>
      ) : null}
      {d.role.pilot ? (
        <div className="rs-actions">
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Aircraft, dock or system discrepancy" aria-label="Discrepancy to report" className="rs-grow" />
          <button type="button" className="btn btn-quiet" disabled={busy || text.trim().length < 8} onClick={() => void act("shift.discrepancy", { text }).then((ok) => ok && setText(""))}>Report to supervisor</button>
          <button type="button" className="btn btn-quiet" onClick={() => setEnding((e) => !e)} aria-expanded={ending}>End shift and sign the log</button>
        </div>
      ) : null}
      {ending ? (
        <div className="rs-log" data-testid="shift-log-draft">
          <p><strong>Shift log, built from the shift's records.</strong> Read it, then sign. Once signed it is sealed into the evidence chain.</p>
          <dl className="rs-fields">
            <div><dt>Hours staffed</dt><dd>{log.staffed_h} of {log.scheduled_h} scheduled</dd></div>
            <div><dt>Flights</dt><dd>{log.flights}</dd></div>
            <div><dt>Aircraft at start</dt><dd>{log.aircraft_start}</dd></div>
            <div><dt>Aircraft now</dt><dd>{log.aircraft_end}</dd></div>
            <div><dt>Not flown</dt><dd>{log.declined.length ? log.declined.map((x) => `${x.call} (${x.by}, ${x.reason}): ${x.note}`).join("; ") : "None"}</dd></div>
            <div><dt>Coverage gaps</dt><dd>{log.gaps.length ? log.gaps.join(" ") : "None"}</dd></div>
            <div><dt>Discrepancies</dt><dd>{log.discrepancies.length ? log.discrepancies.join(" ") : "None"}</dd></div>
            <div><dt>Records not filed</dt><dd>{log.records_unfiled ? <a href="#records">{log.records_unfiled} to file</a> : "All filed"}</dd></div>
          </dl>
          <button type="button" className="btn btn-primary" disabled={busy || d.flights.length > 0} onClick={() => void act("shift.end", {}).then((ok) => ok && setEnding(false))}>Sign and go off console</button>
          {d.flights.length ? <span className="meta"> Recover the aircraft that is out first.</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function CallCard({ c, d, busy, act }: { c: Call; d: Console; busy: boolean; act: Act }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("weather");
  const [note, setNote] = useState("");
  const [dock, setDock] = useState("");
  const pick = dock || c.dock || "";
  return (
    <li className={`rs-call p${c.priority} ${c.status === "approved" ? "is-approved" : ""}`} data-call={c.id}>
      <div className="rs-call-head">
        <span className={`rs-prio p${c.priority}`}>P{c.priority}</span>
        <strong>{c.kind}</strong>
        <span>{c.place}</span>
        <span className="meta mono">{c.id} · {c.incident} · waiting {secs(c.waited_s)}</span>
      </div>
      <p className="rs-call-text">{c.text}</p>
      {c.status === "waiting" ? (
        <>
          <p className="meta">
            {c.dock ? <>Nearest ready: <strong>{c.dock_name}</strong>, on scene in about {secs(c.eta_s ?? 0)}.</> : "No dock passes its checks for this call."}
            {c.options.filter((o) => !o.go).length ? ` Not ready: ${c.options.filter((o) => !o.go).map((o) => `${o.name.split(":")[0]} (${o.why[0]})`).join("; ")}` : ""}
          </p>
          <div className="rs-actions">
            {d.role.supervisor ? (
              <>
                <label className="meta">
                  Dock{" "}
                  <select value={pick} onChange={(e) => setDock(e.target.value)}>
                    {c.options.map((o) => <option key={o.dock} value={o.dock} disabled={!o.go}>{o.name.split(":")[0]}, {secs(o.eta_s)}{o.go ? "" : " (not ready)"}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-primary" disabled={busy || !c.dock} onClick={() => void act("call.approve", { id: c.id, dock: pick })}>Approve launch</button>
                <button type="button" className="btn btn-quiet" disabled={busy || c.priority === 1} onClick={() => void act("call.priority", { id: c.id, priority: c.priority - 1 })} aria-label={`Raise ${c.id} priority`}>Raise</button>
                <button type="button" className="btn btn-quiet" disabled={busy || c.priority === 3} onClick={() => void act("call.priority", { id: c.id, priority: c.priority + 1 })} aria-label={`Lower ${c.id} priority`}>Lower</button>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act("call.cancel", { id: c.id, note: "Units on scene; aircraft not needed." })}>Stand down</button>
              </>
            ) : <span className="meta">Waiting for the supervisor's approval. The pilot does not self-initiate flights.</span>}
          </div>
        </>
      ) : null}
      {c.status === "approved" && c.preflight ? (
        <>
          <p className="meta">Approved by {c.approved_by}. Pre-flight checks for {c.dock_name}:</p>
          <ul className="rs-checks" data-testid="preflight">
            {c.preflight.checks.map((x) => <li key={x.text} className={`th-check is-${x.level === "go" ? "ok" : x.level === "caution" ? "warn" : "fail"}`}>{x.text}</li>)}
          </ul>
          <div className="rs-actions">
            {d.role.pilot ? <button type="button" className="btn btn-primary" disabled={busy || !c.preflight.go} onClick={() => void act("call.launch", { id: c.id })}>Launch {c.dock_name?.split(":")[0]}</button> : <span className="meta">Approved. The pilot launches after the pre-flight checks.</span>}
          </div>
        </>
      ) : null}
      {d.role.pilot ? (
        declining ? (
          <div className="rs-decline">
            <label className="meta">Reason <select value={reason} onChange={(e) => setReason(e.target.value)}>{d.decline_reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line for the supervisor and the record" aria-label="Why the flight is declined" />
            <button type="button" className="btn btn-danger" disabled={busy || !note.trim()} onClick={() => void act("call.decline", { id: c.id, reason, note }).then((ok) => ok && setDeclining(false))}>Decline flight</button>
            <button type="button" className="btn btn-quiet" onClick={() => setDeclining(false)}>Keep it</button>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet rs-decline-open" onClick={() => setDeclining(true)}>Decline as RPIC</button>
        )
      ) : null}
    </li>
  );
}

function FlightCard({ f, d, busy, act }: { f: Flight; d: Console; busy: boolean; act: Act }) {
  const [ending, setEnding] = useState(false);
  const [why, setWhy] = useState("");
  const suggested = f.alert?.level === "no-go" ? `Gusts ${f.wind.gust_mps} m/s over the ${d.limits.gust_mps} m/s waiver limit` : "";
  return (
    <li className={`rs-flight ${f.alert ? `has-${f.alert.level}` : ""}`} data-flight={f.id}>
      <div className="rs-call-head">
        <strong className="mono">{f.tail}</strong>
        <span className={`th-check ${f.phase === "returning" ? "is-warn" : "is-ok"}`}>{PHASE[f.phase]}{f.eta_s ? `, ${secs(f.eta_s)}` : ""}</span>
        <span>{f.kind} at {f.place}</span>
        <span className="meta mono">{f.id} · {f.incident} · RPIC {f.rpic} · approved by {f.approver}</span>
      </div>
      <div className="rs-flight-row">
        <span className="rs-batt" role="img" aria-label={`Battery ${f.battery}%`}><span style={{ width: `${f.battery}%` }} className={f.battery < 35 ? "is-low" : undefined} /></span>
        <span className="mono">{Math.round(f.battery)}%</span>
        <span className="meta">Wind {f.wind.wind_mps} m/s gusting {f.wind.gust_mps}</span>
        {f.observe_stopped ? <span className="th-check is-warn">Observation stopped</span> : null}
      </div>
      {f.terminated ? <p className="rs-alert is-term" role="status">Terminated by RPIC: {f.terminated.reason}. Returning to the dock; this cannot be overridden.</p> : null}
      {f.alert && !f.terminated ? <p className={`rs-alert is-${f.alert.level}`} role="alert">{f.alert.text}</p> : null}
      <div className="rs-actions">
        {d.role.pilot && !f.terminated && f.phase !== "returning" ? (
          ending ? (
            <span className="rs-decline">
              <input type="text" value={why || suggested} onChange={(e) => setWhy(e.target.value)} placeholder="Why the flight ends" aria-label="Why the flight ends" />
              <button type="button" className="btn btn-danger" disabled={busy || !(why || suggested).trim()} onClick={() => void act("flight.terminate", { id: f.id, reason: why || suggested }).then((ok) => ok && setEnding(false))}>End flight now</button>
              <button type="button" className="btn btn-quiet" onClick={() => setEnding(false)}>Keep flying</button>
            </span>
          ) : (
            <button type="button" className={`btn ${f.alert?.level === "no-go" ? "btn-danger" : "btn-quiet"}`} onClick={() => setEnding(true)}>Terminate as RPIC</button>
          )
        ) : null}
        {d.role.supervisor && f.phase === "on_scene" && !f.terminated ? <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act("flight.release", { id: f.id })}>Release to dock</button> : null}
        {d.role.supervisor && !f.observe_stopped && f.phase !== "returning" ? <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act("flight.observe_stop", { id: f.id })}>Stop observation</button> : null}
        {d.role.supervisor && !d.role.pilot && !f.terminated ? <span className="meta">Ending a flight for safety is the pilot's call. There is no override.</span> : null}
      </div>
    </li>
  );
}

function HarborMap({ d }: { d: Console }) {
  const W = d.map.width_m;
  const H = d.map.height_m;
  const X = (x: number) => (x / W) * 600;
  const Y = (y: number) => 400 - (y / H) * 400;
  const calls = d.queue;
  return (
    <svg className="rs-map" viewBox="0 0 600 400" role="img" aria-label="Harbor map: docks, calls waiting, and aircraft in flight" data-testid="harbor-map">
      <rect x="0" y="0" width="600" height="400" className="rs-land" />
      {d.map.water.map((poly, i) => <polygon key={i} className="rs-water" points={poly.map((pt) => `${X(pt[0] ?? 0)},${Y(pt[1] ?? 0)}`).join(" ")} />)}
      {d.map.structures.map((x) => (
        <g key={x.id} className="rs-struct">
          <rect x={X(x.x0)} y={Y(x.y1)} width={X(x.x1) - X(x.x0)} height={Y(x.y0) - Y(x.y1)} />
          <text x={X(x.x1) + 4} y={Y(x.y0) - 4}>{x.label} {x.height_m} m</text>
        </g>
      ))}
      {d.flights.map((f) => <line key={`l-${f.id}`} className="rs-route" x1={X(d.docks.find((k) => k.id === f.dock)?.x ?? f.x)} y1={Y(d.docks.find((k) => k.id === f.dock)?.y ?? f.y)} x2={X(f.target.x)} y2={Y(f.target.y)} />)}
      {d.docks.map((k) => (
        <g key={k.id} className={`rs-mdock is-${k.state}`}>
          <rect x={X(k.x) - 7} y={Y(k.y) - 7} width="14" height="14" rx="2" />
          <text x={X(k.x) + 10} y={Y(k.y) + 4}>{k.id}</text>
        </g>
      ))}
      {calls.map((c) => (
        <g key={c.id} className={`rs-mcall p${c.priority}`}>
          <circle cx={X(c.x)} cy={Y(c.y)} r="7" />
          <text x={X(c.x) > 430 ? X(c.x) - 10 : X(c.x) + 10} y={Y(c.y) - 8} textAnchor={X(c.x) > 430 ? "end" : "start"}>{c.id} {c.kind}</text>
        </g>
      ))}
      {d.flights.map((f) => <circle key={`t-${f.id}`} className="rs-mtarget" cx={X(f.target.x)} cy={Y(f.target.y)} r="9" />)}
      {d.flights.map((f) => (
        <g key={f.id} className="rs-mflight">
          <circle cx={X(f.x)} cy={Y(f.y)} r="5" />
          <text x={X(f.x) + 8} y={Y(f.y) + 14}>{f.tail}</text>
        </g>
      ))}
    </svg>
  );
}
