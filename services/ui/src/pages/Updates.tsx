import { useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, useCustomerOrg, usePageData } from "./thread";

interface Result { unit: string; sku: string; serials: string[]; sorties: number; faults: number; lost_links: number; rate: number; baseline: number; pass: boolean }
interface Rollout { status: string; approved_by?: string; approved?: string; units: Record<string, string>; results?: Result[]; halt?: string | null; canary?: string[] }
interface Release {
  id: string; kind: string; version: string; component: string; notes: string; size_mb: number;
  sha256: string; signature: string; signer: string; status: string; published: string | null;
  rollout: Rollout; customers?: { org: string; status: string; halt: string | null }[];
}
interface Version { unit: string; sku: string | null; serials: number; firmware: Record<string, number>; band_plan: Record<string, number> }
interface Updates { source: string; today: string; org: string; halt_rule: string; units: string[]; versions: Version[]; releases: Release[] }

const counts = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} × ${v}`).join(", ");

/** Signed releases and frequency profiles, staged canary → unit → fleet, halted on canary faults. */
export function UpdatesPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker, neros } = useCustomerOrg(viewer);
  const page = usePageData<Updates>(`/v1/thread/updates${query}`, onBanner);
  const [fault, setFault] = useState("");
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const isNeros = viewer.org === "neros";
  const canCustomer = !isNeros && viewer.roles.some((r) => ["admin", "mission_commander", "maintainer"].includes(r));
  const canNeros = (neros || isNeros) && viewer.roles.some((r) => r === "admin" || r === "ops_lead");
  const go = (action: string, args: Record<string, unknown>) => void page.post("/v1/thread/act", action, { org, ...args });

  async function download(release: string) {
    setFault("");
    try {
      const r = await api<{ bundle: string }>(`/v1/thread/bundle?release=${encodeURIComponent(release)}&org=${org}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.body, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${r.body.bundle}-${release}-manifest.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFault(e instanceof Error ? e.message : "Could not build the bundle.");
    }
  }

  const live = d.releases.filter((r) => r.status !== "draft");
  const halted = live.filter((r) => r.rollout.status === "halted").length;

  return (
    <section className="page ins-page co-page ops-page" data-testid="updates">
      <PageHead
        kicker={isNeros ? "Neros operations" : "Your fleet"}
        title="Updates"
        lede="Firmware and frequency profiles reach drones only after the customer approves them, flies them on a canary of two drones in each unit, and rolls them out unit by unit. A canary whose link or hardware faults rise is halted automatically. Disconnected units carry a signed bundle to the ground station."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />
      {fault ? <p className="ops-note is-bad">{fault}</p> : null}

      <div className="th-stats">
        <Stat label="Releases published" value={String(live.length)} />
        <Stat label="Halted on canary" value={String(halted)} />
        <Stat label="Drones in this fleet" value={String(d.versions.reduce((n, v) => n + v.serials, 0))} />
        <Stat label="Halt rule" value="Canary" hint={d.halt_rule} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Releases</h2>
        </div>
        <ul className="ops-list" data-testid="releases">
          {d.releases.map((r) => {
            const ro = r.rollout;
            const sev = ro.status === "halted" ? "sev-high" : r.status === "draft" ? "sev-low" : "sev-medium";
            return (
              <li key={r.id} className={`ops-item ${sev}`}>
                <p className="ops-title">
                  {r.id}: {r.kind} {r.version} for the {r.component.charAt(0).toLowerCase() + r.component.slice(1)} <span className={r.status === "published" ? "pill pill-ok" : "pill pill-warn"}>{r.status}</span>
                </p>
                <p className="ops-detail">{r.notes}. {r.size_mb} MB · signed by {r.signer} · <span className="mono" title={r.sha256}>sha256 {r.sha256.slice(0, 12)}…</span></p>
                <div className="th-stage">
                  <span className={ro.status !== "awaiting approval" ? "is-done" : undefined}>Approved{ro.approved_by ? ` by ${ro.approved_by}` : ""}</span>
                  <span className={ro.status === "halted" ? "is-bad" : ro.results?.length ? "is-done" : undefined}>Canary</span>
                  {d.units.map((u) => (
                    <span key={u} className={ro.units[u] === "fleet" ? "is-done" : undefined}>{u}</span>
                  ))}
                  <span className={ro.status === "complete" ? "is-done" : undefined}>Fleet</span>
                </div>
                {ro.results?.length ? (
                  <ul className="ops-req" data-testid={`canary-${r.id}`}>
                    {ro.results.map((x) => (
                      <li key={x.unit}>
                        <span className={`th-check ${x.pass ? "is-ok" : "is-fail"}`}>{x.pass ? "Pass" : "Fail"}</span> {x.unit} ({x.sku}): {x.sorties} canary sorties, {x.lost_links} lost links, {x.faults} faults
                      </li>
                    ))}
                  </ul>
                ) : null}
                {ro.halt ? <p className="th-callout is-bad">{ro.halt}</p> : null}
                {r.customers ? (
                  <p className="meta">By customer: {r.customers.map((c) => `${c.org.replace("CUS-", "Customer ")} ${c.status}`).join(" · ")}</p>
                ) : null}
                <div className="ops-actions">
                  {r.status === "draft" ? (
                    <button type="button" className="btn btn-primary" disabled={!canNeros || page.busy} onClick={() => go("updates.publish", { release: r.id })}>Publish {r.id}</button>
                  ) : null}
                  {r.status === "published" && isNeros ? (
                    <button type="button" className="btn btn-quiet" disabled={!canNeros || page.busy} onClick={() => go("updates.withdraw", { release: r.id })}>Withdraw</button>
                  ) : null}
                  {!isNeros && r.status === "published" && ro.status === "awaiting approval" ? (
                    <button type="button" className="btn btn-primary" disabled={!canCustomer || page.busy} onClick={() => go("updates.approve", { release: r.id })}>Approve for our fleet</button>
                  ) : null}
                  {!isNeros && ro.status === "approved" ? (
                    <button type="button" className="btn btn-primary" disabled={!canCustomer || page.busy} onClick={() => go("updates.canary", { release: r.id })}>Fly the canary</button>
                  ) : null}
                  {!isNeros && (ro.status === "canary passed" || ro.status === "rolling out")
                    ? d.units.filter((u) => ro.units[u] !== "fleet").map((u) => (
                        <button key={u} type="button" className="btn btn-quiet" disabled={!canCustomer || page.busy} onClick={() => go("updates.promote", { release: r.id, unit: u })}>Roll out to {u}</button>
                      ))
                    : null}
                  {!isNeros && ro.canary?.length && ro.status !== "reverted" ? (
                    <button type="button" className="btn btn-quiet" disabled={!canCustomer || page.busy} onClick={() => go("updates.revert", { release: r.id })}>Revert</button>
                  ) : null}
                  {!isNeros && ro.status !== "awaiting approval" && ro.status !== "halted" && ro.status !== "reverted" && r.status === "published" ? (
                    <button type="button" className="btn btn-quiet" onClick={() => void download(r.id)}>Air-gap bundle</button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What each unit is running</h2>
        </div>
        <div className="table-wrap">
          <table data-testid="versions">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Model</th>
                <th>Drones</th>
                <th>Firmware</th>
                <th>Band plan</th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.unit}>
                  <td>{v.unit}</td>
                  <td className="mono">{v.sku ?? "—"}</td>
                  <td className="mono">{v.serials}</td>
                  <td className="mono">{counts(v.firmware) || "—"}</td>
                  <td className="mono">{counts(v.band_plan) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Drones in store or issued. The console stages and records an update; the ground station installs it after checking the signature and hash. Nothing is pushed to a vehicle from here.</p>
      </section>
    </section>
  );
}
