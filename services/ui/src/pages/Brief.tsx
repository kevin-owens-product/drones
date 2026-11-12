import { useEffect, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { RangeMap, colorFor, type MapPath, type RangeFrame } from "./RangeMap";
import "./insights.css";
import "./plan.css";

interface LookRow {
  alt_m: number;
  range_m: number;
  gsd_cm: number;
  px: number;
  level: "identify" | "recognise" | "detect" | "none";
  ok: boolean;
  swath_m?: number;
  cover?: number;
  closed?: boolean;
  look_deg?: number;
  hidden_m?: number;
  video_db?: number;
}
interface LookTail {
  tail: string;
  airframe: string;
  camera: string;
  rows: LookRow[];
  recommended_m: number;
  alt_m: number;
  at: LookRow;
  can: boolean;
  linked: boolean;
  why: string;
}
/** What each assigned camera sees of a task by height (demo/optics.mjs). */
interface Look {
  needs: string;
  need_px: number;
  pattern: string;
  strips: boolean;
  tails: LookTail[];
}

interface Task {
  look?: Look | null;
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
  /** Vehicles taken that are already flying another plan. */
  conflicts?: { tail: string; why: string }[];
  status: string;
  by?: string;
  at?: string;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  mission_id?: string;
}

const EXAMPLES = [
  "Search the north field with two vehicles before 14:00, then check the culvert, keep two in reserve",
  "Observe gate 3 with 2 drones for 20 minutes, relay on the ridge, avoid the jamming zone",
  "Survey area a and area d, inspect the road junction",
];

const VERB: Record<string, string> = { search: "Search", survey: "Survey", observe: "Observe", relay: "Relay at", inspect: "Inspect" };

const APPROVERS = ["mission_commander", "admin"];

function ago(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 1 ? "just now" : mins < 90 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

const videoClass = (db: number | undefined) => (db === undefined ? "" : db < 0 ? "is-bad" : db < 3 ? "is-thin" : "is-good");

/**
 * One camera against one task at every height: pixels on a person, the ground
 * it covers or loses, and whether the picture gets home. Each column is a
 * height; while the brief waits for approval a click sets the height the plan files.
 */
function HeightLadder({ look, t, canSet, onSet }: { look: Look; t: LookTail; canSet: boolean; onSet: (alt: number) => void }) {
  return (
    <div className="br-ladder" data-testid={`ladder-${t.tail}`}>
      <p className="br-ladder-head">
        <strong>{t.tail}</strong> <span className="meta">{t.airframe} · {t.camera}</span>
      </p>
      <div className="br-ladder-grid" role="group" aria-label={`${t.tail} height`}>
        <div className="br-ladder-keys" aria-hidden="true">
          <span>Height</span>
          <span>Person</span>
          <span>{look.strips ? "Ground seen" : "Hidden"}</span>
          <span>Video</span>
        </div>
        {t.rows.map((r) => {
          const second = look.strips ? `${Math.round((r.cover ?? 0) * 100)}%` : `${r.hidden_m} m`;
          const says = `${t.tail} at ${r.alt_m} m: ${r.px} pixels on a person, ${look.strips ? `${second} of the ground seen` : `${second} hidden behind an obstacle`}${r.video_db !== undefined ? `, video ${r.video_db} dB` : ""}`;
          return (
            <button key={r.alt_m} type="button" className={`br-rung${r.alt_m === t.alt_m ? " is-set" : ""}${r.alt_m === t.recommended_m ? " is-best" : ""}`} disabled={!canSet} aria-pressed={r.alt_m === t.alt_m} aria-label={says} title={says} onClick={() => onSet(r.alt_m)}>
              <span className="br-rung-alt">{r.alt_m}</span>
              <span className={`br-rung-px lv-${r.level}${r.px >= look.need_px ? "" : " is-short"}`}>{r.px >= 10 ? Math.round(r.px) : r.px}</span>
              <span className={`br-rung-cov ${look.strips ? (r.closed ? "is-good" : (r.cover ?? 0) >= 1 ? "is-thin" : "is-bad") : (r.hidden_m ?? 0) <= 12 ? "is-good" : (r.hidden_m ?? 0) <= 25 ? "is-thin" : "is-bad"}`}>{second}</span>
              <span className={`br-rung-vid ${videoClass(r.video_db)}`}>{r.video_db ?? "–"}</span>
            </button>
          );
        })}
      </div>
      <p className={t.can && t.linked ? "meta" : "br-warn"}>
        {t.alt_m === t.recommended_m ? "" : `Set to ${t.alt_m} m: ${t.at.px} px on a person${look.strips ? `, ${Math.round((t.at.cover ?? 0) * 100)}% of the ground seen` : `, ${t.at.hidden_m} m hidden`}${t.at.video_db !== undefined ? `, video ${t.at.video_db} dB` : ""}. Suggested ${t.recommended_m} m. `}
        {t.why}
      </p>
    </div>
  );
}

function pill(status: string): string {
  if (status === "approved") return "pill pill-ok";
  if (status === "refused" || status === "rejected") return "pill pill-warn";
  if (status === "awaiting approval") return "pill pill-review";
  return "pill";
}

export function BriefPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const [brief, setBrief] = useState(EXAMPLES[0]!);
  const [queue, setQueue] = useState<Proposal[]>([]);
  const [p, setP] = useState<Proposal | null>(null);
  const [note, setNote] = useState("");
  const [range, setRange] = useState<RangeFrame | null>(null);
  const [fault, setFault] = useState("");
  const canApprove = viewer.roles.some((r) => APPROVERS.includes(r));

  async function loadQueue(pick?: string) {
    try {
      const r = await api<{ items: Proposal[] }>("/v1/intent");
      onBanner(r.banner);
      const items = Array.isArray(r.body.items) ? r.body.items : [];
      setQueue(items);
      setP((cur) => items.find((x) => x.id === (pick ?? cur?.id)) ?? items.find((x) => x.status === "awaiting approval") ?? items[0] ?? null);
    } catch {
      /* the queue is a convenience; the form still works without it */
    }
  }

  useEffect(() => {
    void loadQueue();
    void api<{ range?: RangeFrame | null }>("/v1/missions")
      .then((r) => setRange(r.body.range ?? null))
      .catch(() => setRange(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setFault("");
    try {
      const r = await api<Proposal>("/v1/intent/propose", { method: "POST", body: JSON.stringify({ brief }) });
      onBanner(r.banner);
      setP(r.body);
      await loadQueue(r.body.id);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "could not read the brief");
    }
  }

  async function setHeight(task: number, tail: string, alt: number) {
    if (!p) return;
    setFault("");
    try {
      const r = await api<Proposal>("/v1/intent/height", { method: "POST", body: JSON.stringify({ id: p.id, task, tail, alt_m: alt }) });
      setP(r.body);
      setQueue((q) => q.map((x) => (x.id === r.body.id ? r.body : x)));
    } catch (error) {
      setFault(error instanceof Error ? error.message : "could not set the height");
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!p) return;
    setFault("");
    try {
      const r = await api<Proposal>("/v1/intent/approve", { method: "POST", body: JSON.stringify({ id: p.id, decision, by: viewer.display_name, note }) });
      setP(r.body);
      setNote("");
      await loadQueue(r.body.id);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "decision failed");
    }
  }

  const waiting = queue.filter((x) => x.status === "awaiting approval").length;
  const tails = p ? [...new Set(p.plan.flatMap((t) => t.tails ?? []))] : [];
  const paths: MapPath[] =
    range && p
      ? p.plan.flatMap((t) => {
          const place = range.places.find((x) => x.id === t.place);
          if (!place) return [];
          return (t.tails ?? []).map((tail) => ({ id: `${t.place}-${tail}`, color: colorFor(tails, tail), pts: [[range.station.x, range.station.y] as [number, number], [place.x, place.y] as [number, number]], dashed: true }));
        })
      : [];

  return (
    <section className="page ins-page" data-testid="brief">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Brief</h1>
          <p className="lede">Type the mission the way you would say it. The console reads it into tasks, picks vehicles, shows you exactly what it understood, and does nothing until a commander approves. Approval files a draft plan on Missions; it never reaches a vehicle.</p>
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
              <button key={ex} type="button" className={brief === ex ? "chip is-on" : "chip"} aria-pressed={brief === ex} onClick={() => setBrief(ex)}>
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

      <div className="db-layout">
        <aside className="panel db-plans" aria-label="Briefs">
          <div className="panel-head">
            <h2>Briefs</h2>
            <span className="meta">{waiting} waiting</span>
          </div>
          {queue.length === 0 ? <p className="empty">No briefs yet.</p> : null}
          {[...queue].map((x) => (
            <button key={x.id} type="button" className={x.id === p?.id ? "ticket is-selected" : "ticket"} aria-pressed={x.id === p?.id} aria-label={`Brief: ${x.brief}`} onClick={() => setP(x)}>
              <strong>{x.brief.length > 70 ? `${x.brief.slice(0, 70)}…` : x.brief}</strong>
              <span className={pill(x.status)}>{x.status}</span>
              <span className="meta">
                {x.by ?? "Unknown"} · {ago(x.at)}
              </span>
            </button>
          ))}
        </aside>

        <div className="db-main">
          {p ? (
            <section className="panel br-result" aria-label="Proposal">
              <div className="panel-head">
                <h2>
                  Proposal <span className="mono">{p.id}</span>
                </h2>
                <span className={pill(p.status)}>{p.status}</span>
              </div>
              <p className="br-quote">“{p.brief}”</p>
              {p.by ? (
                <p className="meta">
                  Briefed by {p.by} {ago(p.at)}
                </p>
              ) : null}
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
                      {t.look ? (
                        <div className="br-look" data-testid="brief-look">
                          <p className="meta">
                            To {t.look.needs} takes {t.look.need_px} pixels across them. {t.look.pattern}. Heights in metres above the ground; pixels on a person, {t.look.strips ? "share of the ground the strips see" : "ground hidden behind a 6 m obstacle"}, video margin in dB.
                            {p.status === "awaiting approval" ? " Pick a column to set the height the plan files." : ""}
                          </p>
                          {t.look.tails.map((lt) => (
                            <HeightLadder key={lt.tail} look={t.look as Look} t={lt} canSet={p.status === "awaiting approval"} onSet={(alt) => void setHeight(i, lt.tail, alt)} />
                          ))}
                        </div>
                      ) : null}
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
                  {(p.conflicts ?? []).map((c) => (
                    <li key={`c-${c.tail}`} className="br-warn">
                      Busy: {c.tail} is {c.why}; approving retasks it, so the commander should check that plan first
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
                <div className="br-decide">
                    <input aria-label="Decision note" placeholder="Note for the planner (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                    {!canApprove ? <p className="meta">Your role can brief but not approve. A mission commander or admin decides.</p> : null}
                    <div className="br-row">
                      <span className="meta">{p.parser} Approving files this as a draft plan on Missions.</span>
                      <div className="br-actions">
                        <button type="button" className="btn" disabled={!canApprove} onClick={() => void decide("reject")}>
                          Reject
                        </button>
                        <button type="button" className="btn btn-primary" disabled={!canApprove} onClick={() => void decide("approve")}>
                          Approve
                        </button>
                      </div>
                    </div>
                  </div>
              ) : null}
              {p.status === "approved" || p.status === "rejected" ? (
                <p className="ins-held" role="status">
                  {p.status === "approved" ? "Approved" : "Rejected"} by {p.decided_by}
                  {p.decided_at ? ` ${ago(p.decided_at)}` : ""}.{" "}
                  {p.decision_note ? `“${p.decision_note}” ` : ""}
                  {p.status === "approved" ? `Filed as draft ${p.mission_id ?? "plan"} for the mission planner; it goes through review and launch checks like any plan. ` : ""}
                  Nothing was sent to a vehicle.
                  {p.mission_id ? (
                    <>
                      {" "}
                      <a
                        href="#missions"
                        onClick={() => {
                          sessionStorage.setItem("a2e-mission-id", p.mission_id ?? "");
                        }}
                      >
                        Open {p.mission_id} in Missions
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="empty">Read a brief, or pick one from the list.</p>
          )}
          {range && p && paths.length ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Where it sends them</h2>
                <span className="meta">Straight lines from the GCS; the planner routes around the jamming zone.</span>
              </div>
              <RangeMap
                range={range}
                paths={paths}
                markers={p.plan.flatMap((t) => {
                  const place = range.places.find((x) => x.id === t.place);
                  return place && t.tails?.length ? [{ id: t.place, label: `${VERB[t.kind] ?? t.kind}: ${(t.tails ?? []).join(", ")}`, x: place.x, y: place.y, color: colorFor(tails, t.tails[0] ?? "") }] : [];
                })}
                label="Map of the places the brief names and the vehicles assigned to them"
              />
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
