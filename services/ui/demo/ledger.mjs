// What the demo needs for the Fleet, Access and Audit pages: the role matrix in
// plain words, the demo accounts, a factory birth record per tail, and an
// append-only audit log where each row carries the SHA-256 of the row before it.
// Runs in Node (demo/server.mjs) and in the browser (hosted static demo), so the
// hash is plain JS rather than node:crypto or the async WebCrypto API.

// Mirrors policies/role_matrix/data.json; demo/ledger.test.mjs fails if they drift.
export const ROLE_MATRIX = {
  admin: ["fleet.read", "fleet.write", "custody.append", "org.read", "org.write", "sharing.read", "sharing.create", "sharing.approve", "audit.read", "release.export", "user.read", "user.provision", "mission.read", "mission.draft", "mission.review", "mission.approve", "mission.execute", "vehicle.command", "video.read", "video.manage", "telemetry.read", "sim.run", "behavior.read", "behavior.promote"],
  mission_commander: ["fleet.read", "fleet.write", "custody.append", "org.read", "sharing.read", "sharing.create", "sharing.approve", "release.export", "user.read", "mission.read", "mission.draft", "mission.review", "mission.approve", "mission.execute", "vehicle.command", "video.read", "video.manage", "telemetry.read", "sim.run", "behavior.read", "behavior.promote"],
  planner: ["fleet.read", "org.read", "sharing.read", "release.export", "user.read", "mission.read", "mission.draft", "mission.review", "video.read", "telemetry.read", "sim.run", "behavior.read"],
  operator: ["fleet.read", "custody.append", "org.read", "user.read", "mission.read", "mission.execute", "vehicle.command", "video.read", "telemetry.read"],
  analyst: ["fleet.read", "org.read", "sharing.read", "release.export", "user.read", "mission.read", "video.read", "telemetry.read", "behavior.read"],
  maintainer: ["fleet.read", "fleet.write", "custody.append", "org.read", "user.read", "mission.read", "video.read", "telemetry.read"],
  auditor: ["fleet.read", "org.read", "sharing.read", "audit.read", "user.read", "mission.read", "video.read", "telemetry.read", "behavior.read"],
};

export function can(roles, permission) {
  return roles.some((role) => (ROLE_MATRIX[role] ?? []).includes(permission));
}

// The four hosted-demo sign-ins (passwords are shared out of band; see staticDemo.ts).
export const ACCOUNTS = [
  // `org` picks the workspace: "neros" runs operations, a customer id runs its own fleet (demo/ops.mjs).
  { id: "demo-admin", username: "admin", display_name: "Demo Admin", roles: ["admin"], org: "neros" },
  { id: "demo-ops", username: "ops", display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" },
  { id: "demo-commander", username: "commander", display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" },
  { id: "demo-operator", username: "operator", display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" },
  { id: "demo-maintainer", username: "maintainer", display_name: "Demo Maintainer", roles: ["maintainer"], org: "CUS-A" },
];

// ---- SHA-256 (FIPS 180-4), synchronous, UTF-8 input, lowercase hex output ----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = (w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

// ---- Audit log: append-only, each row hashes the previous row's hash ----
const GENESIS = "0".repeat(64);

function rowHash(prev, r) {
  return sha256Hex(prev + JSON.stringify([r.seq, r.occurred_at, r.actor_id, r.action, r.resource_type, r.resource_id, r.decision, r.reason_codes, r.detail]));
}

export function createLedger() {
  const rows = [];
  return {
    append({ actor, action, resource_type, resource_id = "", decision = "allow", reason_codes = [], detail = "", at = Date.now() }) {
      const prev = rows.length ? rows[rows.length - 1].row_hash : GENESIS;
      const r = {
        seq: rows.length + 1,
        id: `ev-${rows.length + 1}`,
        occurred_at: new Date(at).toISOString(),
        actor_id: String(actor || "unknown"),
        action,
        resource_type,
        resource_id: String(resource_id),
        decision,
        reason_codes: [...reason_codes],
        detail: String(detail),
        prev_hash: prev,
      };
      r.row_hash = rowHash(prev, r);
      rows.push(r);
      return r;
    },
    items() {
      return rows.map((r) => ({ ...r, reason_codes: [...r.reason_codes] }));
    },
  };
}

/** Index of the first row whose hash does not follow from the row before it, or -1 if the chain holds. */
export function verifyChain(items) {
  let prev = GENESIS;
  for (let i = 0; i < items.length; i += 1) {
    const r = items[i];
    if (r.prev_hash !== prev || rowHash(prev, r) !== r.row_hash) return i;
    prev = r.row_hash;
  }
  return -1;
}

// ---- Factory birth records (same shape as a2e.birth.from_dict / sim/bench) ----
// Synthetic: the lots and numbers are made up for the demo fleet. NX-05 carries
// ESC lot ESC-2611, the lot the Attrition autopsy flags, so the digital thread
// shows up in the registry. NX-12 failed its EOL hover test.
const LOTS = { frame: ["FR-2604", "FR-2607"], esc: ["ESC-2598", "ESC-2603", "ESC-2611"], motor: ["MT-1180", "MT-1192"], fc: ["FC-0331", "FC-0334"] };

export function birthRecord(tail, index, grounded) {
  const pick = (list, k) => list[(index + k) % list.length];
  const esc = tail === "NX-05" ? "ESC-2611" : pick(LOTS.esc.slice(0, 2), 0);
  const failed = Boolean(grounded);
  const accel = failed ? 0.42 : 0.04 + ((index * 7) % 9) / 100;
  return {
    serial: `A2E-${tail.replace("NX-", "")}${String(1000 + index * 37).slice(-3)}`,
    tail_number: tail,
    parts: [
      { part: "frame", lot: pick(LOTS.frame, 0) },
      { part: "esc", lot: esc },
      { part: "motor", lot: pick(LOTS.motor, 1) },
      { part: "flight controller", lot: pick(LOTS.fc, 0) },
    ],
    calibrations: [
      { name: "IMU", value: Number(accel.toFixed(2)), low: 0, high: 0.2 },
      { name: "gyro", value: Number((0.1 + ((index * 3) % 5) / 20).toFixed(2)), low: 0, high: 0.5 },
    ],
    firmware_sha256: sha256Hex(`a2e-px4-v1.15.4-${index < 7 ? "vio" : "gnss"}`),
    eol: { kind: "hover", passed: !failed, note: failed ? "IMU cal out of range" : "" },
    recorded_at: new Date(Date.UTC(2026, 9, 6 + index, 14, 20)).toISOString(),
  };
}

/** Same rule as a2e.birth.verdict: a failed EOL test or an out-of-range cal grounds the airframe. */
export function birthVerdict(rec) {
  const bad = rec.calibrations.find((c) => c.value < c.low || c.value > c.high);
  const cause = bad ? `${bad.name} cal out of range` : rec.eol.note || "no cause recorded";
  if (!rec.eol.passed) return { status: "grounded", reason: `EOL ${rec.eol.kind} test failed: ${cause}` };
  if (bad) return { status: "grounded", reason: cause };
  return { status: "airworthy", reason: `EOL ${rec.eol.kind} test passed` };
}
