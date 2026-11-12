import { api } from "../api";

/**
 * The operating picture around the fleet: what each vehicle is doing, not just
 * where it is. Areas being surveyed, planned paths, task allocation, link
 * quality, and hazards such as a GNSS jamming zone. Everything here is
 * optional; a gateway that does not serve it leaves those layers off.
 */

export type LatLon = readonly [number, number];

export interface Basemap {
  url: string;
  south: number;
  west: number;
  north: number;
  east: number;
  attribution: string;
  /** Optional 8-bit greyscale heightmap over the same bounds, for the 3D view. */
  heightmap?: string;
  /** Elevation at grey 0 and grey 255, metres above sea level. */
  elevation_m?: [number, number];
}

export interface Zone {
  id: string;
  kind: string;
  label: string;
  lat: number;
  lon: number;
  radius_m: number;
}

export interface Area {
  id: string;
  tail: string;
  ring: LatLon[];
  covered_pct: number;
  swath_m: number;
  flown: LatLon[];
  ahead: LatLon[];
}

export interface Route {
  tail: string;
  kind: string;
  path: LatLon[];
}

export interface Link {
  a: string;
  b: string;
  quality: number;
}

export interface Task {
  id: string;
  label: string;
  lat: number;
  lon: number;
  tail: string | null;
}

export interface Picture {
  source: string;
  basemap?: Basemap | null;
  station?: { label: string; lat: number; lon: number } | null;
  zones?: Zone[];
  areas?: Area[];
  routes?: Route[];
  links?: Link[];
  tasks?: Task[];
  notes?: Record<string, string>;
}

export interface Layers {
  terrain: boolean;
  coverage: boolean;
  links: boolean;
  tasks: boolean;
  /** Where the station's control link goes thin or is lost behind terrain, at 100 m. */
  radio: boolean;
}

export const LAYER_NAMES: Record<keyof Layers, string> = {
  terrain: "Terrain",
  coverage: "Coverage",
  links: "Links",
  tasks: "Tasks",
  radio: "Radio shadow",
};

export const DEFAULT_LAYERS: Layers = { terrain: true, coverage: true, links: true, tasks: true, radio: false };

/** The station's control-link margin over the terrain, as a grid of cells in latitude and longitude. */
export interface RadioGrid {
  agl_m: number;
  need_db: number;
  half_deg: [number, number];
  cells: { ll: [number, number]; m: number }[];
}

export async function loadRadio(): Promise<RadioGrid | null> {
  try {
    const { body } = await api<RadioGrid>("/v1/coverage?link=c2&band=915&agl_m=100&ll=1");
    return body && Array.isArray(body.cells) && Array.isArray(body.half_deg) ? body : null;
  } catch {
    return null;
  }
}

export async function loadPicture(): Promise<Picture | null> {
  try {
    const { body } = await api<Picture>("/v1/operations/picture");
    return body && typeof body === "object" && typeof body.source === "string" ? body : null;
  } catch {
    return null;
  }
}

export interface Replan {
  id: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** Tasks whose owner changed between two pictures. */
export function replans(before: Picture | null, after: Picture | null): Replan[] {
  if (!before?.tasks || !after?.tasks) return [];
  const old = new Map(before.tasks.map((t) => [t.id, t.tail] as const));
  return after.tasks.flatMap((t) => (old.has(t.id) && old.get(t.id) !== t.tail ? [{ id: t.id, label: t.label, from: old.get(t.id) ?? null, to: t.tail }] : []));
}

/** One line per vehicle that lost or gained tasks, for the timeline. */
export function replanText(changes: readonly Replan[]): { tail: string; text: string }[] {
  const byFrom = new Map<string, Replan[]>();
  for (const c of changes) {
    const key = c.from ?? c.to ?? "";
    byFrom.set(key, [...(byFrom.get(key) ?? []), c]);
  }
  return [...byFrom].map(([tail, list]) => ({
    tail,
    text: `Re-plan: ${list.map((c) => `${c.id} ${c.from ?? "unassigned"} → ${c.to ?? "unassigned"}`).join(", ")}`,
  }));
}
