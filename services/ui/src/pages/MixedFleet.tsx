import { useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { EmptyRow, Loading, Note, PageHead, Stat, useCustomerOrg, usePageData, Withheld } from "./thread";
import "./market.css";

interface UnitRow { unit: string; vendors: number; total: number; ready: number; unknown: number; grounded: number; held: number }
interface NerosRow { unit: string; model: string; total: number; ready: number; held: number; sorties_14d: number; source: string; depth: string[] }
interface Tail {
  tail: string; vendor: string; vendor_name: string; unit: string; source: string; last: string; flights_30d: number; minutes_30d: number;
  state: string; note?: string; ngc2: boolean; depth: string[]; log: { day: string; minutes: number; outcome: string }[];
}
interface Mixed {
  source: string; today: string; stale_days: number; log_fields: string[];
  units: UnitRow[]; neros: NerosRow[]; others: Tail[];
  counts: { vendors: number; tails: number; ready: number; unknown: number; ngc2: number };
  sample_log: string;
}

const STATE: Record<string, string> = { ready: "is-ok", grounded: "is-fail", unknown: "is-warn", retired: "" };

/** One fleet picture across every vendor a unit flies, whichever control software flies them. */
export function MixedFleetPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker } = useCustomerOrg(viewer);
  const page = usePageData<Mixed>(`/v1/mixed${query}`, onBanner);
  const [csv, setCsv] = useState("");
  const [why, setWhy] = useState<{ tail: string; text: string } | null>(null);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer", "ops_lead"].includes(r));
  const post = (action: string, args: Record<string, unknown>) => page.post("/v1/market/act", action, { org, ...args });
  async function lineage(tail: string) {
    try {
      const r = await api<{ why: string }>(`/v1/mixed/tail?tail=${tail}${query ? `&${query.slice(1)}` : ""}`);
      setWhy({ tail, text: r.body.why });
    } catch (e) {
      setWhy({ tail, text: e instanceof Error ? e.message : "Could not load the record." });
    }
  }

  return (
    <section className="page ins-page co-page ops-page" data-testid="mixed">
      <PageHead
        kicker="Your fleet"
        title="All vendors"
        lede="Every tail your units fly, from every vendor, in one readiness picture. Neros drones carry the full serial record; other vendors' drones carry what their logs give, imported from government control software or MAVLink-M."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />
      <Withheld data={d} />

      <div className="th-stats">
        <Stat label="Vendors" value={String(d.counts.vendors)} />
        <Stat label="Ready" value={`${d.counts.ready} of ${d.counts.tails}`} hint="Neros airframes held by configuration or stockpile health count as not ready" />
        <Stat label="No log in 21 days" value={String(d.counts.unknown)} hint="Status unknown until a log arrives" />
        <Stat label="Publishing to NGC2 (SIM)" value={d.counts.ngc2 == null ? "Withheld" : String(d.counts.ngc2)} hint="Neros fleet counts as one feed" />
      </div>

      <section className="panel">
        <div className="panel-head"><h2>By unit</h2></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="mixed-units">
            <thead><tr><th>Unit</th><th>Vendors</th><th>Tails</th><th>Ready</th><th>Held (Neros)</th><th>Grounded</th><th>Unknown</th></tr></thead>
            <tbody>
              {d.units.length === 0 ? <EmptyRow text="No units on file yet. Import another vendor's tails below, or accept a Neros delivery." /> : null}
              {d.units.map((u) => (
                <tr key={u.unit}><td>{u.unit}</td><td className="mono">{u.vendors}</td><td className="mono">{u.total}</td><td className="mono">{u.ready}</td><td className="mono">{u.held}</td><td className="mono">{u.grounded}</td><td className="mono">{u.unknown}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head"><h2>Neros airframes</h2></div>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead><tr><th>Unit</th><th>Model</th><th>On hand</th><th>Ready</th><th>Sorties, 14 days</th></tr></thead>
              <tbody>
                {d.neros.length === 0 ? <EmptyRow text="Nothing yet for your organization: rows appear once Neros delivers airframes and you accept them." go={{ label: "Open Receiving", section: "receiving" }} /> : null}
                {d.neros.map((r) => (
                  <tr key={r.unit}><td>{r.unit}</td><td>{r.model}</td><td className="mono">{r.total}</td><td className="mono">{r.ready}</td><td className="mono">{r.sorties_14d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">Record depth: {d.neros[0]?.depth.join(", ") ?? "none"}. Source: {d.neros[0]?.source ?? "none"}.</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Import a flight log</h2></div>
          <label className="mk-field">CSV with columns {d.log_fields.join(", ")}
            <textarea aria-label="Flight log CSV" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={d.sample_log} />
          </label>
          <div className="ops-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setCsv(d.sample_log)}>Use the sample export</button>
            <button type="button" className="btn" disabled={!canAct || page.busy || !csv.trim()} title={!canAct ? "Importing needs the mission commander, maintainer or admin role" : !csv.trim() ? "Paste rows above first" : undefined} onClick={() => void post("mixed.import", { csv }).then((ok) => ok && setCsv(""))}>Import</button>
          </div>
          <p className="meta">Every row is checked: unknown vendors, dates that are not dates, Neros tails (they report through their own records) and impossible durations are refused with the reason. Good rows land.</p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Other vendors' tails</h2></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="mixed-tails">
            <thead><tr><th>Tail</th><th>Vendor</th><th>Unit</th><th>Source</th><th>Last log</th><th>Flights, 30 days</th><th>Status</th><th>NGC2</th><th>Record</th><th /></tr></thead>
            <tbody>
              {d.others.length === 0 ? <EmptyRow text="No other vendors' airframes yet. Paste their rows into Import below." /> : null}
              {d.others.map((t) => (
                <tr key={t.tail} className={t.state === "retired" ? "th-row-fail" : undefined}>
                  <td className="mono">{t.tail}</td>
                  <td>{t.vendor_name}</td>
                  <td>{t.unit}</td>
                  <td>{t.source}</td>
                  <td className="mono">{t.last}</td>
                  <td className="mono">{t.flights_30d}</td>
                  <td><span className={`th-check ${STATE[t.state] ?? ""}`}>{t.state}</span>{t.note ? <span className="meta"> {t.note}</span> : null}</td>
                  <td>{t.ngc2 == null ? "Withheld" : t.ngc2 ? "Publishing" : "Off"}</td>
                  <td><button type="button" className="th-link" onClick={() => void lineage(t.tail)}>{t.depth.join(", ")}</button></td>
                  <td>
                    {t.state !== "retired" ? (
                      <span className="th-inline">
                        {t.ngc2 != null ? <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("mixed.ngc2", { tail: t.tail })}>{t.ngc2 ? "Stop NGC2" : "Publish to NGC2"}</button> : null}
                        <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("mixed.ground", { tail: t.tail })}>{t.state === "grounded" ? "Return to service" : "Ground"}</button>
                        <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("mixed.retire", { tail: t.tail, reason: "Expended" })}>Retire</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {why ? <p className="th-callout" data-testid="mixed-why">{why.tail}: {why.text}</p> : null}
        <p className="meta">Status is unknown when a tail has sent no log in {d.stale_days} days. Publishing to NGC2 needs a MAVLink-M or government SDK source; the console sends position and status out, and accepts no commands back (ADR-0016).</p>
      </section>
    </section>
  );
}
