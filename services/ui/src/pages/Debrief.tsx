import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { RangeMap, colorFor, type MapMarker, type MapPath, type RangeFrame } from "./RangeMap";
import "./insights.css";
import "./plan.css";

interface MissionRow {
  id: string;
  name: string;
  summary: string | null;
  state: string;
  portion_mark: string | null;
  tails?: string[];
  planned_start?: string | null;
}

interface Cue {
  time_us: number;
  kind: string;
  label?: string;
  tail?: string;
}

/** [t_s, x_m, y_m, alt_m, battery_pct, vio, link] */
type Sample = [number, number, number, number, number, number, number];

interface Track {
  tail: string;
  sku: string;
  outcome: string;
  points: Sample[];
  max_vio_m: number;
  vio_s: number;
  link_lost_s: number;
  flight_s: number;
  energy_wh?: number;
  energy_parts?: Record<EnergyPart, number>;
  /** [t_s, control margin dB, video margin dB, link up 1/0], priced over the terrain from the GCS every 30 s. */
  link_margin?: [number, number, number, number][];
}

type EnergyPart = "induced" | "parasite" | "profile" | "climb" | "avionics" | "wind" | "cold" | "abort";
const ENERGY_PARTS: [EnergyPart, string, string][] = [
  ["induced", "Holding it up", "#5cc8ff"],
  ["profile", "Spinning the blades", "#8eb4ff"],
  ["parasite", "Pushing through the air", "#b6a5ff"],
  ["climb", "Climbing", "#3fd69a"],
  ["avionics", "Avionics", "#7fe0d6"],
  ["wind", "Fighting the wind", "#f4b443"],
  ["cold", "Cold pack", "#dfe7ef"],
  ["abort", "Early return", "#ff6b5b"],
];

/** Each tail's energy split by where it went, as stacked bars on one scale. */
function EnergyBars({ tracks }: { tracks: Track[] }) {
  const rows = tracks.filter((x) => x.energy_parts);
  if (!rows.length) return null;
  const total = (x: Track) => ENERGY_PARTS.reduce((a, [k]) => a + Math.max(0, x.energy_parts?.[k] ?? 0), 0);
  const max = Math.max(...rows.map(total), 1);
  const used = ENERGY_PARTS.filter(([k]) => rows.some((x) => (x.energy_parts?.[k] ?? 0) > 0.05));
  return (
    <>
      <ul className="db-energy" aria-label="Energy by where it went, per vehicle">
        {rows.map((x) => (
          <li key={x.tail}>
            <span className="db-energy-tail">{x.tail}</span>
            <span className="db-energy-bar">
              {used.map(([k, label, color]) => {
                const v = Math.max(0, x.energy_parts?.[k] ?? 0);
                return v > 0 ? <span key={k} style={{ width: `${(100 * v) / max}%`, background: color }} title={`${label}: ${v} Wh`} /> : null;
              })}
            </span>
            <span className="db-energy-total">{x.energy_wh ?? Math.round(total(x))} Wh</span>
          </li>
        ))}
      </ul>
      <p className="ins-legend">
        {used.map(([k, label, color]) => (
          <span key={k}>
            <span className="ins-key" style={{ background: color }} /> {label}{" "}
          </span>
        ))}
      </p>
    </>
  );
}

/** Control and video margin along the flown track, over the terrain, with the moments the link was actually down shaded. */
function MarginSpark({ track, t }: { track: Track; t: number }) {
  const rows = track.link_margin ?? [];
  if (rows.length < 2) return null;
  const W = 300;
  const H = 70;
  const t0 = rows[0]![0];
  const t1 = rows.at(-1)![0] || t0 + 1;
  const vals = rows.flatMap((r) => [r[1], r[2]]);
  const lo = Math.min(-10, ...vals);
  const hi = Math.max(30, ...vals);
  const x = (s: number) => ((s - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (i: 1 | 2) => rows.map((r, k) => `${k ? "L" : "M"}${x(r[0]).toFixed(1)},${y(r[i]).toFixed(1)}`).join(" ");
  const worst = Math.min(...rows.map((r) => r[1]));
  return (
    <div className="db-spark db-spark-tall" data-testid="debrief-margin">
      <p className="meta">
        Link margin over the terrain <strong className="mono">worst control {worst} dB</strong>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${track.tail} control and video link margin over the terrain through the flight`}>
        {rows.map((r, k) => (r[3] === 0 && rows[k + 1] ? <rect key={k} x={x(r[0])} y={0} width={Math.max(1, x(rows[k + 1]![0]) - x(r[0]))} height={H} className="db-margin-lost" /> : null))}
        <line x1={0} x2={W} y1={y(10)} y2={y(10)} className="db-margin-need" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="db-margin-zero" vectorEffect="non-scaling-stroke" />
        <path d={line(2)} className="db-margin-video" vectorEffect="non-scaling-stroke" />
        <path d={line(1)} className="db-margin-c2" vectorEffect="non-scaling-stroke" />
        {t >= t0 && t <= t1 ? <line x1={x(t)} x2={x(t)} y1={0} y2={H} className="db-margin-now" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <p className="meta db-margin-key">Control (solid), video (dashed), 10 dB planning line; shaded where the link was actually down.</p>
    </div>
  );
}

interface DebriefEvent {
  t_s: number;
  tail: string;
  kind: string;
  severity: "info" | "warn" | "danger";
  label: string;
  link?: string;
}

interface Finding {
  title: string;
  detail: string;
  link: string | null;
  cta: string | null;
}

interface Stats {
  sorties: number;
  effective: number;
  aborted: number;
  lost: number;
  airborne: number;
  flight_min: number;
  operators: number;
  operator_hours: number;
  effective_per_operator_hour: number;
  interventions: number;
  link_lost_s: number;
  vio_s: number;
  max_vio_m: number;
}

interface Debrief {
  source?: string;
  live?: boolean;
  started_at?: string | null;
  duration_s?: number;
  basemap?: RangeFrame["basemap"];
  station?: RangeFrame["station"];
  zones?: RangeFrame["zones"];
  places?: RangeFrame["places"];
  tracks?: Track[];
  events?: DebriefEvent[];
  stats?: Stats;
  findings?: Finding[];
  cues: Cue[];
}

type ExportFormat = "csv" | "json" | "xapi";
type Filter = "all" | "warn" | "operator" | "nav" | "link";

const STATES: Record<string, string> = { draft: "Draft", review: "Review", approved: "Approved", active: "Active", closed: "Closed" };

const KIND_LABEL: Record<string, string> = {
  launch: "Launch",
  station: "On station",
  recover: "Recovery",
  gnss: "Navigation",
  link: "Link",
  replan: "Re-plan",
  operator: "Operator",
  report: "Report",
  abort: "Early return",
  loss: "Loss",
  telemetry: "Position report",
  track: "Sensor custody",
  klv: "Sensor frame",
  transit: "Transit",
  search: "Search",
  rtb: "Return to base",
};

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["warn", "Warnings"],
  ["operator", "People"],
  ["nav", "Navigation"],
  ["link", "Link"],
];

function keep(filter: Filter, e: DebriefEvent): boolean {
  if (filter === "all") return true;
  if (filter === "warn") return e.severity !== "info";
  if (filter === "operator") return e.kind === "operator" || e.kind === "report" || e.kind === "replan";
  if (filter === "nav") return e.kind === "gnss";
  return e.kind === "link";
}

function tplus(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function clock(timeUs: number): string {
  return tplus(Number.isFinite(timeUs) ? timeUs / 1_000_000 : 0);
}

function at(track: Track, t: number): Sample | null {
  const pts = track.points;
  if (pts.length === 0 || t < (pts[0]?.[0] ?? 0)) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((pts[mid]?.[0] ?? 0) <= t) lo = mid;
    else hi = mid - 1;
  }
  return pts[lo] ?? null;
}

function faultSentence(error: unknown, denied: string, fallback: string): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "role_denied") return denied;
  if (code === "format_unavailable") return "That release format is not available.";
  return fallback;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Lanes({ tracks, events, duration, t, tails, onSeek }: { tracks: Track[]; events: DebriefEvent[]; duration: number; t: number; tails: string[]; onSeek: (t: number) => void }) {
  const W = 1000;
  const row = 22;
  const left = 70;
  const H = tracks.length * row + 26;
  const sx = (s: number) => left + ((W - left - 8) * s) / Math.max(duration, 1);
  return (
    <svg
      className="db-lanes"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Each vehicle's sortie over time: navigation source, link state and events"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * W;
        if (x >= left) onSeek(((x - left) / (W - left - 8)) * duration);
      }}
    >
      {tracks.map((track, i) => {
        const y = 6 + i * row;
        const pts = track.points;
        const runs: { a: number; b: number; cls: string }[] = [];
        for (let k = 0; k < pts.length; k += 1) {
          const p = pts[k] as Sample;
          const cls = p[6] === 0 ? "db-lane-link" : p[5] === 1 ? "db-lane-vio" : "db-lane-gnss";
          const next = (pts[k + 1]?.[0] ?? p[0] + 5) as number;
          const last = runs[runs.length - 1];
          if (last && last.cls === cls && Math.abs(last.b - p[0]) < 6) last.b = next;
          else runs.push({ a: p[0], b: next, cls });
        }
        return (
          <g key={track.tail}>
            <text x={4} y={y + 13} className="db-lane-tail" fill={colorFor(tails, track.tail)}>
              {track.tail}
            </text>
            {runs.map((r, k) => (
              <rect key={k} x={sx(r.a)} y={y + 3} width={Math.max(1, sx(r.b) - sx(r.a))} height={row - 9} className={r.cls} />
            ))}
            {events
              .filter((e) => e.tail === track.tail && e.kind !== "station")
              .map((e, k) => (
                <circle key={k} cx={sx(e.t_s)} cy={y + 3 + (row - 9) / 2} r={3.2} className={`db-tick db-tick-${e.severity}`}>
                  <title>
                    {tplus(e.t_s)} {e.label}
                  </title>
                </circle>
              ))}
            {track.outcome === "lost" ? (
              <text x={sx(pts[pts.length - 1]?.[0] ?? 0) + 6} y={y + 13} className="db-lane-out">
                lost
              </text>
            ) : null}
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={sx(f * duration)} y={H - 4} className="db-lane-axis" textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>
          {tplus(f * duration)}
        </text>
      ))}
      <line x1={sx(t)} x2={sx(t)} y1={2} y2={H - 16} className="db-cursor" />
    </svg>
  );
}

function Spark({ track, t, field, label, unit }: { track: Track; t: number; field: 3 | 4; label: string; unit: string }) {
  const pts = track.points;
  if (pts.length < 2) return null;
  const t0 = pts[0]?.[0] ?? 0;
  const t1 = pts[pts.length - 1]?.[0] ?? 1;
  const max = field === 4 ? 100 : Math.max(...pts.map((p) => p[3]), 10);
  const sx = (s: number) => (100 * (s - t0)) / Math.max(1, t1 - t0);
  const sy = (v: number) => 30 - (28 * v) / max;
  const now = at(track, t);
  return (
    <div className="db-spark">
      <p className="meta">
        {label} <strong className="mono">{now ? `${now[field]} ${unit}` : "–"}</strong>
      </p>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={pts.map((p) => `${sx(p[0]).toFixed(2)},${sy(p[field]).toFixed(2)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {now ? <line x1={sx(now[0])} x2={sx(now[0])} y1={0} y2={32} className="db-cursor" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
    </div>
  );
}

export function DebriefPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const reportBanner = useRef(onBanner);
  reportBanner.current = onBanner;
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [missionId, setMissionId] = useState(() => {
    const handed = sessionStorage.getItem("a2e-debrief-mission");
    if (handed && handed.trim()) {
      sessionStorage.removeItem("a2e-debrief-mission");
      return handed.trim();
    }
    return "";
  });
  const [data, setData] = useState<Debrief | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(30);
  const [focus, setFocus] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [outcome, setOutcome] = useState("");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = missions.find((m) => m.id === missionId) ?? null;
  const flown = missions.filter((m) => m.state === "active" || m.state === "closed");
  const waiting = missions.filter((m) => m.state !== "active" && m.state !== "closed");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await api<{ items: MissionRow[] }>("/v1/missions");
        if (cancelled) return;
        reportBanner.current(listed.banner);
        const items = listed.body.items;
        setMissions(items);
        setMissionId((current) => {
          if (current && items.some((m) => m.id === current)) return current;
          const first = items.find((m) => m.state === "closed") ?? items.find((m) => m.state === "active") ?? items[0];
          return first?.id ?? "";
        });
      } catch (error) {
        if (!cancelled) setFault(faultSentence(error, "Your role cannot read these plans.", "The plans could not be loaded."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer.id]);

  useEffect(() => {
    if (!missionId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setOutcome("");
    setPlaying(false);
    void (async () => {
      try {
        const r = await api<Debrief>(`/v1/missions/${encodeURIComponent(missionId)}/debrief`);
        if (cancelled) return;
        reportBanner.current(r.banner);
        setFault("");
        setData(r.body);
        const dur = r.body.duration_s ?? 0;
        setT(r.body.live ? dur : Math.min(dur, Math.max(0, (r.body.events ?? []).find((e) => e.severity !== "info")?.t_s ?? dur / 2)));
        setFocus(r.body.tracks?.[0]?.tail ?? "");
      } catch (error) {
        if (!cancelled) {
          setData(null);
          setFault(faultSentence(error, "Your role cannot open this flight log.", "The flight log could not be opened."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  const duration = data?.duration_s ?? 0;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * rate;
      last = now;
      setT((cur) => {
        const next = cur + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, duration]);

  const tracks = data?.tracks ?? [];
  const tails = tracks.map((x) => x.tail);
  const events = data?.events ?? [];
  const range: RangeFrame | null = data?.station ? { basemap: data.basemap ?? null, station: data.station, zones: data.zones ?? [], places: data.places ?? [] } : null;

  const { paths, markers } = useMemo(() => {
    const paths: MapPath[] = [];
    const markers: MapMarker[] = [];
    for (const track of tracks) {
      const color = colorFor(tails, track.tail);
      const all = track.points.map((p) => [p[1], p[2]] as [number, number]);
      paths.push({ id: `${track.tail}-all`, color, pts: all, faded: true });
      const done = track.points.filter((p) => p[0] <= t).map((p) => [p[1], p[2]] as [number, number]);
      if (done.length > 1) paths.push({ id: `${track.tail}-done`, color, pts: done });
      const now = at(track, t);
      if (!now) continue;
      const ended = t > (track.points[track.points.length - 1]?.[0] ?? 0) + 5;
      const vioAlong = now[5] === 1 ? Math.max(1.5, track.max_vio_m * 0.6) : 0;
      markers.push({ id: track.tail, label: `${track.tail}${now[5] ? " VIO" : ""}${now[6] ? "" : " NO LINK"}`, x: now[1], y: now[2], color, ring: vioAlong, dim: now[6] === 0 || (ended && track.outcome !== "lost"), cross: ended && track.outcome === "lost" });
    }
    return { paths, markers };
  }, [tracks, tails, t]);

  async function onExport() {
    if (!selected) return;
    setFault("");
    setOutcome("");
    setBusy(true);
    try {
      const r = await api<{ format: string; body: unknown }>("/v1/debrief/export", {
        method: "POST",
        body: JSON.stringify({ format, mission_id: selected.id, rows: (data?.cues ?? []).map((c) => ({ time: clock(c.time_us), event: KIND_LABEL[c.kind] ?? c.kind, label: c.label ?? "", tail: c.tail ?? "" })) }),
      });
      reportBanner.current(r.banner);
      const body = r.body.body;
      if (format === "csv" && typeof body === "string") {
        download(`${selected.id}-debrief.csv`, body, "text/csv");
        setOutcome(`Released ${body.trim().split("\n").length - 2} events as CSV, marked UNCLASSIFIED // DEMO DATA. Logged in Audit.`);
      } else if (format === "json") {
        download(`${selected.id}-replay.json`, JSON.stringify(body, null, 1), "application/json");
        setOutcome("Released the full replay as JSON. Logged in Audit.");
      } else {
        const actor = (body as { actor?: { name?: string } } | null)?.actor?.name ?? viewer.display_name;
        setOutcome(`Recorded that ${actor} debriefed this mission (xAPI). Logged in Audit.`);
      }
    } catch (error) {
      setFault(faultSentence(error, "Your role cannot release a debrief. Mission commanders, planners and analysts can.", "The debrief could not be released."));
    } finally {
      setBusy(false);
    }
  }

  const st = data?.stats;
  const focusTrack = tracks.find((x) => x.tail === focus) ?? tracks[0];
  const shown = events.filter((e) => keep(filter, e));
  const nextEvent = events.find((e) => e.t_s > t + 1);

  return (
    <section className="page ins-page db-page" data-testid="debrief">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Debrief</h1>
          <p className="lede">Replay what each vehicle did, where it lost GNSS or the link, what people decided, and what the sortie cost in operator time. Findings link to the page that acts on them.</p>
        </div>
        <span className="pill pill-warn">SIM REPLAY</span>
      </header>
      {fault ? (
        <p className="fault" role="alert">
          {fault}
        </p>
      ) : null}
      <div className="db-layout">
        <aside className="panel db-plans" aria-label="Plans">
          <div className="panel-head">
            <h2>Flown</h2>
            <span className="meta">{flown.length}</span>
          </div>
          {flown.length === 0 ? <p className="empty">No plan has flown yet.</p> : null}
          {flown.map((m) => (
            <button key={m.id} type="button" className={m.id === missionId ? "ticket is-selected" : "ticket"} aria-pressed={m.id === missionId} onClick={() => setMissionId(m.id)}>
              <strong>{m.name}</strong>
              <span className={`pill pill-${m.state}`}>{m.state === "active" ? "In flight" : STATES[m.state]}</span>
              <span className="meta">
                {m.id}
                {m.planned_start ? ` · ${new Date(m.planned_start).toISOString().slice(0, 16).replace("T", " ")}Z` : ""}
                {m.tails?.length ? ` · ${m.tails.length} vehicles` : ""}
              </span>
            </button>
          ))}
          {waiting.length ? (
            <>
              <div className="panel-head">
                <h2>Not flown</h2>
                <span className="meta">{waiting.length}</span>
              </div>
              {waiting.map((m) => (
                <button key={m.id} type="button" className={m.id === missionId ? "ticket is-selected db-unflown" : "ticket db-unflown"} onClick={() => setMissionId(m.id)}>
                  <strong>{m.name}</strong>
                  <span className={`pill pill-${m.state}`}>{STATES[m.state] ?? m.state}</span>
                </button>
              ))}
            </>
          ) : null}
        </aside>

        <div className="db-main">
          {selected ? (
            <section className="panel">
              <div className="panel-head">
                <h2>
                  {selected.name} <span className="meta mono">{selected.id}</span>
                </h2>
                <span className={`pill pill-${selected.state}`}>{data?.live ? "In flight, replay to now" : (STATES[selected.state] ?? selected.state)}</span>
              </div>
              <p className="db-summary">{selected.summary}</p>
              <div className="db-actions">
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    sessionStorage.setItem("a2e-mission-id", selected.id);
                    window.location.hash = "missions";
                  }}
                >
                  Open the plan
                </button>
                <span className="db-spacer" />
                {selected.state === "active" || selected.state === "closed" ? (
                <>
                <label className="meta" htmlFor="export-format">
                  Release as
                </label>
                <select id="export-format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                  <option value="csv">CSV event log</option>
                  <option value="json">JSON replay</option>
                  <option value="xapi">xAPI training record</option>
                </select>
                <button className="btn btn-primary" type="button" disabled={busy || !data?.tracks?.length} onClick={() => void onExport()}>
                  Release debrief
                </button>
                </>
                ) : (
                  <span className="meta">Release opens once the plan has flown.</span>
                )}
              </div>
              {outcome ? (
                <p className="ins-held" role="status">
                  {outcome}
                </p>
              ) : null}
            </section>
          ) : null}

          {selected && data && !data.tracks?.length && data.cues.length === 0 ? <p className="empty">This plan has not flown, so there is nothing to replay. Its launch checks are on Missions.</p> : null}

          {st ? (
            <div className="grid-stats db-stats">
              <div className="stat">
                <p className="stat-value">
                  {st.effective} / {st.sorties}
                </p>
                <p className="stat-label">Effective sorties{st.airborne ? ` (${st.airborne} still flying)` : ""}{st.aborted ? `, ${st.aborted} early return` : ""}{st.lost ? `, ${st.lost} lost` : ""}</p>
              </div>
              <div className="stat">
                <p className="stat-value">{data?.live ? "–" : st.effective_per_operator_hour}</p>
                <p className="stat-label">Effective sorties per operator-hour ({st.operators} operator{st.operators > 1 ? "s" : ""})</p>
              </div>
              <div className="stat">
                <p className="stat-value">{st.max_vio_m ? `${st.max_vio_m} m` : "–"}</p>
                <p className="stat-label">Worst VIO error, {Math.round(st.vio_s / 60)} vehicle-min without GNSS</p>
              </div>
              <div className="stat">
                <p className="stat-value">{Math.round(st.link_lost_s / 60)} min</p>
                <p className="stat-label">Off the link · {st.interventions} operator action{st.interventions === 1 ? "" : "s"} · {st.flight_min} flight-min</p>
              </div>
            </div>
          ) : null}

          {range && tracks.length ? (
            <div className="db-replay">
              <section className="panel db-map-panel">
                <div className="panel-head">
                  <h2>Replay</h2>
                  <span className="mono">{tplus(t)}</span>
                </div>
                <RangeMap range={range} paths={paths} markers={markers} label="Replay map: flown paths, the jamming zone and each vehicle at the replay time" />
                <div className="db-transport">
                  <button type="button" className="btn btn-primary" onClick={() => (t >= duration ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}>
                    {playing ? "Pause" : t >= duration ? "Replay" : "Play"}
                  </button>
                  <input type="range" min={0} max={duration} step={1} value={Math.min(t, duration)} aria-label="Replay time" onChange={(e) => setT(Number(e.target.value))} />
                  <select value={rate} aria-label="Replay speed" onChange={(e) => setRate(Number(e.target.value))}>
                    <option value={10}>10x</option>
                    <option value={30}>30x</option>
                    <option value={90}>90x</option>
                  </select>
                  <button type="button" className="btn btn-quiet" disabled={!nextEvent} onClick={() => nextEvent && setT(nextEvent.t_s)}>
                    Next event
                  </button>
                </div>
                <div className="pl-legend">
                  <span><i className="db-key-gnss" />GNSS</span>
                  <span><i className="db-key-vio" />VIO, GNSS rejected</span>
                  <span><i className="db-key-link" />Off the link</span>
                  <span><i className="db-key-jam" />Jamming zone (SIM)</span>
                </div>
              </section>
              <section className="panel db-tele">
                <div className="panel-head">
                  <h2>Vehicle</h2>
                  <select value={focusTrack?.tail ?? ""} aria-label="Vehicle" onChange={(e) => setFocus(e.target.value)}>
                    {tracks.map((x) => (
                      <option key={x.tail} value={x.tail}>
                        {x.tail}
                      </option>
                    ))}
                  </select>
                </div>
                {focusTrack ? (
                  <>
                    {(() => {
                      const now = at(focusTrack, t);
                      return (
                        <ul className="db-facts">
                          <li>
                            Model <strong>{focusTrack.sku.replace("ARCHER-", "Archer ")}</strong>
                          </li>
                          <li>
                            Outcome <strong className={focusTrack.outcome === "lost" ? "db-bad" : focusTrack.outcome === "aborted" ? "db-warn" : ""}>{focusTrack.outcome === "aborted" ? "early return" : focusTrack.outcome}</strong>
                          </li>
                          <li>
                            Navigation <strong>{now ? (now[5] ? "VIO" : "GNSS") : "–"}</strong>
                          </li>
                          <li>
                            Link <strong className={now && !now[6] ? "db-warn" : ""}>{now ? (now[6] ? "up" : "lost") : "–"}</strong>
                          </li>
                          <li>
                            Airborne <strong>{Math.round(focusTrack.flight_s / 60)} min</strong>
                          </li>
                          <li>
                            Worst VIO error <strong>{focusTrack.max_vio_m ? `${focusTrack.max_vio_m} m` : "none"}</strong>
                          </li>
                        </ul>
                      );
                    })()}
                    <Spark track={focusTrack} t={t} field={3} label="Altitude" unit="m" />
                    <Spark track={focusTrack} t={t} field={4} label="Battery" unit="%" />
                    <MarginSpark track={focusTrack} t={t} />
                  </>
                ) : null}
              </section>
            </div>
          ) : null}

          {tracks.length ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Timeline</h2>
                <span className="meta">Click to jump. Bars show navigation source and link; dots are events.</span>
              </div>
              <Lanes tracks={tracks} events={events} duration={duration} t={t} tails={tails} onSeek={(s) => setT(s)} />
            </section>
          ) : null}

          {tracks.some((x) => x.energy_parts) ? (
            <section className="panel" data-testid="debrief-energy">
              <div className="panel-head">
                <h2>Where the energy went</h2>
                <span className="pill pill-warn">SIM</span>
              </div>
              <EnergyBars tracks={tracks} />
              <p className="meta ins-note">
                The performance model's power split by part at every 5 s step: induced power holds the airframe up, profile power spins the blades, parasite power pushes the body through the air. Fighting the wind is what the flight cost over the same ground track in still air (negative when a tailwind helped). Cold pack and early return are the extra a cold derate and an RTL added. Assumed coefficients, not measured.
              </p>
            </section>
          ) : null}

          {data?.findings?.length ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Findings</h2>
              </div>
              <div className="db-findings">
                {data.findings.map((f) => (
                  <article key={f.title} className="db-finding">
                    <p className="ins-alert-title">{f.title}</p>
                    <p className="meta">{f.detail}</p>
                    {f.link && f.cta ? (
                      <a className="btn btn-quiet" href={f.link}>
                        {f.cta}
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {events.length ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Events</h2>
                <div className="db-filters" role="group" aria-label="Filter events">
                  {FILTERS.map(([k, label]) => (
                    <button key={k} type="button" className={filter === k ? "chip is-on" : "chip"} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <ol className="db-events">
                {shown.map((e, i) => (
                  <li key={`${e.t_s}-${e.tail}-${i}`} className={`db-ev db-ev-${e.severity}${Math.abs(e.t_s - t) < 3 ? " is-now" : ""}`}>
                    <button type="button" className="db-ev-time mono" onClick={() => setT(e.t_s)}>
                      {tplus(e.t_s)}
                    </button>
                    <span className="db-ev-tail" style={{ color: colorFor(tails, e.tail) }}>
                      {e.tail}
                    </span>
                    <span className="db-ev-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    <span className="db-ev-label">
                      {e.label}
                      {e.link ? (
                        <>
                          {" "}
                          <a href={e.link}>Open</a>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : data && data.cues.length ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Flight log</h2>
              </div>
              <ol className="log-rail">
                {data.cues.map((cue, index) => (
                  <li key={`${cue.time_us}-${cue.kind}-${index}`}>
                    <span className="log-time">{clock(cue.time_us)}</span>
                    <span className="log-body">
                      <strong>{cue.tail?.trim() ? cue.tail : "Plan"}</strong>
                      <span>{KIND_LABEL[cue.kind] ?? cue.kind}</span>
                      {cue.label ? <span className="meta">{cue.label}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {data?.source ? <p className="ins-source">{data.source} Positions, battery and VIO error come from the demo kinematics with assumed rates (1% of distance for VIO drift).</p> : null}
        </div>
      </div>
    </section>
  );
}
