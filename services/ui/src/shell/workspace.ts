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
  { id: "supply", label: "Supply & support", in: ["customer", "all"] },
  { id: "company", label: "Company", in: ["neros", "all"] },
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
