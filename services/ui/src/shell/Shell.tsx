import { useEffect, useState, type JSX } from "react";
import { FloorField } from "./FloorField";
import type { Section, Viewer } from "./types";

const NAV: readonly { label: string; items: readonly { id: Section; label: string }[] }[] = [
  {
    label: "Operate",
    items: [
      { id: "overview", label: "Overview" },
      { id: "live", label: "Live" },
      { id: "fleet", label: "Fleet" },
      { id: "video", label: "Video" },
    ],
  },
  {
    label: "Plan",
    items: [
      { id: "missions", label: "Missions" },
      { id: "debrief", label: "Debrief" },
      { id: "eval", label: "Eval" },
    ],
  },
  {
    label: "Tenant",
    items: [
      { id: "organization", label: "Organization" },
      { id: "people", label: "People" },
      { id: "sharing", label: "Sharing" },
      { id: "audit", label: "Audit" },
    ],
  },
];

function formatRoles(roles: readonly string[]): string {
  if (roles.length === 0) {
    return "No role";
  }
  return roles.map((role) => role.replaceAll("_", " ")).join(" · ");
}

function zuluClock(now: Date): string {
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss} Z`;
}

function useZulu(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

export function Shell(props: {
  banner: string;
  viewer: Viewer;
  section: Section;
  onSection: (s: Section) => void;
  onLogout: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const name = props.viewer.display_name.trim() || props.viewer.username;
  const now = useZulu();
  return (
    <div className="shell">
      <FloorField />
      <aside className="rail">
        <div className="brand">
          A2E
          <span className="kicker">Mission Cloud</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const active = props.section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "is-active" : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => props.onSection(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="meta">{props.banner}</p>
      </aside>
      <div className="workspace">
        <header className="workspace-bar">
          <div id="who" className="who">
            <strong>{name}</strong>
            <span className="meta">{formatRoles(props.viewer.roles)}</span>
          </div>
          <time className="zulu" dateTime={now.toISOString()}>
            <span className="live-mark">Live</span>
            {zuluClock(now)}
          </time>
          <button type="button" className="btn btn-quiet" onClick={props.onLogout}>
            Log out
          </button>
        </header>
        {props.children}
      </div>
    </div>
  );
}
