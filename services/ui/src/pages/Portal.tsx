import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";
import "./company.css";
import "./ops.css";

interface Spare { pn: string; name?: string; qty: number }
interface Unit {
  unit: string; sku: string; name: string; airframes: number; gcs: number; operators: number; instructors: number;
  losses: number; days_of_supply: number | null; short: number;
  open_request?: { id: string; qty: number; status: string } | null;
  spares_on_hand: Spare[]; suggested_spares: Spare[]; training_gaps: string[]; suggested_course: string;
}
interface Order { id: string; name: string; qty: number; delivered: number; shipped: number; left: number; due: string; projected: string | null; at_risk: boolean; why: string }
interface Shipment { id: string; unit: string | null; name: string; qty: number; status: string; created: string; serials?: string[]; spares?: Spare[]; dg: boolean; order?: string; request?: string }
interface Request { id: string; kind: string; origin: string; title: string; status: string; created: string; by: string; note?: string; reason?: string; rma?: string; shipment?: string; course?: string }
interface Course { id: string; name: string; unit: string | null; seats: number; start: string; status: string }
interface Received { tail: string; name: string; status: string; reason: string | null; shipment: string }
interface Portal {
  source: string;
  today: string;
  org: { id: string; name: string; country: string; sharing: boolean };
  units: Unit[];
  orders: Order[];
  shipments: Shipment[];
  requests: Request[];
  courses: Course[];
  received: Received[];
  catalog: { sku: string; name: string }[];
  tails: string[];
}

const STATUS: Record<string, string> = {
  submitted: "Waiting on Neros",
  proposed: "Neros proposes",
  approved: "Approved, shipping next",
  authorised: "Return authorised",
  booked: "Class booked",
  shipped: "Shipped",
  delivered: "Delivered",
  declined: "Declined",
};
const GOOD = new Set(["approved", "authorised", "booked", "shipped", "delivered"]);

/** A customer's own workspace: their units, orders and shipments, and what they need from Neros. */
export function PortalPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const neros = viewer.org === "neros" || !viewer.org;
  const [org, setOrg] = useState("CUS-A");
  const [data, setData] = useState<Portal | null>(null);
  const [fault, setFault] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [sparesFor, setSparesFor] = useState<string | null>(null);
  const [spares, setSpares] = useState<Spare[]>([]);
  const [rmaTail, setRmaTail] = useState("");
  const [rmaIssue, setRmaIssue] = useState("");
  const canAct = viewer.roles.some((r) => ["admin", "mission_commander", "maintainer"].includes(r));

  function load() {
    void api<Portal>(`/v1/ops/portal${neros ? `?org=${org}` : ""}`)
      .then((r) => {
        onBannerRef.current(r.banner);
        setData(r.body);
        setFault("");
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "Could not load your workspace."));
  }
  useEffect(load, [org]);

  async function act(action: string, args: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("/v1/ops/act", { method: "POST", body: JSON.stringify({ action, args: { ...args, org } }) });
      setNote({ text: r.body.message, ok: true });
      return true;
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : "That did not go through.", ok: false });
      return false;
    } finally {
      setBusy(false);
      load();
    }
  }

  if (!data) {
    return <section className="page">{fault ? <p className="fault" role="alert">{fault}</p> : <p className="meta">Loading…</p>}</section>;
  }
  const d = data;
  const proposals = d.requests.filter((r) => r.status === "proposed");
  const incoming = d.shipments.filter((s) => s.status !== "delivered");
  const restricted = d.received.filter((r) => r.status !== "airworthy");
  const toAccept = [...new Set(restricted.map((r) => r.shipment))].map((shipment) => ({ shipment, tails: restricted.filter((r) => r.shipment === shipment) }));
  const needs = proposals.length + incoming.length + toAccept.length;
  const disabled = !canAct || busy;

  return (
    <section className="page ins-page co-page ops-page" data-testid="portal">
      <header className="page-head">
        <div>
          <p className="kicker">{d.org.name.replace(" (SIM)", "")}</p>
          <h1 className="page-title">Requests to Neros</h1>
          <p className="lede">Your units, what is on order and on the way, and what you need from Neros: replacements, spares, training or a repair. Requests go straight to Neros operations.</p>
        </div>
        <span className="pill pill-warn" title="Simulated demo data">SIM</span>
      </header>
      <p className="ins-source">{d.source}</p>
      {neros ? (
        <div className="ops-preview">
          <span className="meta">Neros preview of a customer workspace:</span>
          {["CUS-A", "CUS-B", "CUS-C"].map((id) => (
            <button key={id} type="button" className={org === id ? "ops-chip is-on" : "ops-chip"} onClick={() => setOrg(id)}>
              {id.replace("CUS-", "Customer ")}
            </button>
          ))}
        </div>
      ) : null}
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {note ? (
        <p className={note.ok ? "ops-note" : "ops-note is-bad"} role="status">
          {note.text}
        </p>
      ) : null}
      {!canAct ? <p className="meta">You can see everything here; requests and receipts need the mission commander or maintainer role.</p> : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Needs you {needs ? <span className="ops-count">{needs}</span> : null}</h2>
        </div>
        {needs === 0 ? <p className="meta">Nothing waiting on you.</p> : null}
        <ul className="ops-list">
          {proposals.map((r) => (
            <li key={r.id} className="ops-item sev-high">
              <p className="ops-title">Neros proposes {r.title}</p>
              <p className="ops-detail">{r.id}. {r.note}. Accept and it ships; decline and nothing happens.</p>
              <div className="ops-actions">
                <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void act("proposal.accept", { id: r.id })}>Accept</button>
                <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => void act("proposal.decline", { id: r.id })}>Decline</button>
              </div>
            </li>
          ))}
          {incoming.map((s) => (
            <li key={s.id} className="ops-item sev-medium">
              <p className="ops-title">
                {s.id} on the way{s.unit ? ` to ${s.unit}` : ""}: {s.qty ? `${s.qty} ${s.name}` : ""}
                {s.spares?.length ? `${s.qty ? " + " : ""}spares (${s.spares.map((x) => `${x.qty} ${x.pn}`).join(", ")})` : ""}
              </p>
              <p className="ops-detail">
                {s.order ? `Against ${s.order}. ` : s.request ? `For ${s.request}. ` : ""}
                {s.serials?.length ? `Serials ${s.serials[0]}–${s.serials[s.serials.length - 1]}. ` : ""}
                {s.dg ? "Lithium packs travel as dangerous goods. " : ""}Sign for it when it arrives{s.serials?.length ? "; the airframes join your fleet" : ""}.
              </p>
              <div className="ops-actions">
                <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void act("shipment.receive", { id: s.id })}>Sign for it</button>
              </div>
            </li>
          ))}
          {toAccept.map((g) => (
            <li key={g.shipment} className="ops-item sev-low">
              <p className="ops-title">
                {g.tails.length} {g.tails[0]?.name} from {g.shipment} restricted until their acceptance flights
              </p>
              <p className="ops-detail">
                {g.tails.length === 1 ? g.tails[0]?.tail : `${g.tails[0]?.tail} to ${g.tails[g.tails.length - 1]?.tail}`}. Each one is in your Fleet list as restricted; it can fly a sortie once accepted.
              </p>
              <div className="ops-actions">
                <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void act("airframe.accept", { shipment: g.shipment })}>
                  Acceptance flights passed
                </button>
                <a className="btn btn-quiet" href="#fleet">See them in Fleet</a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {d.units.length ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Your units</h2>
          </div>
          <div className="table-wrap">
            <table data-testid="portal-units">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Airframe</th>
                  <th>On hand</th>
                  <th>Lost, 14 days</th>
                  <th>Days of supply</th>
                  <th>Operators</th>
                  <th>Ask Neros</th>
                </tr>
              </thead>
              <tbody>
                {d.units.map((u) => {
                  const n = qty[u.unit] ?? (u.short || 5);
                  return (
                    <tr key={u.unit}>
                      <td>
                        <strong>{u.unit}</strong>
                      </td>
                      <td>{u.name}</td>
                      <td className="mono">{u.airframes}</td>
                      <td className="mono">{u.losses}</td>
                      <td>
                        {u.days_of_supply == null ? "—" : <span className={u.days_of_supply < 10 ? "pill pill-warn" : "pill pill-ok"}>{u.days_of_supply} days</span>}
                        {u.short ? <span className="meta"> {u.short} short</span> : null}
                        {u.open_request ? <span className="meta"> · {u.open_request.qty} on {u.open_request.id} ({u.open_request.status.replaceAll("_", " ")})</span> : null}
                      </td>
                      <td>
                        {u.operators}
                        {u.training_gaps.length ? <span className="meta"> · {u.training_gaps[0]}</span> : null}
                      </td>
                      <td>
                        <div className="ops-ask">
                          <input type="number" min={1} max={500} aria-label={`Airframes for ${u.unit}`} value={n} onChange={(e) => setQty((q) => ({ ...q, [u.unit]: Number(e.target.value) }))} />
                          <button
                            type="button"
                            className={u.short && !u.open_request ? "btn btn-primary" : "btn btn-quiet"}
                            disabled={disabled || Boolean(u.open_request)}
                            title={u.open_request ? `${u.open_request.id} is already open for ${u.unit}` : undefined}
                            onClick={() => void act("request.replacement", { unit: u.unit, qty: n })}
                          >
                            {u.open_request ? `${u.open_request.id} open` : "Request airframes"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={disabled}
                            onClick={() => {
                              setSparesFor(sparesFor === u.unit ? null : u.unit);
                              setSpares(u.suggested_spares.map((s) => ({ ...s })));
                            }}
                          >
                            Spares…
                          </button>
                          {u.training_gaps.length ? (
                            <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => void act("request.training", { unit: u.unit, sku: u.suggested_course, seats: u.suggested_course === "TRN-ADI" ? 2 : 6 })}>
                              Request {u.suggested_course === "TRN-ADI" ? "instructor course" : "operator course"}
                            </button>
                          ) : null}
                        </div>
                        {sparesFor === u.unit ? (
                          <div className="ops-spares">
                            {spares.map((s, i) => (
                              <label key={s.pn}>
                                <span>{s.name ?? s.pn}</span>
                                <input type="number" min={0} value={s.qty} onChange={(e) => setSpares((list) => list.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                              </label>
                            ))}
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={disabled}
                              onClick={() => void act("request.spares", { unit: u.unit, items: spares.filter((s) => s.qty > 0).map((s) => ({ pn: s.pn, qty: s.qty })) }).then((ok) => ok && setSparesFor(null))}
                            >
                              Send spares request
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="meta">
            Days of supply comes from your own loss forecast (Attrition). {d.org.sharing ? "You share it with Neros, so Neros can propose resupply before you run short." : "You do not share it with Neros; ask for what you need here."}
          </p>
        </section>
      ) : (
        <section className="panel">
          <p className="meta">No fielded units on file yet. Orders and training show below.</p>
        </section>
      )}

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Your requests</h2>
          </div>
          {d.requests.length === 0 ? <p className="meta">No requests yet.</p> : null}
          <ul className="ops-req">
            {d.requests.map((r) => (
              <li key={r.id}>
                <span className="mono">{r.id}</span> {r.title}
                <span className={GOOD.has(r.status) ? "pill pill-ok" : r.status === "declined" ? "pill" : "pill pill-warn"}>{STATUS[r.status] ?? r.status}</span>
                <span className="meta">
                  {r.origin === "neros" ? "Proposed by Neros" : r.by} · {r.created}
                  {r.rma ? ` · ${r.rma}` : ""}
                  {r.shipment ? ` · ${r.shipment}` : ""}
                  {r.course ? ` · ${r.course}` : ""}
                  {r.reason ? ` · ${r.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Report a fault</h2>
          </div>
          <p className="meta">Neros authorises a return and ships an advance replacement from stock.</p>
          <form
            className="ops-rma"
            onSubmit={(e) => {
              e.preventDefault();
              void act("request.rma", { tail: rmaTail || d.tails[0], issue: rmaIssue }).then((ok) => ok && setRmaIssue(""));
            }}
          >
            <label>
              <span>Airframe</span>
              <select value={rmaTail || d.tails[0] || ""} onChange={(e) => setRmaTail(e.target.value)}>
                {d.tails.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              <span>What is wrong</span>
              <input value={rmaIssue} maxLength={200} placeholder="Video drops past 2 km on the dual-band radio" onChange={(e) => setRmaIssue(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={disabled || !rmaIssue.trim() || !d.tails.length}>Send to Neros</button>
          </form>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>On order</h2>
        </div>
        <div className="table-wrap">
          <table data-testid="portal-orders">
            <thead>
              <tr>
                <th>Order</th>
                <th>Item</th>
                <th>Delivered</th>
                <th>On the way</th>
                <th>Due</th>
                <th>Expected</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {d.orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.id}</td>
                  <td>{o.name}</td>
                  <td className="mono">{o.delivered} of {o.qty}</td>
                  <td className="mono">{o.shipped || "—"}</td>
                  <td className="mono">{o.due}</td>
                  <td>{o.left ? <span className={o.at_risk ? "pill pill-warn" : "pill pill-ok"}>{o.projected ?? "On hold"}</span> : "—"}</td>
                  <td className="meta">{o.why || "On track"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ops-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Training</h2>
          </div>
          <ul className="ops-req">
            {d.courses.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.id}</span> {c.name.split(" / ")[1] ?? c.name}
                <span className={c.status === "complete" ? "pill pill-ok" : "pill"}>{c.status}</span>
                <span className="meta">{c.unit ?? "Programme"} · {c.seats} seats · {c.start}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Data sharing</h2>
          </div>
          <p className="meta">
            Your loss and readiness data stays yours. Sharing it lets Neros see when a unit will run short and propose resupply, and feeds the failure analysis that finds bad part lots.
          </p>
          <label className="ops-toggle">
            <input type="checkbox" checked={d.org.sharing} disabled={disabled} onChange={(e) => void act("sharing.set", { on: e.target.checked })} />
            <span>{d.org.sharing ? "Sharing loss data with Neros" : "Not sharing loss data"}</span>
          </label>
        </section>
      </div>
    </section>
  );
}
