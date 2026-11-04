import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, pct, Stat, usePageData, Withheld } from "./thread";
import "./market.css";

interface Line { item: string; qty: number; each: number; usd: number; included?: boolean }
interface Preview {
  sku: string; sensor: string; qty: number; seats: number; fleet: string; unit_usd: number; lines: Line[]; total_usd: number;
  sortie: { usd: number | null; drones_per_completed?: number; completion?: number; basis: string; sorties?: number };
  program_price?: { label: string; usd: number; source: string };
  delivery: { date: string; fastest: string; binding: string };
  evidence: { label: string; value: string; detail: string }[];
}
interface QuoteRow extends Preview {
  id: string; org: string; org_name: string; status: string; requested: string; by: string;
  committed: { date: string; total_usd: number; discount: number; by: string; at: string; needs_expedite: boolean } | null;
}
interface QuoteView {
  source: string; today: string;
  options: { skus: { sku: string; name: string; usd: number }[]; sensors: { id: string; name: string; usd: number }[]; fleet: Record<string, number>; course_usd: number };
  preview: Preview; quotes: QuoteRow[];
}

interface MyPlan { tier: string; name: string; price: string; missing: { feature: string; label: string; needs: string }[]; usage: { drones: number; formations: number; annual_usd: number }; requests: { id: string; to: string; status: string }[] }

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);

/** The customer's plan: what it includes, what it uses, and a way to ask for more. */
function YourPlan({ canAsk, onBanner }: { canAsk: boolean; onBanner: (banner: string) => void }) {
  const page = usePageData<MyPlan>("/v1/plans?org=CUS-A", onBanner);
  const d = page.data;
  if (!d) return null;
  const next = d.missing[0]?.needs;
  const asked = d.requests.find((r) => r.status === "requested");
  return (
    <section className="panel" data-testid="your-plan">
      <div className="panel-head"><h2>Your plan: {d.name}</h2></div>
      <Note note={page.note} />
      <p className="meta">{d.price}. {d.usage.drones} drones under the record, {d.usage.formations} formations; about {usd(d.usage.annual_usd)} a year (SIM).</p>
      {d.missing.length ? <p className="meta">Not in your plan: {d.missing.map((m) => `${m.label} (${m.needs})`).join(", ")}.</p> : <p className="meta">Every feature is in your plan.</p>}
      {next && !asked ? <button type="button" className="btn btn-quiet" disabled={!canAsk || page.busy} onClick={() => void page.post("/v1/market/act", "plans.request", { tier: next.toLowerCase() })}>Ask Neros for {next}</button> : null}
      {asked ? <p className="meta">{asked.id}: your request is with Neros.</p> : null}
    </section>
  );
}

/** The storefront listing: configure a kit, see what it costs per completed sortie and when it can arrive, and ask Neros to commit. */
export function QuotePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const neros = viewer.org === "neros";
  const [c, setC] = useState({ sku: "ARCHER-5", sensor: "thermal", qty: 120, seats: 10, fleet: "battalion" });
  const [dates, setDates] = useState<Record<string, string>>({});
  const query = `?sku=${c.sku}&sensor=${c.sensor}&qty=${c.qty}&seats=${c.seats}&fleet=${c.fleet}`;
  const page = usePageData<QuoteView>(`/v1/quote${query}`, onBanner);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const p = d.preview;
  const buyer = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer", "planner"].includes(r));
  const seller = viewer.roles.some((r) => ["admin", "ops_lead"].includes(r));
  const set = (k: keyof typeof c, v: string | number) => setC({ ...c, [k]: v });

  return (
    <section className="page ins-page co-page ops-page" data-testid="quote">
      <PageHead
        kicker={neros ? "Neros sales" : "Buy"}
        title={neros ? "Quotes" : "Order"}
        lede={neros
          ? "Quotes customers request from the listing. Price each one and commit a date the factory can keep: the surge planner refuses a promise the line cannot make."
          : "Configure a kit the way the Army UAS Marketplace builds a package: airframe, sensor pack, training and fleet software. See what a completed sortie costs from your own records, and when it can arrive."}
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      <Withheld data={d} />

      <section className="panel">
        <div className="panel-head"><h2>{neros ? "The listing as customers see it" : "Configure"}</h2></div>
        <div className="mk-form">
          <label className="mk-field">Airframe
            <select aria-label="Airframe" value={c.sku} onChange={(e) => set("sku", e.target.value)}>
              {d.options.skus.map((s) => <option key={s.sku} value={s.sku}>{s.name} ({usd(s.usd)})</option>)}
            </select>
          </label>
          <label className="mk-field">Sensor pack
            <select aria-label="Sensor pack" value={c.sensor} onChange={(e) => set("sensor", e.target.value)}>
              {d.options.sensors.map((s) => <option key={s.id} value={s.id}>{s.name}{s.usd ? ` (+${usd(s.usd)})` : ""}</option>)}
            </select>
          </label>
          <label className="mk-field">Quantity
            <input aria-label="Quantity" type="number" min={1} max={20000} value={c.qty} onChange={(e) => set("qty", Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label className="mk-field">Course seats
            <input aria-label="Course seats" type="number" min={0} max={200} value={c.seats} onChange={(e) => set("seats", Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label className="mk-field">Fleet software
            <select aria-label="Fleet software" value={c.fleet} onChange={(e) => set("fleet", e.target.value)}>
              <option value="none">None (Record only)</option>
              <option value="battalion">Battalion ({usd(d.options.fleet.battalion)} a year)</option>
              <option value="brigade">Brigade ({usd(d.options.fleet.brigade)} a year)</option>
            </select>
          </label>
        </div>
      </section>

      <div className="th-stats">
        <Stat label="Total" value={usd(p.total_usd)} hint={`${usd(p.unit_usd)} a drone`} />
        <Stat label="Cost per completed sortie" value={usd(p.sortie.usd)} hint={p.sortie.usd ? `${p.sortie.drones_per_completed} drones per completed sortie, from ${p.sortie.basis}` : p.sortie.basis} />
        <Stat label="Earliest delivery" value={p.delivery.date} hint={`Fastest with expediting ${p.delivery.fastest}. Limit: ${p.delivery.binding}`} />
        {p.program_price ? <Stat label="Program reference" value={usd(p.program_price.usd)} hint={`${p.program_price.label}, ${p.program_price.source}`} /> : null}
      </div>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head"><h2>Lines</h2></div>
          <div className="table-wrap">
            <table data-testid="quote-lines">
              <thead><tr><th>Item</th><th>Qty</th><th>Each</th><th>Amount</th></tr></thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.item}><td>{l.item}</td><td className="mono">{l.qty}</td><td className="mono">{usd(l.each)}</td><td className="mono">{l.included ? "Included" : usd(l.usd)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mk-total"><span>Total</span><span className="mono">{usd(p.total_usd)}</span></p>
          {!neros ? (
            <button type="button" className="btn" disabled={!buyer || page.busy} onClick={() => void page.post("/v1/market/act", "quote.request", { ...c })}>Request this quote</button>
          ) : null}
          {!neros && !buyer ? <p className="meta">Requesting a quote needs the planner, mission commander, maintainer or admin role.</p> : null}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Evidence on the listing</h2></div>
          <ul className="mk-badges" data-testid="quote-evidence">
            {d.preview.evidence.map((e) => (
              <li key={e.label}><span className="meta">{e.label}</span><strong>{e.value}</strong><span className="meta">{e.detail}</span></li>
            ))}
          </ul>
          <p className="meta">The serial record is priced into every drone ({pct(0.02)} of the unit price, a planning assumption). Fleet software is priced per formation, not per drone, because drones are expended and formations are not.</p>
        </section>
      </div>

      {!neros ? <YourPlan canAsk={buyer} onBanner={onBanner} /> : null}

      <section className="panel">
        <div className="panel-head"><h2>{neros ? "Requests from customers" : "Your quotes"}</h2></div>
        {d.quotes.length === 0 ? <p className="meta">No quotes yet.</p> : null}
        <ul className="ops-list" data-testid="quotes">
          {d.quotes.map((q) => (
            <li key={q.id} className="ops-item">
              <div className="ops-item-head">
                <span className="ops-title">{q.id}: {q.qty} × {q.lines[0]?.item}</span>
                <span className={`th-check ${q.status === "ordered" ? "is-ok" : q.status === "declined" ? "is-fail" : "is-warn"}`}>{q.status}</span>
              </div>
              <p className="ops-detail">
                {neros ? `${q.org_name}. ` : ""}Requested {q.requested} by {q.by}. List {usd(q.total_usd)}; earliest {q.delivery.date}.
                {q.committed ? ` Committed ${usd(q.committed.total_usd)} for ${q.committed.date}${q.committed.needs_expedite ? " (needs expediting)" : ""}.` : ""}
              </p>
              <div className="ops-actions">
                {neros && q.status === "requested" ? (
                  <span className="mk-inline">
                    <input aria-label={`Commit date for ${q.id}`} type="date" value={dates[q.id] ?? q.delivery.date} onChange={(e) => setDates({ ...dates, [q.id]: e.target.value })} />
                    <button type="button" className="btn" disabled={!seller || page.busy} onClick={() => void page.post("/v1/market/act", "quote.price", { id: q.id, date: dates[q.id] ?? q.delivery.date })}>Price and commit</button>
                  </span>
                ) : null}
                {!neros && q.status === "quoted" ? (
                  <>
                    <button type="button" className="btn" disabled={!buyer || page.busy} onClick={() => void page.post("/v1/market/act", "quote.accept", { id: q.id })}>Accept and order</button>
                    <button type="button" className="btn btn-quiet" disabled={!buyer || page.busy} onClick={() => void page.post("/v1/market/act", "quote.decline", { id: q.id })}>Decline</button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
