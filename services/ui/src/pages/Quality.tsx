import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, pct, SerialDrawer, Stat, usePageData } from "./thread";

interface Signal { part: string; lot: string; pn: string; supplier: string | null; sorties: number; faults: number; rate: number; baseline: number; ratio: number; p_value: number; flagged: boolean; held: boolean; action: string | null }
interface Supplier { id: string; name: string; commodity: string; incoming_ppm: number; on_time: number; ndaa: string; field_sorties: number; field_faults: number; per_1000: number | null; worst_lot: { lot: string; ratio: number; flagged: boolean } | null; open_actions: string[]; tracked: boolean }
interface Action { id: string; lot: string; pn: string; supplier: string; status: string; opened: string; closed?: string; by: string; evidence: string }
interface Quality {
  source: string; today: string; sharing: Record<string, boolean>; shared_sorties: number;
  acceptance: { lots: number; serials: number; rate: number | null; first_pass: number | null; mean_days: number | null; waiting: number; program: { rate: number; label: string } };
  lots_waiting: { id: string; customer: string; qty: number; name: string; days_waiting: number; failing: number }[];
  replacements: { lot: string; serial: string; reason: string }[];
  signals: Signal[]; suppliers: Supplier[]; actions: Action[];
  sampling: { current: string; recommend: string; ok: boolean; sorties: number; faults: number; rate: number | null; upper_95: number; threshold: number; excluded_lots: string[]; hours_saved_per_day: number; assumptions: string };
}

const PART: Record<string, string> = { esc: "ESC", motor: "Motor", fc: "Flight controller", vtx: "Video transmitter", frame: "Frame" };

/** Neros quality: customer field outcomes joined to factory genealogy, by lot and supplier. */
export function QualityPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Quality>("/v1/thread/quality", onBanner);
  const [all, setAll] = useState(false);
  const [serial, setSerial] = useState<string | null>(null);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.roles.some((r) => r === "admin" || r === "ops_lead");
  const disabled = !canAct || page.busy;
  const rows = all ? d.signals : d.signals.filter((s) => s.faults > 0).slice(0, 10);
  const go = (action: string, args: Record<string, unknown>) => void page.post("/v1/thread/act", action, args);

  return (
    <section className="page ins-page co-page ops-page" data-testid="quality">
      <PageHead
        kicker="Neros operations"
        title="Quality"
        lede="What customers find at receiving and in the field, joined to how each airframe was built. A lot or supplier out of family raises a corrective action or a hold; clean field evidence says where end-of-line flight test can move to sampling."
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      {!canAct ? <p className="meta">You can see this page; acting on it needs the Neros ops lead or admin role.</p> : null}

      <div className="th-stats">
        <Stat label="Accepted by customers, by serial" value={pct(d.acceptance.rate, 1)} hint={`${d.acceptance.serials} serials in ${d.acceptance.lots} lots`} />
        <Stat label="Program comparison" value={pct(d.acceptance.program.rate)} hint={d.acceptance.program.label} />
        <Stat label="Days from ship to decision" value={d.acceptance.mean_days == null ? "—" : d.acceptance.mean_days.toFixed(1)} />
        <Stat label="Shared field sorties" value={String(d.shared_sorties)} hint={Object.entries(d.sharing).map(([k, v]) => `${k.replace("CUS-", "Customer ")} ${v ? "shares" : "does not share"}`).join(" · ")} />
      </div>

      {d.lots_waiting.length || d.replacements.length ? (
        <section className="panel">
          <div className="panel-head">
            <h2>At customer receiving</h2>
          </div>
          <ul className="ops-req">
            {d.lots_waiting.map((l) => (
              <li key={l.id}>
                <span className="mono">{l.id}</span> {l.qty} {l.name} with {l.customer}, waiting {l.days_waiting} days
                {l.failing ? <span className="pill pill-warn">{l.failing} fail a check</span> : <span className="pill pill-ok">All checks pass</span>}
              </li>
            ))}
            {d.replacements.map((r) => (
              <li key={r.serial}>
                <button type="button" className="th-link" onClick={() => setSerial(r.serial)}>{r.serial}</button> rejected on {r.lot}: {r.reason}
                <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => go("rejects.replace", { lot: r.lot })}>Ship replacement</button>
              </li>
            ))}
          </ul>
          <p className="meta">A serial that fails a check here was missed at the factory. Each one is a finding against the line, not just a replacement.</p>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Field faults by component lot</h2>
          <button type="button" className="btn btn-quiet" onClick={() => setAll(!all)}>{all ? "Lots with faults only" : "Every lot"}</button>
        </div>
        <div className="table-wrap">
          <table data-testid="quality-lots">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Part</th>
                <th>Supplier</th>
                <th>Sorties</th>
                <th>Faults</th>
                <th>Rate</th>
                <th>Other lots</th>
                <th>p</th>
                <th>Status</th>
                <th>Act</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={`${s.part}-${s.lot}`} className={s.flagged ? "th-row-fail" : undefined}>
                  <td className="mono">{s.lot}</td>
                  <td>{PART[s.part] ?? s.part}</td>
                  <td>{d.suppliers.find((x) => x.id === s.supplier)?.name.split(" (")[0] ?? "—"}</td>
                  <td className="mono">{s.sorties}</td>
                  <td className="mono">{s.faults}</td>
                  <td className="mono">{pct(s.rate, 1)}</td>
                  <td className="mono">{pct(s.baseline, 1)}</td>
                  <td className="mono">{s.p_value < 0.001 ? "<0.001" : s.p_value.toFixed(3)}</td>
                  <td>
                    {s.flagged ? <span className="pill pill-warn">{s.ratio}x, out of family</span> : <span className="meta">In family</span>}
                    {s.held ? <span className="pill">Held</span> : null}
                    {s.action ? <span className="pill">{s.action}</span> : null}
                  </td>
                  <td>
                    <span className="th-inline">
                      {s.flagged && !s.action ? <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => go("quality.action", { lot: s.lot })}>Open supplier action</button> : null}
                      {s.flagged && !s.held ? <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => go("quality.hold", { lot: s.lot })}>Hold the lot</button> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">A fault counts against a lot when its code points at that part (an ESC desync against the ESC lot). Out of family means at least 5 faults, 1.5 times the other lots, and p under 0.01 on a Poisson test. A hold restricts every airframe that carries the lot, in customer fleets and in factory stock.</p>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Supplier scorecard</h2>
          </div>
          <div className="table-wrap">
            <table data-testid="quality-suppliers">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Field faults per 1,000 sorties</th>
                  <th>Incoming ppm</th>
                  <th>On time</th>
                  <th>NDAA</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.suppliers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="mono">
                      {s.per_1000 ?? <span className="meta">No field signal</span>}
                      {s.worst_lot?.flagged ? <span className="pill pill-warn">{s.worst_lot.lot}</span> : null}
                    </td>
                    <td className="mono">{s.incoming_ppm}</td>
                    <td className="mono">{pct(s.on_time)}</td>
                    <td>{s.ndaa}</td>
                    <td className="mono">{s.open_actions.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">Incoming ppm is what the factory finds at the dock; field faults are what customers find in flight. A supplier can look fine at the dock and not in the field.</p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>End-of-line flight test</h2>
          </div>
          <div className={`th-callout ${d.sampling.ok ? "is-ok" : ""}`} data-testid="sampling">
            <p><strong>{d.sampling.recommend}</strong></p>
            <p className="meta">
              Now: {d.sampling.current}. Clean-lot evidence: {d.sampling.faults} hardware faults in {d.sampling.sorties} shared sorties ({pct(d.sampling.rate, 1)}); the 95% upper bound is {pct(d.sampling.upper_95, 1)} against a {pct(d.sampling.threshold)} threshold.
              {d.sampling.excluded_lots.length ? ` Lots under action or hold stay at 100%: ${d.sampling.excluded_lots.join(", ")}.` : ""}
            </p>
            {d.sampling.ok ? <p className="meta">About {d.sampling.hours_saved_per_day} bench hours a day freed. {d.sampling.assumptions}.</p> : null}
          </div>
          <div className="panel-head">
            <h2>Supplier corrective actions</h2>
          </div>
          {d.actions.length === 0 ? <p className="meta">None open. Open one from a flagged lot above.</p> : null}
          <ul className="ops-req">
            {d.actions.map((a) => (
              <li key={a.id}>
                <span className="mono">{a.id}</span> {a.lot} ({a.pn}): {a.evidence}
                <span className={a.status === "open" ? "pill pill-warn" : "pill pill-ok"}>{a.status}</span>
                {a.status === "open" ? <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => go("quality.close", { id: a.id })}>Close</button> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {serial ? <SerialDrawer serial={serial} onClose={() => setSerial(null)} /> : null}
    </section>
  );
}
