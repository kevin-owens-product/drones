/**
 * Hand a mission plan from Missions to the live sim swarm in Operate.
 *
 * A plan is objectives at points, not an area, so each search objective becomes
 * an area to sweep, centred on its point. Loiter and sensor-custody points come
 * after the searches. Transit and return-to-base legs are not areas.
 *
 * Missions writes the plan here and opens Operate; the swarm panel reads it,
 * launches the vehicles that pass their launch checks, and sweeps the chosen
 * area. Nothing is flown from Missions itself. See docs/design/live-sim.md.
 */

const KEY = "a2e-live-plan";

export interface PlanArea {
  label: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface PlanForLive {
  id: string;
  name: string;
  areas: PlanArea[];
}

const ORDER: Readonly<Record<string, number>> = { search: 0, loiter: 1, sensor_custody: 2 };

/** The areas a plan's objectives describe, searches first, one per place. */
export function planAreas(objectives: readonly { kind: string; label: string; lat: number; lon: number }[]): PlanArea[] {
  const seen = new Set<string>();
  const out: PlanArea[] = [];
  const usable = objectives.filter((o) => o.kind in ORDER && Number.isFinite(o.lat) && Number.isFinite(o.lon));
  for (const o of [...usable].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))) {
    const key = `${o.lat.toFixed(5)},${o.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: o.label || `${o.lat.toFixed(4)}, ${o.lon.toFixed(4)}`, kind: o.kind, lat: o.lat, lon: o.lon });
  }
  return out;
}

export function handPlanToLive(plan: PlanForLive): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    /* blocked storage: Operate opens without the plan */
  }
}

export function readPlanForLive(): PlanForLive | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as PlanForLive;
    return plan && typeof plan.name === "string" && Array.isArray(plan.areas) && plan.areas.length ? plan : null;
  } catch {
    return null;
  }
}

export function clearPlanForLive(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Metres between two points, near enough at range scale. */
export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const north = (b.lat - a.lat) * 111_320;
  const east = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(north, east);
}
