// The plan's physics, where the plan is made: the launch conditions a planner
// sets, the findings and fixes inside Launch checks, and the packs and thrust
// beside the plan map. Missions.tsx owns the state; these draw it.
import { useState } from "react";
import { AREA_LABEL, COMPASS, Envelope, PackChart, Profile, ThrustBars, compassOf, fmtMin, type Finding, type Fix, type PhysicsCheck } from "./physics-parts";

export type Ask = { temp_c?: number; wind_mps?: number; wind_from_deg?: number; gust_mps?: number; ew?: boolean };

/** Air temperature, wind, gusts and the EW emitter the plan is checked against, with a what-if the planner can save. */
export function ConditionsPanel({ check, ask, setAsk, canSave, busy, onSave }: { check: PhysicsCheck; ask: Ask; setAsk: (f: (a: Ask) => Ask) => void; canSave: boolean; busy: boolean; onSave: () => void }) {
  const f = check.forecast;
  const whatIf = Object.keys(ask).length > 0;
  return (
    <section className="panel" data-testid="plan-conditions">
      <div className="panel-head">
        <h2>Conditions at launch</h2>
        {whatIf ? <span className="pill pill-warn">What-if</span> : <span className="meta">Saved forecast</span>}
      </div>
      <div className="ph-controls">
        <label>
          Air <strong>{f.temp_c} °C</strong>
          <input type="range" min={-25} max={40} step={1} value={f.temp_c} onChange={(e) => setAsk((a) => ({ ...a, temp_c: Number(e.target.value) }))} aria-label="Air temperature" />
        </label>
        <label>
          Wind <strong>{f.wind_mps} m/s</strong>
          <input type="range" min={0} max={16} step={1} value={f.wind_mps} onChange={(e) => setAsk((a) => ({ ...a, wind_mps: Number(e.target.value), gust_mps: Math.max(Number(e.target.value), a.gust_mps ?? f.gust_mps) }))} aria-label="Wind speed" />
        </label>
        <label className="ph-from">
          Wind from <strong>{compassOf(f.wind_from_deg)}</strong>
          <select value={Math.round(f.wind_from_deg / 45) % 8} onChange={(e) => setAsk((a) => ({ ...a, wind_from_deg: Number(e.target.value) * 45 }))} aria-label="Wind direction">
            {COMPASS.map((c, i) => (
              <option key={c} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gusts <strong>{f.gust_mps} m/s</strong>
          <input type="range" min={0} max={24} step={1} value={f.gust_mps} onChange={(e) => setAsk((a) => ({ ...a, gust_mps: Number(e.target.value) }))} aria-label="Gust speed" />
        </label>
        <label className="dm-check">
          <input type="checkbox" checked={f.ew} onChange={(e) => setAsk((a) => ({ ...a, ew: e.target.checked }))} /> EW emitter on (900 MHz, 2.4 GHz)
        </label>
      </div>
      {whatIf ? (
        <p className="ph-whatif">
          Launch checks below use this what-if, not the saved forecast.{" "}
          {canSave ? (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={onSave}>
              Save to plan
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={() => setAsk(() => ({}))}>
            Reset
          </button>
        </p>
      ) : (
        <p className="meta">The terrain, pack, thrust and wind checks fly the plan in this air. Move a slider to ask what if.</p>
      )}
    </section>
  );
}

/** Physics findings as launch-check rows, each with its fixes and an Apply button for planners. */
export function PhysicsFindings({ check, state, canFix, busy, onApply, onFocus }: { check: PhysicsCheck; state: string; canFix: boolean; busy: boolean; onApply: (fix: Fix) => void; onFocus: (f: Finding) => void }) {
  if (!check.findings.length) return null;
  return (
    <ul className="ph-findings ms-ph-findings" data-testid="physics-findings">
      {check.findings.map((fd) => (
        <li key={fd.id} className={`ph-finding ph-sev-${fd.severity}`}>
          <div className="ph-finding-head">
            {/* Physics findings advise; they never block a launch, so the launch checks show them as cautions. */}
            <span className={`ms-lv ms-lv-${fd.severity === "info" ? "go" : "caution"}`}>{fd.severity === "info" ? "go" : "caution"}</span>
            <span className="ph-area">{AREA_LABEL[fd.area]}</span>
            <button type="button" className="ph-title" onClick={() => onFocus(fd)}>
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
                    {x.changes_plan && state !== "draft" ? <span className="ph-fix-detail"> Changes the plan: it goes back to draft for review.</span> : null}
                  </div>
                  {canFix ? (
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onApply(x)}>
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
  );
}

/** The plan's link table and worst terrain profile, under the plan map when it shows the video link. */
export function LinkDetail({ check, tail, setTail }: { check: PhysicsCheck; tail: string; setTail: (t: string) => void }) {
  return (
    <>
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
            <tr key={t.tail} className={t.tail === tail ? "ph-row-sel" : ""} onClick={() => setTail(t.tail)}>
              <td>{t.tail}</td>
              <td>{t.link.video_lost_s ? fmtMin(t.link.video_lost_s) : "–"}</td>
              <td>{t.link.c2_thin_s ? fmtMin(t.link.c2_thin_s) : "–"}</td>
              <td>{t.link.c2_lost_s ? fmtMin(t.link.c2_lost_s) : "–"}</td>
              <td>{t.link.c2_min_db ?? "–"} dB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** What the terrain makes of the wind for each tail, under the plan map when it shows the wind. */
export function WindDetail({ check, tail, setTail }: { check: PhysicsCheck; tail: string; setTail: (t: string) => void }) {
  const f = check.forecast;
  const at = (s: { label: string; home: boolean }) => (s.home ? "on the way home" : s.label);
  return (
    <>
      <table className="ph-table" data-testid="plan-wind">
        <thead>
          <tr>
            <th>Tail</th>
            <th>Strongest wind</th>
            <th>Worst sink</th>
            <th>In sink</th>
            <th>Terrain costs</th>
            <th>Thrust in hand</th>
          </tr>
        </thead>
        <tbody>
          {check.tails.map((t) => {
            const w = t.wind;
            if (!w) return null;
            return (
              <tr key={t.tail} className={t.tail === tail ? "ph-row-sel" : ""} onClick={() => setTail(t.tail)}>
                <td>{t.tail}</td>
                <td>
                  {w.max_mps} m/s, {at(w.max_at)}
                </td>
                <td style={{ color: w.worst_sink_mps <= -2 ? "var(--danger)" : w.worst_sink_mps <= -1 ? "var(--warn)" : undefined }}>
                  {w.worst_sink_mps < 0 ? `${Math.abs(w.worst_sink_mps)} m/s, ${at(w.sink_at)}` : "none"}
                </td>
                <td>{w.sink_s ? fmtMin(w.sink_s) : "–"}</td>
                <td>
                  {w.extra_wh} Wh ({w.extra_pct}%)
                </td>
                <td className={`ph-v-${w.verdict}`}>{Math.round(w.headroom * 100)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="meta ins-note">
        Forecast {f.wind_mps} m/s from the {compassOf(f.wind_from_deg)} at 10 m; {check.wind?.free_mps ?? f.wind_mps} m/s at {check.wind?.agl_m ?? 100} m over open ground. Over a crest the air speeds up about 2 H/L and that fades with height; on a lee slope it descends with the ground, and a vehicle holding height there is climbing through it. Sink counts under {check.wind?.sink_mps ?? 1} m/s. Assumed coefficients over SRTM terrain, not measured; the model does not turn the wind round hills.
      </p>
    </>
  );
}

/** Each tail's pack through the sortie and the thrust it keeps in hand, beside the plan. */
export function PacksThrustPanel({ check, tail, setTail }: { check: PhysicsCheck; tail: string; setTail: (t: string) => void }) {
  const [showEnvelope, setShowEnvelope] = useState(false);
  const sel = check.tails.find((t) => t.tail === tail) ?? check.tails[0];
  if (!sel) return null;
  const f = check.forecast;
  return (
    <section className="panel" data-testid="plan-packs">
      <div className="panel-head">
        <h2>Packs and thrust at {f.temp_c} °C</h2>
        <select value={sel.tail} onChange={(e) => setTail(e.target.value)} aria-label="Airframe">
          {check.tails.map((t) => (
            <option key={t.tail} value={t.tail}>
              {t.tail} · {t.airframe}
            </option>
          ))}
        </select>
      </div>
      <PackChart t={sel} />
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
              <tr key={t.tail} className={t.tail === sel.tail ? "ph-row-sel" : ""} onClick={() => setTail(t.tail)}>
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
      <h3 className="ms-subhead">Thrust in hand in a gust</h3>
      <ThrustBars rows={check.tails.map((t) => ({ tail: t.tail, headroom: t.thrust.headroom, verdict: t.thrust.verdict, detail: `${Math.round(t.thrust.headroom * 100)}% · tilt ${t.thrust.tilt_gust_deg}° · go to ${t.thrust.max_wind_mps} m/s` }))} />
      {check.envelope ? (
        <p className="meta">
          <button type="button" className="btn btn-quiet" onClick={() => setShowEnvelope((v) => !v)} aria-expanded={showEnvelope}>
            {showEnvelope ? "Hide" : "Show"} the {check.envelope.airframe} envelope
          </button>
        </p>
      ) : null}
      {showEnvelope && check.envelope ? <Envelope e={check.envelope} /> : null}
      <p className="meta ins-note">
        Cells per volt under load, cutoff at {sel.pack.cutoff_v} V. Resistance rises about 3x by -10 °C, the pack heats itself and cools in the airflow; a full climb is 80% of available thrust. Thrust falls with air density and the square of pack voltage, against Dryden 3σ gusts.
        {sel.thrust ? ` ${sel.tail} needs ${sel.thrust.thrust_gust_n} N of ${sel.thrust.thrust_max_n} N in a ${sel.thrust.gust_mps} m/s gust at density altitude ${sel.thrust.density_altitude_m} m.` : ""} Assumed coefficients, not measured.
      </p>
    </section>
  );
}
