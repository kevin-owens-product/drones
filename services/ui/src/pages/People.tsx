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
const CLEARANCES = ["UNCLASSIFIED", "CUI"] as const;
const ROLES = ["admin", "mission_commander", "planner", "operator", "analyst", "maintainer", "auditor"] as const;
type Clearance = (typeof CLEARANCES)[number];
type UserRole = (typeof ROLES)[number];

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  portion_mark: string;
  roles: string;
  teams: string;
}

function isClearance(value: string): value is Clearance {
  return (CLEARANCES as readonly string[]).includes(value);
}

function isRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
}

function programs(raw: string): string[] {
  return raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : "";
}

function explain(error: unknown, fallback: string): string {
  const code = codeOf(error);
  if (code === "role_denied" || code === "denied") {
    return "This role cannot provision an account.";
  }
  if (code === "not_found") {
    return "That tenant could not be found.";
  }
  if (code === "citizenship_invalid") {
    return "Citizenship must be three letters.";
  }
  if (code === "invalid_request") {
    return "Check the account fields and try again.";
  }
  if (code === "clearance_insufficient" || code === "above_system_high") {
    return "That clearance is above what this account can grant.";
  }
  return fallback;
}

function shown(value: string): string {
  return value.trim() === "" ? "—" : value;
}

export function PeoplePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [items, setItems] = useState<UserRow[]>([]);
  const [access, setAccess] = useState<"loading" | "open" | "limited" | "failed">("loading");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [roleFilter, setRoleFilter] = useState("all");
  const [teamNeedle, setTeamNeedle] = useState(() => {
    const handed = sessionStorage.getItem("a2e-people-team");
    if (handed && handed.trim().length > 0) {
      sessionStorage.removeItem("a2e-people-team");
      return handed.trim();
    }
    return "";
  });
  const writable = viewer.roles.includes("admin");

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const result = await api<{ items: UserRow[] }>("/v1/users");
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
        setFault(explain(error, "The directory could not be loaded."));
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
    const clearance = String(data.get("clearance") ?? "");
    const role = String(data.get("role") ?? "");
    if (!isClearance(clearance) || !isRole(role)) {
      setFault("Choose a clearance and a role.");
      return;
    }
    setBusy(true);
    setFault("");
    try {
      const result = await api<{ id: string }>("/v1/users", {
        method: "POST",
        body: JSON.stringify({
          username: String(data.get("username") ?? "").trim(),
          email: String(data.get("email") ?? "").trim(),
          display_name: String(data.get("display_name") ?? "").trim(),
          citizenship: String(data.get("citizenship") ?? "").trim().toUpperCase(),
          clearance,
          ntk_programs: programs(String(data.get("ntk_programs") ?? "")),
          keycloak_sub: String(data.get("keycloak_sub") ?? "").trim(),
          tenant_id: String(data.get("tenant_id") ?? "").trim(),
          role,
        }),
      });
      onBannerRef.current(result.banner);
      form.reset();
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFault(explain(error, "The account could not be provisioned."));
    } finally {
      setBusy(false);
    }
  }

  const shownRows = items.filter((row) => {
    const roleOk = roleFilter === "all" || row.roles.toLowerCase().includes(roleFilter.replaceAll("_", " ")) || row.roles.toLowerCase().includes(roleFilter);
    const teamOk = teamNeedle.length === 0 || row.teams.toLowerCase().includes(teamNeedle.toLowerCase());
    return roleOk && teamOk;
  });

  return (
    <section className="page page-fill" id="page-people">
      <header className="page-head">
        <div>
          <p className="kicker">Tenant</p>
          <h1 className="page-title">People</h1>
          <p className="lede">{items.length.toLocaleString("en-US")} accounts in this view.</p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={() => { window.location.hash = "organization"; }}>
          Organization
        </button>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <div className="role-switch">
        <button type="button" className={roleFilter === "all" ? "btn btn-primary" : "btn"} onClick={() => setRoleFilter("all")}>All roles</button>
        {ROLES.map((role) => (
          <button key={role} type="button" className={roleFilter === role ? "btn btn-primary" : "btn"} onClick={() => setRoleFilter(role)}>
            {role.replaceAll("_", " ")}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="people-team-filter">Team</label>
        <input id="people-team-filter" value={teamNeedle} placeholder="Team North" onChange={(event) => setTeamNeedle(event.target.value)} />
      </div>
      {writable ? (
        <details className="panel">
          <summary className="btn btn-quiet">Provision</summary>
          <form onSubmit={(event) => void onCreate(event)}>
            <div className="field">
              <label htmlFor="people-username">Username</label>
              <input id="people-username" name="username" required maxLength={64} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="people-email">Email</label>
              <input id="people-email" name="email" type="email" required maxLength={200} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="people-display">Display name</label>
              <input id="people-display" name="display_name" required maxLength={120} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="people-citizenship">Citizenship</label>
              <input id="people-citizenship" name="citizenship" required pattern="[A-Za-z]{3}" maxLength={3} placeholder="USA" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="people-clearance">Clearance</label>
              <select id="people-clearance" name="clearance" defaultValue="CUI" required>
                {CLEARANCES.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="people-ntk">Need-to-know programs</label>
              <input id="people-ntk" name="ntk_programs" placeholder="isr-demo" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="people-subject">Identity subject</label>
              <input id="people-subject" name="keycloak_sub" required maxLength={128} autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="people-tenant">Tenant</label>
              <input id="people-tenant" name="tenant_id" required defaultValue={TEAM_NORTH} autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="people-role">Role</label>
              <select id="people-role" name="role" defaultValue="analyst" required>
                {ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>Provision</button>
          </form>
        </details>
      ) : null}
      {access === "limited" ? (
        <div className="denied panel">The directory is not available to this role.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Username</th>
                <th scope="col">Display name</th>
                <th scope="col">Role</th>
                <th scope="col">Team</th>
                <th scope="col">Citizenship</th>
                <th scope="col">Clearance</th>
                <th scope="col">Portion</th>
              </tr>
            </thead>
            <tbody>
              {access === "loading" ? (
                <tr>
                  <td colSpan={7}><p className="meta">Loading the directory.</p></td>
                </tr>
              ) : null}
              {access === "failed" ? (
                <tr>
                  <td colSpan={7}><p className="empty">The directory could not be loaded.</p></td>
                </tr>
              ) : null}
              {access === "open" && shownRows.length === 0 ? (
                <tr>
                  <td colSpan={7}><p className="empty">No accounts match this filter.</p></td>
                </tr>
              ) : null}
              {shownRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.username}</td>
                  <td>{row.display_name}</td>
                  <td>{shown(row.roles)}</td>
                  <td>{shown(row.teams)}</td>
                  <td>{row.citizenship}</td>
                  <td><span className="pill">{shown(row.clearance)}</span></td>
                  <td>{shown(row.portion_mark)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
