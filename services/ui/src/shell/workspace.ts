import { ROLE_MATRIX } from "../../demo/ledger.mjs";
import type { Section, Viewer } from "./types";

/**
 * Two products on one platform. Neros runs its own operations (the work queue,
 * the company view, and the loss data customers choose to share); a customer
 * runs its own fleet (operate, plan, maintain, and ask Neros for resupply).
 * Neros staff can switch to the customer view to see what a customer sees.
 */
export type Workspace = "neros" | "customer" | "all";

export const NAV: readonly { id: Section; label: string; in: readonly Workspace[]; group?: string }[] = [
  { id: "ops", label: "Work queue", in: ["neros", "all"] },
  { id: "operate", label: "Operate", in: ["customer", "all"] },
  { id: "brief", label: "Brief", in: ["customer", "all"] },
  { id: "missions", label: "Missions", in: ["customer", "all"] },
  { id: "debrief", label: "Debrief", in: ["customer", "all"] },
  // Fleet: every airframe the unit holds, from any vendor, as it is now.
  { id: "fleet", label: "Airframes", in: ["customer", "all"], group: "Fleet" },
  { id: "mixed", label: "All vendors", in: ["customer", "all"], group: "Fleet" },
  { id: "config", label: "Configuration", in: ["neros", "customer", "all"], group: "Fleet" },
  { id: "stockpile", label: "Stockpile health", in: ["customer", "all"], group: "Fleet" },
  { id: "readiness", label: "Readiness", in: ["customer", "all"], group: "Fleet" },
  // Sustain: what arrives, what is spent, what to ask for, what to install.
  { id: "receiving", label: "Receiving", in: ["customer", "all"], group: "Sustain" },
  { id: "accountability", label: "Accountability", in: ["customer", "all"], group: "Sustain" },
  { id: "supply", label: "Supply & support", in: ["customer", "all"], group: "Sustain" },
  { id: "updates", label: "Updates", in: ["neros", "customer", "all"], group: "Sustain" },
  { id: "quote", label: "Quote and order", in: ["customer", "all"], group: "Sustain" },
  { id: "company", label: "Company", in: ["neros", "all"] },
  { id: "program", label: "Program", in: ["neros", "all"] },
  { id: "quality", label: "Quality", in: ["neros", "all"] },
  { id: "compliance", label: "Compliance", in: ["neros", "all"] },
  // Commercial: what Neros sells, can promise and bids.
  { id: "quote", label: "Quotes", in: ["neros"], group: "Commercial" },
  { id: "surge", label: "Surge planner", in: ["neros", "all"], group: "Commercial" },
  { id: "bid", label: "Bid desk", in: ["neros", "all"], group: "Commercial" },
  { id: "plans", label: "Plans", in: ["neros", "all"], group: "Commercial" },
  { id: "release", label: "Releasability", in: ["neros", "all"], group: "Commercial" },
  // Analysis: studies and models rather than daily work.
  { id: "cases", label: "Fix loop", in: ["neros", "all"], group: "Analysis" },
  { id: "eval", label: "Eval", in: ["neros", "all"], group: "Analysis" },
  { id: "attrition", label: "Attrition", in: ["neros", "customer", "all"], group: "Analysis" },
  { id: "reports", label: "Reports", in: ["neros", "customer", "all"], group: "Analysis" },
  { id: "denial", label: "Denial map", in: ["customer", "all"], group: "Analysis" },
  { id: "configure", label: "Configure", in: ["neros", "customer", "all"], group: "Analysis" },
];

/** The top bar: plain tabs, and a menu for each group with more than one page in this workspace. */
export type NavEntry = { kind: "tab"; id: Section; label: string } | { kind: "menu"; label: string; items: { id: Section; label: string }[] };
export function navEntries(w: Workspace): NavEntry[] {
  const items = NAV.filter((n) => n.in.includes(w));
  const size = (g: string) => items.filter((n) => n.group === g).length;
  const out: NavEntry[] = [];
  for (const n of items) {
    if (!n.group || size(n.group) === 1) out.push({ kind: "tab", id: n.id, label: n.label });
    else if (!out.some((e) => e.kind === "menu" && e.label === n.group)) out.push({ kind: "menu", label: n.group, items: items.filter((m) => m.group === n.group).map((m) => ({ id: m.id, label: m.label })) });
  }
  return out;
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
  return [...NAV.filter((n) => n.in.includes(w)).map((n) => n.id), "access", "integrations", "audit"];
}

export function homeOf(w: Workspace): Section {
  return w === "neros" ? "ops" : "operate";
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
