import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import "./insights.css";
import "./company.css";
import "./ops.css";
import "./thread.css";

/** Load a page's data, refresh after actions, and post actions with a status line. */
export function usePageData<T>(path: string, onBanner: (banner: string) => void) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [data, setData] = useState<T | null>(null);
  const [fault, setFault] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api<T>(path)
      .then((r) => {
        onBannerRef.current(r.banner);
        setData(r.body);
        setFault("");
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "Could not load this page."));
  }, [path]);
  useEffect(load, [load]);

  async function post(endpoint: string, action: string, args: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>(endpoint, { method: "POST", body: JSON.stringify({ action, args }) });
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

  return { data, fault, note, busy, load, post, setNote };
}

export function Loading({ fault }: { fault: string }) {
  return <section className="page">{fault ? <p className="fault" role="alert">{fault}</p> : <p className="meta">Loading…</p>}</section>;
}

export function Note({ note }: { note: { text: string; ok: boolean } | null }) {
  if (!note) return null;
  return (
    <p className={note.ok ? "ops-note" : "ops-note is-bad"} role="status">
      {note.text}
    </p>
  );
}

export function PageHead({ kicker, title, lede, testid }: { kicker: string; title: string; lede: string; testid?: string }) {
  return (
    <header className="page-head" data-testid={testid}>
      <div>
        <p className="kicker">{kicker}</p>
        <h1 className="page-title">{title}</h1>
        <p className="lede">{lede}</p>
      </div>
      <span className="pill pill-warn" title="Simulated demo data">SIM</span>
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="meta">{hint}</span> : null}
    </div>
  );
}

/** Neros staff looking at a customer page pick which customer; customers see their own. */
export function useCustomerOrg(viewer: Viewer) {
  const neros = viewer.org === "neros" || !viewer.org;
  const [org, setOrg] = useState("CUS-A");
  const picker = neros ? (
    <div className="ops-preview">
      <span className="meta">Neros preview of a customer workspace:</span>
      {["CUS-A", "CUS-B"].map((id) => (
        <button key={id} type="button" className={org === id ? "ops-chip is-on" : "ops-chip"} onClick={() => setOrg(id)}>
          {id.replace("CUS-", "Customer ")}
        </button>
      ))}
    </div>
  ) : null;
  return { org, query: neros ? `?org=${org}` : "", picker, neros };
}

/** What an allied session's releasability rules removed from this page's data, and why. The server strips it; this only says so. */
export function Withheld({ data }: { data: unknown }) {
  const d = data as { _withheld?: { field: string; label: string; reason: string }[]; _marking?: string } | null;
  if (!d?._withheld?.length && !d?._marking) return null;
  return (
    <div className="th-callout mk-withheld" data-testid="withheld">
      {d._marking ? <strong>{d._marking}. </strong> : null}
      {d._withheld?.length ? <>Withheld for releasability: {d._withheld.map((w) => `${w.label} (${w.reason})`).join("; ")}</> : "Nothing on this page is withheld."}
    </div>
  );
}

export const pct = (x: number | null | undefined, digits = 0) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);

interface SerialEvent { seq: number; day: string; kind: string; text: string; owner: string; hash: string; prev_hash: string }
interface SerialRecord {
  serial: string; name: string; state: string; verified: boolean;
  parts: Record<string, string>;
  firmware: { version: string; sha256: string; released: boolean };
  bench: { station: string; imu: number; vibration_g: number; hover_s: number; passed: boolean } | null;
  events: SerialEvent[];
}

/** One serial's record, factory bench to last flight, each event hashing the one before it. */
export function SerialDrawer({ serial, onClose }: { serial: string; onClose: () => void }) {
  const [rec, setRec] = useState<SerialRecord | null>(null);
  const [fault, setFault] = useState("");
  useEffect(() => {
    void api<SerialRecord>(`/v1/thread/serial?serial=${encodeURIComponent(serial)}`)
      .then((r) => setRec(r.body))
      .catch((e: unknown) => setFault(e instanceof Error ? e.message : "Could not load the record."));
  }, [serial]);
  return (
    <div className="th-drawer" role="dialog" aria-label={`Serial record ${serial}`} data-testid="serial-drawer">
      <div className="th-drawer-head">
        <div>
          <p className="kicker">Serial record</p>
          <h2 className="mono">{serial}</h2>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
      </div>
      {fault ? <p className="fault">{fault}</p> : null}
      {rec ? (
        <>
          <p className="meta">
            {rec.name} · {rec.state} · firmware {rec.firmware.version}{rec.firmware.released ? "" : " (not released)"} ·{" "}
            {rec.verified ? <span className="pill pill-ok">Chain verified</span> : <span className="pill pill-warn">Chain broken</span>}
          </p>
          <dl className="th-parts">
            {Object.entries(rec.parts).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="mono">{v}</dd>
              </div>
            ))}
          </dl>
          <ol className="th-events">
            {rec.events.map((e) => (
              <li key={e.seq} className={`th-ev th-ev-${e.kind}`}>
                <span className="mono th-ev-day">{e.day}</span>
                <span className="th-ev-kind">{e.kind}</span>
                <span>{e.text}</span>
                <span className="mono th-hash" title={`prev ${e.prev_hash}`}>{e.hash.slice(0, 10)}</span>
              </li>
            ))}
          </ol>
          <p className="meta">Neros writes the build events; the customer writes everything after acceptance. Each event's hash covers the one before it, so an edit anywhere breaks the chain.</p>
        </>
      ) : null}
    </div>
  );
}

/** The provenance packet for one delivery lot, as JSON the customer can file or forward. */
export function PacketDrawer({ lot, onClose }: { lot: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [fault, setFault] = useState("");
  useEffect(() => {
    void api<{ status: string }>(`/v1/thread/packet?lot=${encodeURIComponent(lot)}`)
      .then((r) => {
        setText(JSON.stringify(r.body, null, 2));
        setStatus(r.body.status);
      })
      .catch((e: unknown) => setFault(e instanceof Error ? e.message : "Could not load the packet."));
  }, [lot]);
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lot}-provenance.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="th-drawer" role="dialog" aria-label={`Provenance packet ${lot}`} data-testid="packet-drawer">
      <div className="th-drawer-head">
        <div>
          <p className="kicker">Provenance packet</p>
          <h2 className="mono">{lot}</h2>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
      </div>
      {fault ? <p className="fault">{fault}</p> : null}
      {text ? (
        <>
          <p className="meta">
            Status: <span className={status === "complete" ? "pill pill-ok" : "pill pill-warn"}>{status}</span> Every component lot the serials carry, with sub-component origins by tier, Blue List and FCC exemption basis, and where the firmware is hosted.
          </p>
          <div className="ops-actions">
            <button type="button" className="btn btn-primary" onClick={download}>Download JSON</button>
          </div>
          <pre className="th-code">{text}</pre>
        </>
      ) : null}
    </div>
  );
}
