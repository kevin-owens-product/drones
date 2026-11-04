// Provenance evidence per component lot, and the packet that follows each delivery lot.
//
// Why: from Drone Dominance Phase II no covered-country content is allowed at
// any tier, from Phase III firmware may not be hosted in a covered country, and
// the FCC's exemptions for Blue List items and domestic end products expire on
// 1 Jan 2027. Compliance becomes evidence per lot, not a certificate per
// product. This module keeps that evidence by component lot, rolls it up to
// each delivery lot, and shows what is missing before the deadline.
//
// Every supplier, sub-component, origin and document here is simulated (SIM).
// Supplier names are placeholders; no real vendor is implied. Pure JavaScript.

import { TODAY } from "./company.mjs";
import { PARTS, SUPPLIERS } from "./supply.mjs";

export const FCC_EXEMPTION_ENDS = "2027-01-01";
export const RULES = [
  { id: "tier", text: "No covered-country content at any tier (Drone Dominance Phase II onward)" },
  { id: "assembly", text: "Motors, battery packs and flight controllers assembled outside covered countries" },
  { id: "firmware", text: "Firmware repositories not hosted in a covered country (Phase III)" },
  { id: "fcc", text: "FCC Covered List exemption basis on file (Blue List or domestic end product); both exemptions end 1 Jan 2027" },
];

// Sub-components traced per part, with the tier they sit at (SIM).
const TREE = {
  "ESC-4IN1": [["MOSFETs", 2], ["Gate driver", 2], ["MCU", 2]],
  "MOT-S": [["Magnets", 3], ["Windings", 2], ["Bearings", 2]],
  "MOT-L": [["Magnets", 3], ["Windings", 2], ["Bearings", 2]],
  "FC-1": [["MCU", 2], ["IMU", 2], ["Barometer", 2]],
  "RAD-C2": [["RF transceiver", 2], ["Power amplifier", 2]],
  "VTX-1": [["RF chipset", 2]],
  "CAM-FPV": [["Image sensor", 2], ["Lens", 2]],
  "BAT-S": [["Cells", 2], ["BMS board", 2]],
  "BAT-L": [["Cells", 2], ["BMS board", 2]],
  "FRM-5": [["Carbon sheet", 2]],
  "FRM-8": [["Carbon sheet", 2]],
  "FRM-10": [["Carbon sheet", 2]],
};
const ORIGIN = { MOSFETs: "US", "Gate driver": "US", MCU: "Taiwan", Magnets: "Japan", Windings: "US", Bearings: "Japan", IMU: "US", Barometer: "Germany", "RF transceiver": "US", "Power amplifier": "US", "RF chipset": "US", "Image sensor": "Japan", Lens: "US", Cells: "South Korea", "BMS board": "US", "Carbon sheet": "US" };

// Component lots the serial record uses, with the planted gaps (SIM).
const LOTS = [
  ["ESC-2598", "ESC-4IN1"], ["ESC-2603", "ESC-4IN1"], ["ESC-2611", "ESC-4IN1"],
  ["MT-1180", "MOT-L"], ["MT-1192", "MOT-L"], ["MT-1201", "MOT-S"],
  ["FC-0331", "FC-1"], ["FC-0334", "FC-1"],
  ["RF-0712", "RAD-C2"], ["VT-0440", "VTX-1"], ["CM-0302", "CAM-FPV"], ["CM-0318", "CAM-FPV"],
  ["BT-S-0920", "BAT-S"], ["BT-L-0920", "BAT-L"],
  ["FR-2604", "FRM-8"], ["FR-2607", "FRM-10"], ["FR-2609", "FRM-5"],
];
// Planted findings: what is missing or about to lapse.
const GAPS = {
  "CM-0318": { "Image sensor": { origin: null, evidence: "missing", note: "Supplier attestation for the tier-2 image sensor not received" } },
  "MT-1180": { Magnets: { origin: null, evidence: "missing", note: "Tier-3 magnet origin not traced for this older lot" } },
  "BT-S-0920": { Cells: { evidence: "expiring", expires: "2026-12-15", note: "Cell maker's origin certificate expires 15 Dec 2026" } },
};
const BLUE = { "ESC-4IN1": "BL-C-0412", "FC-1": "BL-C-0388", "RAD-C2": "BL-C-0391", "MOT-S": "BL-C-0420", "MOT-L": "BL-C-0421", "BAT-S": "BL-C-0433", "BAT-L": "BL-C-0434", "VTX-1": "BL-C-0402", "CAM-FPV": null };

export const FIRMWARE_HOSTING = { repository: "Firmware source and build pipeline", location: "US (GovCloud region)", evidence: "attested", note: "Signed builds published from a US-hosted repository (ADR-0018)" };

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** @param {{ serials: ReturnType<import("./serials.mjs").createSerials> }} deps */
export function createCompliance({ serials }) {
  const lots = LOTS.map(([lot, pn]) => {
    const part = PARTS.find((p) => p.pn === pn);
    const sup = SUPPLIERS.find((s) => s.id === part.supplier);
    const items = (TREE[pn] ?? []).map(([name, tier]) => {
      const gap = GAPS[lot]?.[name];
      return { name, tier, origin: gap && "origin" in gap ? gap.origin : ORIGIN[name], evidence: gap?.evidence ?? "attested", expires: gap?.expires ?? null, note: gap?.note ?? null };
    });
    return { lot, pn, name: part.name, supplier: sup.id, supplier_name: sup.name, assembled: "US", blue_list: BLUE[pn] ?? null, items, requests: [] };
  });
  let reqSeq = 300;

  function status(l) {
    if (l.items.some((i) => i.evidence === "missing")) return "gap";
    if (l.items.some((i) => i.evidence === "expiring" && daysBetween(TODAY, i.expires) < FCC_DAYS())) return "expiring";
    return "complete";
  }
  const FCC_DAYS = () => daysBetween(TODAY, FCC_EXEMPTION_ENDS);
  const fccBasis = (l) => (l.blue_list ? `Blue UAS Cleared List (${l.blue_list})` : "Domestic end product (over 60% US content)");

  function lotRow(l) {
    return {
      lot: l.lot, pn: l.pn, name: l.name, supplier: l.supplier, supplier_name: l.supplier_name, assembled: l.assembled,
      blue_list: l.blue_list, fcc_basis: fccBasis(l), items: l.items, status: status(l),
      open_request: l.requests.find((r) => r.status === "requested") ?? null,
      in_delivered: [...serials.serials.values()].filter((s) => Object.values(s.parts).includes(l.lot) && s.state !== "packed").length,
    };
  }

  /** The packet for one delivery lot: every component lot its serials carry. */
  function packet(deliveryId, withSuppliers = true) {
    const d = serials.deliveries.find((x) => x.id === deliveryId);
    if (!d) return null;
    const used = new Set();
    for (const id of d.serials) for (const lot of Object.values(serials.serials.get(id).parts)) used.add(lot);
    const rows = lots.filter((l) => used.has(l.lot)).map(lotRow);
    const gaps = rows.filter((r) => r.status !== "complete");
    return {
      delivery_lot: d.id,
      sku: d.sku,
      serials: d.serials.length,
      generated: TODAY,
      status: gaps.some((g) => g.status === "gap") ? "gap" : gaps.length ? "expiring" : "complete",
      gaps: gaps.length,
      rules: RULES,
      firmware: FIRMWARE_HOSTING,
      fcc_exemption_ends: FCC_EXEMPTION_ENDS,
      components: rows.map((r) => (withSuppliers ? r : { ...r, supplier: undefined, supplier_name: undefined, open_request: undefined })),
    };
  }

  function summaryFor(deliveryId) {
    const p = packet(deliveryId, false);
    return p ? { status: p.status, gaps: p.gaps } : null;
  }

  function view() {
    const rows = lots.map(lotRow);
    return {
      source: "Simulated: sub-component origins, evidence and supplier documents are demo data. The rules are as published for Drone Dominance and by the FCC.",
      today: TODAY,
      fcc_exemption_ends: FCC_EXEMPTION_ENDS,
      days_left: FCC_DAYS(),
      rules: RULES,
      firmware: FIRMWARE_HOSTING,
      lots: rows.sort((a, b) => ["gap", "expiring", "complete"].indexOf(a.status) - ["gap", "expiring", "complete"].indexOf(b.status)),
      deliveries: serials.deliveries.map((d) => ({ id: d.id, org: d.org, sku: d.sku, status: d.status, ...summaryFor(d.id) })),
      counts: { complete: rows.filter((r) => r.status === "complete").length, gap: rows.filter((r) => r.status === "gap").length, expiring: rows.filter((r) => r.status === "expiring").length },
    };
  }

  function request(a, actor) {
    const l = lots.find((x) => x.lot === a.lot);
    if (!l) return { error: "no such component lot", status: 404 };
    if (status(l) === "complete") return { error: `${l.lot} has every document on file`, status: 409 };
    if (l.requests.some((r) => r.status === "requested")) return { error: `A request to ${l.supplier_name} for ${l.lot} is already open`, status: 409 };
    const r = { id: `EVR-${(reqSeq += 1)}`, status: "requested", by: actor, at: TODAY, due: addDays(TODAY, 10), items: l.items.filter((i) => i.evidence !== "attested").map((i) => i.name) };
    l.requests.push(r);
    return { ok: true, message: `${r.id} sent to ${l.supplier_name}: evidence for ${r.items.join(", ")} on ${l.lot}, due ${r.due}` };
  }

  function record(a, actor) {
    const l = lots.find((x) => x.lot === a.lot);
    if (!l) return { error: "no such component lot", status: 404 };
    const open = l.items.filter((i) => i.evidence !== "attested");
    if (!open.length) return { error: `${l.lot} has every document on file`, status: 409 };
    const origin = String(a.origin ?? "").trim();
    if (open.some((i) => i.evidence === "missing") && !origin) return { error: "record the origin the document states", status: 400 };
    if (/^(china|prc|russia|iran|north korea|dprk)$/i.test(origin)) {
      for (const i of open) i.note = `Document states ${origin}: covered country. Quarantine the lot and replace the part.`;
      return { error: `${origin} is a covered country. The lot cannot ship in a Drone Dominance delivery; hold it from Quality.`, status: 409 };
    }
    for (const i of open) {
      if (i.evidence === "missing") i.origin = origin;
      i.evidence = "attested";
      i.expires = i.expires ? addDays(i.expires, 365) : null;
      i.note = `Document received ${TODAY}, recorded by ${actor}`;
    }
    for (const r of l.requests) if (r.status === "requested") r.status = "received";
    return { ok: true, message: `${l.lot}: evidence on file${origin ? ` (origin ${origin})` : ""}; every packet that carries it updates` };
  }

  function queueItems() {
    return lots.filter((l) => status(l) !== "complete" && !l.requests.some((r) => r.status === "requested")).map((l) => {
      const row = lotRow(l);
      return {
        id: `q-prov-${l.lot}`, area: "Compliance", severity: row.status === "gap" ? "high" : "medium",
        title: `${l.lot} (${l.name}): ${row.status === "gap" ? "provenance gap" : "evidence expiring"}, ${FCC_DAYS()} days to the FCC exemption deadline`,
        detail: `${l.items.filter((i) => i.evidence !== "attested").map((i) => i.note).join("; ")}. ${row.in_delivered} delivered serials carry it.`,
        actions: [{ label: `Request evidence from ${l.supplier_name.split(" (")[0]}`, action: "thread.compliance.request", args: { lot: l.lot }, primary: true }],
      };
    });
  }

  return { view, packet, summaryFor, request, record, queueItems };
}
