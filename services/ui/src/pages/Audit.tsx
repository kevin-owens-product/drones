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
  resource_id?: string;
  detail?: string;
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
    return "The audit log needs the auditor or admin role.";
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

const ACTION_TEXT: Record<string, string> = {
  "brief.propose": "Brief read into a plan",
  "brief.approve": "Plan approved",
  "brief.reject": "Plan rejected",
  "mission.approve": "Mission approved",
  "attrition.hold": "Parts lot held",
  "field_report.file": "Field report filed",
  "platform.ground": "Airframe grounded",
  "platform.restrict": "Airframe restricted",
  "platform.return_to_service": "Airframe returned to service",
  "mission.draft": "Plan drafted",
  "mission.review": "Plan sent for review",
  "mission.execute": "Plan released to operators",
  "mission.close": "Plan closed",
  "debrief.release": "Debrief released",
  "work_order.close": "Work order closed",
  "kit.ship": "Replacement kit shipped",
  "request.approve": "Customer request approved",
  "request.decline": "Customer request declined",
  "request.fulfil": "Customer request shipped",
  "request.propose": "Resupply proposed to a customer",
  "order.ship": "Order shipped",
  "licence.record": "Export licence recorded",
  "build.run": "Build run",
  "po.raise": "Purchase order raised",
  "po.expedite": "Purchase order expedited",
  "po.receive": "Purchase order received",
  "lot.accept": "Parts lot accepted",
  "lot.reject": "Parts lot rejected",
  "lot.disposition": "Parts lot dispositioned",
  "scar.close": "Supplier corrective action closed",
  "eco.approve": "Engineering change approved",
  "wo.close": "Work order closed",
  "request.replacement": "Customer asked for airframes",
  "request.spares": "Customer asked for spares",
  "request.training": "Customer asked for training",
  "request.rma": "Customer reported a fault",
  "proposal.accept": "Customer accepted a proposal",
  "proposal.decline": "Customer declined a proposal",
  "shipment.receive": "Customer signed for a shipment",
  "airframe.accept": "Customer accepted an airframe",
  "sharing.set": "Customer changed data sharing",
};

function actionText(action: string): string {
  const key = action.startsWith("ops.") ? action.slice(4) : action;
  return ACTION_TEXT[key] ?? ACTION_TEXT[action] ?? key.replaceAll(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Row index where a row stops pointing at the hash of the row before it, or -1. Scheme-independent. */
function brokenLink(rows: readonly AuditRow[]): number {
  const bySeq = [...rows].sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < bySeq.length; i += 1) {
    if (bySeq[i]?.prev_hash !== bySeq[i - 1]?.row_hash) return bySeq[i]?.seq ?? i;
  }
  return -1;
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
          <p className="kicker">Admin</p>
          <h1 className="page-title">Audit</h1>
          <p className="lede">Every plan approval, hold, grounding and field report, including the ones a role was refused. Each row carries the hash of the row before it, so an edited row shows.</p>
        </div>
      </header>
      {access === "limited" ? (
        <div className="denied panel">The audit log needs the auditor or admin role.</div>
      ) : null}
      {access === "failed" ? <p className="fault" role="alert">{fault}</p> : null}
      {access === "loading" ? <p className="meta">Loading the audit chain.</p> : null}
      {access === "open" && items.length > 1 ? (
        brokenLink(items) === -1 ? (
          <p className="meta" data-testid="chain-status">
            <span className="pill pill-ok">Chain intact</span> {items.length} events, each linked to the one before it.
          </p>
        ) : (
          <p className="fault" role="alert" data-testid="chain-status">
            The chain breaks at event {brokenLink(items)}: it does not point at the hash of the event before it.
          </p>
        )
      ) : null}
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
                <strong>{actionText(row.action)}{row.resource_id ? ` · ${row.resource_id}` : ""}</strong>
                <p className="meta">
                  {row.actor_id}
                  {row.detail ? ` · ${row.detail}` : ""}
                  {(row.reason_codes ?? []).length > 0 ? ` · ${reasonText(row.reason_codes)}` : ""}
                </p>
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
