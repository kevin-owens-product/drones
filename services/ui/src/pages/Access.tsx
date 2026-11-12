import { useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { ROLE_MATRIX } from "../../demo/ledger.mjs";
import type { Viewer } from "../shell/types";

// Who can do what, in plain words. The permissions come from the policy role
// matrix (policies/role_matrix/data.json, mirrored in demo/ledger.mjs and
// checked by its test). Tenants, clearances and two-person sharing still run
// in the API (ADR-0013, ADR-0025); this page does not manage them.

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  mission_commander: "Mission commander",
  planner: "Planner",
  operator: "Operator",
  analyst: "Analyst",
  maintainer: "Maintainer",
  auditor: "Auditor",
};

const ROLE_JOB: Record<string, string> = {
  admin: "Runs the system and the accounts.",
  mission_commander: "Owns the mission and approves plans.",
  planner: "Drafts and reviews plans.",
  operator: "Flies approved plans and supervises vehicles.",
  analyst: "Reads results and exports them.",
  maintainer: "Grounds, inspects and returns airframes to service.",
  auditor: "Reads the audit log. Changes nothing.",
};

const ABILITIES: readonly { label: string; any: readonly string[] }[] = [
  { label: "See fleet and telemetry", any: ["telemetry.read"] },
  { label: "Draft a plan", any: ["mission.draft"] },
  { label: "Approve a plan", any: ["mission.approve"] },
  { label: "Fly an approved plan", any: ["mission.execute"] },
  { label: "Ground or hold airframes", any: ["fleet.write"] },
  { label: "Share across teams", any: ["sharing.approve"] },
  { label: "Read the audit log", any: ["audit.read"] },
  { label: "Manage accounts", any: ["user.provision"] },
];

const MATRIX = ROLE_MATRIX as Record<string, readonly string[]>;
const ROLES = Object.keys(ROLE_LABEL);

function has(role: string, any: readonly string[]): boolean {
  return any.some((permission) => (MATRIX[role] ?? []).includes(permission));
}

interface Account {
  id: string;
  username: string;
  display_name: string;
  roles: string[] | string;
}

function rolesOf(account: Account): string[] {
  return Array.isArray(account.roles) ? account.roles : String(account.roles).split(/[\s,]+/).filter(Boolean);
}

function roleText(roles: readonly string[]): string {
  return roles.map((role) => ROLE_LABEL[role] ?? role.replaceAll("_", " ")).join(" · ") || "No role";
}

export function AccessPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }): JSX.Element {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  useEffect(() => {
    let stopped = false;
    api<{ items: Account[] }>("/v1/users")
      .then((result) => {
        if (stopped) return;
        onBannerRef.current(result.banner);
        setAccounts(Array.isArray(result.body.items) ? result.body.items : []);
      })
      .catch(() => {
        if (!stopped) setAccounts([]);
      });
    return () => {
      stopped = true;
    };
  }, []);

  const mine = new Set(viewer.roles);

  return (
    <section className="page" data-testid="access" tabIndex={0}>
      <header className="page-head">
        <div>
          <p className="kicker">Admin</p>
          <h1 className="page-title">Access</h1>
          <p className="lede">
            Who can do what. A person with the right role approves every plan and every hold, and the console never arms or releases anything.
          </p>
        </div>
      </header>

      <section className="panel">
        <header className="panel-head">
          <h2>You</h2>
        </header>
        <p>
          <strong>{viewer.display_name || viewer.username}</strong> <span className="meta">{roleText(viewer.roles)}</span>
        </p>
        <p className="meta">
          You can:{" "}
          {ABILITIES.filter((a) => viewer.roles.some((role) => has(role, a.any)))
            .map((a) => a.label.toLowerCase())
            .join(", ") || "nothing yet"}
          .
        </p>
        <p className="meta">
          Roles come from your organization's sign-in provider, so an admin there changes them, and every change lands in the audit log.{" "}
          <a href="/developers/#auth">See what each role can open and change</a>.
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Roles</h2>
        </header>
        <div className="table-wrap" tabIndex={0}>
          <table className="access-matrix">
            <thead>
              <tr>
                <th scope="col">Role</th>
                {ABILITIES.map((a) => (
                  <th scope="col" key={a.label}>
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => (
                <tr key={role} className={mine.has(role) ? "is-selected" : undefined}>
                  <th scope="row">
                    {ROLE_LABEL[role]}
                    <span className="meta">{ROLE_JOB[role]}</span>
                  </th>
                  {ABILITIES.map((a) => (
                    <td key={a.label} aria-label={has(role, a.any) ? "yes" : "no"}>
                      {has(role, a.any) ? "✓" : <span className="meta">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Accounts</h2>
        </header>
        {accounts === null ? <p className="meta">Loading accounts.</p> : null}
        {accounts !== null && accounts.length === 0 ? <p className="empty">No accounts in this view.</p> : null}
        {accounts !== null && accounts.length > 0 ? (
          <ul className="objective-list">
            {accounts.map((account) => (
              <li key={account.id}>
                <strong>{account.display_name || account.username}</strong>
                <span className="meta">
                  {account.username} · {roleText(rolesOf(account))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
