import { ROLE_MATRIX } from "../../demo/ledger.mjs";
import type { Section, Viewer } from "./types";

/**
 * Two products on one platform. Neros runs its own operations (the work queue,
 * the company view, and the loss data customers choose to share); a customer
 * runs its own fleet (operate, plan, maintain, and ask Neros for resupply).
 * Neros staff can switch to the customer view to see what a customer sees.
 */
export type Workspace = "neros" | "customer" | "all";

/**
 * Who a page is for in the rail. "lead" is anyone who plans, approves or runs the unit (commander, planner, admin,
 * analyst, auditor); operators fly; maintainers keep airframes ready. A page left out of a role's rail is still one
 * Cmd-K away, and its route still works: the rail is a working list, not a permission.
 */
export type Profile = "lead" | "operator" | "maintainer";
const ALL: readonly Profile[] = ["lead", "operator", "maintainer"];

export type NavItem = { id: Section; label: string; group: string; for: readonly Profile[] };
const item = (id: Section, label: string, group: string, who: readonly Profile[] = ALL): NavItem => ({ id, label, group, for: who });

/** A customer runs its own fleet: fly it, keep it ready, keep it supplied, learn from it. */
export const CUSTOMER_NAV: readonly NavItem[] = [
  item("operate", "Operate", "Fly"),
  item("brief", "Brief", "Fly", ["lead"]),
  item("missions", "Missions", "Fly", ["lead", "operator"]),
  item("physics", "Physics check", "Fly", ["lead", "operator"]),
  item("debrief", "Debrief", "Fly"),
  item("configure", "Loadout planner", "Fly", ["lead", "operator"]),
  item("denial", "GNSS denial map", "Fly", ["lead", "operator"]),
  item("fleet", "Airframes", "Fleet"),
  item("mixed", "All vendors", "Fleet", ["lead", "maintainer"]),
  item("config", "Configuration", "Fleet", ["lead", "maintainer"]),
  item("stockpile", "Stockpile health", "Fleet", ["lead", "maintainer"]),
  item("readiness", "Crew readiness", "Fleet", ["lead", "operator"]),
  item("receiving", "Receiving", "Supply", ["lead", "maintainer"]),
  item("accountability", "Accountability", "Supply", ["lead", "maintainer"]),
  item("supply", "Requests to Neros", "Supply", ["lead", "maintainer"]),
  item("quote", "Order", "Supply", ["lead"]),
  item("updates", "Software updates", "Supply", ["lead", "maintainer"]),
  item("attrition", "Attrition", "Learn", ["lead", "maintainer"]),
  item("reports", "Field reports", "Learn"),
];

/** Neros runs its own operations: the work queue first, then delivering, making, selling and learning. */
export const NEROS_NAV: readonly NavItem[] = [
  item("ops", "Work queue", ""),
  item("company", "Contract to field", "Deliver"),
  item("program", "Program", "Deliver"),
  item("quality", "Quality", "Make"),
  item("compliance", "Compliance", "Make"),
  item("config", "Configuration", "Make"),
  item("updates", "Software updates", "Make"),
  item("quote", "Quotes", "Sell"),
  item("surge", "Surge planner", "Sell"),
  item("bid", "Bid desk", "Sell"),
  item("plans", "Pricing plans", "Sell"),
  item("release", "Releasability", "Sell"),
  item("cases", "Field fixes", "Learn"),
  item("attrition", "Attrition", "Learn"),
  item("reports", "Field reports", "Learn"),
  item("eval", "Evidence", "Learn"),
  item("configure", "Loadout planner", "Learn"),
  item("physics", "Physics check", "Learn"),
];

/** Every page a workspace has, whether or not this role's rail shows it. */
export function navFor(w: Workspace): readonly NavItem[] {
  if (w === "neros") return NEROS_NAV;
  if (w === "customer") return CUSTOMER_NAV;
  // No organization (the local demo server): every page, the work queue first, each page once.
  const out: NavItem[] = [NEROS_NAV[0]!];
  for (const n of [...CUSTOMER_NAV, ...NEROS_NAV.slice(1)]) if (!out.some((m) => m.id === n.id)) out.push(n);
  return out;
}

const LEAD_ROLES = ["admin", "mission_commander", "planner", "ops_lead", "analyst", "auditor"];
export function profilesOf(viewer: Pick<Viewer, "roles">): Profile[] {
  const out: Profile[] = [];
  if (viewer.roles.some((r) => LEAD_ROLES.includes(r))) out.push("lead");
  if (viewer.roles.includes("operator")) out.push("operator");
  if (viewer.roles.includes("maintainer")) out.push("maintainer");
  return out.length ? out : ["lead"];
}

/** A maintainer's day starts with airframes, so their rail does too. */
function onlyMaintainer(viewer: Pick<Viewer, "roles">): boolean {
  const p = profilesOf(viewer);
  return p.length === 1 && p[0] === "maintainer";
}

export type RailGroup = { label: string; items: NavItem[] };
/** The rail for this person in this workspace: their pages, grouped, in the order their work runs. */
export function railFor(w: Workspace, viewer: Pick<Viewer, "roles">): RailGroup[] {
  const mine = profilesOf(viewer);
  const items = navFor(w).filter((n) => n.for.some((p) => mine.includes(p)));
  const groups: RailGroup[] = [];
  for (const n of items) {
    const g = groups.find((x) => x.label === n.group);
    if (g) g.items.push(n);
    else groups.push({ label: n.group, items: [n] });
  }
  if (w === "customer" && onlyMaintainer(viewer)) {
    const order = ["Fleet", "Supply", "Fly", "Learn"];
    groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  }
  return groups;
}

/** How many of this workspace's pages the rail leaves out for this person (they stay in Cmd-K). */
export function hiddenCount(w: Workspace, viewer: Pick<Viewer, "roles">): number {
  return navFor(w).length - railFor(w, viewer).reduce((n, g) => n + g.items.length, 0);
}

const KEY = "a2e-workspace";

export function canSwitch(viewer: Viewer): boolean {
  return viewer.org === "neros";
}

export function workspaceOf(viewer: Viewer): Workspace {
  if (!viewer.org) return "all";
  if (viewer.org !== "neros") return "customer";
  try {
    return localStorage.getItem(KEY) === "customer" ? "customer" : "neros";
  } catch {
    return "neros";
  }
}

export function rememberWorkspace(w: Workspace): void {
  try {
    localStorage.setItem(KEY, w);
  } catch {
    /* not remembered */
  }
}

export function sectionsFor(w: Workspace): Section[] {
  return [...navFor(w).map((n) => n.id), "access", "integrations", "audit"];
}

/** Where each person lands: Neros on its work queue, a maintainer on airframes, everyone else on the live map. */
export function homeOf(w: Workspace, viewer?: Pick<Viewer, "roles">): Section {
  if (w === "neros") return "ops";
  if (w === "customer" && viewer && onlyMaintainer(viewer)) return "fleet";
  return "operate";
}

/** The demo role matrix (demo/ledger.mjs, mirrored from policies/role_matrix): drives which buttons are live. */
export function can(viewer: Pick<Viewer, "roles">, permission: string): boolean {
  const matrix = ROLE_MATRIX as Record<string, readonly string[]>;
  return viewer.roles.some((role) => (matrix[role] ?? []).includes(permission));
}

/** True when the page is showing a customer's workspace (a customer, or Neros staff on the Customer switch). */
export function inCustomerView(viewer: Viewer): boolean {
  return workspaceOf(viewer) === "customer";
}
