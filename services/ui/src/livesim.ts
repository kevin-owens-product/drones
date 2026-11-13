import type { PlatformRow } from "./api";
import type { LivePoint } from "./live";

/**
 * Live sim: PX4 vehicles flying in a simulator (or on real hardware) through the
 * bridge in sim/swarm/bridge.py. Off unless asked for, so the hosted demo and its
 * scripted fleet never try to reach a bridge:
 *
 *   ?live=1                 the bridge on http://localhost:8765 (make swarm-up)
 *   ?live=http://host:port  a bridge somewhere else
 *   ?live=off               switch it off again
 *
 * The choice is remembered in this browser. See docs/design/live-sim.md.
 */

const KEY = "a2e-live-sim";
export const DEFAULT_BRIDGE = "http://localhost:8765";

export type LiveTask = { kind: string; detail: string; progress: number | null; goal: [number, number, number] | null };
export type LiveSimPoint = LivePoint & { source?: "px4-sitl"; landed?: boolean; link?: "ok" | "lost" | "cut"; task?: LiveTask };

export interface SwarmState {
  task: string;
  shape?: string;
  lat?: number;
  lon?: number;
  slots?: { tail: string; lat: number; lon: number; alt_m: number }[];
  corners?: [number, number][];
  paths?: { tail: string; points: [number, number][] }[];
}

export interface LiveEvent {
  id: number;
  at: number;
  tail: string;
  level: "info" | "warn" | "alert";
  text: string;
}

export interface LiveSnapshot {
  items: LiveSimPoint[];
  platforms: PlatformRow[];
  swarm: SwarmState;
  events: LiveEvent[];
  heard: number;
}

export interface LiveResult {
  ok: boolean;
  detail: string;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Pick up ?live= from the address (once, at load) and remember it. */
export function adoptLiveParam(search: string = typeof window === "undefined" ? "" : window.location.search): void {
  const raw = new URLSearchParams(search).get("live");
  if (raw === null) return;
  const value = raw.trim();
  try {
    if (value === "" || value === "1" || value === "on") localStorage.setItem(KEY, DEFAULT_BRIDGE);
    else if (value === "0" || value === "off") localStorage.removeItem(KEY);
    else if (/^https?:\/\/[^\s/]+$/.test(value.replace(/\/$/, ""))) localStorage.setItem(KEY, value.replace(/\/$/, ""));
  } catch {
    /* blocked storage: live sim stays off */
  }
}

/** The bridge's base URL, or null when live sim is off. */
export function liveBase(): string | null {
  return read();
}

export function setLiveBase(base: string | null): void {
  try {
    if (base) localStorage.setItem(KEY, base);
    else localStorage.removeItem(KEY);
  } catch {
    /* not remembered */
  }
}

async function call<T>(base: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await response.json()) as T;
  if (!response.ok && !(out && typeof out === "object" && "detail" in out)) throw new Error(response.statusText);
  return out;
}

export function liveSnapshot(base: string, since: number): Promise<LiveSnapshot> {
  return call<LiveSnapshot>(base, `/v1/live/vehicles?since=${since}`);
}

export type VehicleAction =
  | { action: "launch"; alt_m: number }
  | { action: "goto"; lat: number; lon: number; alt_m?: number }
  | { action: "hold" | "rtl" | "land" }
  | { action: "link"; on: boolean };

export function liveCommand(base: string, tail: string, command: VehicleAction): Promise<LiveResult> {
  return call<LiveResult>(base, "/v1/live/command", { tail, ...command });
}

export type SwarmTask =
  | { task: "launch"; alt_m: number; tails?: string[] }
  | { task: "formation"; shape: string; spacing_m: number; heading_deg: number; alt_m: number; lat?: number; lon?: number }
  | { task: "sweep"; width_m: number; height_m: number; lane_m: number; heading_deg: number; alt_m: number; lat?: number; lon?: number; then: "rtl" | "hold" }
  | { task: "hold" | "rtl" | "land" };

export function liveSwarm(base: string, task: SwarmTask): Promise<LiveResult> {
  return call<LiveResult>(base, "/v1/live/swarm", task);
}

export function isLiveSim(point: LivePoint | null | undefined): point is LiveSimPoint {
  return !!point && (point as LiveSimPoint).source === "px4-sitl";
}
