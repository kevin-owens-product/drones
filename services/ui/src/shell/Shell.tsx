import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { usePageCommands, type Command } from "./commands";
import { useNavCounts } from "./counts";
import { Palette } from "./Palette";
import "../pages/ops.css";
import "./shell.css";
import type { Section, Viewer } from "./types";
import { can, canSwitch, hiddenCount, navFor, railFor, type Workspace } from "./workspace";

const ADMIN_ALL: readonly { id: Section; label: string; needs?: string }[] = [
  { id: "access", label: "Access" },
  { id: "integrations", label: "Integrations" },
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
  // The rail: open beside the page on a wide screen, a drawer on a narrow one. "hidden" folds it away for map room.
  const [drawer, setDrawer] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("a2e-rail") === "hidden";
    } catch {
      return false;
    }
  });
  const [orgMenu, setOrgMenu] = useState(false);
  // Audit is in Settings only for the roles that can read it; Access (who can do what) is for everyone.
  const ADMIN = useMemo(() => ADMIN_ALL.filter((item) => !item.needs || can(props.viewer, item.needs)), [props.viewer]);
  const orgRef = useRef<HTMLDivElement>(null);
  const pageCommands = usePageCommands();
  const { onSection, onLogout, onWorkspace } = props;
  // Every page in the workspace stays in the palette, including ones this role's rail leaves out.
  const PRIMARY = useMemo(() => navFor(props.workspace), [props.workspace]);
  const GROUPS = useMemo(() => railFor(props.workspace, props.viewer), [props.workspace, props.viewer]);
  const more = useMemo(() => hiddenCount(props.workspace, props.viewer), [props.workspace, props.viewer]);
  const counts = useNavCounts(props.workspace, props.viewer, props.section);
  const switchable = canSwitch(props.viewer);
  const viewing = switchable && props.workspace === "customer";
  const [orgName, orgSub] = useMemo(() => {
    if (viewing) return ["Customer A", "Viewing as Neros"];
    const raw = props.viewer.org_name ?? "";
    if (!raw) return ["All workspaces", "Local demo"];
    const [name = raw, rest] = raw.split(":");
    return [name.replace(" (operations)", ""), (rest ?? (props.viewer.org === "neros" ? "Operations" : "")).replace(" (SIM)", "").trim()];
  }, [viewing, props.viewer]);

  const commands = useMemo<Command[]>(
    () => [
      ...pageCommands,
      ...[...PRIMARY, ...ADMIN].map((item) => ({ id: `go-${item.id}`, label: item.label, group: "Go to", run: () => onSection(item.id) })),
      ...(switchable
        ? [{ id: "workspace", label: props.workspace === "customer" ? "Switch to Neros operations" : "Switch to the customer view", group: "Workspace", run: () => onWorkspace(props.workspace === "customer" ? "neros" : "customer") }]
        : []),
      { id: "rail", label: hidden ? "Show the menu" : "Hide the menu", group: "View", run: () => toggleRail() },
      { id: "help", label: "Keyboard shortcuts", group: "Help", hint: "?", run: () => setHelp(true) },
      { id: "logout", label: "Log out", group: "Session", run: onLogout },
    ],
    [pageCommands, onSection, onLogout, onWorkspace, PRIMARY, ADMIN, switchable, props.workspace, hidden],
  );

  // Operate needs the width for its list, map and flight display, so there the rail floats over the page (opened
  // from the menu button) unless the screen is wide enough for all four. Below 900 px every page uses the drawer.
  const roomy = props.section === "operate";
  const floating = () => window.matchMedia("(max-width: 900px)").matches || (roomy && window.matchMedia("(max-width: 1599px)").matches);

  function toggleRail() {
    setHidden((was) => {
      const next = !was;
      try {
        localStorage.setItem("a2e-rail", next ? "hidden" : "open");
      } catch {
        /* not remembered */
      }
      return next;
    });
  }

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
        setOrgMenu(false);
        setDrawer(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!orgMenu) return;
    function onDown(event: MouseEvent) {
      if (orgRef.current && !orgRef.current.contains(event.target as Node)) setOrgMenu(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [orgMenu]);

  const here = [...PRIMARY, ...ADMIN].find((item) => item.id === props.section);
  const hereGroup = here && "group" in here ? here.group : ADMIN.some((a) => a.id === props.section) ? "Settings" : "";
  const go = (next: Section) => {
    setDrawer(false);
    setOrgMenu(false);
    onSection(next);
  };
  const railItem = (id: Section, label: string) => {
    const active = props.section === id;
    const n = counts[id];
    return (
      <button key={id} type="button" className={active ? "side-item is-active" : "side-item"} aria-current={active ? "page" : undefined} onClick={() => go(id)}>
        <span>{label}</span>
        {n ? <span className="side-count" aria-label={`${n} waiting`}>{n}</span> : null}
      </button>
    );
  };

  return (
    <div className={`shell shell-side${hidden ? " side-hidden" : ""}${drawer ? " side-drawer" : ""}${roomy ? " side-float" : ""}`}>
      <header className="topbar">
        <button type="button" className="side-toggle" aria-expanded={hidden ? false : drawer || undefined} aria-controls="sections" onClick={() => (floating() ? setDrawer((o) => !o) : toggleRail())} title={hidden ? "Show the menu" : "Hide the menu"}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <span className="sr-only">Menu</span>
        </button>
        <div className="brand">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>
            Drone <span className="brand-sub">Mission Cloud</span>
          </span>
        </div>
        <div className="crumb" aria-label="You are here">
          {hereGroup ? <span>{hereGroup}</span> : null}
          <strong>{here?.label ?? ""}</strong>
        </div>
        <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Open command palette">
          <span>Go to a page, vehicle or command</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="topbar-right">
          <time className="zulu" dateTime={now.toISOString()}>
            {zuluClock(now)}
          </time>
        </div>
      </header>
      {viewing ? (
        <div className="viewing-strip" role="status">
          <span>Viewing Customer A as Neros. You see what they see; anything you do is recorded as Neros.</span>
          <button type="button" className="btn btn-quiet" onClick={() => onWorkspace("neros")}>
            Back to Neros operations
          </button>
        </div>
      ) : null}
      <div className="shell-body">
        <nav id="sections" className="side" aria-label="Sections">
          <div className="side-org" ref={orgRef}>
            <button type="button" className="side-org-btn" aria-haspopup={switchable ? "menu" : undefined} aria-expanded={switchable ? orgMenu : undefined} disabled={!switchable} onClick={() => setOrgMenu((o) => !o)}>
              <span className="side-org-mark" aria-hidden="true">{orgName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
              <span className="side-org-text">
                <strong>{orgName}</strong>
                {orgSub ? <span>{orgSub}</span> : null}
              </span>
              {switchable ? <span className="side-org-chev" aria-hidden="true">▾</span> : null}
            </button>
            {orgMenu ? (
              <div className="menu-list side-org-menu" role="menu" aria-label="Workspace">
                <button type="button" role="menuitemradio" aria-checked={props.workspace === "neros"} className={props.workspace === "neros" ? "is-active" : undefined} onClick={() => { setOrgMenu(false); onWorkspace("neros"); }}>
                  Neros operations
                </button>
                <button type="button" role="menuitemradio" aria-checked={props.workspace === "customer"} className={props.workspace === "customer" ? "is-active" : undefined} onClick={() => { setOrgMenu(false); onWorkspace("customer"); }}>
                  Customer A, as they see it
                </button>
              </div>
            ) : null}
          </div>
          <div className="side-groups">
            {GROUPS.map((g) => (
              <div key={g.label || "home"} className="side-group" role="group" aria-label={g.label || undefined}>
                {g.label ? <div className="side-label">{g.label}</div> : null}
                {g.items.map((n) => railItem(n.id, n.label))}
              </div>
            ))}
            {more > 0 ? (
              <button type="button" className="side-more" onClick={() => setPalette(true)}>
                {more} more {more === 1 ? "page" : "pages"} in <kbd>⌘K</kbd>
              </button>
            ) : null}
          </div>
          <div className="side-foot">
            <div className="side-group" role="group" aria-label="Settings">
              <div className="side-label">Settings</div>
              {ADMIN.map((a) => railItem(a.id, a.label))}
            </div>
            <div id="who" className="who" title={formatRoles(props.viewer.roles)}>
              <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
              <span className="who-text">
                <strong>{name}</strong>
                <span className="meta">{formatRoles(props.viewer.roles)}</span>
              </span>
              <button type="button" className="btn btn-quiet side-logout" onClick={onLogout}>
                Log out
              </button>
            </div>
          </div>
        </nav>
        {drawer ? <div className="side-scrim" role="presentation" onMouseDown={() => setDrawer(false)} /> : null}
        <div className="workspace">{props.children}</div>
      </div>
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
