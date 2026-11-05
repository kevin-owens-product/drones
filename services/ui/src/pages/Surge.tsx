import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./market.css";

interface Part { pn: string; name: string; need: number; on_hand: number; from_po: { po: string; qty: number; due: string }[]; to_order: number; ready: string; lead_days: number; supplier: string }
interface Option {
  label: string; date: string; meets: boolean | null; material_ready: string; line_free: string; line_rate_per_day: number; build_days: number;
  binding: { what: string; why: string }; parts: Part[]; cost: { expedite_usd: number; second_shift_usd: number; total_usd: number };
}
interface SurgeView {
  source: string; today: string; second_shift: boolean;
  lines: { sku: string; name: string; rate: number; backlog: number; free: string }[];
  ask: { sku: string; name: string; qty: number; by: string | null; options: Option[]; recommended: string | null; verdict: string | null };
  raised: { po: string; pn: string; qty: number; for: string; at: string }[];
  presets: { label: string; sku: string; qty: number; by: string }[];
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Can the line build N by a date, what binds it, and what beating the date costs. */
export function SurgePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const [ask, setAsk] = useState({ sku: "ARCHER-5", qty: 400, by: "2026-12-29" });
  const page = usePageData<SurgeView>(`/v1/surge?sku=${ask.sku}&qty=${ask.qty}&by=${ask.by}`, onBanner);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = !viewer.org || viewer.roles.some((r) => ["admin", "ops_lead"].includes(r));
  const plain = d.ask.options[0];
  const binding = plain?.parts.find((p) => p.pn === plain.binding.what);

  return (
    <section className="page ins-page co-page ops-page" data-testid="surge">
      <PageHead
        kicker="Neros commercial"
        title="Surge planner"
        lede="Can the line build this many by that date? The answer joins released stock after open orders take theirs, open purchase orders, part lead times and the line rate, and names what binds. Expediting and a second shift are the levers, and each shows what it costs."
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />

      <section className="panel">
        <div className="panel-head">
          <h2>The ask</h2>
          <div className="ops-filter">
            {d.presets.map((p) => (
              <button key={p.label} type="button" className={ask.sku === p.sku && ask.qty === p.qty && ask.by === p.by ? "ops-chip is-on" : "ops-chip"} onClick={() => setAsk({ sku: p.sku, qty: p.qty, by: p.by })}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="mk-form">
          <label className="mk-field">Airframe
            <select aria-label="Airframe" value={ask.sku} onChange={(e) => setAsk({ ...ask, sku: e.target.value })}>
              {d.lines.map((l) => <option key={l.sku} value={l.sku}>{l.name}</option>)}
            </select>
          </label>
          <label className="mk-field">Quantity
            <input aria-label="Quantity" type="number" min={1} max={100000} value={ask.qty} onChange={(e) => setAsk({ ...ask, qty: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="mk-field">Needed by
            <input aria-label="Needed by" type="date" value={ask.by} onChange={(e) => setAsk({ ...ask, by: e.target.value })} />
          </label>
        </div>
        {d.ask.verdict ? <p className={`th-callout ${d.ask.recommended ? "is-ok" : "is-bad"}`} data-testid="surge-verdict">{d.ask.verdict}</p> : null}
      </section>

      <div className="th-stats">
        <Stat label="As planned" value={plain?.date ?? "—"} hint={plain ? `Material ${plain.material_ready}, line free ${plain.line_free}` : ""} />
        <Stat label="What binds" value={plain?.binding.what === "line" ? "The line" : plain?.binding.what ?? "—"} hint={plain?.binding.why ?? ""} />
        <Stat label="Second shift" value={d.second_shift ? "On" : "Off"} hint="Line output × 1.6 when on (SIM)" />
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Three ways to meet it</h2></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="surge-options">
            <thead><tr><th>Option</th><th>Ships</th><th>Makes the date</th><th>Material ready</th><th>Build days</th><th>Extra cost</th></tr></thead>
            <tbody>
              {d.ask.options.map((o) => (
                <tr key={o.label} className={o.meets === false ? "th-row-fail" : undefined}>
                  <td>{o.label}{d.ask.recommended === o.label ? <span className="th-check is-ok"> Recommended</span> : null}</td>
                  <td className="mono">{o.date}</td>
                  <td>{o.meets == null ? "—" : o.meets ? "Yes" : "No"}</td>
                  <td className="mono">{o.material_ready}</td>
                  <td className="mono">{o.build_days} at {o.line_rate_per_day}/day</td>
                  <td className="mono">{o.cost.total_usd ? usd(o.cost.total_usd) : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ops-actions">
          <button type="button" className="btn" disabled={!canAct || page.busy} onClick={() => void page.post("/v1/market/act", "surge.expedite", { sku: ask.sku, qty: ask.qty })}>Expedite the parts for this ask</button>
          <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void page.post("/v1/market/act", "surge.shift", { on: !d.second_shift })}>{d.second_shift ? "Stop the second shift" : "Add a second shift"}</button>
        </div>
        <p className="meta">Expediting raises purchase orders for what the ask is short, with premium freight, and expedites open orders it depends on. Quotes use the fastest of these as the earliest date Neros may commit.</p>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head"><h2>Parts, as planned</h2></div>
          <div className="table-wrap" tabIndex={0}>
            <table data-testid="surge-parts">
              <thead><tr><th>Part</th><th>Need</th><th>Released</th><th>On order</th><th>To order</th><th>Ready</th></tr></thead>
              <tbody>
                {(plain?.parts ?? []).map((p) => (
                  <tr key={p.pn} className={binding?.pn === p.pn ? "th-row-fail" : undefined}>
                    <td>{p.name} <span className="meta mono">{p.pn}</span></td>
                    <td className="mono">{p.need.toLocaleString("en-US")}</td>
                    <td className="mono">{p.on_hand.toLocaleString("en-US")}</td>
                    <td className="mono">{p.from_po.reduce((n, x) => n + x.qty, 0).toLocaleString("en-US")}</td>
                    <td className="mono">{p.to_order ? `${p.to_order.toLocaleString("en-US")} (${p.lead_days} days)` : "—"}</td>
                    <td className="mono">{p.ready}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Lines</h2></div>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead><tr><th>Airframe</th><th>Rate a day</th><th>Open orders</th><th>Free from</th></tr></thead>
              <tbody>
                {d.lines.map((l) => <tr key={l.sku}><td>{l.name}</td><td className="mono">{l.rate}</td><td className="mono">{l.backlog}</td><td className="mono">{l.free}</td></tr>)}
              </tbody>
            </table>
          </div>
          {d.raised.length ? (
            <ul className="ops-req">{d.raised.map((r) => <li key={r.po}><span className="mono">{r.po}</span> {r.qty} × {r.pn} for {r.for} <span className="meta">{r.at}</span></li>)}</ul>
          ) : <p className="meta">No surge purchase orders raised this session.</p>}
        </section>
      </div>
    </section>
  );
}
