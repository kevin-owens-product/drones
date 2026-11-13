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
interface Dock { id: string; name: string; x: number; y: number; tail: string; charge: number; state: string; out_on: string | null; comms: string; power: string }
interface Console {
  source: string;
  program: { name: string };
  role: { supervisor: boolean; pilot: boolean; preview: boolean };
  shift: { start: string; end: string; rpic_name: string; supervisor: string };
  limits: { wind_mps: number; gust_mps: number };
  weather: { wind_mps: number; gust_mps: number; visibility_km: number; ceiling_ft: number };
  map: { width_m: number; height_m: number; water: number[][][]; places: { id: string; label: string; x: number; y: number }[] };
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
              <span className="meta">{k.state === "out" ? `Out on ${k.out_on}` : k.state === "charging" ? `Charging, ${k.charge}% (60% to launch)` : k.state === "fault" ? `Fault: ${k.power !== "on" ? "no power" : "comms"}` : `Ready, ${k.charge}%`}</span>
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
