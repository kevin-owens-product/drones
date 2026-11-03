import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";
import "./company.css";
import "./ops.css";

interface Action { label: string; action: string; args: Record<string, unknown>; primary?: boolean }
interface Item { id: string; area: string; severity: "high" | "medium" | "low"; title: string; detail: string; org?: string; actions: Action[] }
interface Queue {
  source: string;
  today: string;
  items: Item[];
  areas: { area: string; count: number }[];
  customers: { id: string; name: string; sharing: boolean; open_requests: number }[];
}
interface Done { at: string; text: string; ok: boolean }

const SEVERITY_LABEL = { high: "Now", medium: "Today", low: "This week" } as const;

/** Neros's own operations: one queue of work drawn from orders, the line, suppliers, quality and customers. */
export function OpsPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [data, setData] = useState<Queue | null>(null);
  const [fault, setFault] = useState("");
  const [area, setArea] = useState("All");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<Done[]>([]);
  const canAct = viewer.roles.some((r) => r === "admin" || r === "ops_lead");

  function load() {
    void api<Queue>("/v1/ops/queue")
      .then((r) => {
        onBannerRef.current(r.banner);
        setData(r.body);
        setFault("");
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "Could not load the work queue."));
  }
  useEffect(load, []);

  async function run(item: Item, a: Action) {
    setBusy(`${item.id}:${a.label}`);
    try {
      const r = await api<{ message: string }>("/v1/ops/act", { method: "POST", body: JSON.stringify({ action: a.action, args: a.args }) });
      setDone((d) => [{ at: new Date().toISOString().slice(11, 16), text: r.body.message, ok: true }, ...d].slice(0, 12));
    } catch (error) {
      setDone((d) => [{ at: new Date().toISOString().slice(11, 16), text: error instanceof Error ? error.message : "That did not go through.", ok: false }, ...d].slice(0, 12));
    } finally {
      setBusy("");
      load();
    }
  }

  if (!data) {
    return <section className="page">{fault ? <p className="fault" role="alert">{fault}</p> : <p className="meta">Loading…</p>}</section>;
  }
  const shown = data.items.filter((i) => area === "All" || i.area === area);
  const now = data.items.filter((i) => i.severity === "high").length;

  return (
    <section className="page ins-page co-page ops-page" data-testid="ops">
      <header className="page-head">
        <div>
          <p className="kicker">Neros operations</p>
          <h1 className="page-title">Work queue</h1>
          <p className="lede">Everything that needs a decision today, from customer requests to late purchase orders, each with the action that clears it. Every action is recorded in the audit log.</p>
        </div>
        <span className="pill pill-warn" title="Simulated demo data">SIM</span>
      </header>
      <p className="ins-source">{data.source}</p>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {!canAct ? <p className="meta">You can see the queue; acting on it needs the Neros ops lead or admin role.</p> : null}

      <div className="ops-layout">
        <div className="ops-main">
          <div className="ops-filter" role="tablist" aria-label="Filter by area">
            {[{ area: "All", count: data.items.length }, ...data.areas].map((a) => (
              <button key={a.area} type="button" role="tab" aria-selected={area === a.area} className={area === a.area ? "ops-chip is-on" : "ops-chip"} onClick={() => setArea(a.area)}>
                {a.area} <span className="ops-count">{a.count}</span>
              </button>
            ))}
          </div>
          <p className="meta ops-summary">
            {data.items.length} open items, {now} that need someone now. Today is {data.today} in the scenario.
          </p>
          {shown.length === 0 ? <p className="meta">Nothing open here.</p> : null}
          <ul className="ops-list" data-testid="ops-items">
            {shown.map((i) => (
              <li key={i.id} className={`ops-item sev-${i.severity}`}>
                <div className="ops-item-head">
                  <span className={`ops-sev sev-${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span>
                  <span className="ops-area">{i.area}</span>
                  {i.org ? <span className="ops-org">{data.customers.find((c) => c.id === i.org)?.name.split(":")[0] ?? i.org}</span> : null}
                </div>
                <p className="ops-title">{i.title}</p>
                <p className="ops-detail">{i.detail}</p>
                <div className="ops-actions">
                  {i.actions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      className={a.primary ? "btn btn-primary" : "btn btn-quiet"}
                      disabled={!canAct || busy !== ""}
                      onClick={() => void run(i, a)}
                    >
                      {busy === `${i.id}:${a.label}` ? "Working…" : a.label}
                    </button>
                  ))}
                  {i.actions.length === 0 ? <span className="meta">Waiting on parts; see Supply.</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside className="ops-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Done this session</h2>
            </div>
            {done.length === 0 ? (
              <p className="meta">Actions you take show here, and in the audit log.</p>
            ) : (
              <ul className="ops-done" role="status">
                {done.map((d, n) => (
                  <li key={`${d.at}-${n}`} className={d.ok ? undefined : "is-bad"}>
                    <span className="mono">{d.at}</span> {d.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Customers</h2>
            </div>
            <ul className="ops-cust">
              {data.customers.map((c) => (
                <li key={c.id}>
                  <strong>{c.name.split(":")[0]}</strong>
                  <span className="meta">{c.name.split(":")[1]?.replace(" (SIM)", "").trim()}</span>
                  <span className="meta">
                    {c.open_requests} open request{c.open_requests === 1 ? "" : "s"} ·{" "}
                    {c.sharing ? <span className="pill pill-ok">Shares loss data</span> : <span className="pill">Not sharing</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="meta">A customer that shares loss data gets resupply proposals before it runs short. Use the Customer switch at the top to see their portal.</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
