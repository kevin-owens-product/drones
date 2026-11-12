import { useState } from "react";
import type { Viewer } from "../shell/types";
import { EmptyRow, Loading, Note, PageHead, Stat, useCustomerOrg, usePageData, Withheld } from "./thread";
import "./market.css";

interface Flag { level: "hold" | "warn"; code: string; text: string; fix: string }
interface Row {
  serial: string; sku: string; unit: string; lot: string; ready: boolean; flags: Flag[]; history: { day: string; what: string }[];
  pack: { id: string; maker: string; listed: boolean; made: string; age_days: number; stored_days: number; soc: number; heat_c: number;
    health_pct: number; store_c: number; eol_days: number | null; eol_days_storage_charge: number | null; eol_days_cool: number | null;
    curve: { d: number; as_is: number; storage: number; cool: number }[] };
}
interface StockView {
  source: string; today: string; ban_days: number;
  rules: { shelf_days: number; storage_soc_max: number; storage_days_warn: number; heat_c: number; listed_ban: string };
  units: { unit: string; stored: number; held: number }[]; unit: string | null;
  counts: { stored: number; held: number; over_age: number; listed: number; high_charge: number; heat: number; fade?: number };
  aging?: { eol: number; storage_soc: number; cool_store_c: number };
  rows: Row[]; retired: { serial: string; day: string; reason: string }[];
}

const life = (d: number | null) => (d === null ? "20+ years" : d < 90 ? `${d} days` : d < 730 ? `${Math.round(d / 30)} months` : `${(d / 365).toFixed(1)} years`);

/** One pack's capacity over the next two years: as stored, at storage charge, and at storage charge in a cool store. */
function FadeChart({ r, eol }: { r: Row; eol: number }) {
  const W = 640;
  const H = 180;
  const rows = r.pack.curve;
  const span = rows.at(-1)?.d || 1;
  const lo = Math.min(eol * 100 - 4, ...rows.map((x) => x.as_is));
  const hi = 100;
  const x = (d: number) => (d / span) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (k: "as_is" | "storage" | "cool") => rows.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  return (
    <figure className="sp-fade" data-testid="stock-fade">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${r.pack.id} projected capacity over two years for three ways of storing it`}>
        <line x1={0} x2={W} y1={y(eol * 100)} y2={y(eol * 100)} className="sp-eol" vectorEffect="non-scaling-stroke" />
        <path d={line("cool")} className="sp-line sp-cool" vectorEffect="non-scaling-stroke" />
        <path d={line("storage")} className="sp-line sp-storage" vectorEffect="non-scaling-stroke" />
        <path d={line("as_is")} className="sp-line sp-asis" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="meta">
        <strong>{r.serial}</strong> pack {r.pack.id}: {r.pack.health_pct}% of rated capacity today, after {r.pack.age_days} days ({r.pack.stored_days} in a store averaging {r.pack.store_c} °C at {Math.round(r.pack.soc * 100)}% charge). Next two years, down to the {Math.round(eol * 100)}% line (red) where it no longer flies the planned sortie with reserve:{" "}
        <span className="sp-key sp-asis" /> as stored, {life(r.pack.eol_days)} <span className="sp-key sp-storage" /> at storage charge, {life(r.pack.eol_days_storage_charge)} <span className="sp-key sp-cool" /> storage charge in a cool store, {life(r.pack.eol_days_cool)}.
      </figcaption>
    </figure>
  );
}

const FIX: Record<string, [string, string]> = { rotate: ["stock.rotate", "Rotate pack"], recharge: ["stock.recharge", "Storage charge"], inspect: ["stock.inspect", "Inspect"] };

/** Stored airframes and their packs: which will fly, and what to recharge, inspect, rotate or retire first. */
export function StockpilePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const { org, query, picker } = useCustomerOrg(viewer);
  const [unit, setUnit] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const sep = query ? "&" : "?";
  const page = usePageData<StockView>(`/v1/stockpile${query}${unit ? `${sep}unit=${unit}` : ""}`, onBanner);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const eol = d.aging?.eol ?? 0.8;
  // Until a serial is picked, show the pack that reaches end of life soonest as stored.
  const shown = d.rows.find((r) => r.serial === pick) ?? [...d.rows].filter((r) => r.pack.curve).sort((a, b) => (a.pack.eol_days ?? 1e9) - (b.pack.eol_days ?? 1e9))[0] ?? null;
  const canAct = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer", "ops_lead"].includes(r));
  const post = (action: string, args: Record<string, unknown>) => page.post("/v1/market/act", action, { org, ...args });

  return (
    <section className="page ins-page co-page ops-page" data-testid="stockpile">
      <PageHead
        kicker="Your fleet"
        title="Stockpile health"
        lede="Attritable drones are bought ahead of need and stored. Packs age on the shelf, faster at high charge and in heat, and a pack past its shelf life is not one you launch on. This is what in store will actually fly, and what to fix first."
      />
      <p className="ins-source">{d.source}</p>
      {picker}
      <Note note={page.note} />
      <Withheld data={d} />

      <div className="th-stats">
        <Stat label="Stored airframes" value={String(d.counts.stored)} />
        <Stat label="Held from ready" value={String(d.counts.held)} hint={`Pack past ${d.rules.shelf_days} days. All vendors counts these as not ready`} />
        <Stat label="Listed cell maker" value={String(d.counts.listed)} hint={`Barred from ${d.rules.listed_ban}, ${d.ban_days} days`} />
        <Stat label="Recharge or inspect" value={String(d.counts.high_charge + d.counts.heat)} hint={`${d.counts.high_charge} stored above ${Math.round(d.rules.storage_soc_max * 100)}% charge, ${d.counts.heat} over ${d.rules.heat_c} °C`} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>In store{d.unit ? ` at ${d.unit}` : ""}</h2>
          <div className="ops-filter">
            <button type="button" className={d.unit ? "ops-chip" : "ops-chip is-on"} onClick={() => setUnit(null)}>All</button>
            {d.units.map((u) => <button key={u.unit} type="button" className={d.unit === u.unit ? "ops-chip is-on" : "ops-chip"} onClick={() => setUnit(u.unit)}>{u.unit} ({u.held} held of {u.stored})</button>)}
          </div>
        </div>
        {shown ? <FadeChart r={shown} eol={eol} /> : null}
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="stock-rows">
            <thead><tr><th>Serial</th><th>Unit</th><th>Pack</th><th>Age</th><th>Charge</th><th>Store max</th><th>Capacity</th><th>State</th><th /></tr></thead>
            <tbody>
              {d.rows.length === 0 ? <EmptyRow text="No stored airframes in this unit yet." /> : null}
              {d.rows.map((r) => (
                <tr key={r.serial} className={[r.ready ? "" : "th-row-fail", r.serial === shown?.serial ? "sp-row-sel" : ""].join(" ").trim() || undefined}>
                  <td className="mono">
                    <button type="button" className="sp-pick" aria-pressed={r.serial === shown?.serial} onClick={() => setPick(r.serial)}>
                      {r.serial}
                    </button>
                  </td>
                  <td>{r.unit}</td>
                  <td><span className="mono">{r.pack.id}</span> <span className="meta">{r.pack.maker}</span></td>
                  <td className="mono">{r.pack.age_days} d</td>
                  <td className="mono">{Math.round(r.pack.soc * 100)}% for {r.pack.stored_days} d</td>
                  <td className="mono">{r.pack.heat_c} °C</td>
                  <td className="mono">
                    <span className="sp-health" title={`Reaches ${Math.round(eol * 100)}% in ${life(r.pack.eol_days)} as stored`}>
                      <span style={{ width: `${Math.max(0, Math.min(100, ((r.pack.health_pct - eol * 100) / (100 - eol * 100)) * 100))}%` }} />
                    </span>{" "}
                    {r.pack.health_pct}%
                  </td>
                  <td>
                    {r.flags.length === 0 ? <span className="th-check is-ok">Ready</span> : r.flags.map((f) => <span key={f.code} className={`th-check ${f.level === "hold" ? "is-fail" : "is-warn"}`} title={f.text}>{f.text}</span>)}
                  </td>
                  <td>
                    <span className="th-inline">
                      {[...new Set(r.flags.map((f) => f.fix))].map((fx) => {
                        const [action, label] = FIX[fx] ?? ["", fx];
                        return <button key={fx} type="button" className={fx === "rotate" && !r.ready ? "btn" : "btn btn-quiet"} disabled={!canAct || page.busy} onClick={() => void post(action, { serial: r.serial })}>{label}</button>;
                      })}
                      <button type="button" className="btn btn-quiet" disabled={!canAct || page.busy} onClick={() => void post("stock.retire", { serial: r.serial, reason: "Retired from store" })}>Retire</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Rules: a pack older than {d.rules.shelf_days} days holds its airframe from ready until rotated. Stored more than {d.rules.storage_days_warn} days above {Math.round(d.rules.storage_soc_max * 100)}% charge: bring to storage charge. Store above {d.rules.heat_c} °C: inspect for swelling. Packs from a listed cell maker must be replaced before {d.rules.listed_ban} (SIM reading of FY24 NDAA §154). Capacity is a calendar-ageing model: loss grows with the square root of time, doubles roughly every 10 °C and runs about 2.7x faster full than at half charge (assumed coefficients, not measured). Pick a serial to see what a storage charge or a cooler store buys.</p>
        {d.retired.length ? <ul className="ops-req">{d.retired.map((r) => <li key={r.serial}><span className="mono">{r.serial}</span> retired {r.day}: {r.reason}</li>)}</ul> : null}
      </section>
    </section>
  );
}
