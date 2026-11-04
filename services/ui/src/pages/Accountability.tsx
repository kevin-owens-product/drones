import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, pct, SerialDrawer, Stat, useCustomerOrg, usePageData, Withheld } from "./thread";

interface UnitRow { unit: string; sku: string | null; in_store: number; issued: number; ended_14d: number; per_day: number; days_of_supply: number | null; sorties_14d: number }
interface LotRow { lot: string; unit: string; sku: string; delivered: number; rejected: number; in_store: number; issued: number; ended: number }
interface EndRecord {
  id: string; serial: string; unit: string; operator: string; gcs: string; day: string; outcome: string; recovered: boolean; jamming: boolean;
  last_link_dbm: number; nav_source: string; battery_pct: number; fault_codes: string[]; firmware: string; delivery_lot: string;
}
interface Accountability {
  source: string; today: string; synced_to: string; sharing: boolean;
  units: UnitRow[]; lots: LotRow[]; outcomes: Record<string, number>; outcome_labels: Record<string, string>;
  records: EndRecord[]; shared_fields: string[];
}

const BAD = new Set(["lost_link", "lost_nav", "hw_fault", "battery", "unknown"]);

/** On hand, issued and ended by unit and lot, from the records ground stations write at the end of each sortie. */
export function AccountabilityPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker } = useCustomerOrg(viewer);
  const page = usePageData<Accountability>(`/v1/thread/accountability${query}`, onBanner);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [serial, setSerial] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [filter, setFilter] = useState("all");
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer", "ops_lead"].includes(r));
  const sorties = Object.values(d.outcomes).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(d.outcomes));
  const ended = d.units.reduce((n, u) => n + u.ended_14d, 0);
  const shown = d.records.filter((r) => filter === "all" || (filter === "problems" ? BAD.has(r.outcome) : r.outcome === filter));
  const disabled = !canAct || page.busy;

  return (
    <section className="page ins-page co-page ops-page" data-testid="accountability">
      <PageHead
        kicker="Your fleet"
        title="Accountability"
        lede="Issue airframes by lot and count, like ammunition, and see where every one went. Ground stations write a record when each sortie ends and sync it when they reconnect, so nobody fills in a loss form."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />
      <Withheld data={d} />

      <div className="th-stats">
        <Stat label="Sorties, last 14 days" value={String(sorties)} />
        <Stat label="Completed" value={pct(sorties ? (d.outcomes.completed ?? 0) / sorties : null)} />
        <Stat label="Airframes ended, 14 days" value={String(ended)} />
        <Stat label="Ground stations synced to" value={d.synced_to} hint={`Today is ${d.today} in the scenario`} />
      </div>

      <div className="ops-actions">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void page.post("/v1/thread/act", "sync", { org })}>
          Sync ground stations
        </button>
        <form
          className="th-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (find.trim()) setSerial(find.trim().toUpperCase());
          }}
        >
          <input aria-label="Find a serial" placeholder="Find a serial, e.g. A5-2615-004" value={find} onChange={(e) => setFind(e.target.value)} />
          <button type="submit" className="btn btn-quiet">Open record</button>
        </form>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>By unit</h2>
        </div>
        <div className="table-wrap">
          <table data-testid="acct-units">
            <thead>
              <tr>
                <th>Unit</th>
                <th>In store</th>
                <th>Issued</th>
                <th>Ended, 14 days</th>
                <th>Per day</th>
                <th>Days of supply</th>
                <th>Act</th>
              </tr>
            </thead>
            <tbody>
              {d.units.map((u) => {
                const lot = d.lots.find((l) => l.unit === u.unit && l.in_store > 0);
                const need = Math.max(5, Math.ceil(u.per_day * 21 - u.issued - u.in_store));
                const n = qty[u.unit] ?? Math.min(lot?.in_store ?? 0, Math.ceil(u.per_day * 5));
                return (
                  <tr key={u.unit}>
                    <td><strong>{u.unit}</strong></td>
                    <td className="mono">{u.in_store}</td>
                    <td className="mono">{u.issued}</td>
                    <td className="mono">{u.ended_14d}</td>
                    <td className="mono">{u.per_day}</td>
                    <td>{u.days_of_supply == null ? "—" : <span className={u.days_of_supply < 14 ? "pill pill-warn" : "pill pill-ok"}>{u.days_of_supply} days</span>}</td>
                    <td>
                      <span className="th-inline">
                        {lot ? (
                          <>
                            <input type="number" min={1} max={lot.in_store} aria-label={`Issue to ${u.unit}`} value={n} onChange={(e) => setQty((q) => ({ ...q, [u.unit]: Number(e.target.value) }))} />
                            <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => void page.post("/v1/thread/act", "issue", { org, lot: lot.lot, unit: u.unit, qty: n })}>
                              Issue from {lot.lot}
                            </button>
                          </>
                        ) : (
                          <span className="meta">Store empty</span>
                        )}
                        {u.days_of_supply != null && u.days_of_supply < 21 ? (
                          <button
                            type="button"
                            className={u.days_of_supply < 14 ? "btn btn-primary" : "btn btn-quiet"}
                            disabled={disabled}
                            title="Replacement kit sized to three weeks at this unit's ending rate"
                            onClick={() => void page.post("/v1/ops/act", "request.replacement", { org, unit: u.unit, qty: need, note: `From accountability: ${u.ended_14d} ended in 14 days, ${u.days_of_supply} days of supply` })}
                          >
                            Request {need} from Neros
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="meta">Days of supply counts issued plus in store against the rate airframes ended over the last 14 days. A request sizes the kit to three weeks; it lands in Neros's queue and on Supply &amp; support.</p>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>By delivery lot</h2>
          </div>
          <div className="table-wrap">
            <table data-testid="acct-lots">
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Unit</th>
                  <th>Delivered</th>
                  <th>In store</th>
                  <th>Issued</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {d.lots.map((l) => (
                  <tr key={l.lot}>
                    <td className="mono">{l.lot}</td>
                    <td>{l.unit}</td>
                    <td className="mono">{l.delivered - l.rejected}</td>
                    <td className="mono">{l.in_store}</td>
                    <td className="mono">{l.issued}</td>
                    <td className="mono">{l.ended}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>How sorties ended, 14 days</h2>
          </div>
          <ul className="th-bars">
            {Object.entries(d.outcomes).map(([k, v]) => (
              <li key={k}>
                <span>{d.outcome_labels[k]}</span>
                <span className={`th-bar ${k === "completed" ? "is-ok" : k === "aborted" ? "" : "is-bad"}`} style={{ width: `${(v / max) * 100}%` }} />
                <span className="mono">{v}</span>
              </li>
            ))}
          </ul>
          <p className="meta">
            {d.sharing
              ? `You share outcome fields with Neros (${d.shared_fields.join(", ")}). Neros never sees operators, units, stations or the day flown.`
              : "You do not share these records with Neros. Turn sharing on in Requests to Neros to get resupply proposals and quality follow-up."}
          </p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>End-of-flight records</h2>
          <div className="ops-filter">
            {["all", "problems", "completed", "lost_link", "hw_fault"].map((f) => (
              <button key={f} type="button" className={filter === f ? "ops-chip is-on" : "ops-chip"} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "problems" ? "Problems" : d.outcome_labels[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table data-testid="acct-records">
            <thead>
              <tr>
                <th>Record</th>
                <th>Day</th>
                <th>Serial</th>
                <th>Unit</th>
                <th>Operator</th>
                <th>Outcome</th>
                <th>Link</th>
                <th>Nav</th>
                <th>Battery</th>
                <th>Faults</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td className="mono">{r.day}</td>
                  <td><button type="button" className="th-link" onClick={() => setSerial(r.serial)}>{r.serial}</button></td>
                  <td>{r.unit}</td>
                  <td className="mono">{r.operator}</td>
                  <td>
                    <span className={r.outcome === "completed" ? "pill pill-ok" : BAD.has(r.outcome) ? "pill pill-warn" : "pill"}>{d.outcome_labels[r.outcome]}</span>
                    {r.recovered ? <span className="meta"> recovered</span> : null}
                    {r.jamming ? <span className="meta"> · jamming</span> : null}
                  </td>
                  <td className="mono">{r.last_link_dbm == null ? "Withheld" : `${r.last_link_dbm} dBm`}</td>
                  <td className="mono">{r.nav_source}</td>
                  <td className="mono">{r.battery_pct}%</td>
                  <td className="mono">{r.fault_codes ? r.fault_codes.join(", ") || "—" : "Withheld"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Records hold how a sortie ended, never what it was for or what it hit. The latest 60 are shown; open a serial to see its whole record.</p>
      </section>
      {serial ? <SerialDrawer serial={serial} onClose={() => setSerial(null)} /> : null}
    </section>
  );
}
