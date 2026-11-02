import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Viewer = {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
};

interface AuditRow {
  seq: number;
  id: string;
  occurred_at: string;
  actor_id: string;
  action: string;
  resource_type: string;
  decision: string;
  reason_codes: string[];
  prev_hash: string;
  row_hash: string;
}

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : "";
}

function explain(error: unknown): string {
  const code = codeOf(error);
  if (code === "not_found") {
    return "The audit chain could not be found.";
  }
  if (code === "role_denied" || code === "denied") {
    return "The audit chain is limited to the auditor role.";
  }
  return "The audit chain could not be loaded.";
}

function compactTime(value: string): string {
  return value.replace(/\.\d+Z$/, "Z").replace("T", " ").replace(/Z$/, " UTC");
}

function hashPrefix(value: string): string {
  const hex = value.trim();
  if (hex.length === 0) {
    return "—";
  }
  return hex.length <= 12 ? hex : hex.slice(0, 12);
}

function decisionClass(decision: string): string {
  return decision === "allow" ? "pill pill-ok" : "pill pill-warn";
}

function reasonText(codes: readonly string[] | null | undefined): string {
  if (!codes || codes.length === 0) {
    return "—";
  }
  return codes.join(", ");
}

export function AuditPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [items, setItems] = useState<AuditRow[]>([]);
  const [access, setAccess] = useState<"loading" | "open" | "limited" | "failed">("loading");
  const [fault, setFault] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"all" | "allow" | "deny">("all");

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const result = await api<{ items: AuditRow[] }>("/v1/audit");
        if (stopped) {
          return;
        }
        onBannerRef.current(result.banner);
        setItems(result.body.items);
        setAccess("open");
        setFault("");
      } catch (error) {
        if (stopped) {
          return;
        }
        setItems([]);
        if (codeOf(error) === "role_denied") {
          setAccess("limited");
          setFault("");
          return;
        }
        setAccess("failed");
        setFault(explain(error));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [viewer.id]);

  const ordered = [...items]
    .filter((row) => decisionFilter === "all" || row.decision === decisionFilter)
    .sort((left, right) => right.seq - left.seq);

  return (
    <section className="page page-fill" id="page-audit">
      <header className="page-head">
        <div>
          <p className="kicker">Tenant</p>
          <h1 className="page-title">Audit</h1>
          <p className="lede">Each row is chained to the hash before it.</p>
        </div>
      </header>
      {access === "limited" ? (
        <div className="denied panel">The audit chain is limited to the auditor role.</div>
      ) : null}
      {access === "failed" ? <p className="fault" role="alert">{fault}</p> : null}
      {access === "loading" ? <p className="meta">Loading the audit chain.</p> : null}
      {access === "open" ? (
        <div className="role-switch">
          <button type="button" className={decisionFilter === "all" ? "btn btn-primary" : "btn"} onClick={() => setDecisionFilter("all")}>All</button>
          <button type="button" className={decisionFilter === "allow" ? "btn btn-primary" : "btn"} onClick={() => setDecisionFilter("allow")}>Allow</button>
          <button type="button" className={decisionFilter === "deny" ? "btn btn-primary" : "btn"} onClick={() => setDecisionFilter("deny")}>Deny</button>
        </div>
      ) : null}
      {access === "open" && ordered.length === 0 ? <p className="empty">No events in this filter.</p> : null}
      {access === "open" && ordered.length > 0 ? (
        <div className="chain">
          {ordered.map((row) => (
            <article className="chain-row" key={row.id}>
              <p className="meta">{compactTime(row.occurred_at)}</p>
              <div>
                <strong>{row.action}</strong>
                <p className="meta">{row.resource_type} · {reasonText(row.reason_codes)}</p>
                <p className="meta"><code>{hashPrefix(row.prev_hash)} → {hashPrefix(row.row_hash)}</code></p>
              </div>
              <span className={decisionClass(row.decision)}>{row.decision}</span>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
