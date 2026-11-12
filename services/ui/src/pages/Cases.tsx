import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, pct, Stat, usePageData } from "./thread";
import "./market.css";

interface Arm { n: number; k: number; rate: number | null }
interface Measurement {
  ready: boolean; improved: boolean; did: number | null; z: number | null; verdict: string;
  partner: { unit: string; before: Arm; after: Arm }; control: { units: string[]; before: Arm; after: Arm };
}
interface Case {
  id: string; theme: string; title: string; metric: string; reported: string; partner: string; status: string; engineer: string | null; change: string | null;
  shipped: string | null; closed: string | null; trial_days: number; measurement: Measurement | null; measured: boolean; days_to_fix: number | null; history: { day: string; what: string }[];
}
interface CasesView {
  source: string; today: string; rule: { before_days: number; min_after: number; z: number; trial_days_per_collect: number }; units: string[];
  cases: Case[]; stats: { open: number; closed: number; median_days: number | null; awaiting_data: number };
  themes: { theme: string; label: string; count: number; units: string[]; latest: string; concentrated: boolean; has_case: boolean }[];
  engineers: string[];
}

const STATE: Record<string, string> = { open: "is-fail", assigned: "is-warn", shipped: "is-warn", closed: "is-ok" };

/** Field reports become cases; a case closes only when the records show the change worked. */
export function CasesPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<CasesView>("/v1/cases", onBanner);
  const [form, setForm] = useState<Record<string, { engineer?: string; change?: string }>>({});
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = !viewer.org || viewer.roles.some((r) => ["admin", "ops_lead"].includes(r));
  const post = (action: string, args: Record<string, unknown>) => page.post("/v1/market/act", action, args);
  const f = (id: string) => form[id] ?? {};

  return (
    <section className="page ins-page co-page ops-page" data-testid="cases">
      <PageHead
        kicker="Neros analysis"
        title="Field fixes"
        lede="A field report becomes a case with an engineer and a partner unit. A change ships to that unit, and the case closes only when its end-of-flight records improve more than the units that did not get the change. Closing a ticket is not fixing a drone."
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />

      <div className="th-stats">
        <Stat label="Open cases" value={String(d.stats.open)} hint={`${d.stats.awaiting_data} waiting on field data`} />
        <Stat label="Closed with a measured effect" value={String(d.stats.closed)} />
        <Stat label="Report to measured fix" value={d.stats.median_days == null ? "—" : `${d.stats.median_days} days`} hint="Median, closed cases" />
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Cases</h2></div>
        <ul className="ops-list" data-testid="case-list">
          {d.cases.map((c) => {
            const m = c.measurement;
            return (
              <li key={c.id} className="ops-item" data-testid={`case-${c.id}`}>
                <div className="ops-item-head">
                  <span className="ops-title">{c.id}: {c.title}</span>
                  <span className={`th-check ${STATE[c.status] ?? ""}`}>{c.status}</span>
                </div>
                <p className="ops-detail">
                  Reported {c.reported}. Partner unit {c.partner}. Measured by {c.metric}. {c.engineer ? `Engineer: ${c.engineer}.` : "No engineer yet."}
                  {c.change ? ` Change: ${c.change}, shipped ${c.shipped}.` : ""}
                  {c.days_to_fix != null ? ` Fixed and measured in ${c.days_to_fix} days.` : ""}
                </p>
                {m && c.shipped ? (
                  <div className="table-wrap" tabIndex={0}>
                    <table className="mk-did">
                      <thead><tr><th /><th>Before ({d.rule.before_days} days)</th><th>After ({c.trial_days} days)</th></tr></thead>
                      <tbody>
                        <tr><td>{m.partner.unit} (got the change)</td><td className="mono">{pct(m.partner.before.rate, 1)} of {m.partner.before.n}</td><td className="mono">{pct(m.partner.after.rate, 1)} of {m.partner.after.n}</td></tr>
                        <tr><td>{m.control.units.join(", ")} (control)</td><td className="mono">{pct(m.control.before.rate, 1)} of {m.control.before.n}</td><td className="mono">{pct(m.control.after.rate, 1)} of {m.control.after.n}</td></tr>
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {m && c.shipped ? <p className={`th-callout ${m.improved ? "is-ok" : "is-bad"}`}>{m.verdict}</p> : null}
                {c.status !== "closed" ? (
                  <div className="ops-actions">
                    {!c.engineer || c.status === "open" ? (
                      <span className="mk-inline">
                        <select aria-label={`Engineer for ${c.id}`} value={f(c.id).engineer ?? d.engineers[0]} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), engineer: e.target.value } })}>
                          {d.engineers.map((x) => <option key={x}>{x}</option>)}
                        </select>
                        <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("case.assign", { id: c.id, engineer: f(c.id).engineer ?? d.engineers[0] })}>Assign</button>
                      </span>
                    ) : null}
                    {c.engineer ? (
                      <span className="mk-inline">
                        <input aria-label={`Change for ${c.id}`} placeholder="What changed, e.g. firmware 1.15.5 canary" value={f(c.id).change ?? ""} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), change: e.target.value } })} />
                        <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy || !(f(c.id).change ?? "").trim()} title={!canAct ? "Shipping a fix needs the ops lead or admin role" : !(f(c.id).change ?? "").trim() ? "Describe the change first" : undefined} onClick={() => void post("case.ship", { id: c.id, change: f(c.id).change }).then((ok) => ok && setForm({ ...form, [c.id]: {} }))}>{c.shipped ? "Ship another change" : `Ship to ${c.partner}`}</button>
                      </span>
                    ) : null}
                    {c.shipped ? <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("case.collect", { id: c.id })}>Add {d.rule.trial_days_per_collect} days of field sorties (SIM)</button> : null}
                    {c.shipped ? <button type="button" className="btn" disabled={!canAct || page.busy} onClick={() => void post("case.close", { id: c.id })}>Close on the measurement</button> : null}
                  </div>
                ) : null}
                <ul className="ops-req">{c.history.map((h, i) => <li key={i}><span className="mono">{h.day}</span> {h.what}</li>)}</ul>
              </li>
            );
          })}
        </ul>
        <p className="meta">The measure is a difference in differences: the partner unit's change in rate, less the control units' change over the same window. A case closes when the improvement reaches z ≤ −{d.rule.z} (one-sided 90%) with at least {d.rule.min_after} sorties after the change on each side.</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Field-report themes</h2></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="case-themes">
            <thead><tr><th>Theme</th><th>Reports</th><th>Units</th><th>Latest</th><th /></tr></thead>
            <tbody>
              {d.themes.map((t) => (
                <tr key={t.theme}>
                  <td>{t.label}{t.concentrated ? <span className="th-check is-warn"> On one build</span> : null}</td>
                  <td className="mono">{t.count}</td>
                  <td>{t.units.join(", ")}</td>
                  <td className="mono">{t.latest.slice(0, 10)}</td>
                  <td>{t.has_case ? <span className="meta">Case open</span> : <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("case.open", { theme: t.theme })}>Open a case</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
