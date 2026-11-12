import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PacketDrawer, PageHead, Stat, usePageData } from "./thread";

interface Item { name: string; tier: number; origin: string | null; evidence: string; expires: string | null; note: string | null }
interface LotRow {
  lot: string; pn: string; name: string; supplier: string; supplier_name: string; assembled: string; blue_list: string | null; fcc_basis: string;
  items: Item[]; status: "complete" | "gap" | "expiring"; open_request: { id: string; due: string } | null; in_delivered: number;
}
interface Compliance {
  source: string; today: string; fcc_exemption_ends: string; days_left: number;
  rules: { id: string; text: string }[];
  firmware: { repository: string; location: string; evidence: string; note: string };
  lots: LotRow[];
  deliveries: { id: string; org: string; sku: string; status: string; gaps: number }[];
  counts: { complete: number; gap: number; expiring: number };
}

const LABEL = { complete: "Complete", gap: "Gap", expiring: "Expiring" } as const;

/** Neros: provenance evidence per component lot, rolled up into the packet each delivery lot carries. */
export function CompliancePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Compliance>("/v1/thread/compliance", onBanner);
  const [origin, setOrigin] = useState<Record<string, string>>({});
  const [packet, setPacket] = useState<string | null>(null);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.roles.some((r) => r === "admin" || r === "ops_lead");
  const disabled = !canAct || page.busy;
  const go = (action: string, args: Record<string, unknown>) => void page.post("/v1/thread/act", action, args);

  return (
    <section className="page ins-page co-page ops-page" data-testid="compliance">
      <PageHead
        kicker="Neros operations"
        title="Compliance"
        lede="Provenance is now evidence per lot: no covered-country content at any tier, firmware hosted outside covered countries, and an FCC exemption basis that ends on 1 January 2027. Close the gaps here; every delivery lot's packet updates with them."
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      {!canAct ? <p className="meta">You can see this page; requesting or recording evidence needs the Neros ops lead or admin role.</p> : null}

      <div className="th-stats">
        <Stat label="Days to FCC exemption end" value={String(d.days_left)} hint={`Blue List and domestic-product exemptions end ${d.fcc_exemption_ends}`} />
        <Stat label="Component lots complete" value={`${d.counts.complete} of ${d.lots.length}`} />
        <Stat label="Gaps" value={String(d.counts.gap)} />
        <Stat label="Evidence expiring" value={String(d.counts.expiring)} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Component lots</h2>
        </div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="compliance-lots">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Part</th>
                <th>Supplier</th>
                <th>By tier</th>
                <th>FCC basis</th>
                <th>Status</th>
                <th>Act</th>
              </tr>
            </thead>
            <tbody>
              {d.lots.map((l) => (
                <tr key={l.lot} className={l.status === "gap" ? "th-row-fail" : undefined}>
                  <td className="mono">{l.lot}</td>
                  <td>{l.name}</td>
                  <td>{l.supplier_name}<span className="meta"> · assembled {l.assembled}</span></td>
                  <td>
                    {l.items.map((i) => (
                      <span key={i.name} className={`th-check ${i.evidence === "missing" ? "is-fail" : i.evidence === "expiring" ? "is-warn" : "is-ok"}`} title={i.note ?? undefined}>
                        T{i.tier} {i.name}: {i.origin ?? "not traced"}{i.evidence === "expiring" ? ` (to ${i.expires})` : ""}
                      </span>
                    ))}
                  </td>
                  <td className="meta">{l.fcc_basis}</td>
                  <td>
                    <span className={l.status === "complete" ? "pill pill-ok" : "pill pill-warn"}>{LABEL[l.status]}</span>
                    {l.in_delivered ? <span className="meta"> {l.in_delivered} delivered serials</span> : null}
                  </td>
                  <td>
                    {l.status !== "complete" ? (
                      <span className="th-inline">
                        {l.open_request ? (
                          <span className="meta">{l.open_request.id} due {l.open_request.due}</span>
                        ) : (
                          <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => go("compliance.request", { lot: l.lot })}>Request evidence</button>
                        )}
                        {l.items.some((i) => i.evidence === "missing") ? (
                          <input aria-label={`Origin for ${l.lot}`} placeholder="Origin on the document" value={origin[l.lot] ?? ""} onChange={(e) => setOrigin((o) => ({ ...o, [l.lot]: e.target.value }))} />
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-quiet"
                          disabled={disabled || (l.items.some((i) => i.evidence === "missing") && !(origin[l.lot] ?? "").trim())}
                          title={l.items.some((i) => i.evidence === "missing") && !(origin[l.lot] ?? "").trim() ? "Type the origin the document states first" : undefined}
                          onClick={() => go("compliance.record", { lot: l.lot, origin: origin[l.lot] ?? "" })}
                        >
                          Record document
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Recording a covered country (for example China) is refused and tells you to hold the lot from Quality. The firmware repository: {d.firmware.location}, {d.firmware.note}.</p>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Delivery lot packets</h2>
          </div>
          <ul className="ops-req">
            {d.deliveries.map((x) => (
              <li key={x.id}>
                <button type="button" className="th-link" onClick={() => setPacket(x.id)}>{x.id}</button> {x.org.replace("CUS-", "Customer ")} · {x.sku} · {x.status}
                <span className={x.status === "complete" ? "pill pill-ok" : "pill pill-warn"}>{x.status === "complete" ? "Complete" : `${x.gaps} open`}</span>
              </li>
            ))}
          </ul>
          <p className="meta">Customers see their packet on Receiving, without supplier names.</p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Rules checked</h2>
          </div>
          <ul className="ops-req">
            {d.rules.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
        </section>
      </div>
      {packet ? <PacketDrawer lot={packet} onClose={() => setPacket(null)} /> : null}
    </section>
  );
}
