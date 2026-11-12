import { useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, useCustomerOrg, usePageData } from "./thread";

interface Feed { id: string; name: string; format: string; destination: string; direction: "in" | "out"; on: boolean; rate_s: number; sent: number | null; changed_by: string | null }
interface Interop {
  source: string; today: string; org: string; vehicles: number; feeds: Feed[]; rules: string[];
  mavlink: { field: string; message: string; source: string }[]; never_sent: string[];
  sample: { cot: string | null; entity: Record<string, unknown> | null };
}

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The customer's own fleet out to TAK and Lattice, and the MAVLink each field is read from. Outbound only. */
export function IntegrationsPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker } = useCustomerOrg(viewer);
  const page = usePageData<Interop>(`/v1/interop${query}`, onBanner);
  const [tab, setTab] = useState<"cot" | "entity">("cot");
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.org !== "neros" && viewer.roles.some((r) => ["admin", "mission_commander", "maintainer"].includes(r));

  async function exportCot() {
    const r = await api<{ xml: string }>(`/v1/interop/cot${query}`);
    save(`${org}-fleet-cot.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<events>\n${r.body.xml}\n</events>\n`, "application/xml");
  }
  async function exportEntities() {
    const r = await api<{ entities: unknown[] }>(`/v1/interop/entities${query}`);
    save(`${org}-fleet-entities.json`, JSON.stringify(r.body, null, 2), "application/json");
  }

  return (
    <section className="page ins-page co-page ops-page" data-testid="integrations">
      <PageHead
        kicker="Admin"
        title="Integrations"
        lede="Your own drones, out to the systems your unit already runs: Cursor-on-Target for TAK, and Lattice-style entities. Each feed is yours to turn on or off. Nothing comes back in: the console takes no command from any external system."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />

      <div className="th-stats">
        <Stat label="Your drones in the feed" value={String(d.vehicles)} />
        <Stat label="Feeds on" value={`${d.feeds.filter((f) => f.on).length} of ${d.feeds.length}`} />
        <Stat label="CoT events sent today" value={(d.feeds.find((f) => f.id === "tak")?.sent ?? 0).toLocaleString("en-US")} hint="SIM" />
        <Stat label="Commands accepted" value="0" hint="By design (ADR-0016)" />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Feeds</h2>
        </div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="feeds">
            <thead>
              <tr>
                <th>Feed</th>
                <th>Direction</th>
                <th>Format</th>
                <th>Destination</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.feeds.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.direction === "out" ? "Out" : "In, read-only"}</td>
                  <td className="meta">{f.format}</td>
                  <td className="meta">{f.destination}</td>
                  <td>
                    <span className={f.on ? "pill pill-ok" : "pill pill-warn"}>{f.on ? `On, every ${f.rate_s} s` : "Off"}</span>
                    {f.changed_by ? <span className="meta"> · {f.changed_by}</span> : null}
                  </td>
                  <td>
                    {f.direction === "out" ? (
                      <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} title={canAct ? undefined : viewer.org === "neros" ? "Each customer switches its own feeds" : "Switching a feed needs the mission commander, maintainer or admin role"} onClick={() => void page.post("/v1/interop/act", "feed.set", { org, id: f.id, on: !f.on })}>
                        Turn {f.on ? "off" : "on"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="ops-req">
          {d.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>What goes out</h2>
            <div className="ops-filter">
              <button type="button" className={tab === "cot" ? "ops-chip is-on" : "ops-chip"} onClick={() => setTab("cot")}>CoT event</button>
              <button type="button" className={tab === "entity" ? "ops-chip is-on" : "ops-chip"} onClick={() => setTab("entity")}>Lattice-style entity</button>
            </div>
          </div>
          <pre className="th-code" data-testid="sample" tabIndex={0}>{tab === "cot" ? d.sample.cot ?? "No drones in the feed" : JSON.stringify(d.sample.entity, null, 2)}</pre>
          <div className="ops-actions">
            <button type="button" className="btn btn-primary" onClick={() => void exportCot()}>Export CoT snapshot</button>
            <button type="button" className="btn btn-quiet" onClick={() => void exportEntities()}>Export entities</button>
          </div>
          <p className="meta">Each drone is a friendly air asset (CoT type a-f-A-M-H-Q). Position error goes out as the CoT circular error; a drone navigating on VIO after GNSS is rejected is marked as fused, not GPS. The entity shape follows Lattice's public Entities API and has not been tested against a Lattice instance.</p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>MAVLink sources</h2>
          </div>
          <div className="table-wrap" tabIndex={0}>
            <table data-testid="mavlink">
              <thead>
                <tr>
                  <th>Console field</th>
                  <th>Message</th>
                  <th>Field</th>
                </tr>
              </thead>
              <tbody>
                {d.mavlink.map((m) => (
                  <tr key={m.field}>
                    <td className="mono">{m.field}</td>
                    <td className="mono">{m.message}</td>
                    <td className="meta">{m.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">Read-only. The console never sends {d.never_sent.join(", ")}. MAVLink-M's dialect is not public yet; when it is, its messages map here.</p>
        </section>
      </div>
    </section>
  );
}
