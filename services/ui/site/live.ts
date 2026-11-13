import { createDemo, type Demo } from "../demo/scenario.mjs";
import attrition from "../demo/assets/attrition.json";
import terrain from "../demo/assets/terrain.json";

/**
 * The public site runs the same scenario engine as the console (demo/scenario.mjs),
 * in the page, so every picture and API response on it is live demo data, not a mock-up.
 * Nothing leaves the browser.
 */
export type Persona = "neros" | "commander" | "operator" | "maintainer" | "recordplan" | "allied" | "supervisor" | "pilot" | "contractor";

export const PERSONAS: Record<Persona, { label: string; who: { display_name: string; roles: string[]; org: string; citizenship?: string } }> = {
  neros: { label: "Manufacturer ops lead", who: { display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" } },
  commander: { label: "Customer A mission commander", who: { display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" } },
  operator: { label: "Customer A operator", who: { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" } },
  maintainer: { label: "Customer A maintainer", who: { display_name: "Demo Maintainer", roles: ["maintainer"], org: "CUS-A" } },
  recordplan: { label: "Customer B commander (Record plan)", who: { display_name: "Customer B Commander", roles: ["mission_commander", "planner"], org: "CUS-B" } },
  allied: { label: "Customer C allied commander", who: { display_name: "Allied Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-C", citizenship: "Allied (SIM)" } },
  supervisor: { label: "Customer D supervisor (public safety)", who: { display_name: "Demo Supervisor (Harbor police)", roles: ["mission_commander"], org: "CUS-D" } },
  pilot: { label: "Customer D contract pilot", who: { display_name: "Demo Pilot (contract RPIC)", roles: ["operator"], org: "CUS-D" } },
  contractor: { label: "Customer D contractor seat", who: { display_name: "Demo Contractor (pilot company)", roles: ["contractor"], org: "CUS-D" } },
};

let engine: Demo | null = null;

export function demo(): Demo {
  engine ??= createDemo({ speed: 6, terrain, attrition, assetBase: "/demo-assets/" });
  return engine;
}

export function call(method: string, path: string, body = "", persona: Persona | null = null): { status: number; body: unknown; ms: number } {
  const t = performance.now();
  const out = demo().handle(method, new URL(path, window.location.origin), body, persona ? PERSONAS[persona].who : null);
  return { ...out, ms: performance.now() - t };
}

export const ATTRITION = attrition as { autopsy?: { alerts?: Array<{ value: string; ratio: number; flagged: boolean }> } };
export const TERRAIN = terrain as { south: number; west: number; north: number; east: number; attribution: string };
