import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
const LEVELS = ["command", "unit", "team"] as const;
type OrgLevel = (typeof LEVELS)[number];

interface TenantRow {
  id: string;
  parent_id: string | null;
  level: string;
  name: string;
  code: string;
  portion_mark: string;
}

interface TenantNode extends TenantRow {
  children: TenantNode[];
}

const LEVEL_RANK: Readonly<Record<string, number>> = {
  branch: 0,
  command: 1,
  unit: 2,
  team: 3,
};

function levelRank(level: string): number {
  return LEVEL_RANK[level] ?? 0;
}

function isLevel(value: string): value is OrgLevel {
  return (LEVELS as readonly string[]).includes(value);
}

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : "";
}

function explain(error: unknown, fallback: string): string {
  const code = codeOf(error);
  if (code === "role_denied" || code === "denied") {
    return "This role cannot change the organization.";
  }
  if (code === "not_found") {
    return "That parent tenant could not be found.";
  }
  if (code === "invalid_request") {
    return "Check the parent, level, name, and codes.";
  }
  if (code === "database_error") {
    return "That parent and level cannot be combined. A command sits under a branch, a unit under a command, and a team under a unit.";
  }
  return fallback;
}

function buildTree(rows: TenantRow[]): TenantNode[] {
  const nodes = new Map<string, TenantNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...row, children: [] });
  }
  const roots: TenantNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? undefined : nodes.get(node.parent_id);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const byPlace = (left: TenantNode, right: TenantNode): number => {
    const rank = levelRank(left.level) - levelRank(right.level);
    if (rank !== 0) {
      return rank;
    }
    return left.code.localeCompare(right.code) || left.name.localeCompare(right.name);
  };
  const sortNodes = (list: TenantNode[]): void => {
    list.sort(byPlace);
    for (const item of list) {
      sortNodes(item.children);
    }
  };
  sortNodes(roots);
  return roots;
}

function NodeView({ node, depth }: { node: TenantNode; depth: number }): ReactNode {
  let content: ReactNode = (
    <article className="org-card">
      <div className="panel-head">
        <h2>{node.name}</h2>
        <span className="pill">{node.level}</span>
      </div>
      <p className="meta">
        {node.code}
        {node.portion_mark.trim() !== "" ? ` · ${node.portion_mark}` : ""}
        {node.children.length > 0 ? ` · ${node.children.length} below` : ""}
      </p>
      {node.level === "team" ? (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            sessionStorage.setItem("a2e-people-team", node.name);
            window.location.hash = "people";
          }}
        >
          People
        </button>
      ) : null}
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <NodeView key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </article>
  );
  const extra = Math.max(0, levelRank(node.level) - depth);
  for (let step = 0; step < extra; step += 1) {
    content = (
      <ul>
        <li>{content}</li>
      </ul>
    );
  }
  return <li>{content}</li>;
}

export function OrganizationPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [roots, setRoots] = useState<TenantNode[]>([]);
  const [access, setAccess] = useState<"loading" | "open" | "limited" | "failed">("loading");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const writable = viewer.roles.includes("admin");

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const result = await api<{ items: TenantRow[] }>("/v1/org");
        if (stopped) {
          return;
        }
        onBannerRef.current(result.banner);
        setRoots(buildTree(result.body.items));
        setAccess("open");
        setFault("");
      } catch (error) {
        if (stopped) {
          return;
        }
        const code = codeOf(error);
        setRoots([]);
        if (code === "role_denied" || code === "denied") {
          setAccess("limited");
          setFault("");
          return;
        }
        setAccess("failed");
        setFault(explain(error, "The organization could not be loaded."));
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
    const level = String(data.get("level") ?? "");
    if (!isLevel(level)) {
      setFault("Choose a command, unit, or team.");
      return;
    }
    setBusy(true);
    setFault("");
    try {
      const result = await api<{ id: string }>("/v1/org/tenants", {
        method: "POST",
        body: JSON.stringify({
          parent_id: String(data.get("parent_id") ?? "").trim(),
          level,
          name: String(data.get("name") ?? "").trim(),
          code: String(data.get("code") ?? "").trim(),
          branch_code: String(data.get("branch_code") ?? "").trim(),
        }),
      });
      onBannerRef.current(result.banner);
      form.reset();
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFault(explain(error, "The tenant could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page-fill" id="page-organization">
      <header className="page-head">
        <div>
          <p className="kicker">Tenant</p>
          <h1 className="page-title">Organization</h1>
          <p className="lede">Branch, command, unit, and team. A team opens the people on it.</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {access === "limited" ? (
        <div className="denied panel">The organization is not available to this role.</div>
      ) : (
        <div className="panel">
          {access === "loading" ? <p className="meta">Loading the organization.</p> : null}
          {access === "open" && roots.length === 0 ? <p className="empty">No tenants in this view.</p> : null}
          {access === "failed" ? <p className="empty">The organization could not be loaded.</p> : null}
          {roots.length > 0 ? (
            <ul className="org-tree">
              {roots.map((node) => (
                <NodeView key={node.id} node={node} depth={0} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {writable ? (
        <details className="panel">
          <summary className="btn btn-quiet">New tenant</summary>
          <form onSubmit={(event) => void onCreate(event)}>
            <div className="field">
              <label htmlFor="org-parent">Parent</label>
              <input id="org-parent" name="parent_id" defaultValue={TEAM_NORTH} required autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="org-level">Level</label>
              <select id="org-level" name="level" defaultValue="team" required>
                {LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="org-name">Name</label>
              <input id="org-name" name="name" required maxLength={120} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="org-code">Code</label>
              <input id="org-code" name="code" required pattern="[A-Z0-9-]{2,64}" autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="org-branch">Branch code</label>
              <input id="org-branch" name="branch_code" required pattern="[A-Z0-9-]{2,16}" autoComplete="off" spellCheck={false} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>Create tenant</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
