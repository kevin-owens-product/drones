// Product line, inventory, maintenance, parts and supply chain for the demo.
//
// Two kinds of data live here, and the page keeps them apart:
//  - PUBLISHED: what Neros says about its own products on neros.tech and in its
//    press releases. Each entry carries the source URL. Where Neros has not
//    published a figure the entry says "not published"; nothing is filled in.
//  - SIM: everything about stock, lots, suppliers, costs, lead times, units and
//    work orders. Made up for the demo and labelled so on every screen.
//
// ADR-0016 (no weapons in the domain): the Strike variants appear as catalogue
// and inventory SKUs only. They have no BOM here, cannot be built, kitted or
// planned by this platform, and nothing models a payload, targeting or release.
//
// Pure JavaScript with no Node imports, so it runs behind demo/server.mjs and
// inside the browser for the hosted static demo.

export const SOURCES = {
  site: "https://www.neros.tech/",
  archer5: "https://www.neros.tech/products/archer-5",
  training: "https://www.neros.tech/mission-success",
  block2: "https://www.businesswire.com/news/home/20260309/en (Archer Block 2 launch, 9 Mar 2026)",
};

const NP = "not published";

// ---- Catalogue (PUBLISHED) --------------------------------------------------
// `family` drives grouping on the page. `restricted` marks ADR-0016 SKUs.
export const CATALOG = [
  {
    sku: "ARCHER-5",
    name: "Archer 5″",
    family: "airframe",
    role: "Close quarters (CQB)",
    summary: "Built for close quarters, with optional prop guards for indoor flight.",
    specs: [
      ["Length × width", "13.9 × 14.8 in"],
      ["Airframe weight", "1,200 g (2.65 lb)"],
      ["Weight with battery", "1,270 g (2.80 lb)"],
      ["Top speed", "120 km/h (74 mph)"],
      ["Flight range", "13 km"],
      ["Flight time", "20 min"],
      ["Launch time", "under 3 min"],
      ["FPV camera", "2,300 TVL, 150° FOV"],
      ["Thermal camera", "640 × 480, 78° FOV"],
      ["Down camera", "1,200 TVL, 150° FOV"],
      ["EO/IR illuminator", "1,000 lm, 1,000 mW/sr"],
      ["Video link", "High-power adjustable analog"],
      ["Control link", "Dual band, EW hardened"],
      ["Antennas", "Frequency-tuned, user-swappable"],
    ],
    source: SOURCES.archer5,
  },
  {
    sku: "ARCHER-8",
    name: "Archer 8″",
    family: "airframe",
    role: "Mid range",
    summary: "Mid-range hybrid that balances range and payload.",
    specs: [["Range, speed, weight, flight time", NP]],
    source: SOURCES.site,
  },
  {
    sku: "ARCHER-10",
    name: "Archer 10″",
    family: "airframe",
    role: "Long range",
    summary: "Longest range and heaviest payloads in the line.",
    specs: [["Range, speed, weight, flight time", NP]],
    source: SOURCES.site,
  },
  ...["5", "8", "10"].map((size) => ({
    sku: `ARCHER-${size}-S`,
    name: `Archer ${size}″ Strike`,
    family: "airframe",
    role: "Strike variant",
    summary: "Listed by Neros. Tracked here as a sealed inventory SKU only.",
    specs: [],
    restricted: true,
    source: SOURCES.site,
  })),
  {
    sku: "ARCHER-AI",
    name: "Archer AI",
    family: "autonomy",
    role: "Autonomy software",
    summary: "Neros lists GPS-denied position hold and terminal guidance. Only position hold is modelled here; terminal guidance stays out under ADR-0016.",
    specs: [["GPS-denied position hold", "Listed"], ["Licence model", NP]],
    source: SOURCES.site,
  },
  {
    sku: "CROSSBOW",
    name: "Crossbow",
    family: "ground_control",
    role: "Ground control station",
    summary: "Ground control for the Archer line. Block 2 fits on a plate carrier and is over 50% smaller in total system size.",
    specs: [
      ["Radio range", "25+ km, proprietary dual-band, wide-band frequency hopping"],
      ["Carry", "Fits on a standard plate carrier (Block 2)"],
    ],
    source: SOURCES.site,
  },
  {
    sku: "FLATBOW",
    name: "Flatbow",
    family: "ground_control",
    role: "Soldier-borne GCS",
    summary: "Rugged soldier-borne ground control from the Block 2 launch.",
    specs: [
      ["Field pack", "Carries up to three FPV drones"],
      ["Pilot standoff", "Up to 150 m with the displaced antenna"],
    ],
    source: SOURCES.block2,
  },
  {
    sku: "PG-5",
    name: "Prop guards (5″)",
    family: "peripheral",
    role: "Indoor flight",
    summary: "Optional guards for the Archer 5″.",
    specs: [],
    source: SOURCES.archer5,
  },
  {
    sku: "SENS-THERMAL",
    name: "Thermal front sensor",
    family: "peripheral",
    role: "Swappable sensor",
    summary: "Swaps in minutes for night missions (Block 2).",
    specs: [["Thermal camera", "640 × 480, 78° FOV (Archer 5″)"]],
    source: SOURCES.archer5,
  },
  {
    sku: "SENS-ILLUM",
    name: "EO/IR illuminator",
    family: "peripheral",
    role: "Swappable sensor",
    summary: "Day and night illumination.",
    specs: [["Output", "1,000 lm, 1,000 mW/sr (Archer 5″)"]],
    source: SOURCES.archer5,
  },
  {
    sku: "ANT-TAC",
    name: "Tactical C2 antenna set",
    family: "peripheral",
    role: "Frequency-tuned, user-swappable",
    summary: "Swapped by the operator for the band in use.",
    specs: [],
    source: SOURCES.archer5,
  },
  {
    sku: "LEGS-5",
    name: "Landing legs",
    family: "peripheral",
    role: "Integrated mounts",
    summary: "Fits the integrated landing-leg mounts.",
    specs: [],
    source: SOURCES.archer5,
  },
  // MISSION Success training. Durations and seat caps are as published.
  { sku: "TRN-ADO", name: "New Equipment Training / Attack Drone Operator (AD-O)", family: "training", role: "Operator", summary: "No prior FPV experience needed.", specs: [["Length", "5 days, about 40 contact hours"], ["Class size", "Up to 10"]], source: SOURCES.training },
  { sku: "TRN-ADI", name: "Train-the-Trainer / Attack Drone Instructor (AD-I)", family: "training", role: "Instructor", summary: "Certifies AD-O graduates to teach and sustain the programme.", specs: [["Length", "5 days, about 40 contact hours"], ["Class size", "Up to 10"], ["Prerequisite", "AD-O graduate, O-6 memo"]], source: SOURCES.training },
  { sku: "TRN-CQB", name: "Assault Support / Urban / CQB", family: "training", role: "Advanced", summary: "Urban and close-quarters support, day and night.", specs: [["Length", "10 days, about 80 contact hours"], ["Prerequisite", "AD-O graduate"]], source: SOURCES.training },
  { sku: "TRN-LR", name: "Long-Range course", family: "training", role: "Advanced", summary: "RF and endurance planning, repeater and fibre operations, degraded comms.", specs: [["Length", "10 days, about 80 contact hours"], ["Prerequisite", "AD-O graduate, O-6 memo"]], source: SOURCES.training },
];

export const FAMILIES = [
  ["airframe", "Airframes"],
  ["autonomy", "Autonomy"],
  ["ground_control", "Ground control"],
  ["peripheral", "Peripherals"],
  ["training", "Training"],
];

// ---- Suppliers, parts and BOMs (SIM) ---------------------------------------
// Supplier names are placeholders on purpose; no real vendor is implied.
export const SUPPLIERS = [
  { id: "SUP-FR", name: "Supplier F (frames, arms)", commodity: "Mechanical", country: "US", ndaa: "Attested", on_time: 0.96, ppm: 420 },
  { id: "SUP-PW", name: "Supplier P (ESCs, power)", commodity: "Electrical", country: "US", ndaa: "Attested", on_time: 0.88, ppm: 2900 },
  { id: "SUP-MT", name: "Supplier M (motors)", commodity: "Electro-mechanical", country: "US", ndaa: "Attested", on_time: 0.93, ppm: 610 },
  { id: "SUP-FC", name: "Supplier C (flight controllers)", commodity: "Electrical", country: "US", ndaa: "Attested", on_time: 0.81, ppm: 350 },
  { id: "SUP-RF", name: "Supplier R (radios, antennas)", commodity: "RF", country: "US", ndaa: "Attested", on_time: 0.9, ppm: 500 },
  { id: "SUP-OP", name: "Supplier O (cameras, sensors)", commodity: "Optics", country: "US", ndaa: "Attestation due", on_time: 0.85, ppm: 780 },
  { id: "SUP-BT", name: "Supplier B (battery packs)", commodity: "Energy", country: "US", ndaa: "Attested", on_time: 0.92, ppm: 300 },
];

// `swap`: Neros says Block 2 arms, motors and props are swappable by the user,
// and sensors swap in minutes. Those parts are stocked at units as well.
// `dg`: shipped as dangerous goods (lithium batteries, UN3480).
export const PARTS = [
  { pn: "FRM-5", name: "Frame, 5″", supplier: "SUP-FR", usd: 38, lead_days: 21, part: "frame" },
  { pn: "FRM-8", name: "Frame, 8″", supplier: "SUP-FR", usd: 52, lead_days: 21, part: "frame" },
  { pn: "FRM-10", name: "Frame, 10″", supplier: "SUP-FR", usd: 64, lead_days: 28, part: "frame" },
  { pn: "ARM-5", name: "Arm, 5″", supplier: "SUP-FR", usd: 6, lead_days: 14, part: "arm", swap: true },
  { pn: "ARM-8", name: "Arm, 8″", supplier: "SUP-FR", usd: 8, lead_days: 14, part: "arm", swap: true },
  { pn: "ARM-10", name: "Arm, 10″", supplier: "SUP-FR", usd: 10, lead_days: 14, part: "arm", swap: true },
  { pn: "ESC-4IN1", name: "ESC, 4-in-1", supplier: "SUP-PW", usd: 74, lead_days: 35, part: "esc" },
  { pn: "MOT-S", name: "Motor, small", supplier: "SUP-MT", usd: 19, lead_days: 28, part: "motor", swap: true },
  { pn: "MOT-L", name: "Motor, large", supplier: "SUP-MT", usd: 31, lead_days: 35, part: "motor", swap: true },
  { pn: "FC-1", name: "Flight controller", supplier: "SUP-FC", usd: 96, lead_days: 42, part: "flight controller" },
  { pn: "RAD-C2", name: "Control radio, dual band", supplier: "SUP-RF", usd: 140, lead_days: 42, part: "radio" },
  { pn: "VTX-1", name: "Video transmitter", supplier: "SUP-RF", usd: 58, lead_days: 28, part: "vtx" },
  { pn: "ANT-SET", name: "Antenna set", supplier: "SUP-RF", usd: 22, lead_days: 14, part: "antenna", swap: true },
  { pn: "CAM-FPV", name: "FPV camera", supplier: "SUP-OP", usd: 44, lead_days: 21, part: "camera", swap: true },
  { pn: "PROP-5", name: "Propeller, 5″", supplier: "SUP-FR", usd: 1, lead_days: 7, part: "prop", swap: true },
  { pn: "PROP-8", name: "Propeller, 8″", supplier: "SUP-FR", usd: 2, lead_days: 7, part: "prop", swap: true },
  { pn: "PROP-10", name: "Propeller, 10″", supplier: "SUP-FR", usd: 3, lead_days: 7, part: "prop", swap: true },
  { pn: "BAT-S", name: "Battery pack, small", supplier: "SUP-BT", usd: 45, lead_days: 21, part: "battery", swap: true, dg: true },
  { pn: "BAT-L", name: "Battery pack, large", supplier: "SUP-BT", usd: 95, lead_days: 28, part: "battery", swap: true, dg: true },
];

const partOf = (pn) => PARTS.find((p) => p.pn === pn);

export const BOMS = {
  "ARCHER-5": [["FRM-5", 1], ["ARM-5", 4], ["ESC-4IN1", 1], ["MOT-S", 4], ["FC-1", 1], ["RAD-C2", 1], ["VTX-1", 1], ["ANT-SET", 1], ["CAM-FPV", 1], ["PROP-5", 4], ["BAT-S", 1]],
  "ARCHER-8": [["FRM-8", 1], ["ARM-8", 4], ["ESC-4IN1", 1], ["MOT-L", 4], ["FC-1", 1], ["RAD-C2", 1], ["VTX-1", 1], ["ANT-SET", 1], ["CAM-FPV", 1], ["PROP-8", 4], ["BAT-L", 1]],
  "ARCHER-10": [["FRM-10", 1], ["ARM-10", 4], ["ESC-4IN1", 1], ["MOT-L", 4], ["FC-1", 1], ["RAD-C2", 1], ["VTX-1", 1], ["ANT-SET", 1], ["CAM-FPV", 1], ["PROP-10", 4], ["BAT-L", 1]],
};

/** BOM rows with part detail and rolled-up cost. Restricted SKUs have none, by design. */
export function bom(sku) {
  const rows = (BOMS[sku] ?? []).map(([pn, qty]) => ({ ...partOf(pn), qty, ext_usd: partOf(pn).usd * qty }));
  return { sku, rows, usd: rows.reduce((s, r) => s + r.ext_usd, 0) };
}

// Units and what they fly (SIM). Unit names match the Attrition simulation.
export const UNITS = [
  { unit: "Alpha", sku: "ARCHER-5", site: "Forward" },
  { unit: "Bravo", sku: "ARCHER-5", site: "Forward" },
  { unit: "Charlie", sku: "ARCHER-8", site: "Forward" },
  { unit: "Delta", sku: "ARCHER-10", site: "Forward" },
];

// The named demo tails, by model. NX-01..03 fly the long survey legs.
export function skuForTail(tail) {
  const n = Number(String(tail).replace(/\D/g, ""));
  if (String(tail).startsWith("SX-")) return "ARCHER-8";
  if (n >= 1 && n <= 3) return "ARCHER-10";
  if (n >= 4 && n <= 7) return "ARCHER-8";
  return "ARCHER-5";
}

export function nameOf(sku) {
  return CATALOG.find((c) => c.sku === sku)?.name ?? sku;
}

// Lots (SIM). The lot ids match the factory birth records in ledger.mjs, so a
// lot can be traced to the tails built from it, and ESC-2611 is the lot the
// Attrition autopsy flags.
const LOTS = [
  { lot: "FR-2604", pn: "FRM-8", received: "2026-09-14", qty: 400, on_hand: 120 },
  { lot: "FR-2607", pn: "FRM-10", received: "2026-09-28", qty: 300, on_hand: 41 },
  { lot: "FR-2609", pn: "FRM-5", received: "2026-10-02", qty: 600, on_hand: 210 },
  { lot: "AR-2610", pn: "ARM-5", received: "2026-10-05", qty: 4000, on_hand: 1480 },
  { lot: "AR-2611", pn: "ARM-8", received: "2026-10-06", qty: 1600, on_hand: 520 },
  { lot: "AR-2612", pn: "ARM-10", received: "2026-10-06", qty: 1200, on_hand: 260 },
  { lot: "ESC-2598", pn: "ESC-4IN1", received: "2026-09-02", qty: 500, on_hand: 0 },
  { lot: "ESC-2603", pn: "ESC-4IN1", received: "2026-09-21", qty: 500, on_hand: 40 },
  { lot: "ESC-2611", pn: "ESC-4IN1", received: "2026-10-09", qty: 500, on_hand: 204 },
  { lot: "MT-1180", pn: "MOT-L", received: "2026-09-10", qty: 2400, on_hand: 620 },
  { lot: "MT-1192", pn: "MOT-L", received: "2026-10-01", qty: 2400, on_hand: 1150 },
  { lot: "MT-1201", pn: "MOT-S", received: "2026-10-03", qty: 4000, on_hand: 1300 },
  { lot: "FC-0331", pn: "FC-1", received: "2026-09-08", qty: 400, on_hand: 0 },
  { lot: "FC-0334", pn: "FC-1", received: "2026-10-11", qty: 400, on_hand: 60 },
  { lot: "RF-0712", pn: "RAD-C2", received: "2026-10-04", qty: 800, on_hand: 340 },
  { lot: "VT-0440", pn: "VTX-1", received: "2026-10-04", qty: 800, on_hand: 410 },
  { lot: "AN-0901", pn: "ANT-SET", received: "2026-10-07", qty: 1000, on_hand: 620 },
  { lot: "CM-0318", pn: "CAM-FPV", received: "2026-10-08", qty: 800, on_hand: 300 },
  { lot: "PR-5-44", pn: "PROP-5", received: "2026-10-12", qty: 8000, on_hand: 3900 },
  { lot: "PR-8-21", pn: "PROP-8", received: "2026-10-12", qty: 4000, on_hand: 1600 },
  { lot: "PR-10-17", pn: "PROP-10", received: "2026-10-12", qty: 3000, on_hand: 900 },
  { lot: "BT-S-0920", pn: "BAT-S", received: "2026-10-15", qty: 1200, on_hand: 520 },
  { lot: "BT-L-0920", pn: "BAT-L", received: "2026-10-15", qty: 1200, on_hand: 610 },
];

// Reorder points and open purchase orders at the factory (SIM).
const REORDER = { "FRM-5": 120, "FRM-8": 80, "FRM-10": 60, "ESC-4IN1": 250, "MOT-S": 600, "MOT-L": 800, "FC-1": 150, "RAD-C2": 150, "VTX-1": 150, "CAM-FPV": 150, "BAT-S": 300, "BAT-L": 300 };
const OPEN_PO = [
  { po: "PO-41207", pn: "FC-1", qty: 400, due: "2026-11-21", supplier: "SUP-FC", late_days: 9 },
  { po: "PO-41219", pn: "ESC-4IN1", qty: 500, due: "2026-11-14", supplier: "SUP-PW", late_days: 0 },
  { pn: "FRM-10", po: "PO-41230", qty: 300, due: "2026-11-25", supplier: "SUP-FR", late_days: 0 },
];

// Finished goods at the factory, ready to kit (SIM). Strike SKUs are counted, sealed, never kitted here.
const FINISHED = { "ARCHER-5": 14, "ARCHER-8": 22, "ARCHER-10": 9, "ARCHER-5-S": 40, "ARCHER-8-S": 25, "ARCHER-10-S": 12, CROSSBOW: 18, FLATBOW: 6 };

// Unit-level stock of airframes and field spares (SIM).
const UNIT_STOCK = {
  Alpha: { airframes: 10, "PROP-5": 120, "ARM-5": 24, "MOT-S": 16, "BAT-S": 40, "ANT-SET": 6, gcs: 4, operators: 14, instructors: 0 },
  Bravo: { airframes: 25, "PROP-5": 200, "ARM-5": 40, "MOT-S": 24, "BAT-S": 60, "ANT-SET": 10, gcs: 5, operators: 11, instructors: 1 },
  Charlie: { airframes: 18, "PROP-8": 90, "ARM-8": 12, "MOT-L": 12, "BAT-L": 30, "ANT-SET": 6, gcs: 4, operators: 9, instructors: 1 },
  Delta: { airframes: 24, "PROP-10": 80, "ARM-10": 16, "MOT-L": 16, "BAT-L": 34, "ANT-SET": 8, gcs: 4, operators: 12, instructors: 2 },
};

// Field spares a unit keeps per airframe on hand (SIM policy), used to suggest the spares pack.
const SPARES_PER_AIRFRAME = { prop: 8, arm: 2, motor: 1, battery: 3 };

/**
 * The supply-chain state for one demo session.
 * @param {{ births: Array<{ serial: string, tail_number: string, parts: {part: string, lot: string}[], verdict: {status: string} }> }} opts
 */
export function createSupply({ births = [] } = {}) {
  const lots = LOTS.map((l) => ({ ...l }));
  const finished = { ...FINISHED };
  const unitStock = Object.fromEntries(Object.entries(UNIT_STOCK).map(([k, v]) => [k, { ...v }]));
  const shipments = [
    { id: "SHP-1031", unit: "Bravo", sku: "ARCHER-5", qty: 10, spares: [], status: "delivered", dg: true, created: "2026-10-27", by: "Logistics (SIM)" },
    { id: "SHP-1038", unit: "Delta", sku: "ARCHER-10", qty: 6, spares: [], status: "in transit", dg: true, created: "2026-11-01", by: "Logistics (SIM)" },
  ];
  const workOrders = [
    { id: "WO-5101", tail: "NX-08", kind: "unscheduled", summary: "Prop strike on recovery: replace props and one arm, hover check", parts: [["PROP-5", 4], ["ARM-5", 1]], status: "open", returns_to_service: true },
    { id: "WO-5102", tail: "NX-12", kind: "rework", summary: "EOL hover test failed, IMU cal out of range: replace flight controller, rerun the bench", parts: [["FC-1", 1]], status: "open", returns_to_service: false },
    { id: "WO-5094", tail: "NX-03", kind: "scheduled", summary: "Motor and arm inspection after 50 sorties (SIM policy)", parts: [], status: "closed", closed_by: "Demo Maintainer" },
  ];
  let seq = 1040;

  const heldLots = (holds) => new Set((holds ?? []).map((h) => h.value));

  function lotRows(holds) {
    const held = heldLots(holds);
    return lots.map((l) => {
      const part = partOf(l.pn);
      const tails = births.filter((b) => b.parts.some((p) => p.lot === l.lot)).map((b) => ({ tail: b.tail_number, serial: b.serial }));
      return { ...l, name: part.name, supplier: part.supplier, status: held.has(l.lot) ? "quarantined" : "released", where_used: tails };
    });
  }

  /** Usable (released) stock per part number at the factory. */
  function usable(holds) {
    const out = {};
    for (const l of lotRows(holds)) if (l.status === "released") out[l.pn] = (out[l.pn] ?? 0) + l.on_hand;
    return out;
  }

  /** How many of a SKU the factory can build from released stock, and the part that limits it. */
  function buildable(sku, stock) {
    const rows = BOMS[sku];
    if (!rows) return null;
    let n = Infinity;
    let limit = "";
    for (const [pn, qty] of rows) {
      const can = Math.floor((stock[pn] ?? 0) / qty);
      if (can < n) {
        n = can;
        limit = pn;
      }
    }
    return { sku, qty: n, limit };
  }

  /** Material requirements for building `qty` of `sku`, against released stock. */
  function requirements(sku, qty, stock) {
    return (BOMS[sku] ?? []).map(([pn, per]) => {
      const need = per * qty;
      const have = stock[pn] ?? 0;
      return { pn, name: partOf(pn).name, need, have, short: Math.max(0, need - have) };
    });
  }

  function spareParts(sku, airframes) {
    return (BOMS[sku] ?? [])
      .map(([pn]) => partOf(pn))
      .filter((p) => SPARES_PER_AIRFRAME[p.part])
      .map((p) => ({ pn: p.pn, name: p.name, qty: SPARES_PER_AIRFRAME[p.part] * airframes, dg: Boolean(p.dg) }));
  }

  /**
   * Turn the Attrition demand signal into kit plans: for each unit short of
   * airframes, ship from finished goods first, then build the rest, and say
   * which parts stop the build. Rows with no shortfall drop out.
   */
  function replenishment(demand, holds, reserved = {}, stockLeft = null) {
    const stock = stockLeft ?? usable(holds);
    // Finished goods already promised to open orders are not available to kit.
    const fg = Object.fromEntries(Object.entries(finished).map(([k, v]) => [k, Math.max(0, v - (reserved[k] ?? 0))]));
    const out = [];
    const byUnit = {};
    for (const row of demand?.rows ?? []) {
      if (!row.short) continue;
      byUnit[row.unit] = (byUnit[row.unit] ?? 0) + row.short;
    }
    for (const [unit, short] of Object.entries(byUnit)) {
      const u = UNITS.find((x) => x.unit === unit);
      if (!u) continue;
      const fromStock = Math.min(fg[u.sku] ?? 0, short);
      fg[u.sku] = (fg[u.sku] ?? 0) - fromStock;
      const toBuild = short - fromStock;
      const req = requirements(u.sku, toBuild, stock);
      const blocking = req.filter((r) => r.short > 0);
      const po = blocking.map((b) => OPEN_PO.find((p) => p.pn === b.pn)).filter(Boolean);
      out.push({
        id: `KIT-${unit}`,
        unit,
        sku: u.sku,
        name: nameOf(u.sku),
        short,
        from_stock: fromStock,
        to_build: toBuild,
        blocking,
        open_po: po,
        spares: spareParts(u.sku, short),
        shipped: shipments.some((s) => s.unit === unit && s.plan === `KIT-${unit}`),
      });
    }
    return out;
  }

  function exceptions(holds) {
    const stock = usable(holds);
    const held = lotRows(holds).filter((l) => l.status === "quarantined");
    const out = [];
    for (const [pn, rop] of Object.entries(REORDER)) {
      const have = stock[pn] ?? 0;
      if (have < rop) {
        const po = OPEN_PO.find((p) => p.pn === pn);
        out.push({
          kind: "below reorder point",
          pn,
          name: partOf(pn).name,
          detail: `${have} released against a reorder point of ${rop}${po ? `; ${po.po} for ${po.qty} due ${po.due}${po.late_days ? `, ${po.late_days} days late` : ""}` : "; no open PO"}`,
          severity: po?.late_days || !po ? "high" : "medium",
        });
      }
    }
    for (const l of held) {
      out.push({ kind: "lot quarantined", pn: l.pn, name: l.name, detail: `${l.lot}: ${l.on_hand} on the shelf held by the Attrition hold; ${l.where_used.length} named tails built from it`, severity: "high" });
    }
    for (const p of OPEN_PO.filter((x) => x.late_days > 0)) {
      out.push({ kind: "late purchase order", pn: p.pn, name: partOf(p.pn).name, detail: `${p.po} is ${p.late_days} days past the promised date`, severity: "medium" });
    }
    return out;
  }

  function supplierRows(holds) {
    const rows = lotRows(holds);
    return SUPPLIERS.map((s) => {
      const mine = rows.filter((l) => l.supplier === s.id);
      const quarantined = mine.filter((l) => l.status === "quarantined");
      return {
        ...s,
        lots: mine.length,
        quarantined: quarantined.map((l) => l.lot),
        // A held lot opens a supplier corrective action request.
        scar: quarantined.length > 0 ? `SCAR open for ${quarantined.map((l) => l.lot).join(", ")}` : null,
      };
    });
  }

  function openWorkOrders(holds) {
    const extra = [];
    for (const lot of heldLots(holds)) {
      const tails = births.filter((b) => b.parts.some((p) => p.lot === lot));
      for (const b of tails) {
        extra.push({ id: `WO-H-${b.tail_number}`, tail: b.tail_number, kind: "quality hold", summary: `Inspect and replace the ${lot} part (lot on hold from Attrition)`, parts: [["ESC-4IN1", 1]], status: "open", returns_to_service: false, lot });
      }
    }
    const closed = new Set(workOrders.filter((w) => w.status === "closed").map((w) => w.id));
    return [...workOrders.filter((w) => !w.id.startsWith("WO-H-")), ...extra.filter((w) => !closed.has(w.id))].map((w) => ({
      ...w,
      parts: w.parts.map(([pn, qty]) => ({ pn, name: partOf(pn).name, qty })),
    }));
  }

  /** End-of-line first-pass yield over the named birth records. */
  function eolYield() {
    const passed = births.filter((b) => b.verdict?.status === "airworthy").length;
    return { passed, total: births.length };
  }

  function snapshot({ holds = [], demand = null, reserved = {} } = {}) {
    const stock = usable(holds);
    const build = ["ARCHER-5", "ARCHER-8", "ARCHER-10"].map((sku) => ({ ...buildable(sku, stock), name: nameOf(sku), bom_usd: bom(sku).usd }));
    return {
      source: "Catalogue: as published by Neros (links on each item). Stock, lots, suppliers, costs, units and work orders: simulated demo data.",
      catalog: CATALOG.map((c) => ({ ...c, bom: c.restricted ? null : BOMS[c.sku] ? bom(c.sku) : null, on_hand: finished[c.sku] ?? null })),
      families: FAMILIES,
      parts: PARTS.map((p) => ({ ...p, on_hand: stock[p.pn] ?? 0, reorder_point: REORDER[p.pn] ?? null })),
      lots: lotRows(holds),
      suppliers: supplierRows(holds),
      open_po: OPEN_PO,
      build,
      eol: eolYield(),
      exceptions: exceptions(holds),
      units: UNITS.map((u) => ({ ...u, name: nameOf(u.sku), ...unitStock[u.unit], demand: (demand?.rows ?? []).filter((r) => r.unit === u.unit) })),
      replenishment: demand ? replenishment(demand, holds, reserved) : [],
      shipments: shipments.slice().reverse(),
      work_orders: openWorkOrders(holds),
      finished,
    };
  }

  /** Ship a kit plan: finished goods go now, the rest is released to the factory as a build order. */
  function ship(planId, demand, holds, by, reserved = {}, stockLeft = null) {
    const plan = replenishment(demand, holds, reserved, stockLeft).find((p) => p.id === planId);
    if (!plan) return { error: "no such plan", status: 404 };
    if (plan.shipped) return { error: "already shipped", status: 409 };
    finished[plan.sku] -= plan.from_stock;
    const s = { id: `SHP-${(seq += 1)}`, plan: plan.id, unit: plan.unit, sku: plan.sku, qty: plan.from_stock, build_order: plan.to_build, spares: plan.spares, status: "packed", dg: plan.spares.some((x) => x.dg), created: new Date().toISOString().slice(0, 10), by };
    shipments.push(s);
    return { shipment: s };
  }

  /** Close a work order: issue its parts from the factory's released lots, oldest first. */
  function closeWorkOrder(id, holds, by) {
    const wo = openWorkOrders(holds).find((w) => w.id === id);
    if (!wo) return { error: "no such work order", status: 404 };
    if (wo.status !== "open") return { error: `work order is ${wo.status}`, status: 409 };
    const held = heldLots(holds);
    const stock = usable(holds);
    const missing = wo.parts.filter((p) => (stock[p.pn] ?? 0) < p.qty);
    if (missing.length) return { error: `Not enough released stock: ${missing.map((m) => m.name).join(", ")}`, status: 409 };
    const issued = [];
    for (const p of wo.parts) {
      let left = p.qty;
      for (const l of lots.filter((x) => x.pn === p.pn && !held.has(x.lot) && x.on_hand > 0).sort((a, b) => a.received.localeCompare(b.received))) {
        const take = Math.min(left, l.on_hand);
        l.on_hand -= take;
        left -= take;
        issued.push({ pn: p.pn, lot: l.lot, qty: take });
        if (!left) break;
      }
    }
    const existing = workOrders.find((w) => w.id === id);
    if (existing) Object.assign(existing, { status: "closed", closed_by: by, issued });
    else workOrders.push({ ...wo, parts: wo.parts.map((p) => [p.pn, p.qty]), status: "closed", closed_by: by, issued });
    return { work_order: { ...wo, status: "closed", closed_by: by, issued } };
  }

  return { snapshot, replenishment, ship, closeWorkOrder, openWorkOrders, usable };
}
