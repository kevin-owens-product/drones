import { useEffect, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { Loading, Note, PacketDrawer, PageHead, pct, SerialDrawer, Stat, useCustomerOrg, usePageData } from "./thread";

interface Check { level: "fail" | "warn"; code: string; text: string }
interface LotSummary {
  id: string; customer: string; unit: string | null; sku: string; name: string; qty: number; built: string; shipped: string; status: string;
  decided: string | null; decided_by: string | null; days_to_decide: number | null; days_waiting: number | null;
  accepted: number; rejected: { serial: string; reason: string; reason_text: string; replaced: string | boolean }[];
  failing: number; warn: number; firmware: string[]; replaces: string | null;
  compliance?: { status: string; gaps: number } | null;
}
interface PackageRow {
  serial: string; built: string; state: string; parts: Record<string, string>;
  firmware: { version: string; released: boolean };
  bench: { station: string; imu: number; vibration_g: number; hover_s: number; passed: boolean } | null;
  checks: Check[];
}
interface LotPackage extends LotSummary { rows: PackageRow[]; limits: { imu: number }; reasons: Record<string, string> }
interface Receiving {
  source: string; today: string;
  waiting: LotSummary[]; history: LotSummary[];
  stats: { lots: number; serials: number; rate: number | null; first_pass: number | null; mean_days: number | null; waiting: number; program: { rate: number; label: string } };
  reasons: Record<string, string>;
}

const canReceive = (v: Viewer) => v.roles.some((r) => ["admin", "mission_commander", "maintainer", "ops_lead"].includes(r));

/** A customer signs for a delivery lot: every serial's as-built record, checked, accepted or rejected with a reason. */
export function ReceivingPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker } = useCustomerOrg(viewer);
  const page = usePageData<Receiving>(`/v1/thread/receiving${query}`, onBanner);
  const [open, setOpen] = useState<string | null>(null);
  const [serial, setSerial] = useState<string | null>(null);
  const [packet, setPacket] = useState<string | null>(null);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = canReceive(viewer);

  return (
    <section className="page ins-page co-page ops-page" data-testid="receiving">
      <PageHead
        kicker="Your fleet"
        title="Receiving"
        lede="Every delivery arrives with each serial's as-built record: component lots, firmware and end-of-line bench results, checked automatically. Accept the lot, or reject the serials that fail with a reason; rejections go straight to Neros for replacement."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />
      {!canAct ? <p className="meta">You can see every package; accepting or rejecting needs the mission commander or maintainer role.</p> : null}

      <div className="th-stats">
        <Stat label="Accepted, by serial" value={pct(d.stats.rate, 1)} hint={`${d.stats.serials} serials in ${d.stats.lots} lots`} />
        <Stat label="Lots accepted first time" value={pct(d.stats.first_pass)} />
        <Stat label="Days from ship to decision" value={d.stats.mean_days == null ? "—" : d.stats.mean_days.toFixed(1)} />
        <Stat label="Program comparison" value={pct(d.stats.program.rate)} hint={d.stats.program.label} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Waiting for your decision {d.waiting.length ? <span className="ops-count">{d.waiting.length}</span> : null}</h2>
        </div>
        {d.waiting.length === 0 ? <p className="meta">Nothing waiting. New deliveries show here when they arrive.</p> : null}
        <ul className="ops-list">
          {d.waiting.map((l) => (
            <li key={l.id} className={`ops-item ${l.failing ? "sev-high" : "sev-medium"}`}>
              <p className="ops-title">
                {l.id}: {l.qty} {l.name}{l.unit ? ` for ${l.unit}` : ""}{l.replaces ? `, replacing serials rejected on ${l.replaces}` : ""}
              </p>
              <p className="ops-detail">
                Shipped {l.shipped}, waiting {l.days_waiting} day{l.days_waiting === 1 ? "" : "s"}. Firmware {l.firmware.join(", ")}.{" "}
                {l.failing ? <strong>{l.failing} serial{l.failing === 1 ? "" : "s"} fail a check</strong> : "Every serial passes its checks"}
                {l.warn ? `, ${l.warn} with a warning` : ""}.
                {l.compliance ? ` Provenance packet: ${l.compliance.status}${l.compliance.gaps ? ` (${l.compliance.gaps} gap${l.compliance.gaps === 1 ? "" : "s"})` : ""}.` : ""}
              </p>
              <div className="ops-actions">
                <button type="button" className="btn btn-primary" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  {open === l.id ? "Close the package" : "Open the package"}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setPacket(l.id)}>Provenance packet</button>
              </div>
              {open === l.id ? (
                <PackageView
                  id={l.id}
                  org={org}
                  disabled={!canAct || page.busy}
                  onSerial={setSerial}
                  onDecide={(reject) => void page.post("/v1/thread/act", "delivery.accept", { id: l.id, org, reject }).then((ok) => ok && setOpen(null))}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Received</h2>
        </div>
        <div className="table-wrap">
          <table data-testid="receiving-history">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Unit</th>
                <th>Model</th>
                <th>Serials</th>
                <th>Shipped</th>
                <th>Decided</th>
                <th>Days</th>
                <th>Rejected</th>
                <th>Provenance</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.id}</td>
                  <td>{l.unit ?? "—"}</td>
                  <td>{l.name}</td>
                  <td className="mono">{l.qty}</td>
                  <td className="mono">{l.shipped}</td>
                  <td className="mono">{l.decided}</td>
                  <td className="mono">{l.days_to_decide}</td>
                  <td>
                    {l.rejected.length === 0 ? <span className="meta">None</span> : null}
                    {l.rejected.map((x) => (
                      <span key={x.serial} className="th-inline">
                        <button type="button" className="th-link" onClick={() => setSerial(x.serial)}>{x.serial}</button>
                        <span className="meta">{x.reason_text}{x.replaced ? ` · replaced on ${typeof x.replaced === "string" ? x.replaced : "a later lot"}` : " · replacement pending"}</span>
                      </span>
                    ))}
                  </td>
                  <td>
                    <button type="button" className="th-link" onClick={() => setPacket(l.id)}>
                      {l.compliance ? (l.compliance.status === "complete" ? "Complete" : `${l.compliance.status}, ${l.compliance.gaps} open`) : "Packet"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {packet ? <PacketDrawer lot={packet} onClose={() => setPacket(null)} /> : null}
      {serial ? <SerialDrawer serial={serial} onClose={() => setSerial(null)} /> : null}
    </section>
  );
}

const DEFAULT_REASON: Record<string, string> = { bench_missing: "bench_missing", firmware_unreleased: "firmware_unreleased", bench_out_of_limits: "bench_out_of_limits" };

function PackageView({ id, org, disabled, onSerial, onDecide }: { id: string; org: string; disabled: boolean; onSerial: (s: string) => void; onDecide: (reject: { serial: string; reason: string }[]) => void }) {
  const [pkg, setPkg] = useState<LotPackage | null>(null);
  const [all, setAll] = useState(false);
  const [reject, setReject] = useState<Record<string, string>>({});
  useEffect(() => {
    void api<LotPackage>(`/v1/thread/lot?id=${id}&org=${org}`).then((r) => {
      setPkg(r.body);
      // Serials that fail a check start marked for rejection, with the matching reason.
      const pre: Record<string, string> = {};
      for (const row of r.body.rows) {
        const fail = row.checks.find((c) => c.level === "fail");
        if (fail) pre[row.serial] = DEFAULT_REASON[fail.code] ?? "other";
      }
      setReject(pre);
    });
  }, [id, org]);
  if (!pkg) return <p className="meta">Opening the package…</p>;
  const flagged = pkg.rows.filter((r) => r.checks.length);
  const rows = all ? pkg.rows : flagged.length ? flagged : pkg.rows.slice(0, 8);
  const n = Object.keys(reject).length;
  return (
    <div className="th-package" data-testid="package">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Serial</th>
              <th>Bench</th>
              <th>Firmware</th>
              <th>ESC / motor / FC lots</th>
              <th>Checks</th>
              <th>Reject</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.serial} className={r.checks.some((c) => c.level === "fail") ? "th-row-fail" : undefined}>
                <td>
                  <button type="button" className="th-link" onClick={() => onSerial(r.serial)}>{r.serial}</button>
                </td>
                <td className="mono">{r.bench ? `${r.bench.station} · IMU ${r.bench.imu} · ${r.bench.vibration_g} g` : "—"}</td>
                <td className="mono">{r.firmware.version}</td>
                <td className="mono">{r.parts.esc} / {r.parts.motor} / {r.parts.fc}</td>
                <td>
                  {r.checks.length === 0 ? <span className="th-check is-ok">All pass</span> : null}
                  {r.checks.map((c) => (
                    <span key={c.code} className={`th-check is-${c.level}`}>{c.text}</span>
                  ))}
                </td>
                <td>
                  <span className="th-inline">
                    <input
                      type="checkbox"
                      aria-label={`Reject ${r.serial}`}
                      checked={r.serial in reject}
                      onChange={(e) =>
                        setReject((x) => {
                          const next = { ...x };
                          if (e.target.checked) next[r.serial] = "other";
                          else delete next[r.serial];
                          return next;
                        })
                      }
                    />
                    {r.serial in reject ? (
                      <select aria-label={`Reason for ${r.serial}`} value={reject[r.serial]} onChange={(e) => setReject((x) => ({ ...x, [r.serial]: e.target.value }))}>
                        {Object.entries(pkg.reasons).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ops-actions">
        <button type="button" className="btn btn-quiet" onClick={() => setAll(!all)}>
          {all ? "Show only serials with findings" : `Show all ${pkg.rows.length} serials`}
        </button>
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onDecide(Object.entries(reject).map(([serial, reason]) => ({ serial, reason })))}>
          Accept {pkg.rows.length - n}{n ? `, reject ${n}` : ""}
        </button>
      </div>
      <p className="meta">Warnings do not block acceptance. Rejected serials go back to Neros with your reason, and a replacement lot ships with its own records.</p>
    </div>
  );
}
