import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { RangeMap, type MapPath, type MapMarker, type RangeFrame } from "./RangeMap";
import "./insights.css";
import "./plan.css";
import "./physics.css";

type Severity = "no-go" | "caution" | "info";
interface Fix {
  id: string;
  kind: "altitude" | "relay" | "band" | "preheat" | "swap";
  label: string;
  detail?: string;
  changes_plan: boolean;
}
interface Finding {
  id: string;
  area: "link" | "pack" | "thrust";
  severity: Severity;
  tail: string;
  title: string;
  detail: string;
  fixes: Fix[];
}
interface PackSide {
  min_v: number;
  climb_out_v: number | null;
  climb_out_punch_v: number | null;
  cutoff: { t: number; v_cell: number; soc: number } | null;
  end_soc: number | null;
  end_temp_c: number | null;
  max_temp_c: number;
}
interface TailCheck {
  tail: string;
  sku: string;
  airframe: string;
  minutes: number;
  link: { c2_min_db: number | null; video_min_db: number | null; c2_lost_s: number; c2_thin_s: number; video_lost_s: number; cause: string };
  track: [number, number, number, number, number][];
  pack: {
    label: string;
    cutoff_v: number;
    start_pct: number;
    cold: PackSide;
    warm: PackSide;
    preheat: { needed: boolean; launch_c: number | null; out_c: number | null; warm_min: number | null; planned: number | null; done: boolean };
    trace: { t: number; v: number; temp: number; soc: number; v_warm: number | null; temp_warm: number | null }[];
  };
  thrust: { verdict: string; headroom: number; thrust_max_n: number; thrust_gust_n: number; tilt_gust_deg: number; gust_mps: number; density_altitude_m: number; cell_v: number; max_wind_mps: number };
}
interface Check {
  source: string;
  forecast: { temp_c: number; wind_mps: number; wind_from_deg: number; gust_mps: number; ew: boolean };
  band: string;
  bands: { id: string; label: string }[];
  emitter: { x: number; y: number; label: string; on: boolean };
  relays: { tail: string; x: number; y: number; agl: number }[];
  tails: TailCheck[];
  findings: Finding[];
  verdict: "go" | "caution" | "no-go";
  profile: { tail: string; from: string; to: string; distance_m: number; clearance_f1: number; diffraction_db: number; rows: { d_m: number; ground_m: number; los_m: number; fresnel60_m: number }[] } | null;
  envelope?: { tail: string; airframe: string; temps: number[]; winds: number[]; cells: { temp_c: number; wind_mps: number; headroom: number; verdict: string }[]; now: { temp_c: number; wind_mps: number } };
  range: RangeFrame;
}
interface MissionRow {
  id: string;
  name: string;
  state: string;
}

const KEY = "a2e-physics-mission";
const AREA_LABEL: Record<Finding["area"], string> = { link: "Link", pack: "Pack", thrust: "Thrust" };
const marginColor = (db: number) => (db < 0 ? "var(--danger)" : db < 10 ? "var(--warn)" : "var(--ok)");
const fmtMin = (s: number) => (s < 90 ? `${s} s` : `${(s / 60).toFixed(1)} min`);

export function PhysicsCheckPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [missionId, setMissionId] = useState<string>("");
  const [ask, setAsk] = useState<{ temp_c?: number; wind_mps?: number; gust_mps?: number; ew?: boolean }>({});
  const [check, setCheck] = useState<Check | null>(null);
  const [tail, setTail] = useState<string>("");
  const [fault, setFault] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const canPlan = viewer.roles.some((r) => ["admin", "mission_commander", "planner"].includes(r));

  useEffect(() => {
    void api<{ items: MissionRow[] }>("/v1/missions")
      .then((r) => {
        onBannerRef.current(r.banner);
        setMissions(r.body.items);
        let handed = "";
        try {
          handed = sessionStorage.getItem(KEY) ?? "";
        } catch {
          handed = "";
        }
        const open = r.body.items.filter((m) => m.state !== "closed" && m.state !== "active");
        const pick = r.body.items.find((m) => m.id === handed) ?? r.body.items.find((m) => m.id === "M-1035") ?? open[0] ?? r.body.items[0];
        setMissionId(pick?.id ?? "");
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "plans failed"));
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (ask.temp_c !== undefined) q.set("temp_c", String(ask.temp_c));
    if (ask.wind_mps !== undefined) q.set("wind_mps", String(ask.wind_mps));
    if (ask.gust_mps !== undefined) q.set("gust_mps", String(ask.gust_mps));
    if (ask.ew !== undefined) q.set("ew", ask.ew ? "1" : "0");
    return q.toString();
  }, [ask]);

  const load = useCallback(async () => {
    if (!missionId) return;
    try {
      const r = await api<Check>(`/v1/missions/${encodeURIComponent(missionId)}/physics${query ? `?${query}` : ""}`);
      onBannerRef.current(r.banner);
      setCheck(r.body);
      setFault("");
      setTail((t) => (r.body.tails.some((x) => x.tail === t) ? t : (r.body.findings[0]?.tail ?? r.body.tails[0]?.tail ?? "")));
    } catch (error) {
      setFault(error instanceof Error ? error.message : "check failed");
    }
  }, [missionId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectMission = (id: string) => {
    setMissionId(id);
    setAsk({});
    setOutcome("");
    try {
      sessionStorage.setItem(KEY, id);
    } catch {
      /* the choice lasts this view */
    }
  };

  const mission = missions.find((m) => m.id === missionId);
  const editable = mission ? mission.state !== "closed" && mission.state !== "active" : false;
  const whatIf = Object.keys(ask).length > 0;

  async function applyFix(fix: Fix) {
    if (!mission) return;
    setBusy(true);
    try {
      const r = await api<{ state: string; note: string }>(`/v1/missions/${encodeURIComponent(mission.id)}/physics`, { method: "POST", body: JSON.stringify({ fix: fix.id, forecast: ask }) });
      setOutcome(`${r.body.note}.`);
      setMissions((list) => list.map((m) => (m.id === mission.id ? { ...m, state: r.body.state } : m)));
      await load();
    } catch (error) {
      setOutcome(error instanceof Error && error.message === "role_denied" ? "Your role cannot change a plan. Planners and mission commanders can." : `That fix could not be applied (${error instanceof Error ? error.message : "error"}).`);
    } finally {
      setBusy(false);
    }
  }

  async function saveForecast() {
    if (!mission || !check) return;
    setBusy(true);
    try {
      await api(`/v1/missions/${encodeURIComponent(mission.id)}/forecast`, { method: "POST", body: JSON.stringify(check.forecast) });
      setAsk({});
      setOutcome(`Forecast saved to ${mission.id}: launch checks now use ${check.forecast.temp_c} °C and ${check.forecast.wind_mps} m/s gusting ${check.forecast.gust_mps}.`);
    } catch (error) {
      setOutcome(error instanceof Error && error.message === "role_denied" ? "Your role cannot change a plan's forecast." : "The forecast could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!check) return <section className="page">{fault ? <p className="fault">{fault}</p> : <p className="meta">Loading…</p>}</section>;

  const f = check.forecast;
  const sel = check.tails.find((t) => t.tail === tail) ?? check.tails[0];
  const videoOut = check.tails.filter((t) => t.link.video_lost_s > 0);
  const preheats = check.tails.filter((t) => t.pack.preheat.needed);
  const minHead = check.tails.length ? Math.min(...check.tails.map((t) => t.thrust.headroom)) : 0;

  return (
    <section className="page ins-page ph-page" data-testid="physics-check">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Physics check</h1>
          <p className="lede">
            Before a plan launches, fly it through the three things that decide whether a small drone does its job tonight: line of sight over the real terrain, a battery that sags in the cold, and the thrust left to fight a gust. Every finding comes with a fix you can put into the plan.
          </p>
        </div>
        <span className="pill pill-warn" title={check.source}>
          SIM
        </span>
      </header>

      <div className="ph-controls">
        <label>
          Plan
          <select value={missionId} onChange={(e) => selectMission(e.target.value)} aria-label="Plan to check">
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.name} ({m.state})
              </option>
            ))}
          </select>
        </label>
        <label>
          Air <strong>{f.temp_c} °C</strong>
          <input type="range" min={-25} max={40} step={1} value={f.temp_c} onChange={(e) => setAsk((a) => ({ ...a, temp_c: Number(e.target.value) }))} aria-label="Air temperature" />
        </label>
        <label>
          Wind <strong>{f.wind_mps} m/s</strong>
          <input type="range" min={0} max={16} step={1} value={f.wind_mps} onChange={(e) => setAsk((a) => ({ ...a, wind_mps: Number(e.target.value), gust_mps: Math.max(Number(e.target.value), a.gust_mps ?? f.gust_mps) }))} aria-label="Wind speed" />
        </label>
        <label>
          Gusts <strong>{f.gust_mps} m/s</strong>
          <input type="range" min={0} max={24} step={1} value={f.gust_mps} onChange={(e) => setAsk((a) => ({ ...a, gust_mps: Number(e.target.value) }))} aria-label="Gust speed" />
        </label>
        <label className="dm-check">
          <input type="checkbox" checked={f.ew} onChange={(e) => setAsk((a) => ({ ...a, ew: e.target.checked }))} /> EW emitter on (900 MHz, 2.4 GHz)
        </label>
        {whatIf ? (
          <span className="ph-whatif">
            What-if forecast.{" "}
            {editable && canPlan ? (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void saveForecast()}>
                Save to plan
              </button>
            ) : null}
            <button type="button" className="btn btn-quiet" onClick={() => setAsk({})}>
              Reset
            </button>
          </span>
        ) : null}
      </div>

      <div className="grid-stats">
        <div className="stat">
          <p className={`stat-value ph-v-${check.verdict}`}>{check.verdict === "go" ? "Go" : check.verdict === "caution" ? "Go with cautions" : "Fix before launch"}</p>
          <p className="stat-label">
            {check.findings.length} finding{check.findings.length === 1 ? "" : "s"} on {check.tails.length} airframe{check.tails.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="stat">
          <p className="stat-value">{videoOut.length ? videoOut.map((t) => t.tail).join(", ") : "None"}</p>
          <p className="stat-label">Lose video behind terrain{f.ew ? " or jamming" : ""}</p>
        </div>
        <div className="stat">
          <p className="stat-value">{preheats.length ? preheats.map((t) => t.tail).join(", ") : "None"}</p>
          <p className="stat-label">Packs to preheat at {f.temp_c} °C</p>
        </div>
        <div className="stat">
          <p className="stat-value">{Math.round(minHead * 100)}%</p>
          <p className="stat-label">Least thrust in hand in a gust (plan for 30%)</p>
        </div>
      </div>

      {outcome ? (
        <p className="ph-outcome" role="status">
          {outcome} <a href="#missions" onClick={() => sessionStorage.setItem("a2e-mission-id", missionId)}>Open the plan</a>
        </p>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>What to fix</h2>
          {mission ? <span className={`pill pill-${mission.state}`}>{mission.state}</span> : null}
        </div>
        {check.findings.length === 0 ? (
          <p className="empty">Nothing to fix: the links hold, the packs hold the cutoff and every airframe keeps 30% thrust in hand.</p>
        ) : (
          <ul className="ph-findings">
            {check.findings.map((fd) => (
              <li key={fd.id} className={`ph-finding ph-sev-${fd.severity}`}>
                <div className="ph-finding-head">
                  <span className={`ms-lv ms-lv-${fd.severity === "info" ? "go" : fd.severity}`}>{fd.severity}</span>
                  <span className="ph-area">{AREA_LABEL[fd.area]}</span>
                  <button type="button" className="ph-title" onClick={() => setTail(fd.tail)}>
                    {fd.title}
                  </button>
                </div>
                <p className="ph-detail">{fd.detail}</p>
                {fd.fixes.length ? (
                  <ul className="ph-fixes">
                    {fd.fixes.map((x) => (
                      <li key={x.id}>
                        <div>
                          <strong>{x.label}</strong>
                          {x.detail ? <span className="ph-fix-detail"> {x.detail}</span> : null}
                          {x.changes_plan && mission && mission.state !== "draft" ? <span className="ph-fix-detail"> Changes the plan: it goes back to draft for review.</span> : null}
                        </div>
                        {editable && canPlan ? (
                          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void applyFix(x)}>
                            {x.kind === "preheat" ? "Add to launch tasks" : "Apply"}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!editable ? <p className="meta">This plan has flown or is flying, so the check is a look back: fixes apply to plans not yet launched.</p> : !canPlan ? <p className="meta">Planners and mission commanders apply fixes; you can see them.</p> : null}
      </section>

      <div className="ph-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Link over the terrain</h2>
            <span className="meta">
              C2 {check.bands.find((b) => b.id === check.band)?.label} · video 5.8 GHz
            </span>
          </div>
          <LinkMap check={check} selected={sel?.tail ?? ""} />
          <p className="ins-legend">
            <span className="ins-key" style={{ background: "var(--ok)" }} /> Video holds 10 dB or more <span className="ins-key" style={{ background: "var(--warn)" }} /> Under 10 dB <span className="ins-key" style={{ background: "var(--danger)" }} /> No video
          </p>
          {check.profile ? <Profile p={check.profile} /> : null}
          <table className="ph-table">
            <thead>
              <tr>
                <th>Tail</th>
                <th>No video</th>
                <th>C2 under 10 dB</th>
                <th>C2 lost</th>
                <th>Worst C2</th>
              </tr>
            </thead>
            <tbody>
              {check.tails.map((t) => (
                <tr key={t.tail} className={t.tail === sel?.tail ? "ph-row-sel" : ""} onClick={() => setTail(t.tail)}>
                  <td>{t.tail}</td>
                  <td>{t.link.video_lost_s ? fmtMin(t.link.video_lost_s) : "–"}</td>
                  <td>{t.link.c2_thin_s ? fmtMin(t.link.c2_thin_s) : "–"}</td>
                  <td>{t.link.c2_lost_s ? fmtMin(t.link.c2_lost_s) : "–"}</td>
                  <td style={{ color: marginColor(t.link.c2_min_db ?? 0) }}>{t.link.c2_min_db ?? "–"} dB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Packs in the cold</h2>
            {sel ? (
              <select value={sel.tail} onChange={(e) => setTail(e.target.value)} aria-label="Airframe">
                {check.tails.map((t) => (
                  <option key={t.tail} value={t.tail}>
                    {t.tail} · {t.airframe}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {sel ? <PackChart t={sel} /> : null}
          <table className="ph-table">
            <thead>
              <tr>
                <th>Tail</th>
                <th>Pack</th>
                <th>Climb-out, full climb</th>
                <th>Lowest</th>
                <th>Preheat</th>
              </tr>
            </thead>
            <tbody>
              {check.tails.map((t) => {
                const pre = t.pack.preheat;
                const side = pre.done ? t.pack.warm : t.pack.cold;
                return (
                  <tr key={t.tail} className={t.tail === sel?.tail ? "ph-row-sel" : ""} onClick={() => setTail(t.tail)}>
                    <td>{t.tail}</td>
                    <td>
                      {t.pack.label}, {t.pack.start_pct}%
                    </td>
                    <td style={{ color: (side.climb_out_punch_v ?? 9) < t.pack.cutoff_v ? "var(--danger)" : undefined }}>{side.climb_out_punch_v !== null && side.climb_out_punch_v < 2.5 ? "collapses" : `${side.climb_out_punch_v} V`}</td>
                    <td>{side.min_v} V</td>
                    <td>{pre.done ? `planned, out at ${pre.out_c} °C` : pre.needed ? (pre.launch_c === null ? "not enough" : `to ${pre.out_c} °C, ${pre.warm_min} min`) : "not needed"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="meta ins-note">
            Cells per volt under load, cutoff at {sel?.pack.cutoff_v} V. Resistance follows Arrhenius (about 3x at -10 °C), the pack heats with I²R and cools in the airflow. A full climb is 80% of available thrust. Preheating buys the climb-out; the thermal mass gives it back within about ten minutes.
          </p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Thrust in hand</h2>
            <span className="meta">Dryden 3σ gusts, density altitude, pack voltage</span>
          </div>
          <ul className="ph-bars">
            {check.tails.map((t) => (
              <li key={t.tail}>
                <span className="ph-bar-label">{t.tail}</span>
                <span className="ph-bar">
                  <span className={`ph-bar-fill ph-v-${t.thrust.verdict}`} style={{ width: `${Math.max(2, Math.min(100, t.thrust.headroom * 100))}%` }} />
                  <span className="ph-bar-mark" style={{ left: "30%" }} />
                </span>
                <span className="ph-bar-value">
                  {Math.round(t.thrust.headroom * 100)}% · tilt {t.thrust.tilt_gust_deg}° · go to {t.thrust.max_wind_mps} m/s
                </span>
              </li>
            ))}
          </ul>
          {check.envelope ? <Envelope e={check.envelope} /> : null}
          {sel ? (
            <p className="meta ins-note">
              {sel.tail}: {sel.thrust.thrust_gust_n} N needed in a {sel.thrust.gust_mps} m/s gust of {sel.thrust.thrust_max_n} N available, at density altitude {sel.thrust.density_altitude_m} m on {sel.thrust.cell_v} V per cell. Thrust falls with air density and with the square of pack voltage, so a cold pack closes the envelope as surely as thin air.
            </p>
          ) : null}
        </section>
      </div>
      <p className="ins-source">{check.source}</p>
    </section>
  );
}

function LinkMap({ check, selected }: { check: Check; selected: string }) {
  const paths: MapPath[] = [];
  const markers: MapMarker[] = [];
  for (const t of check.tails) {
    // Split the track into runs of the same video margin class so the colour follows the link.
    let run: [number, number][] = [];
    let cls = "";
    const flush = (k: number) => {
      if (run.length > 1) paths.push({ id: `${t.tail}-${k}`, color: cls, pts: run, faded: selected !== "" && t.tail !== selected });
    };
    t.track.forEach(([x, y, , video], k) => {
      const c = marginColor(video);
      if (c !== cls && run.length) {
        run.push([x, y]);
        flush(k);
        run = [];
      }
      cls = c;
      run.push([x, y]);
    });
    flush(t.track.length);
    const last = t.track[Math.floor(t.track.length / 2)];
    if (last) markers.push({ id: t.tail, label: t.tail, x: last[0], y: last[1], color: t.tail === selected ? "var(--accent)" : "#c9d4df", dim: selected !== "" && t.tail !== selected });
  }
  for (const r of check.relays) markers.push({ id: `relay-${r.tail}`, label: `${r.tail} relay`, x: r.x, y: r.y, color: "#b6a5ff" });
  return (
    <div className="ph-map">
      <RangeMap range={check.range} paths={paths} markers={markers} label="Planned tracks coloured by video link margin over the terrain">
        {check.emitter.on ? (
          <g>
            <circle cx={check.emitter.x} cy={-check.emitter.y} r={120} className="ph-emitter" />
            <text x={check.emitter.x + 160} y={-check.emitter.y + 40} className="rm-place-label" fontSize={70}>
              {check.emitter.label}
            </text>
          </g>
        ) : null}
      </RangeMap>
    </div>
  );
}

function Profile({ p }: { p: NonNullable<Check["profile"]> }) {
  const W = 640;
  const H = 170;
  const lo = Math.min(...p.rows.map((r) => r.ground_m)) - 10;
  const hi = Math.max(...p.rows.map((r) => Math.max(r.ground_m, r.los_m))) + 15;
  const sx = (d: number) => (d / Math.max(1, p.distance_m)) * W;
  const sy = (z: number) => H - ((z - lo) / Math.max(1, hi - lo)) * H;
  const ground = `M0,${H} ${p.rows.map((r) => `L${sx(r.d_m)},${sy(r.ground_m)}`).join(" ")} L${W},${H} Z`;
  const los = p.rows.map((r, i) => `${i ? "L" : "M"}${sx(r.d_m)},${sy(r.los_m)}`).join(" ");
  const fz = p.rows.map((r, i) => `${i ? "L" : "M"}${sx(r.d_m)},${sy(r.fresnel60_m)}`).join(" ");
  return (
    <figure className="ph-profile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Terrain profile from ${p.from} to ${p.tail} at ${p.to}`} preserveAspectRatio="none">
        <path d={ground} className="ph-ground" />
        <path d={fz} className="ph-fresnel" vectorEffect="non-scaling-stroke" />
        <path d={los} className="ph-los" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="meta">
        Worst video point: {p.from} to {p.tail} at {p.to}, {(p.distance_m / 1000).toFixed(1)} km. Line of sight (solid) and the 60% Fresnel line (dashed) against the ground; clearance {p.clearance_f1} of the first Fresnel zone, {p.diffraction_db} dB lost to diffraction.
      </figcaption>
    </figure>
  );
}

function PackChart({ t }: { t: TailCheck }) {
  const W = 640;
  const H = 170;
  const rows = t.pack.trace;
  if (!rows.length) return null;
  const T = rows.at(-1)!.t || 1;
  const vs = rows.flatMap((r) => [r.v, r.v_warm ?? r.v]);
  const lo = Math.min(t.pack.cutoff_v - 0.2, ...vs);
  const hi = Math.max(...vs) + 0.05;
  const sx = (s: number) => (s / T) * W;
  const sy = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (pick: (r: (typeof rows)[number]) => number | null) =>
    rows
      .filter((r) => pick(r) !== null)
      .map((r, i) => `${i ? "L" : "M"}${sx(r.t)},${sy(pick(r) as number)}`)
      .join(" ");
  const warm = rows.some((r) => r.v_warm !== null);
  return (
    <figure className="ph-profile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.tail} cell voltage through the sortie, cold-soaked and preheated`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={sy(t.pack.cutoff_v)} y2={sy(t.pack.cutoff_v)} className="ph-cutoff" vectorEffect="non-scaling-stroke" />
        <path d={line((r) => r.v)} className="ph-cold" vectorEffect="non-scaling-stroke" />
        {warm ? <path d={line((r) => r.v_warm)} className="ph-warm" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <figcaption className="meta">
        {t.tail} volts per cell over {t.minutes} min: cold-soaked at launch (blue){warm ? `, preheated to ${t.pack.preheat.launch_c ?? 35} °C (amber)` : ""}, cutoff {t.pack.cutoff_v} V (red). The pack ends at {t.pack.cold.end_temp_c} °C cold-soaked; it warms itself in flight.
      </figcaption>
    </figure>
  );
}

function Envelope({ e }: { e: NonNullable<Check["envelope"]> }) {
  const cw = 100 / e.winds.length;
  const ch = 100 / e.temps.length;
  const temps = [...e.temps].reverse();
  const nearT = e.temps.reduce((a, b) => (Math.abs(b - e.now.temp_c) < Math.abs(a - e.now.temp_c) ? b : a), e.temps[0] ?? 0);
  const nearW = e.winds.reduce((a, b) => (Math.abs(b - e.now.wind_mps) < Math.abs(a - e.now.wind_mps) ? b : a), e.winds[0] ?? 0);
  return (
    <figure className="ph-envelope">
      <div className="ph-env-grid" role="img" aria-label={`${e.airframe} envelope: thrust in hand by air temperature and steady wind`}>
        {temps.map((t, ti) =>
          e.winds.map((w, wi) => {
            const c = e.cells.find((x) => x.temp_c === t && x.wind_mps === w);
            const now = t === nearT && w === nearW;
            return (
              <span
                key={`${t}-${w}`}
                className={`ph-env-cell ph-v-${c?.verdict ?? "go"}${now ? " ph-env-now" : ""}`}
                style={{ left: `${wi * cw}%`, top: `${ti * ch}%`, width: `${cw}%`, height: `${ch}%` }}
                title={`${t} °C, ${w} m/s: ${Math.round((c?.headroom ?? 0) * 100)}% in hand`}
              >
                {Math.round((c?.headroom ?? 0) * 100)}
              </span>
            );
          }),
        )}
      </div>
      <figcaption className="meta">
        {e.airframe} ({e.tail}): % of thrust in hand by air temperature (rows, {temps[0]} °C at the top) and steady wind (columns, {e.winds[0]} to {e.winds.at(-1)} m/s), pack cold-soaked at half charge. The outlined cell is tonight.
      </figcaption>
    </figure>
  );
}
