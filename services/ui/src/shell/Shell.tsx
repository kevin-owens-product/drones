import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { usePageCommands, type Command } from "./commands";
import { Palette } from "./Palette";
import "../pages/ops.css";
import type { Section, Viewer } from "./types";
import { can, canSwitch, NAV, type Workspace } from "./workspace";

const ADMIN_ALL: readonly { id: Section; label: string; needs?: string }[] = [
  { id: "access", label: "Access" },
  { id: "audit", label: "Audit", needs: "audit.read" },
];

function formatRoles(roles: readonly string[]): string {
  if (roles.length === 0) return "No role";
  return roles.map((role) => role.replaceAll("_", " ")).join(" · ");
}

function zuluClock(now: Date): string {
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
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

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const SHORTCUTS: readonly [string, string][] = [
  ["⌘K / Ctrl K", "Command palette"],
  ["/", "Find a vehicle"],
  ["J / K", "Next / previous vehicle"],
  ["F", "Follow the selected vehicle on the map"],
  ["A", "Show only vehicles that need you"],
  ["L", "Check launch readiness"],
  ["Esc", "Clear selection"],
  ["?", "This list"],
];

export function Shell(props: {
  banner: string;
  viewer: Viewer;
  section: Section;
  onSection: (s: Section) => void;
  workspace: Workspace;
  onWorkspace: (w: Workspace) => void;
  onLogout: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const name = props.viewer.display_name.trim() || props.viewer.username;
  const now = useZulu();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Audit is in the menu only for the roles that can read it; Access (who can do what) is for everyone.
  const ADMIN = useMemo(() => ADMIN_ALL.filter((item) => !item.needs || can(props.viewer, item.needs)), [props.viewer]);
  const adminRef = useRef<HTMLDivElement>(null);
  const pageCommands = usePageCommands();
  const { onSection, onLogout, onWorkspace } = props;
  const PRIMARY = useMemo(() => NAV.filter((n) => n.in.includes(props.workspace)), [props.workspace]);
  const switchable = canSwitch(props.viewer);
  const orgLabel = props.workspace === "customer" && switchable ? "Customer view" : props.viewer.org_name?.split(":")[0]?.replace(" (operations)", "");

  const commands = useMemo<Command[]>(
    () => [
      ...pageCommands,
      ...[...PRIMARY, ...ADMIN].map((item) => ({ id: `go-${item.id}`, label: item.label, group: "Go to", run: () => onSection(item.id) })),
      ...(switchable
        ? [{ id: "workspace", label: props.workspace === "customer" ? "Switch to Neros operations" : "Switch to the customer view", group: "Workspace", run: () => onWorkspace(props.workspace === "customer" ? "neros" : "customer") }]
        : []),
      { id: "help", label: "Keyboard shortcuts", group: "Help", hint: "?", run: () => setHelp(true) },
      { id: "logout", label: "Log out", group: "Session", run: onLogout },
    ],
    [pageCommands, onSection, onLogout, onWorkspace, PRIMARY, ADMIN, switchable, props.workspace],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelp((open) => !open);
      } else if (event.key === "Escape") {
        setHelp(false);
        setAdminOpen(false);
        setNavOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!adminOpen) return;
    function onDown(event: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(event.target as Node)) setAdminOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [adminOpen]);

  const inAdmin = ADMIN.some((item) => item.id === props.section);
  const current = [...PRIMARY, ...ADMIN].find((item) => item.id === props.section)?.label ?? "Menu";
  const go = (next: Section) => {
    setNavOpen(false);
    setAdminOpen(false);
    onSection(next);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>A2E</span>
        </div>
        {switchable ? (
          <div className="ws-switch" role="group" aria-label="Workspace">
            <button type="button" className={props.workspace === "neros" ? "is-on" : undefined} aria-pressed={props.workspace === "neros"} onClick={() => onWorkspace("neros")}>
              Neros ops
            </button>
            <button type="button" className={props.workspace === "customer" ? "is-on" : undefined} aria-pressed={props.workspace === "customer"} onClick={() => onWorkspace("customer")}>
              Customer
            </button>
          </div>
        ) : null}
        <button type="button" className="tab nav-toggle" aria-expanded={navOpen} aria-controls="sections" onClick={() => setNavOpen((open) => !open)}>
          {current} <span aria-hidden="true">▾</span>
        </button>
        <nav id="sections" className={navOpen ? "tabs is-open" : "tabs"} aria-label="Sections">
          {PRIMARY.map((item) => {
            const active = props.section === item.id;
            return (
              <button key={item.id} type="button" className={active ? "tab is-active" : "tab"} aria-current={active ? "page" : undefined} onClick={() => go(item.id)}>
                {item.label}
              </button>
            );
          })}
          <div className="menu" ref={adminRef}>
            <button type="button" className={inAdmin ? "tab is-active" : "tab"} aria-haspopup="menu" aria-expanded={adminOpen} onClick={() => setAdminOpen((open) => !open)}>
              Admin <span aria-hidden="true">▾</span>
            </button>
            {adminOpen ? (
              <div className="menu-list" role="menu">
                {ADMIN.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={props.section === item.id ? "is-active" : undefined}
                    onClick={() => go(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </nav>
        <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Open command palette">
          <span>Go to a page, vehicle or command</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="topbar-right">
          <time className="zulu" dateTime={now.toISOString()}>
            {zuluClock(now)}
          </time>
          <div id="who" className="who" title={formatRoles(props.viewer.roles)}>
            <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
            <span className="who-text">
              <strong>{name}</strong>
              <span className="meta">{orgLabel ? `${orgLabel} · ` : ""}{formatRoles(props.viewer.roles)}</span>
            </span>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>
      <div className="workspace">{props.children}</div>
      <Palette open={palette} commands={commands} onClose={() => setPalette(false)} />
      {help ? (
        <div className="palette-scrim" role="presentation" onMouseDown={() => setHelp(false)}>
          <div className="shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Keyboard</h2>
            <dl>
              {SHORTCUTS.map(([key, what]) => (
                <div key={key}>
                  <dt><kbd>{key}</kbd></dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
