import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./market.css";

interface Usage { drones: number; formations: number; record_usd: number; fleet_usd: number; annual_usd: number }
interface Tier { id: string; name: string; price: string; features: string[] }
interface PlansView {
  source: string; today: string; tiers: Tier[]; labels: Record<string, string>;
  customers: { org: string; name: string; tier: string; tier_name: string; usage: Usage; open: { id: string; to: string }[] }[];
  totals: { annual_usd: number; drones: number; formations: number };
  requests: { id: string; org: string; from: string; to: string; status: string; at: string; by: string }[];
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** What each tenant pays for, what it may open, and what it uses, counted from the records. */
export function PlansPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<PlansView>("/v1/plans", onBanner);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = !viewer.org || viewer.roles.some((r) => ["admin", "ops_lead"].includes(r));

  return (
    <section className="page ins-page co-page ops-page" data-testid="plans">
      <PageHead
        kicker="Neros commercial"
        title="Plans"
        lede="If the government furnishes the control software, Neros earns on the record and the fleet software around every drone. Record is priced into each drone; Fleet is priced per formation, because drones are expended and formations are not. A plan gates pages at the API, and usage is counted from the same records the pages show."
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />

      <div className="th-stats">
        <Stat label="Recurring revenue (SIM)" value={usd(d.totals.annual_usd)} hint="A year, at today's usage" />
        <Stat label="Drones under Record" value={d.totals.drones.toLocaleString("en-US")} />
        <Stat label="Formations under Fleet or Program" value={String(d.totals.formations)} />
      </div>

      <div className="mk-tiers">
        {d.tiers.map((t) => (
          <section key={t.id} className="panel">
            <div className="panel-head"><h2>{t.name}</h2></div>
            <p className="mono">{t.price}</p>
            <ul className="ops-req">{t.features.map((f) => <li key={f}>{d.labels[f] ?? f.charAt(0).toUpperCase() + f.slice(1)}</li>)}</ul>
          </section>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Customers</h2></div>
        <div className="table-wrap">
          <table data-testid="plan-rows">
            <thead><tr><th>Customer</th><th>Plan</th><th>Drones</th><th>Formations</th><th>Record</th><th>Fleet</th><th>A year</th><th>Change plan</th></tr></thead>
            <tbody>
              {d.customers.map((c) => (
                <tr key={c.org}>
                  <td>{c.name}{c.open.length ? <span className="th-check is-warn"> Asked for {d.tiers.find((t) => t.id === c.open[0]?.to)?.name}</span> : null}</td>
                  <td>{c.tier_name}</td>
                  <td className="mono">{c.usage.drones}</td>
                  <td className="mono">{c.usage.formations}</td>
                  <td className="mono">{usd(c.usage.record_usd)}</td>
                  <td className="mono">{usd(c.usage.fleet_usd)}</td>
                  <td className="mono">{usd(c.usage.annual_usd)}</td>
                  <td>
                    <span className="th-inline">
                      {d.tiers.filter((t) => t.id !== c.tier).map((t) => (
                        <button key={t.id} type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void page.post("/v1/market/act", "plans.set", { org: c.org, tier: t.id })}>{t.name}</button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Drones are serials delivered to the customer and not rejected; formations are units with tails on All vendors. Prices are planning assumptions to test with buyers, not Neros prices.</p>
      </section>
    </section>
  );
}
