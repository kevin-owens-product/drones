import { useEffect, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, pct, Stat, useCustomerOrg, usePageData } from "./thread";
import "./market.css";

interface Row {
  serial: string; sku: string; built_as: string; unit: string; size: number | null; arm: string; motor: string; prop: string; sensor: string;
  params: string; params_loaded: boolean; ready: boolean; blocker: string | null; changed: boolean; history: { day: string; change: string; by: string }[];
}
interface ConfigView {
  source: string; today: string;
  sizes: Record<string, { arm: string; motor: string; prop: string; params: string }>;
  sensor_packs: { id: string; name: string }[];
  units: { unit: string; issued: number; pending: number; spares: Record<string, number> }[];
  unit: string | null; rows: Row[]; changed: Row[];
}
interface ByConfig { config: string; sorties: number; completed: number; hw_fault: number; rate: number | null; fault_rate: number | null }

const PARTS: Record<string, string[]> = { arm: ["ARM-5", "ARM-8", "ARM-10"], motor: ["MOT-S", "MOT-L"], prop: ["PROP-5", "PROP-8", "PROP-10"] };

/** What each airframe is now, after field swaps: checked against the rules, drawn from spares, held until its parameters load. */
export function ConfigurationPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker, neros } = useCustomerOrg(viewer);
  const [unit, setUnit] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [swap, setSwap] = useState({ part: "arm", to: "ARM-10" });
  const sep = query ? "&" : "?";
  const page = usePageData<ConfigView>(`/v1/config${query}${unit ? `${sep}unit=${unit}` : ""}`, onBanner);
  const [byConfig, setByConfig] = useState<ByConfig[] | null>(null);
  useEffect(() => {
    if (!neros) return;
    void api<{ rows: ByConfig[] }>("/v1/config/quality").then((r) => setByConfig(r.body.rows)).catch(() => setByConfig(null));
  }, [neros]);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const canAct = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer", "ops_lead"].includes(r));
  const post = (action: string, args: Record<string, unknown>) => page.post("/v1/market/act", action, { org, ...args });
  const here = d.units.find((u) => u.unit === d.unit);
  const pending = d.units.reduce((n, u) => n + u.pending, 0);

  return (
    <section className="page ins-page co-page ops-page" data-testid="configuration">
      <PageHead
        kicker="Your fleet"
        title="Configuration"
        lede="Block 2 airframes change shape in the field: arms, motors, props and sensor packs swap to move between 5, 8 and 10 inch. This is what each airframe is now. A swap is checked before it happens, drawn from the unit's spares with its lot, and the airframe stays out of ready until its parameter set loads."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />

      <div className="th-stats">
        <Stat label="Airframes issued" value={String(d.units.reduce((n, u) => n + u.issued, 0))} />
        <Stat label="Changed in the field" value={String(d.changed.length)} />
        <Stat label="Held from ready" value={String(pending)} hint="Invalid build, or parameters not loaded" />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Airframes in {d.unit ?? "no unit"}</h2>
          <div className="ops-filter">
            {d.units.map((u) => (
              <button key={u.unit} type="button" className={d.unit === u.unit ? "ops-chip is-on" : "ops-chip"} onClick={() => setUnit(u.unit)}>{u.unit} ({u.issued})</button>
            ))}
          </div>
        </div>
        {here ? <p className="meta">Spares at {here.unit}: {Object.entries(here.spares).map(([pn, n]) => `${pn} ${n}`).join(", ")}. A swap takes a set of 4.</p> : null}
        <div className="table-wrap">
          <table data-testid="config-rows">
            <thead><tr><th>Serial</th><th>Built as</th><th>Now</th><th>Arms, motors, props</th><th>Sensor pack</th><th>Parameters</th><th>State</th><th /></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.serial} className={r.ready ? undefined : "th-row-fail"}>
                  <td className="mono">{r.serial}</td>
                  <td>{r.built_as}</td>
                  <td className="mono">{r.size ? `${r.size}-inch` : "invalid"}</td>
                  <td className="mono">{r.arm}, {r.motor}, {r.prop}</td>
                  <td>{d.sensor_packs.find((p) => p.id === r.sensor)?.name ?? r.sensor}</td>
                  <td className="mono">{r.params}{r.params_loaded ? "" : " (not loaded)"}</td>
                  <td>{r.ready ? <span className="th-check is-ok">Ready</span> : <span className="th-check is-fail">{r.blocker}</span>}</td>
                  <td>
                    <span className="th-inline">
                      {!r.params_loaded ? <button type="button" className="btn" disabled={!canAct || page.busy} onClick={() => void post("config.params", { serial: r.serial })}>Load {r.params}</button> : null}
                      <button type="button" className="btn btn-quiet" onClick={() => setOpen(open === r.serial ? null : r.serial)}>{open === r.serial ? "Close" : "Change"}</button>
                    </span>
                    {open === r.serial ? (
                      <div className="mk-stack" data-testid={`change-${r.serial}`}>
                        <span className="mk-inline">
                          Reconfigure to
                          {[5, 8, 10].filter((s) => s !== r.size).map((s) => (
                            <button key={s} type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("config.reconfigure", { serial: r.serial, size: s })}>{s}-inch</button>
                          ))}
                        </span>
                        <span className="mk-inline">
                          Swap one
                          <select aria-label="Part" value={swap.part} onChange={(e) => setSwap({ part: e.target.value, to: PARTS[e.target.value]?.[0] ?? d.sensor_packs[0]?.id ?? "day" })}>
                            <option value="arm">arm set</option><option value="motor">motor set</option><option value="prop">prop set</option><option value="sensor">sensor pack</option>
                          </select>
                          <select aria-label="Fit" value={swap.to} onChange={(e) => setSwap({ ...swap, to: e.target.value })}>
                            {(PARTS[swap.part] ?? d.sensor_packs.map((p) => p.id)).map((x) => <option key={x} value={x}>{d.sensor_packs.find((p) => p.id === x)?.name ?? x}</option>)}
                          </select>
                          <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("config.swap", { serial: r.serial, part: swap.part, to: swap.to })}>Fit</button>
                        </span>
                        {r.history.length ? <ul className="ops-req">{r.history.map((h, i) => <li key={i}><span className="mono">{h.day}</span> {h.change} <span className="meta">{h.by}</span></li>)}</ul> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Rules: 5-inch takes ARM-5, MOT-S, PROP-5 and parameter set P-5; 8-inch ARM-8, MOT-L, PROP-8, P-8; 10-inch ARM-10, MOT-L, PROP-10, P-10 (SIM placeholders). Updates for an airframe follow its current size.</p>
      </section>

      {neros && byConfig ? (
        <section className="panel">
          <div className="panel-head"><h2>Neros Quality: shared results by configuration</h2></div>
          <div className="table-wrap">
            <table data-testid="by-config">
              <thead><tr><th>Configuration now</th><th>Sorties</th><th>Completed</th><th>Hardware faults</th></tr></thead>
              <tbody>
                {byConfig.map((g) => (
                  <tr key={g.config}><td>{g.config}</td><td className="mono">{g.sorties}</td><td className="mono">{pct(g.rate)}</td><td className="mono">{pct(g.fault_rate, 1)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">From end-of-flight records customers share, grouped by each serial's configuration today. Sample sizes are small: read a gap as a question for Quality, not a finding.</p>
        </section>
      ) : null}
    </section>
  );
}
