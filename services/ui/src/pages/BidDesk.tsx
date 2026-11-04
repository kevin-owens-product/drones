import { useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./market.css";

interface Row { id: string; req: string; status: "met" | "partial" | "gap" | "out_of_scope"; value: string; evidence: { page: string; label: string; count: number } | null; owner: { owner: string; due: string; by: string } | null }
interface BidView {
  source: string; today: string;
  solicitations: { id: string; name: string; buyer: string; due: string; met: number; of: number; gaps: number; out_of_scope: number }[];
  current: { id: string; name: string; buyer: string; due: string; rows: Row[] };
  owners_pool: string[];
}

const STATUS: Record<Row["status"], [string, string]> = { met: ["Met", "is-ok"], partial: ["Partial", "is-warn"], gap: ["Gap", "is-fail"], out_of_scope: ["Out of scope (ADR-0016)", ""] };

/** Answer a solicitation from the record: each row is checked live and links to its evidence. */
export function BidDeskPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const [id, setId] = useState("DD-P3");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [brief, setBrief] = useState<string | null>(null);
  const page = usePageData<BidView>(`/v1/bid?id=${id}`, onBanner);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const c = d.current;
  const canAct = !viewer.org || viewer.roles.some((r) => ["admin", "ops_lead"].includes(r));
  const s = d.solicitations.find((x) => x.id === c.id);
  async function exportBrief() {
    try {
      const r = await api<{ markdown: string }>(`/v1/bid/brief?id=${c.id}`);
      setBrief(r.body.markdown);
    } catch (e) {
      setBrief(e instanceof Error ? e.message : "Could not build the brief.");
    }
  }

  return (
    <section className="page ins-page co-page ops-page" data-testid="bid">
      <PageHead
        kicker="Neros commercial"
        title="Bid desk"
        lede="Every program office asks the same questions in different words. Each row here is answered from the record when the page loads: a row reads met only when the record it links to exists. Gaps get an owner and a date before the bid is due. Weapons-effects requirements are answered out of scope."
      />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />

      <div className="ops-filter">
        {d.solicitations.map((x) => (
          <button key={x.id} type="button" className={x.id === c.id ? "ops-chip is-on" : "ops-chip"} onClick={() => { setId(x.id); setBrief(null); }}>{x.name.replace(/ \(SIM.*\)$/, "")} ({x.met}/{x.of})</button>
        ))}
      </div>

      <div className="th-stats">
        <Stat label="Met from the record" value={`${s?.met ?? 0} of ${s?.of ?? 0}`} hint="Out-of-scope rows are not counted" />
        <Stat label="Gaps and partials" value={String(s?.gaps ?? 0)} hint={`${c.rows.filter((r) => (r.status === "gap" || r.status === "partial") && !r.owner).length} without an owner`} />
        <Stat label="Due" value={c.due} hint={c.buyer} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{c.name}</h2>
          <button type="button" className="btn btn-quiet" onClick={() => void exportBrief()}>Export the response brief</button>
        </div>
        <div className="table-wrap">
          <table data-testid="bid-rows">
            <thead><tr><th>Requirement</th><th>Status</th><th>From the record</th><th>Evidence</th><th>Owner</th></tr></thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.id} data-status={r.status}>
                  <td>{r.req}</td>
                  <td><span className={`th-check ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                  <td className="meta">{r.value}</td>
                  <td>{r.evidence ? <a className="th-link" href={`#${r.evidence.page}`}>{r.evidence.label}</a> : "—"}</td>
                  <td>
                    {r.owner ? <span>{r.owner.owner}, due <span className="mono">{r.owner.due}</span></span> : null}
                    {!r.owner && (r.status === "gap" || r.status === "partial") ? (
                      <span className="mk-inline">
                        <select aria-label={`Owner for ${r.id}`} value={pick[r.id] ?? d.owners_pool[0]} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                          {d.owners_pool.map((o) => <option key={o}>{o}</option>)}
                        </select>
                        <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void page.post("/v1/market/act", "bid.owner", { id: c.id, row: r.id, owner: pick[r.id] ?? d.owners_pool[0] })}>Assign</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Solicitation wording is a paraphrase of public program descriptions (SIM). A row whose evidence page or record count is missing is downgraded to partial rather than claimed.</p>
        {brief ? <pre className="mk-brief" data-testid="bid-brief">{brief}</pre> : null}
      </section>
    </section>
  );
}
