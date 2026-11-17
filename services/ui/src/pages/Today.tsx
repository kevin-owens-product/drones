import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Section, Viewer } from "../shell/types";
import "./insights.css";
import "./company.css";
import "./ops.css";

interface Action {
  label: string;
  primary?: boolean;
  /** A write through the route the page itself uses. */
  post?: { path: string; body: unknown };
  /** A page to open, with the record it should open on. */
  go?: Section;
  hand?: { key: string; value: string };
}
interface Item { id: string; area: string; severity: "now" | "today" | "week"; title: string; detail: string; actions: Action[] }
interface Today { source: string; lead: string; profiles: string[]; items: Item[]; areas: { area: string; count: number }[]; now: number }
interface Done { at: string; text: string; ok: boolean }

const DONE_PREFIX = "a2e-today-done";
const SEVERITY_LABEL = { now: "Now", today: "Today", week: "This week" } as const;

/** A short sentence for what an action did, from the route's own answer. */
function said(body: unknown, item: Item, a: Action): string {
  const b = body as { message?: string; note?: string; state?: string; work_order?: { tail?: string } } | null;
  if (b?.message) return b.message;
  if (b?.note) return /[.!?]$/.test(b.note) ? b.note : `${b.note}.`;
  if (b?.state) return `${item.title.match(/M-\d+/)?.[0] ?? "The plan"} is now ${b.state}.`;
  if (b?.work_order?.tail) return `${b.work_order.tail} is back in service; its launch checks run again.`;
  if (a.post?.path === "/v1/attrition/hold") return `${a.label.replace(/^Hold/, "Held")}; their launch checks now block them.`;
  return `${a.label}: done.`;
}

/** What is waiting on this person in their own workspace, each item with the action that clears it. */
export function TodayPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [data, setData] = useState<Today | null>(null);
  const [fault, setFault] = useState("");
  const [area, setArea] = useState("All");
  const [busy, setBusy] = useState("");
  // Each person's own record: the demo keeps one tab across sign-ins.
  const DONE_KEY = `${DONE_PREFIX}:${viewer.username}`;
  const [done, setDoneState] = useState<Done[]>(() => {
    try {
      const raw = sessionStorage.getItem(DONE_KEY);
      return raw ? (JSON.parse(raw) as Done[]) : [];
    } catch {
      return [];
    }
  });
  function note(d: Done) {
    setDoneState((all) => {
      const out = [d, ...all].slice(0, 12);
      try {
        sessionStorage.setItem(DONE_KEY, JSON.stringify(out));
      } catch {
        /* not kept */
      }
      return out;
    });
  }

  function load() {
    void api<Today>("/v1/today")
      .then((r) => {
        onBannerRef.current(r.banner);
        setData(r.body);
        setFault("");
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "Could not load what is waiting on you."));
  }
  useEffect(load, []);

  async function run(item: Item, a: Action) {
    if (a.go) {
      if (a.hand) {
        try {
          sessionStorage.setItem(a.hand.key, a.hand.value);
        } catch {
          /* the page opens on its default */
        }
      }
      window.location.hash = a.go;
      return;
    }
    if (!a.post) return;
    setBusy(`${item.id}:${a.label}`);
    const at = new Date().toISOString().slice(11, 16);
    try {
      const r = await api<unknown>(a.post.path, { method: "POST", body: JSON.stringify(a.post.body) });
      note({ at, text: said(r.body, item, a), ok: true });
    } catch (error) {
      const why = error instanceof Error ? error.message : "That did not go through.";
      note({ at, text: why === "two_person_required" ? "You drafted that plan, so someone else approves it." : why === "role_denied" ? "Your role cannot do that; it is shown so you know it is waiting." : why, ok: false });
    } finally {
      setBusy("");
      load();
    }
  }

  if (!data) {
    return <section className="page">{fault ? <p className="fault" role="alert">{fault}</p> : <p className="meta">Loading…</p>}</section>;
  }
  const shown = data.items.filter((i) => area === "All" || i.area === area);
  const first = viewer.display_name.replace(/^Demo /, "").split(" (")[0];

  return (
    <section className="page ins-page co-page ops-page" data-testid="today">
      <header className="page-head">
        <div>
          <p className="kicker">{first}</p>
          <h1 className="page-title">Today</h1>
          <p className="lede">
            {data.lead} Every item says why it is yours and has the button that clears it; the pages behind it are one click away.
          </p>
        </div>
        <span className="pill pill-warn" title="Simulated demo data">SIM</span>
      </header>
      <p className="ins-source">{data.source}</p>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}

      <div className="ops-layout">
        <div className="ops-main">
          <div className="ops-filter" role="tablist" aria-label="Filter by area">
            {[{ area: "All", count: data.items.length }, ...data.areas].map((a) => (
              <button key={a.area} type="button" role="tab" aria-selected={area === a.area} className={area === a.area ? "ops-chip is-on" : "ops-chip"} onClick={() => setArea(a.area)}>
                {a.area} <span className="ops-count">{a.count}</span>
              </button>
            ))}
          </div>
          <p className="meta ops-summary" data-testid="today-summary">
            {data.items.length === 0 ? "Nothing is waiting on you." : `${data.items.length} waiting on you, ${data.now} of them now.`}
          </p>
          <ul className="ops-list" data-testid="today-items">
            {shown.map((i) => {
              const sev = i.severity === "now" ? "high" : i.severity === "today" ? "medium" : "low";
              return (
                <li key={i.id} className={`ops-item sev-${sev}`} data-item={i.id}>
                  <div className="ops-item-head">
                    <span className={`ops-sev sev-${sev}`}>{SEVERITY_LABEL[i.severity]}</span>
                    <span className="ops-area">{i.area}</span>
                  </div>
                  <p className="ops-title">{i.title}</p>
                  <p className="ops-detail">{i.detail}</p>
                  <div className="ops-actions">
                    {i.actions.map((a) => (
                      <button key={a.label} type="button" className={a.primary ? "btn btn-primary" : "btn btn-quiet"} disabled={busy !== ""} onClick={() => void run(i, a)}>
                        {busy === `${i.id}:${a.label}` ? "Working…" : a.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="ops-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Done this session</h2>
            </div>
            {done.length === 0 ? (
              <p className="meta">What you clear here shows up here, and in the audit log.</p>
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
              <h2>Where this comes from</h2>
            </div>
            <p className="meta">
              Plans and their launch checks (Missions), work orders (Airframes), deliveries (Receiving, Requests to Neros), releases (Software updates) and loss
              data (Attrition). Today adds no data of its own: an item clears when the thing behind it changes, wherever you change it.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
