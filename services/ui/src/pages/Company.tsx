import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";
import "./company.css";

type Spec = [string, string];
interface BomRow { pn: string; name: string; qty: number; usd: number; ext_usd: number; supplier: string; swap?: boolean; dg?: boolean }
interface CatalogItem { sku: string; name: string; family: string; role: string; summary: string; specs: Spec[]; source: string; restricted?: boolean; bom: { rows: BomRow[]; usd: number } | null; on_hand: number | null }
interface Kpi { id: string; label: string; value: number | string; warn?: boolean }
interface OrderRow { id: string; customer_name: string; sku: string; name: string; qty: number; delivered: number; left: number; from_stock: number; to_build: number; due: string; projected: string | null; at_risk: boolean; why: string; dpas: string | null; export: { license: string; status: string } | null }
interface SopRow { sku: string; name: string; backlog: number; attrition: number; finished: number; buildable: number | null; limit: string | null; rate: number; days_to_clear: number; wip: { step: string; qty: number }[] | null }
interface Part { pn: string; name: string; supplier: string; usd: number; lead_days: number; on_hand: number; reorder_point: number | null; swap?: boolean; dg?: boolean }
interface Lot { lot: string; pn: string; name: string; supplier: string; received: string; qty: number; on_hand: number; status: string; where_used: { tail: string; serial: string }[] }
interface Supplier { id: string; name: string; commodity: string; country: string; ndaa: string; on_time: number; ppm: number; lots: number; quarantined: string[]; scar: string | null }
interface Po { po: string; pn: string; qty: number; due: string; supplier: string; late_days: number }
interface Exception { kind: string; pn: string; name: string; detail: string; severity: string }
interface UnitRow { unit: string; sku: string; name: string; airframes: number; gcs: number; operators: number; instructors: number; [k: string]: unknown }
interface KitPlan { id: string; unit: string; sku: string; name: string; short: number; from_stock: number; to_build: number; blocking: { pn: string; name: string; need: number; have: number; short: number }[]; open_po: Po[]; spares: { pn: string; name: string; qty: number; dg: boolean }[]; shipped: boolean }
interface Shipment { id: string; unit: string; sku: string; qty: number; build_order?: number; status: string; dg: boolean; created: string; by: string }
interface WorkOrder { id: string; tail: string; kind: string; summary: string; status: string; parts: { pn: string; name: string; qty: number }[] }
interface Eco { id: string; title: string; status: string; skus: string[]; effectivity: string; driver: string; link: string }
interface Course { id: string; sku: string; name: string; unit: string | null; seats: number; start: string; status: string }
interface Training { unit: string; name: string; operators: number; instructors: number; airframes: number; gaps: string[] }
interface Company {
  source: string;
  today: string;
  kpis: Kpi[];
  orders: OrderRow[];
  sop: SopRow[];
  catalog: CatalogItem[];
  families: [string, string][];
  parts: Part[];
  lots: Lot[];
  suppliers: Supplier[];
  open_po: Po[];
  eol: { passed: number; total: number };
  exceptions: Exception[];
  units: UnitRow[];
  replenishment: KitPlan[];
  shipments: Shipment[];
  work_orders: WorkOrder[];
  ecos: Eco[];
  courses: Course[];
  training: Training[];
  routing: string[];
}
interface ThreadStep { stage: string; text: string; ok?: boolean; parts?: { part: string; lot: string; supplier: string | null; lot_status: string; scar: string | null }[] }
interface Thread { tail: string; serial: string; name: string; steps: ThreadStep[] }

const TABS = [
  ["overview", "Overview"],
  ["products", "Products"],
  ["orders", "Orders and plan"],
  ["production", "Production"],
  ["supply", "Supply chain"],
  ["logistics", "Logistics"],
  ["sustain", "Sustainment"],
  ["training", "Training"],
  ["engineering", "Engineering change"],
] as const;
type Tab = (typeof TABS)[number][0];

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const supplierName = (c: Company, id: string) => c.suppliers.find((s) => s.id === id)?.name ?? id;
const TAB_KEY = "a2e-company-tab";

function initialTab(): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    if (t && TABS.some(([id]) => id === t)) return t as Tab;
  } catch {
    /* storage blocked: start on the overview */
  }
  return "overview";
}

function Sim() {
  return (
    <span className="pill pill-warn" title="Simulated demo data">
      SIM
    </span>
  );
}

export function CompanyPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [data, setData] = useState<Company | null>(null);
  const [fault, setFault] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [tail, setTail] = useState(() => {
    try {
      const handed = sessionStorage.getItem("a2e-company-tail");
      if (handed) sessionStorage.removeItem("a2e-company-tail");
      return handed ?? "NX-05";
    } catch {
      return "NX-05";
    }
  });
  const [thread, setThread] = useState<Thread | null>(null);
  const [sku, setSku] = useState("ARCHER-5");
  const [lotFilter, setLotFilter] = useState(() => {
    try {
      const handed = sessionStorage.getItem("a2e-company-lot");
      if (handed) sessionStorage.removeItem("a2e-company-lot");
      return handed ?? "";
    } catch {
      return "";
    }
  });
  const canWrite = viewer.roles.some((r) => ["admin", "ops_lead", "mission_commander", "maintainer"].includes(r));

  function setTab(next: Tab) {
    setTabState(next);
    try {
      sessionStorage.setItem(TAB_KEY, next);
    } catch {
      /* not remembered, which is fine */
    }
  }

  function load() {
    void api<Company>("/v1/company")
      .then((r) => {
        onBannerRef.current(r.banner);
        setData(r.body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "Could not load the company view."));
  }
  useEffect(load, []);
  useEffect(() => {
    void api<Thread>(`/v1/company/thread?tail=${encodeURIComponent(tail)}`)
      .then((r) => setThread(r.body))
      .catch(() => setThread(null));
  }, [tail, data]);

  async function act(path: string, body: object, done: string) {
    setNote("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setNote(done);
      load();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That did not go through.");
    }
  }

  if (!data) {
    return <section className="page">{fault ? <p className="fault" role="alert">{fault}</p> : <p className="meta">Loading…</p>}</section>;
  }
  const c = data;
  const selected = c.catalog.find((x) => x.sku === sku) ?? c.catalog[0];

  return (
    <section className="page ins-page co-page" data-testid="company">
      <header className="page-head">
        <div>
          <p className="kicker">Company</p>
          <h1 className="page-title">From contract to the field</h1>
          <p className="lede">Every order, build, part, shipment, repair and trained operator, joined by SKU and serial, so a loss in the field shows up as a reorder, a late order or a supplier problem the same day.</p>
        </div>
        <Sim />
      </header>
      <p className="ins-source">{c.source}</p>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {note ? <p className="meta" role="status">{note}</p> : null}

      <nav className="co-tabs" role="tablist" aria-label="Company areas">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "co-tab is-on" : "co-tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <>
          <div className="grid-stats co-kpis">
            {c.kpis.map((k) => (
              <div className={k.warn ? "stat co-warn" : "stat"} key={k.id}>
                <p className="stat-value">{k.value}</p>
                <p className="stat-label">{k.label}</p>
              </div>
            ))}
          </div>
          <section className="panel">
            <div className="panel-head">
              <h2>Today's chain of cause</h2>
            </div>
            <ol className="co-chain">
              {c.replenishment.map((r) => (
                <li key={r.id}>
                  <strong>{r.unit} is {r.short} {r.name} short</strong> on the Attrition forecast.{" "}
                  {r.blocking.length
                    ? `Building them needs ${r.blocking.map((b) => `${b.short} more ${b.name.toLowerCase()}${b.short > 1 ? "s" : ""}`).join(", ")}, because what is on the shelf is already promised to open orders${r.open_po[0] ? `; ${r.open_po[0].po} is ${r.open_po[0].late_days ? `${r.open_po[0].late_days} days late` : `due ${r.open_po[0].due}`}` : ""}.`
                    : "Finished goods and released stock cover it."}
                </li>
              ))}
              {c.orders.filter((o) => o.at_risk).map((o) => (
                <li key={o.id}>
                  <strong>{o.id}</strong> ({o.name}, {o.customer_name.split(":")[0]}) {o.projected ? `projects ${o.projected} against ${o.due}` : "cannot ship yet"}: {o.why}.
                </li>
              ))}
              {c.suppliers.filter((s) => s.scar).map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong>: {s.scar}.
                </li>
              ))}
              {c.training.filter((t) => t.gaps.length).map((t) => (
                <li key={t.unit}>
                  <strong>{t.unit}</strong>: {t.gaps.join("; ")}.
                </li>
              ))}
            </ol>
          </section>
          <section className="panel" data-testid="digital-thread">
            <div className="panel-head">
              <h2>One serial, end to end</h2>
              <label className="meta">
                Tail{" "}
                <select value={tail} onChange={(e) => setTail(e.target.value)}>
                  {["NX-01", "NX-02", "NX-03", "NX-04", "NX-05", "NX-06", "NX-07", "NX-08", "NX-09", "NX-10", "NX-11", "NX-12"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            {thread ? (
              <>
                <p className="meta">
                  {thread.tail} · serial {thread.serial} · {thread.name}
                </p>
                <ol className="co-thread">
                  {thread.steps.map((s) => (
                    <li key={s.stage} className={s.ok === false ? "is-bad" : undefined}>
                      <span className="co-stage">{s.stage}</span>
                      <span>{s.text}</span>
                      {s.parts ? (
                        <ul className="co-parts">
                          {s.parts.map((p) => (
                            <li key={p.part}>
                              {p.part} <span className="mono">{p.lot}</span> · {p.supplier ?? "supplier unknown"}{" "}
                              {p.lot_status === "quarantined" ? <span className="pill pill-warn">Lot on hold</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="empty">No birth record for this tail.</p>
            )}
          </section>
        </>
      ) : null}

      {tab === "products" ? (
        <div className="co-split">
          <section className="panel">
            {c.families.map(([fam, label]) => (
              <div key={fam} className="co-family">
                <h3>{label}</h3>
                <ul className="co-skus">
                  {c.catalog.filter((x) => x.family === fam).map((x) => (
                    <li key={x.sku}>
                      <button type="button" className={x.sku === selected?.sku ? "co-sku is-on" : "co-sku"} onClick={() => setSku(x.sku)}>
                        <span>{x.name}</span>
                        <span className="meta">{x.role}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          {selected ? (
            <section className="panel" data-testid="product-detail">
              <div className="panel-head">
                <h2>{selected.name}</h2>
                <span className="mono meta">{selected.sku}</span>
              </div>
              <p>{selected.summary}</p>
              {selected.restricted ? (
                <p className="co-adr">Catalog and inventory record only. Under ADR-0016 this platform holds no bill of materials, build plan, payload, targeting or release function for Strike variants.</p>
              ) : null}
              {selected.specs.length ? (
                <table className="co-specs">
                  <tbody>
                    {selected.specs.map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td className={v === "not published" ? "meta" : undefined}>{v === "not published" ? "Not published by Neros" : v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <p className="ins-source">
                Published by Neros:{" "}
                <a href={selected.source.split(" ")[0]} target="_blank" rel="noreferrer">
                  {selected.source}
                </a>
              </p>
              {selected.on_hand !== null ? (
                <p className="meta">
                  {selected.on_hand} finished and on the shelf at the factory <Sim />
                </p>
              ) : null}
              {selected.bom ? (
                <>
                  <h3>
                    Bill of materials <Sim />
                  </h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Part</th>
                          <th>Qty</th>
                          <th>Supplier</th>
                          <th>Cost</th>
                          <th>Field swap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.bom.rows.map((r) => (
                          <tr key={r.pn}>
                            <td>
                              <span className="mono">{r.pn}</span> {r.name}
                            </td>
                            <td className="mono">{r.qty}</td>
                            <td>{supplierName(c, r.supplier)}</td>
                            <td className="mono">{usd(r.ext_usd)}</td>
                            <td>{r.swap ? "Yes" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="meta">Material cost {usd(selected.bom.usd)} per airframe (assumed part prices). Field swap marks the parts Neros says Block 2 users can replace themselves.</p>
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "orders" ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Open orders, in shipping priority</h2>
              <Sim />
            </div>
            <div className="table-wrap">
              <table data-testid="orders">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Item</th>
                    <th>Left</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Projected</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id}>
                      <td className="mono">{o.id}</td>
                      <td>{o.customer_name.replace(" (SIM)", "")}</td>
                      <td>{o.name}</td>
                      <td className="mono">
                        {o.left} of {o.qty}
                      </td>
                      <td>{o.dpas ? `DPAS ${o.dpas}` : o.export ? "Export" : "—"}</td>
                      <td className="mono">{o.due}</td>
                      <td>
                        <span className={o.at_risk ? "pill pill-warn" : "pill pill-ok"}>{o.projected ?? "On hold"}</span>
                      </td>
                      <td className="meta">{o.why || `${o.from_stock} from stock, ${o.to_build} to build`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta">Rated (DPAS) orders draw on finished goods and released parts first, then by due date. Projected dates assume the line rate shown under Production and that late purchase orders arrive at their promised date plus the days they are already late.</p>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Sales and operations plan</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>On order</th>
                    <th>Attrition replacements</th>
                    <th>Finished</th>
                    <th>Line rate / day</th>
                    <th>Working days to clear</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sop.map((r) => (
                    <tr key={r.sku}>
                      <td>{r.name}</td>
                      <td className="mono">{r.backlog}</td>
                      <td className="mono">{r.attrition || "—"}</td>
                      <td className="mono">{r.finished}</td>
                      <td className="mono">{r.rate}</td>
                      <td className="mono">{r.days_to_clear}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "production" ? (
        <>
          <div className="grid-stats">
            <div className="stat">
              <p className="stat-value">{c.eol.total ? pct(c.eol.passed / c.eol.total) : "—"}</p>
              <p className="stat-label">
                EOL first-pass yield, {c.eol.passed} of {c.eol.total} named tails
              </p>
            </div>
            {c.sop.filter((r) => r.buildable !== null).map((r) => (
              <div className="stat" key={r.sku}>
                <p className="stat-value">{r.buildable}</p>
                <p className="stat-label">
                  {r.name} buildable from released parts, limited by {r.limit}
                </p>
              </div>
            ))}
          </div>
          <section className="panel">
            <div className="panel-head">
              <h2>Work in progress by step</h2>
              <Sim />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    {c.routing.map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.sop.filter((r) => r.wip).map((r) => (
                    <tr key={r.sku}>
                      <td>{r.name}</td>
                      {(r.wip ?? []).map((w) => (
                        <td className="mono" key={w.step}>
                          {w.qty}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta">The EOL bench step is the end-of-line check in sim/bench: it reads the flight controller, checks it against the release profile, and writes the birth record that Fleet and this page read. A failure goes to rework as a work order, like NX-12.</p>
          </section>
        </>
      ) : null}

      {tab === "supply" ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Exceptions to act on</h2>
              <Sim />
            </div>
            {c.exceptions.length === 0 ? <p className="empty">Nothing below its reorder point, held or late.</p> : null}
            <ul className="objective-list">
              {c.exceptions.map((e, i) => (
                <li key={`${e.kind}-${e.pn}-${i}`}>
                  <strong>
                    <span className={e.severity === "high" ? "pill pill-warn" : "pill"}>{e.kind}</span> {e.name}
                  </strong>
                  <span className="meta">{e.detail}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Suppliers</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Commodity</th>
                    <th>NDAA</th>
                    <th>On time</th>
                    <th>Defects (ppm)</th>
                    <th>Corrective action</th>
                  </tr>
                </thead>
                <tbody>
                  {c.suppliers.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.commodity}</td>
                      <td>{s.ndaa === "Attested" ? s.ndaa : <span className="pill pill-warn">{s.ndaa}</span>}</td>
                      <td className="mono">{pct(s.on_time)}</td>
                      <td className="mono">{s.ppm.toLocaleString()}</td>
                      <td>{s.scar ? <span className="pill pill-warn">{s.scar}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Lots and where they went</h2>
              <input className="co-filter" placeholder="Filter by lot or part" value={lotFilter} onChange={(e) => setLotFilter(e.target.value)} aria-label="Filter lots" />
            </div>
            <div className="table-wrap">
              <table data-testid="lots">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Part</th>
                    <th>Supplier</th>
                    <th>Received</th>
                    <th>On hand</th>
                    <th>Status</th>
                    <th>Named tails built from it</th>
                  </tr>
                </thead>
                <tbody>
                  {c.lots
                    .filter((l) => !lotFilter || `${l.lot} ${l.pn} ${l.name}`.toLowerCase().includes(lotFilter.toLowerCase()))
                    .map((l) => (
                      <tr key={l.lot}>
                        <td className="mono">{l.lot}</td>
                        <td>{l.name}</td>
                        <td>{supplierName(c, l.supplier)}</td>
                        <td className="mono">{l.received}</td>
                        <td className="mono">
                          {l.on_hand} of {l.qty}
                        </td>
                        <td>
                          <span className={l.status === "released" ? "pill pill-ok" : "pill pill-warn"}>{l.status === "quarantined" ? "On hold" : l.status.charAt(0).toUpperCase() + l.status.slice(1)}</span>
                        </td>
                        <td className="meta">{l.where_used.map((w) => w.tail).join(", ") || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Parts and open purchase orders</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Released stock</th>
                    <th>Reorder point</th>
                    <th>Lead time</th>
                    <th>Open PO</th>
                  </tr>
                </thead>
                <tbody>
                  {c.parts.map((p) => {
                    const po = c.open_po.find((x) => x.pn === p.pn);
                    const low = p.reorder_point !== null && p.on_hand < p.reorder_point;
                    return (
                      <tr key={p.pn}>
                        <td>
                          <span className="mono">{p.pn}</span> {p.name}
                        </td>
                        <td className={low ? "mono fault" : "mono"}>{p.on_hand}</td>
                        <td className="mono">{p.reorder_point ?? "—"}</td>
                        <td className="mono">{p.lead_days} d</td>
                        <td className="meta">{po ? `${po.po}: ${po.qty} due ${po.due}${po.late_days ? `, ${po.late_days} d late` : ""}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "logistics" ? (
        <>
          <section className="panel" data-testid="kit-plans">
            <div className="panel-head">
              <h2>Replacement kits from the Attrition forecast</h2>
              <a className="btn btn-quiet" href="#attrition">
                Open Attrition
              </a>
            </div>
            {c.replenishment.length === 0 ? <p className="empty">No unit is forecast to run short.</p> : null}
            {c.replenishment.map((r) => (
              <article className="ins-alert" key={r.id}>
                <div>
                  <p className="ins-alert-title">
                    {r.unit}: {r.short} {r.name}
                  </p>
                  <p className="meta">
                    {r.from_stock} from unpromised finished goods, {r.to_build} to build.{" "}
                    {r.blocking.length ? `Blocked on ${r.blocking.map((b) => `${b.short} ${b.name.toLowerCase()}${b.short > 1 ? "s" : ""}`).join(", ")}${r.open_po[0] ? ` until ${r.open_po[0].po} lands` : ""}. ` : ""}
                    Spares pack: {r.spares.map((s) => `${s.qty} × ${s.name.toLowerCase()}`).join(", ")}.
                    {r.spares.some((s) => s.dg) ? " Battery packs ship as lithium dangerous goods." : ""}
                  </p>
                </div>
                {canWrite ? (
                  <button type="button" className="btn btn-primary" disabled={r.shipped} onClick={() => void act("/v1/company/ship", { plan: r.id }, `Kit plan for ${r.unit} released: shipment packed and the build order sent to the line.`)}>
                    {r.shipped ? "Released" : "Release kit plan"}
                  </button>
                ) : null}
              </article>
            ))}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Shipments</h2>
              <Sim />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th>To</th>
                    <th>Contents</th>
                    <th>Status</th>
                    <th>Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {c.shipments.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.id}</td>
                      <td>{s.unit}</td>
                      <td>
                        {s.qty > 0 ? `${s.qty} ${c.catalog.find((x) => x.sku === s.sku)?.name ?? s.sku}` : "Spares pack"}
                        {s.build_order ? `, ${s.build_order} ${c.catalog.find((x) => x.sku === s.sku)?.name ?? s.sku} to follow from the line` : ""}
                      </td>
                      <td>{s.status}</td>
                      <td className="meta">{s.dg ? "Lithium DG (UN3480)" : "General"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta">Export orders wait for their license before anything is packed (see ORD-C1 under Orders and plan).</p>
          </section>
        </>
      ) : null}

      {tab === "sustain" ? (
        <>
          <section className="panel" data-testid="work-orders">
            <div className="panel-head">
              <h2>Maintenance work orders</h2>
              <a className="btn btn-quiet" href="#fleet">
                Open Fleet
              </a>
            </div>
            <ul className="objective-list">
              {c.work_orders.map((w) => (
                <li key={w.id} className="co-wo">
                  <div>
                    <strong>
                      <span className="mono">{w.id}</span> {w.tail} <span className={w.status === "open" ? "pill pill-warn" : "pill pill-ok"}>{w.status}</span> <span className="pill">{w.kind}</span>
                    </strong>
                    <span className="meta">
                      {w.summary}
                      {w.parts.length ? `. Parts: ${w.parts.map((p) => `${p.qty} × ${p.name.toLowerCase()}`).join(", ")}` : ""}
                    </span>
                  </div>
                  {w.status === "open" && canWrite ? (
                    <button type="button" className="btn" onClick={() => void act("/v1/company/work-orders/close", { id: w.id }, `${w.id} closed; parts issued from the oldest released lots.`)}>
                      Close and issue parts
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Units in the field</h2>
              <Sim />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Flies</th>
                    <th>Airframes</th>
                    <th>Ground stations</th>
                    <th>Field spares</th>
                  </tr>
                </thead>
                <tbody>
                  {c.units.map((u) => (
                    <tr key={u.unit}>
                      <td>{u.unit}</td>
                      <td>{u.name}</td>
                      <td className="mono">{u.airframes}</td>
                      <td className="mono">{u.gcs}</td>
                      <td className="meta">
                        {Object.entries(u)
                          .filter(([k, v]) => /^[A-Z]+-/.test(k) && typeof v === "number")
                          .map(([k, v]) => `${String(v)} ${k}`)
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "training" ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Who can fly what they were sent</h2>
              <Sim />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Airframes</th>
                    <th>Operators (AD-O)</th>
                    <th>Instructors (AD-I)</th>
                    <th>Booked</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {c.training.map((t) => (
                    <tr key={t.unit}>
                      <td>{t.unit}</td>
                      <td className="mono">{t.airframes}</td>
                      <td className="mono">{t.operators}</td>
                      <td className="mono">{t.instructors}</td>
                      <td className="meta">{c.courses.filter((x) => x.unit === t.unit && x.status === "booked").map((x) => `${x.id} from ${x.start}`).join(", ") || "—"}</td>
                      <td>{t.gaps.length ? <span className="pill pill-warn">{t.gaps.join("; ")}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>MISSION Success classes</h2>
            </div>
            <ul className="objective-list">
              {c.courses.map((x) => (
                <li key={x.id}>
                  <strong>
                    <span className="mono">{x.id}</span> {x.name}
                  </strong>
                  <span className="meta">
                    {x.seats} seats, {x.unit ?? "Customer B"}, from {x.start}, {x.status}
                  </span>
                </li>
              ))}
            </ul>
            <p className="meta">Course names, lengths and class sizes are as Neros publishes them; bookings and unit rosters are simulated. The Operate console's training mode (qual-1) scores the console side of an operator's readiness.</p>
          </section>
        </>
      ) : null}

      {tab === "engineering" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Engineering change orders</h2>
            <Sim />
          </div>
          <ul className="objective-list">
            {c.ecos.map((e) => (
              <li key={e.id}>
                <strong>
                  <span className="mono">{e.id}</span> {e.title} <span className="pill">{e.status}</span>
                </strong>
                <span className="meta">
                  Why: {e.driver} (<a href={`#${e.link}`}>evidence</a>). Applies to {e.skus.map((s) => c.catalog.find((x) => x.sku === s)?.name ?? s).join(", ")}; effective {e.effectivity.toLowerCase()}.
                </span>
              </li>
            ))}
          </ul>
          <p className="meta">Each change names the platform evidence behind it and the serials it applies to, so Fleet can tell which airframes in the field have it.</p>
        </section>
      ) : null}
    </section>
  );
}
