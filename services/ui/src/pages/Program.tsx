import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, PageHead, pct, Stat, usePageData } from "./thread";

interface Rung { phase: string; drones: number; price_usd: number; note: string; source: string }
interface SkuRow { sku: string; name: string; bom_usd: number; sorties: number; rate: number | null }
interface Group { label: string; operators: number; sorties: number; rate: number | null }
interface Order { id: string; customer: string; sku: string; name: string; qty: number; delivered: number; left: number; due: string; projected: string | null; at_risk: boolean; why: string }
interface Spend { org: string; unit: string; sku: string; per_week: number; on_hand: number; days_of_supply: number | null; open_requests: { id: string; qty: number; status: string }[] }
interface Program {
  source: string; today: string; ladder: Rung[]; price_goal: number; skus: SkuRow[];
  training: { customers: string[]; operators: number; full: { rate: number | null; operators: number } | null; few: { rate: number | null; operators: number } | null; by_sessions: Group[] };
  acceptance: { rate: number | null; serials: number; lots: number; program: { rate: number; label: string } };
  orders: Order[]; on_time: number | null; expenditure: Spend[];
  compliance: { days_left: number; fcc_exemption_ends: string; gaps: number; expiring: number; lots: number };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Neros against Drone Dominance: price ladder, cost per completed sortie, acceptance, delivery, demand and training. */
export function ProgramPage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Program>("/v1/program", onBanner);
  const [price, setPrice] = useState(3500);
  const [sku, setSku] = useState("ARCHER-5");
  const [trained, setTrained] = useState(false);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const row = d.skus.find((s) => s.sku === sku) ?? d.skus[0] ?? { sku, name: sku, bom_usd: 0, sorties: 0, rate: null };
  const lift = d.training.full?.rate != null && d.training.few?.rate != null ? d.training.full.rate - d.training.few.rate : 0;
  const base = row.rate ?? 0;
  const rate = Math.min(0.99, trained ? base + lift / 2 : base);
  const perSortie = rate > 0 ? price / rate : null;
  const maxPrice = Math.max(...d.ladder.map((r) => r.price_usd));
  const spendWeek = d.expenditure.reduce((n, e) => n + e.per_week, 0);

  return (
    <section className="page ins-page co-page ops-page" data-testid="program">
      <PageHead
        kicker="Neros operations"
        title="Program"
        lede="Neros against the program it sells into: a price that falls every phase, what each drone costs to build and what a completed sortie costs the customer, acceptance and on-time delivery, the demand that expenditure creates, and whether training moves results."
      />
      <p className="ins-source">{d.source}</p>

      <div className="th-stats">
        <Stat label="Accepted by customers" value={pct(d.acceptance.rate, 1)} hint={`Program: ${pct(d.acceptance.program.rate)} (${d.acceptance.program.label})`} />
        <Stat label="Order lines on time" value={pct(d.on_time)} hint={`${d.orders.filter((o) => o.at_risk).length} of ${d.orders.length} at risk`} />
        <Stat label="Airframes expended a week" value={spendWeek.toFixed(0)} hint="Sharing customers, last 14 days" />
        <Stat label="Days to FCC exemption end" value={String(d.compliance.days_left)} hint={`${d.compliance.gaps} provenance gaps, ${d.compliance.expiring} expiring`} />
      </div>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Price ladder</h2>
          </div>
          <ul className="th-bars" data-testid="ladder">
            {d.ladder.map((r) => (
              <li key={r.phase} title={`${r.note}. Source: ${r.source}`}>
                <span>{r.phase} · {(r.drones / 1000).toFixed(0)}k drones</span>
                <span className={`th-bar ${r.price_usd <= d.price_goal * 1.2 ? "is-warn" : "is-ok"}`} style={{ width: `${(r.price_usd / maxPrice) * 100}%` }} />
                <span className="mono">{usd(r.price_usd)}</span>
              </li>
            ))}
          </ul>
          <p className="meta">Airframe price per drone as reported by secondary trackers; hover a row for its source. Phase III figures conflict. Goal: under {usd(d.price_goal)}. Bill of materials (SIM): {d.skus.map((s) => `${s.name} ${usd(s.bom_usd)}`).join(", ")}.</p>
        </section>

        <section className="panel" data-testid="levers">
          <div className="panel-head">
            <h2>Cost per completed sortie</h2>
          </div>
          <div className="th-inline">
            {d.skus.map((s) => (
              <button key={s.sku} type="button" className={sku === s.sku ? "ops-chip is-on" : "ops-chip"} onClick={() => setSku(s.sku)}>{s.name}</button>
            ))}
          </div>
          <label className="th-lever">
            <span>Price per drone: <strong className="mono">{usd(price)}</strong></span>
            <input type="range" min={1500} max={5000} step={100} value={price} aria-label="Price per drone" onChange={(e) => setPrice(Number(e.target.value))} />
          </label>
          <label className="th-check-row">
            <input type="checkbox" checked={trained} onChange={(e) => setTrained(e.target.checked)} /> Every operator takes all six bundled sessions
          </label>
          <p className="th-callout">
            <span className="stat-value mono">{perSortie == null ? "—" : usd(perSortie)}</span> per completed sortie at {pct(rate)} completed
            <span className="meta"> · margin over bill of materials {usd(price - row.bom_usd)}</span>
          </p>
          <p className="meta">
            Completion from {row.sorties} shared end-of-flight records for {row.name} (SIM). The training lever adds half the gap between operators with six sessions ({pct(d.training.full?.rate)}) and three or fewer ({pct(d.training.few?.rate)}), a conservative read of an observational difference. A 10% price cut and a 10% rise in completion lower cost per sortie by about the same amount.
          </p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Delivery against orders</h2>
        </div>
        <div className="table-wrap">
          <table data-testid="program-orders">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Model</th>
                <th>Delivered</th>
                <th>Due</th>
                <th>Projected</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {d.orders.map((o) => (
                <tr key={o.id} className={o.at_risk ? "th-row-fail" : undefined}>
                  <td className="mono">{o.id}</td>
                  <td>{o.customer.replace("CUS-", "Customer ")}</td>
                  <td>{o.name}</td>
                  <td className="mono">{o.delivered} of {o.qty}</td>
                  <td className="mono">{o.due}</td>
                  <td className="mono">{o.projected ?? "—"}</td>
                  <td>{o.at_risk ? <span className="th-check is-fail">{o.why}</span> : <span className="th-check is-ok">On time</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Demand from expenditure</h2>
          </div>
          <ul className="ops-req" data-testid="expenditure">
            {d.expenditure.map((e) => (
              <li key={`${e.org}-${e.unit}`}>
                {e.org.replace("CUS-", "Customer ")} {e.unit}: {e.per_week} a week, {e.on_hand} on hand
                {e.days_of_supply != null ? <span className={e.days_of_supply < 14 ? "pill pill-warn" : "pill pill-ok"}>{e.days_of_supply} days</span> : null}
                {e.open_requests.map((r) => <span key={r.id} className="meta"> · {r.id} for {r.qty} ({r.status})</span>)}
              </li>
            ))}
          </ul>
          <p className="meta">From end-of-flight records the customer shares; a unit under 14 days asks for replacements from Accountability, and the request lands in the work queue.</p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Training against results</h2>
          </div>
          <ul className="th-bars">
            {d.training.by_sessions.map((g) => (
              <li key={g.label}>
                <span>{g.label} sessions ({g.operators})</span>
                <span className="th-bar is-ok" style={{ width: `${(g.rate ?? 0) * 100}%` }} />
                <span className="mono">{pct(g.rate)}</span>
              </li>
            ))}
          </ul>
          <p className="meta">Completed sorties by bundled sessions taken, {d.training.operators} operators at {d.training.customers.length} sharing customer{d.training.customers.length === 1 ? "" : "s"}. Group results only; Neros never sees operator rows.</p>
        </section>
      </div>
    </section>
  );
}
