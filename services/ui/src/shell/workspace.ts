import { ROLE_MATRIX } from "../../demo/ledger.mjs";
import type { Section, Viewer } from "./types";

/**
 * Two products on one platform. Neros runs its own operations (the work queue,
 * the company view, and the loss data customers choose to share); a customer
 * runs its own fleet (operate, plan, maintain, and ask Neros for resupply).
 * Neros staff can switch to the customer view to see what a customer sees.
 */
export type Workspace = "neros" | "customer" | "all";

export const NAV: readonly { id: Section; label: string; in: readonly Workspace[] }[] = [
  { id: "ops", label: "Work queue", in: ["neros", "all"] },
  { id: "operate", label: "Operate", in: ["customer", "all"] },
  { id: "brief", label: "Brief", in: ["customer", "all"] },
  { id: "missions", label: "Missions", in: ["customer", "all"] },
  { id: "debrief", label: "Debrief", in: ["customer", "all"] },
  { id: "fleet", label: "Fleet", in: ["customer", "all"] },
  { id: "receiving", label: "Receiving", in: ["customer", "all"] },
  { id: "accountability", label: "Accountability", in: ["customer", "all"] },
  { id: "readiness", label: "Readiness", in: ["customer", "all"] },
  { id: "supply", label: "Supply & support", in: ["customer", "all"] },
  { id: "company", label: "Company", in: ["neros", "all"] },
  { id: "quality", label: "Quality", in: ["neros", "all"] },
  { id: "compliance", label: "Compliance", in: ["neros", "all"] },
  { id: "eval", label: "Eval", in: ["neros", "all"] },
  { id: "attrition", label: "Attrition", in: ["neros", "customer", "all"] },
  { id: "reports", label: "Reports", in: ["neros", "customer", "all"] },
  { id: "denial", label: "Denial map", in: ["customer", "all"] },
  { id: "configure", label: "Configure", in: ["neros", "customer", "all"] },
];

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
  return [...NAV.filter((n) => n.in.includes(w)).map((n) => n.id), "access", "audit"];
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
