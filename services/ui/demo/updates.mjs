// Controlled updates and re-banding: signed releases, staged rollout, halt on canary faults.
//
// Why: capability on attritable drones now ships by software (firmware fixes,
// frequency profiles moved off a jammed band) faster than airframes ship. A
// unit cannot take an update it has not approved, onto drones it cannot see,
// without a way back. Here Neros publishes a signed release; the customer
// approves it, flies it on a canary (two serials in each unit), and only then
// rolls it out unit by unit. A canary whose link or hardware faults rise is
// halted automatically. Disconnected units get an air-gap bundle: a manifest
// the ground station verifies before install.
//
// The console records and stages; it never pushes code to a vehicle. Releases,
// signatures, canary sorties and results are simulated (SIM). Pure JavaScript.

import { TODAY } from "./company.mjs";
import { CUSTOMERS } from "./company.mjs";

const sha = (s) => {
  // Small deterministic stand-in for a digest (SIM). Not a cryptographic hash.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const c of s) {
    h1 = Math.imul(h1 ^ c.charCodeAt(0), 16777619) >>> 0;
    h2 = Math.imul(h2 + c.charCodeAt(0), 2246822519) >>> 0;
  }
  return Array.from({ length: 8 }, (_, i) => ((Math.imul(h1 ^ (i * 2654435761), h2 + i) >>> 0).toString(16).padStart(8, "0"))).join("");
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Halt rule: a canary unit stops the rollout when faults rise this far above its own baseline. */
export const HALT_RULE = { sorties_per_serial: 6, max_fault_rate_rise: 0.1, max_lost_links: 3 };

const RELEASES = [
  {
    id: "FW-1.16.0", kind: "firmware", version: "1.16.0", component: "Flight controller (PX4)", size_mb: 3.8,
    notes: "ESC desync recovery on ESC-4IN1; VIO drift correction after GNSS loss (SIM)",
    status: "published", published: "2026-11-02",
    // SIM effect on canary sorties: fewer hardware faults.
    effect: { fault: -0.02 },
  },
  {
    id: "RF-P4", kind: "frequency profile", version: "P4", component: "Control link (RAD-C2)", size_mb: 0.1,
    notes: "Re-band the control link from band plan P3 to P4, away from the band jammed on the training range (SIM)",
    status: "published", published: "2026-11-03",
    // SIM regression: P4 sits badly with the 10-inch frame's antenna placement.
    effect: { fault: -0.01, lost_link_by_sku: { "ARCHER-10": 0.3 } },
  },
  {
    id: "FW-1.17.0-rc1", kind: "firmware", version: "1.17.0-rc1", component: "Flight controller (PX4)", size_mb: 3.9,
    notes: "Release candidate: operator workload changes to the low-battery return (SIM)",
    status: "draft", published: null, effect: { fault: 0 },
  },
].map((r) => ({ ...r, sha256: sha(`${r.id}-${r.version}-release`), signature: `ed25519:${sha(`sig-${r.id}`).slice(0, 64)}`, signer: "Neros release key 2026-A (SIM)" }));

/** @param {{ serials: ReturnType<import("./serials.mjs").createSerials> }} deps */
export function createUpdates({ serials }) {
  const releases = RELEASES.map((r) => ({ ...r, effect: { ...r.effect } }));
  // rollouts[org][releaseId] = { status, approved_by, canary, units: {unit: stage}, halt, results }
  const rollouts = {};
  const installed = new Map(); // serial -> release id applied (firmware version or band plan)

  const unitsOf = (org) => CUSTOMERS.find((c) => c.id === org)?.units ?? [];
  const fleetOf = (org, unit = null) => [...serials.serials.values()].filter((s) => s.org === org && (!unit || s.unit === unit) && (s.state === "accepted" || s.state === "issued"));
  const rollout = (org, id) => (rollouts[org] ??= {})[id] ?? null;

  function versions(org) {
    return unitsOf(org).map((unit) => {
      const own = fleetOf(org, unit);
      const fw = {};
      const band = {};
      for (const s of own) {
        const applied = installed.get(s.serial) ?? [];
        const f = [...applied].reverse().find((id) => id.startsWith("FW-"));
        const b = [...applied].reverse().find((id) => id.startsWith("RF-"));
        const v = f ? releases.find((r) => r.id === f).version : s.firmware.version;
        fw[v] = (fw[v] ?? 0) + 1;
        const bp = b ? releases.find((r) => r.id === b).version : "P3";
        band[bp] = (band[bp] ?? 0) + 1;
      }
      return { unit, sku: own[0]?.sku ?? null, serials: own.length, firmware: fw, band_plan: band };
    });
  }

  function apply(org, rel, list) {
    for (const s of list) installed.set(s.serial, [...(installed.get(s.serial) ?? []), rel.id]);
  }

  /** Fly the canary: six simulated sorties per canary serial, before and after, per unit. */
  function flyCanary(org, rel, canary) {
    const rng = mulberry32([...`${org}${rel.id}`].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const results = [];
    for (const unit of unitsOf(org)) {
      const list = canary.filter((s) => s.unit === unit);
      if (!list.length) continue;
      const sku = list[0].sku;
      const base = { fault: 0.05, lost_link: 0.05 };
      const after = { fault: Math.max(0, base.fault + (rel.effect.fault ?? 0)), lost_link: base.lost_link + (rel.effect.lost_link_by_sku?.[sku] ?? 0) };
      const n = list.length * HALT_RULE.sorties_per_serial;
      let faults = 0, lost = 0, baseFaults = 0;
      for (let i = 0; i < n; i += 1) {
        if (rng() < after.fault) faults += 1;
        if (rng() < after.lost_link) lost += 1;
        if (rng() < base.fault + base.lost_link) baseFaults += 1;
      }
      const rate = (faults + lost) / n;
      const baseRate = baseFaults / n;
      const fail = lost >= HALT_RULE.max_lost_links || rate - baseRate > HALT_RULE.max_fault_rate_rise;
      results.push({ unit, sku, serials: list.map((s) => s.serial), sorties: n, faults, lost_links: lost, rate: Number(rate.toFixed(3)), baseline: Number(baseRate.toFixed(3)), pass: !fail });
    }
    return results;
  }

  function view(org, neros) {
    const rows = releases.filter((r) => neros || r.status !== "draft").map((r) => {
      const ro = rollout(org, r.id);
      return {
        id: r.id, kind: r.kind, version: r.version, component: r.component, notes: r.notes, size_mb: r.size_mb,
        sha256: r.sha256, signature: r.signature, signer: r.signer, status: r.status, published: r.published,
        rollout: ro ? { ...ro } : { status: "awaiting approval", units: {} },
        customers: neros ? CUSTOMERS.map((c) => ({ org: c.id, status: rollout(c.id, r.id)?.status ?? "awaiting approval", halt: rollout(c.id, r.id)?.halt ?? null })) : undefined,
      };
    });
    return {
      source: "Simulated: releases, signatures, canary sorties and results are demo data. The console stages and records updates; it never pushes code to a vehicle.",
      today: TODAY,
      org,
      halt_rule: `Halt when a canary unit loses link ${HALT_RULE.max_lost_links} or more times, or its fault rate rises over ${Math.round(HALT_RULE.max_fault_rate_rise * 100)} points above baseline, across ${HALT_RULE.sorties_per_serial} sorties per canary serial`,
      units: unitsOf(org),
      versions: versions(org),
      releases: rows,
    };
  }

  function act(org, action, a, actor) {
    const rel = releases.find((r) => r.id === a.release);
    if (!rel) return { error: "no such release", status: 404 };
    if (action === "updates.publish") {
      if (rel.status === "published") return { error: `${rel.id} is already published`, status: 409 };
      rel.status = "published";
      rel.published = TODAY;
      return { ok: true, message: `${rel.id} published, signed by ${rel.signer}. Each customer approves it before any drone takes it.` };
    }
    if (action === "updates.withdraw") {
      if (rel.status !== "published") return { error: `${rel.id} is ${rel.status}`, status: 409 };
      rel.status = "withdrawn";
      return { ok: true, message: `${rel.id} withdrawn: no customer can approve or stage it. Customers with it on drones see it marked withdrawn and can revert.` };
    }
    if (rel.status !== "published" && action !== "updates.revert") return { error: `${rel.id} is ${rel.status}`, status: 409 };
    const ro = rollout(org, rel.id);
    if (action === "updates.approve") {
      if (ro) return { error: `${rel.id} is already ${ro.status}`, status: 409 };
      rollouts[org][rel.id] = { status: "approved", approved_by: actor, approved: TODAY, units: {}, results: [], halt: null, canary: [] };
      return { ok: true, message: `${rel.id} approved for your fleet by ${actor}. Next: fly it on the canary.` };
    }
    if (!ro) return { error: `Approve ${rel.id} first`, status: 409 };
    if (action === "updates.canary") {
      if (ro.status !== "approved") return { error: `${rel.id} is ${ro.status}`, status: 409 };
      const canary = unitsOf(org).flatMap((u) => fleetOf(org, u).filter((s) => s.state === "issued").slice(0, 2));
      if (!canary.length) return { error: "no issued drones to canary", status: 409 };
      apply(org, rel, canary);
      ro.canary = canary.map((s) => s.serial);
      ro.results = flyCanary(org, rel, canary);
      const failed = ro.results.filter((r) => !r.pass);
      for (const r of ro.results) ro.units[r.unit] = "canary";
      if (failed.length) {
        ro.status = "halted";
        ro.halt = `Canary failed in ${failed.map((f) => `${f.unit} (${f.sku}: ${f.lost_links} lost links, ${f.faults} faults in ${f.sorties} sorties)`).join(", ")}. Canary drones keep the release until reverted; nothing else takes it.`;
        return { ok: true, message: `${rel.id} halted automatically. ${ro.halt}` };
      }
      ro.status = "canary passed";
      return { ok: true, message: `${rel.id} canary passed on ${canary.length} drones across ${ro.results.length} units. Roll it out unit by unit.` };
    }
    if (action === "updates.promote") {
      if (ro.status !== "canary passed" && ro.status !== "rolling out") return { error: ro.status === "halted" ? `${rel.id} is halted: ${ro.halt}` : `Fly the canary first`, status: 409 };
      const unit = String(a.unit ?? "");
      if (!unitsOf(org).includes(unit)) return { error: "not one of your units", status: 404 };
      if (ro.units[unit] === "fleet") return { error: `${unit} already has ${rel.id}`, status: 409 };
      const list = fleetOf(org, unit).filter((s) => !(installed.get(s.serial) ?? []).includes(rel.id));
      apply(org, rel, list);
      ro.units[unit] = "fleet";
      const done = unitsOf(org).every((u) => ro.units[u] === "fleet");
      ro.status = done ? "complete" : "rolling out";
      return { ok: true, message: `${rel.id} staged for ${list.length} more ${unit} drones${done ? ". Every unit has it." : ""}` };
    }
    if (action === "updates.revert") {
      if (!ro.canary.length) return { error: "nothing to revert", status: 409 };
      for (const id of [...serials.serials.keys()]) {
        const applied = installed.get(id);
        if (applied?.includes(rel.id)) installed.set(id, applied.filter((x) => x !== rel.id));
      }
      ro.status = "reverted";
      return { ok: true, message: `${rel.id} reverted on every drone that had it; they return to the previous ${rel.kind}.` };
    }
    return { error: "unknown action", status: 400 };
  }

  /** The air-gap bundle manifest a disconnected unit carries to its ground station. */
  function bundle(org, releaseId, unit) {
    const rel = releases.find((r) => r.id === releaseId && r.status === "published");
    const ro = rel ? rollout(org, rel.id) : null;
    if (!rel || !ro || ro.status === "halted" || ro.status === "reverted") return null;
    const targets = fleetOf(org, unit || null).map((s) => s.serial);
    return {
      bundle: `BND-${sha(`${org}-${rel.id}-${unit || "all"}`).slice(0, 6).toUpperCase()}`,
      release: rel.id, kind: rel.kind, version: rel.version, component: rel.component,
      sha256: rel.sha256, signature: rel.signature, signer: rel.signer, size_mb: rel.size_mb,
      approved_by: ro.approved_by, approved: ro.approved, generated: TODAY,
      org, unit: unit || "all units", targets,
      verify: "The ground station checks the signature against the Neros release key and the hash against this manifest before it stages the update. A mismatch refuses the install.",
      source: "SIM",
    };
  }

  function queueItems() {
    const items = [];
    for (const [org, map] of Object.entries(rollouts)) {
      for (const [id, ro] of Object.entries(map)) {
        if (ro.status !== "halted" || releases.find((r) => r.id === id)?.status !== "published") continue;
        items.push({
          id: `q-upd-${org}-${id}`, area: "Updates", severity: "high",
          title: `${id} halted on ${org.replace("CUS-", "Customer ")}'s canary`,
          detail: ro.halt,
          org,
          actions: releases.find((r) => r.id === id)?.status === "published" ? [{ label: `Withdraw ${id}`, action: "thread.updates.withdraw", args: { release: id }, primary: true }] : [],
        });
      }
    }
    return items;
  }

  return { view, act, bundle, queueItems, releases };
}
