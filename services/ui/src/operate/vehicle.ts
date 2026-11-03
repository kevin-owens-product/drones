import type { LivePoint } from "../live";

export const LINK_STALE_AFTER_MS = 20_000;
export const BATTERY_LOW_PCT = 25;

export interface Registered {
  tail_number: string;
  designation: string;
  airworthiness: string;
  classification: string;
}

export type Health = "ok" | "warn" | "alert" | "offline";

export interface Vehicle {
  tail: string;
  designation: string;
  live: LivePoint | null;
  linkAgeMs: number | null;
  health: Health;
  reasons: string[];
}

export function linkAge(time: string | undefined, now: number): number | null {
  if (typeof time !== "string" || time.length === 0) return null;
  const sent = Date.parse(time);
  return Number.isNaN(sent) ? null : Math.max(0, now - sent);
}

/** Why a vehicle needs the operator, worst first. */
export function assess(point: LivePoint | null, airworthiness: string, now: number): { health: Health; reasons: string[]; age: number | null } {
  if (!point) return { health: "offline", reasons: ["No link"], age: null };
  const age = linkAge(point.time, now);
  const reasons: string[] = [];
  let health: Health = "ok";
  if (age === null || age > LINK_STALE_AFTER_MS) {
    reasons.push("Link stale");
    health = "alert";
  }
  if (point.gnss_trusted === false) {
    reasons.push(point.nav_source === "vio" ? "GNSS rejected · on VIO" : "GNSS rejected");
    if (health === "ok") health = "warn";
  }
  if (typeof point.battery_pct === "number" && point.battery_pct < BATTERY_LOW_PCT) {
    reasons.push(`Battery ${Math.round(point.battery_pct)}%`);
    health = "alert";
  }
  if (airworthiness === "restricted") {
    reasons.push("Restricted");
    if (health === "ok") health = "warn";
  }
  return { health, reasons, age };
}

const RANK: Record<Health, number> = { alert: 0, warn: 1, ok: 2, offline: 3 };

export function mergeFleet(registry: readonly Registered[], live: readonly LivePoint[], now: number): Vehicle[] {
  const byTail = new Map(live.map((point) => [point.tail_number, point]));
  const seen = new Set<string>();
  const out: Vehicle[] = [];
  for (const row of registry) {
    seen.add(row.tail_number);
    const point = byTail.get(row.tail_number) ?? null;
    const { health, reasons, age } = assess(point, row.airworthiness, now);
    out.push({ tail: row.tail_number, designation: row.designation, live: point, linkAgeMs: age, health, reasons });
  }
  for (const point of live) {
    if (seen.has(point.tail_number)) continue;
    const { health, reasons, age } = assess(point, point.airworthiness ?? "", now);
    out.push({ tail: point.tail_number, designation: "", live: point, linkAgeMs: age, health, reasons });
  }
  return out.sort((a, b) => RANK[a.health] - RANK[b.health] || a.tail.localeCompare(b.tail));
}

export interface OpsEvent {
  id: number;
  at: number;
  tail: string;
  level: "info" | "warn" | "alert";
  text: string;
}

/** Turn two fleet snapshots into the events an operator would want logged. */
export function diffEvents(before: ReadonlyMap<string, Vehicle>, after: readonly Vehicle[], now: number, nextId: () => number): OpsEvent[] {
  const events: OpsEvent[] = [];
  // The first poll after the registry loads is not news: nothing came up.
  const anyLiveBefore = [...before.values()].some((v) => v.live !== null);
  const push = (tail: string, level: OpsEvent["level"], text: string) => events.push({ id: nextId(), at: now, tail, level, text });
  for (const v of after) {
    const old = before.get(v.tail);
    if (!old) continue;
    const was = old.live;
    const is = v.live;
    if (was && is) {
      if (was.mode && is.mode && was.mode !== is.mode) push(v.tail, "info", `Mode ${was.mode} → ${is.mode}`);
      if (was.gnss_trusted !== false && is.gnss_trusted === false) push(v.tail, "warn", "GNSS rejected by spoof gate");
      if (was.gnss_trusted === false && is.gnss_trusted === true) push(v.tail, "info", "GNSS trusted again");
      const wb = was.battery_pct ?? 100;
      const ib = is.battery_pct ?? 100;
      if (wb >= BATTERY_LOW_PCT && ib < BATTERY_LOW_PCT) push(v.tail, "alert", `Battery low, ${Math.round(ib)}%`);
    }
    const wasStale = old.reasons.includes("Link stale");
    const isStale = v.reasons.includes("Link stale");
    if (!wasStale && isStale) push(v.tail, "alert", "Link lost");
    if (wasStale && !isStale && is) push(v.tail, "info", "Link restored");
    if (!was && is && anyLiveBefore) push(v.tail, "info", "Link up");
  }
  return events;
}

export function fmt(value: number | undefined, digits: number, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "—";
}

export function ago(ms: number | null): string {
  if (ms === null) return "never";
  if (ms < 1500) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
