import { useEffect, useRef, useState, type FormEvent } from "react";
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

const TEAM_NORTH = "11111111-1111-4111-8111-111111111104";
const CATEGORIES = ["fleet", "mission", "telemetry", "video"] as const;
const CLASSIFICATIONS = ["UNCLASSIFIED", "CUI"] as const;
type ShareCategory = (typeof CATEGORIES)[number];
type Classification = (typeof CLASSIFICATIONS)[number];

interface AgreementRow {
  id: string;
  provider_tenant_id: string;
  consumer_tenant_id: string;
  categories: string[];
  access: string;
  max_classification: string;
  allow_noforn: boolean;
  purpose: string;
  status: string;
  expires_at: string | null;
}

interface TenantLabel {
  name: string;
  code: string;
}

function canChange(viewer: Viewer): boolean {
  return viewer.roles.includes("admin") || viewer.roles.includes("mission_commander");
}

function isClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

function readCategories(data: FormData): ShareCategory[] {
  const picked: ShareCategory[] = [];
  for (const category of CATEGORIES) {
    if (data.get(`category-${category}`) === "yes") {
      picked.push(category);
    }
  }
  return picked;
}

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : "";
}

function explain(error: unknown, fallback: string): string {
  const code = codeOf(error);
  if (code === "two_person_required") {
    return "The approver cannot be the requester.";
  }
  if (code === "role_denied" || code === "denied") {
    return "This role cannot change sharing agreements.";
  }
  if (code === "not_found") {
    return "That agreement could not be found.";
  }
  if (code === "illegal_sharing_transition") {
    return "That agreement is not in a state that can change.";
  }
  if (code === "invalid_request") {
    return "Check the parties, categories, and expiration.";
  }
  return fallback;
}

function statusClass(status: string): string {
  if (status === "active") {
    return "pill pill-ok";
  }
  if (status === "draft") {
    return "pill pill-warn";
  }
  return "pill";
}

function partyName(directory: Readonly<Record<string, TenantLabel>>, id: string): string {
  const found = directory[id];
  if (found) {
    return found.name;
  }
  return id.length > 8 ? id.slice(0, 8) : id;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function expiryText(value: string | null): string {
  if (value === null || value.trim() === "") {
    return "No expiry";
  }
  const parsed = new Date(value.replace(/\.\d+Z$/, "Z"));
  if (Number.isNaN(parsed.getTime())) {
    return "No expiry";
  }
  const day = parsed.getUTCDate().toString().padStart(2, "0");
  const month = MONTHS[parsed.getUTCMonth()] ?? "";
  const year = parsed.getUTCFullYear().toString();
  const hours = parsed.getUTCHours().toString().padStart(2, "0");
  const minutes = parsed.getUTCMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

export function SharingPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [items, setItems] = useState<AgreementRow[]>([]);
  const [directory, setDirectory] = useState<Readonly<Record<string, TenantLabel>>>({});
  const [access, setAccess] = useState<"loading" | "open" | "limited" | "failed">("loading");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const approvable = canChange(viewer);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const org = await api<{ items: { id: string; name: string; code: string }[] }>("/v1/org");
        if (!stopped) {
          const next: Record<string, TenantLabel> = {};
          for (const item of org.body.items) {
            next[item.id] = { name: item.name, code: item.code };
          }
          setDirectory(next);
        }
      } catch {
        if (!stopped) {
          setDirectory({});
        }
      }
      try {
        const result = await api<{ items: AgreementRow[] }>("/v1/sharing-agreements");
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
        const code = codeOf(error);
        setItems([]);
        if (code === "role_denied" || code === "denied") {
          setAccess("limited");
          setFault("");
          return;
        }
        setAccess("failed");
        setFault(explain(error, "Sharing agreements could not be loaded."));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [viewer.id, reloadKey]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const categories = readCategories(data);
    if (categories.length === 0) {
      setFault("Choose at least one category.");
      return;
    }
    const maxClassification = String(data.get("max_classification") ?? "");
    if (!isClassification(maxClassification)) {
      setFault("Maximum classification must be UNCLASSIFIED or CUI.");
      return;
    }
    const expires = new Date(String(data.get("expires_at") ?? ""));
    if (Number.isNaN(expires.getTime())) {
      setFault("Enter an expiration time.");
      return;
    }
    setBusy(true);
    setFault("");
    try {
      const result = await api<{ id: string }>("/v1/sharing-agreements", {
        method: "POST",
        body: JSON.stringify({
          provider_tenant_id: String(data.get("provider_tenant_id") ?? "").trim(),
          consumer_code: String(data.get("consumer_code") ?? "").trim(),
          categories,
          purpose: String(data.get("purpose") ?? "").trim(),
          expires_at: expires.toISOString(),
          allow_noforn: data.get("allow_noforn") === "yes",
          include_descendants: data.get("include_descendants") === "yes",
          max_classification: maxClassification,
        }),
      });
      onBannerRef.current(result.banner);
      form.reset();
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFault(explain(error, "The agreement could not be requested."));
    } finally {
      setBusy(false);
    }
  }

  async function onDecision(id: string, action: "approve" | "revoke") {
    setBusyId(id);
    setFault("");
    try {
      const result = await api<{ status: string }>(`/v1/sharing-agreements/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
      });
      onBannerRef.current(result.banner);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFault(explain(error, "The agreement could not be updated."));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="page page-fill" id="page-sharing">
      <header className="page-head">
        <div>
          <p className="kicker">Tenant</p>
          <h1 className="page-title">Sharing</h1>
          <p className="lede">The approver cannot be the requester. An agreement names what may cross a team boundary.</p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={() => { window.location.hash = "organization"; }}>
          Organization
        </button>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {access === "limited" ? (
        <div className="denied panel">Sharing agreements are not available to this role.</div>
      ) : null}
      {access === "loading" ? <p className="meta">Loading agreements.</p> : null}
      {access === "failed" ? <p className="empty">Sharing agreements could not be loaded.</p> : null}
      {access === "open" && items.length === 0 ? <p className="empty">No sharing agreements in this view.</p> : null}
      {access === "open" && items.length > 0 ? (
        <div className="agreement-list">
          {items.map((row) => (
            <article className="ticket" key={row.id}>
              <p className="kicker">Agreement</p>
              <h2>{partyName(directory, row.provider_tenant_id)}</h2>
              <p className="meta">shares with {partyName(directory, row.consumer_tenant_id)}</p>
              <p><span className={statusClass(row.status)}>{row.status}</span></p>
              <p>{row.purpose}</p>
              <p className="meta">
                {Array.isArray(row.categories) && row.categories.length > 0 ? row.categories.join(", ") : "—"}
                {" · "}
                <span className="pill">{row.max_classification}</span>
                {" · "}
                {row.allow_noforn ? "NOFORN allowed" : "NOFORN blocked"}
                {" · "}
                {expiryText(row.expires_at)}
              </p>
              {approvable && row.status === "draft" ? (
                <button className="btn btn-primary" type="button" disabled={busyId === row.id} onClick={() => void onDecision(row.id, "approve")}>
                  Approve
                </button>
              ) : null}
              {approvable && row.status === "active" ? (
                <button className="btn btn-danger" type="button" disabled={busyId === row.id} onClick={() => void onDecision(row.id, "revoke")}>
                  Revoke
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {approvable ? (
        <details className="panel">
          <summary className="btn btn-quiet">New agreement</summary>
          <form onSubmit={(event) => void onCreate(event)}>
            <div className="field">
              <label htmlFor="share-provider">Provider tenant</label>
              <input id="share-provider" name="provider_tenant_id" required defaultValue={TEAM_NORTH} autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="share-consumer">Consumer code</label>
              <input id="share-consumer" name="consumer_code" required maxLength={80} placeholder="USAF-DAC-DET77-SOUTH" autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label>Categories</label>
              {CATEGORIES.map((category) => (
                <label key={category}>
                  <input type="checkbox" name={`category-${category}`} value="yes" defaultChecked={category === "fleet"} />
                  {category}
                </label>
              ))}
            </div>
            <div className="field">
              <label htmlFor="share-purpose">Purpose</label>
              <input id="share-purpose" name="purpose" required maxLength={400} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="share-expires">Expires</label>
              <input id="share-expires" name="expires_at" type="datetime-local" required />
            </div>
            <div className="field">
              <label htmlFor="share-max">Maximum classification</label>
              <select id="share-max" name="max_classification" defaultValue="CUI">
                {CLASSIFICATIONS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" name="allow_noforn" value="yes" />
                Allow NOFORN
              </label>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" name="include_descendants" value="yes" />
                Include descendant tenants
              </label>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>Request agreement</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
