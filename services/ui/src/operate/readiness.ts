import type { Vehicle } from "./vehicle";

/**
 * Launch readiness: a go/no-go for every vehicle that is on the ground, and a
 * clock from power-on to ready. The console only advises. It does not arm or
 * launch anything; the operator does that on the vehicle's own controls.
 */

export const LAUNCH_MIN_BATTERY_PCT = 60;
const LINK_FRESH_MS = 5_000;

export interface Check {
  id: "power" | "link" | "airworthy" | "battery" | "position";
  label: string;
  ok: boolean;
  detail: string;
}

/** On the ground: powered and disarmed, or registered and not heard from yet (still in the case). */
export function onGround(v: Vehicle): boolean {
  return v.live === null || v.live.armed === false;
}

export function checks(v: Vehicle): Check[] {
  const p = v.live;
  const airworthiness = v.airworthiness;
  if (!p) return [{ id: "power", label: "Powered on", ok: false, detail: "No link yet" }];
  const fresh = v.linkAgeMs !== null && v.linkAgeMs <= LINK_FRESH_MS;
  const battery = p.battery_pct;
  const batteryOk = typeof battery === "number" && battery >= LAUNCH_MIN_BATTERY_PCT;
  const fix = p.nav_source !== "none" && (p.gnss_trusted !== false || p.nav_source === "vio");
  return [
    { id: "link", label: "Link", ok: fresh, detail: fresh ? "Fresh" : "Stale or missing" },
    {
      id: "airworthy",
      label: "Airworthiness",
      ok: airworthiness !== "restricted" && airworthiness !== "grounded",
      // Carry the birth-record or maintenance reason when there is one, so the operator sees why.
      detail: v.airworthinessReason || (airworthiness ? airworthiness[0]!.toUpperCase() + airworthiness.slice(1) : "Not recorded"),
    },
    {
      id: "battery",
      label: "Battery",
      ok: batteryOk,
      detail: typeof battery === "number" ? `${Math.round(battery)}%${batteryOk ? "" : `, need ${LAUNCH_MIN_BATTERY_PCT}%`}` : "Unknown",
    },
    {
      id: "position",
      label: "Position fix",
      ok: fix,
      detail: p.nav_source === "none" ? "Acquiring" : p.gnss_trusted === false ? (p.nav_source === "vio" ? "VIO only" : "GNSS rejected") : "GNSS",
    },
  ];
}

export function isGo(list: readonly Check[]): boolean {
  return list.length > 0 && list.every((c) => c.ok);
}

/** First failing check, phrased for a list row. */
export function blocker(list: readonly Check[]): string | null {
  const bad = list.find((c) => !c.ok);
  return bad ? `${bad.label}: ${bad.detail}` : null;
}

export interface ReadyEntry {
  /** When the console first heard the vehicle; null if it was already up when the console opened. */
  upAt: number | null;
  readyAt: number | null;
}

export type ReadyClock = ReadonlyMap<string, ReadyEntry>;

/**
 * Advance the power-on-to-ready clock. Returns the new clock and the tails that
 * became ready on this tick with how long it took (null when power-on was not seen).
 */
export function tick(
  clock: ReadyClock,
  fleet: readonly Vehicle[],
  goByTail: ReadonlyMap<string, boolean>,
  now: number,
  first: boolean,
): { clock: Map<string, ReadyEntry>; ready: { tail: string; ms: number | null }[] } {
  const next = new Map<string, ReadyEntry>();
  const ready: { tail: string; ms: number | null }[] = [];
  for (const v of fleet) {
    if (!v.live) continue; // Powered off or not yet on: the clock starts again at the next link.
    const old = clock.get(v.tail);
    const entry: ReadyEntry = old ? { ...old } : { upAt: first ? null : now, readyAt: null };
    if (entry.readyAt === null && goByTail.get(v.tail) === true && onGround(v)) {
      entry.readyAt = now;
      if (!first) ready.push({ tail: v.tail, ms: entry.upAt === null ? null : now - entry.upAt });
    }
    next.set(v.tail, entry);
  }
  return { clock: next, ready };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function seconds(ms: number): string {
  return ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
