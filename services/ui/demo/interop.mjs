// Interop: the customer's own fleet, out to the systems units already run.
//
// Why: C2 and situational awareness belong to TAK and Lattice, and the vehicle
// dialect is MAVLink (MAVLink-M is coming). A fleet platform that wants a place
// in a unit plugs into them instead of competing with them. This module renders
// the customer's own drones as Cursor-on-Target events for a TAK Server and as
// Lattice-style entities, and documents which MAVLink messages each console
// field is read from.
//
// Outbound only, own fleet only. Nothing here describes anything other than the
// customer's own drones, and the console accepts no command from an external
// system (ADR-0016). The Lattice shape follows Anduril's public Entities API
// documentation and has not been tested against a Lattice instance. The TAK
// destination, rates and delivery counts are simulated (SIM). Pure JavaScript.

import { TODAY } from "./company.mjs";

const iso = (ms) => new Date(ms).toISOString();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Console field -> MAVLink source. Read-only: the console sends no MAVLink commands. */
export const MAVLINK_MAP = [
  { field: "lat, lon", message: "GLOBAL_POSITION_INT", source: "lat, lon (degE7)" },
  { field: "alt_m", message: "GLOBAL_POSITION_INT", source: "alt (mm, MSL)" },
  { field: "heading_deg", message: "GLOBAL_POSITION_INT", source: "hdg (cdeg)" },
  { field: "ground_mps, climb_mps", message: "VFR_HUD", source: "groundspeed, climb" },
  { field: "battery_pct", message: "SYS_STATUS", source: "battery_remaining" },
  { field: "mode", message: "HEARTBEAT", source: "custom_mode (PX4 main and sub mode)" },
  { field: "armed", message: "HEARTBEAT", source: "base_mode & MAV_MODE_FLAG_SAFETY_ARMED" },
  { field: "nav_source, gnss_trusted", message: "ESTIMATOR_STATUS", source: "flags (GNSS fused or rejected)" },
  { field: "pos_sigma_m", message: "ESTIMATOR_STATUS", source: "pos_horiz_accuracy" },
  { field: "last_link_dbm", message: "RADIO_STATUS", source: "rssi" },
  { field: "firmware", message: "AUTOPILOT_VERSION", source: "flight_sw_version, flight_custom_version" },
  { field: "serial", message: "AUTOPILOT_VERSION", source: "uid2 (read at the end-of-line bench)" },
  { field: "fault_codes", message: "EVENT / STATUSTEXT", source: "PX4 events, severity error and above" },
];

export const NEVER_SENT = ["COMMAND_LONG", "COMMAND_INT", "SET_MODE", "MISSION_ITEM_INT", "SET_POSITION_TARGET_GLOBAL_INT", "PARAM_SET"];

/**
 * @param {{ live: () => object[], platforms: { tail_number: string, owner: string | null, sku?: string, designation?: string }[] }} deps
 */
export function createInterop({ live, platforms }) {
  const feeds = {};
  const feedsFor = (org) =>
    (feeds[org] ??= [
      { id: "tak", name: "TAK Server", format: "Cursor-on-Target 2.0 XML over TLS (port 8089)", destination: `tak.${org.toLowerCase()}.example (SIM)`, direction: "out", on: org === "CUS-A", rate_s: 2, sent: org === "CUS-A" ? 18_342 : 0, changed_by: null },
      { id: "lattice", name: "Lattice", format: "Entity JSON (PublishEntity), Lattice-style", destination: "Not configured: needs the unit's Lattice environment and token", direction: "out", on: false, rate_s: 1, sent: 0, changed_by: null },
      { id: "mavlink", name: "MAVLink telemetry", format: "MAVLink 2 common.xml, read-only (MAVLink-M when its dialect is published)", destination: "Ground stations, in", direction: "in", on: true, rate_s: 1, sent: null, changed_by: null },
    ]);

  const ownTails = (org) => new Set(platforms.filter((p) => p.owner === org).map((p) => p.tail_number));
  const ownLive = (org) => {
    const own = ownTails(org);
    return live().filter((v) => own.has(v.tail_number));
  };

  function cotEvent(v, now) {
    const how = v.nav_source === "gnss" ? "m-g" : "m-f";
    const ce = v.pos_sigma_m == null ? 9999999 : Number(v.pos_sigma_m.toFixed(1));
    const remarks = `SIM. ${v.mode}${v.armed ? ", motors armed" : ""}. Nav ${v.nav_source}${v.nav_source === "vio" ? " (GNSS rejected)" : ""}. Battery ${Math.round(v.battery_pct)}%.`;
    return [
      `<event version="2.0" uid="DMC-${esc(v.tail_number)}" type="a-f-A-M-H-Q" how="${how}" time="${iso(now)}" start="${iso(now)}" stale="${iso(now + 30_000)}">`,
      `  <point lat="${v.lat.toFixed(6)}" lon="${v.lon.toFixed(6)}" hae="${(v.alt_m ?? 0).toFixed(1)}" ce="${ce}" le="9999999"/>`,
      "  <detail>",
      `    <contact callsign="${esc(v.tail_number)}"/>`,
      `    <__group name="Cyan" role="Team Member"/>`,
      v.heading_deg == null ? "" : `    <track course="${v.heading_deg.toFixed(1)}" speed="${(v.ground_mps ?? 0).toFixed(1)}"/>`,
      `    <status battery="${Math.round(v.battery_pct)}"/>`,
      `    <remarks>${esc(remarks)}</remarks>`,
      "  </detail>",
      "</event>",
    ].filter(Boolean).join("\n");
  }

  function cot(org) {
    const now = Date.now();
    const vs = ownLive(org);
    return { format: "application/cot+xml", count: vs.length, xml: vs.map((v) => cotEvent(v, now)).join("\n") };
  }

  function entity(v, now) {
    const p = platforms.find((x) => x.tail_number === v.tail_number);
    return {
      entityId: `a2e-${v.tail_number}`,
      description: `${p?.designation ?? "Small UAS"} (SIM)`,
      isLive: true,
      createdTime: iso(now),
      expiryTime: iso(now + 30_000),
      aliases: { name: v.tail_number },
      location: { position: { latitudeDegrees: Number(v.lat.toFixed(6)), longitudeDegrees: Number(v.lon.toFixed(6)), altitudeHaeMeters: Number((v.alt_m ?? 0).toFixed(1)) } },
      locationUncertainty: v.pos_sigma_m == null ? undefined : { positionErrorEllipse: { probability: 0.39, semiMajorAxisM: Number(v.pos_sigma_m.toFixed(1)), semiMinorAxisM: Number(v.pos_sigma_m.toFixed(1)) } },
      milView: { disposition: "DISPOSITION_FRIENDLY", environment: "ENVIRONMENT_AIR" },
      ontology: { template: "TEMPLATE_ASSET", platformType: "Small UAS" },
      health: { healthStatus: v.battery_pct < 25 || v.mode === "HOLD" ? "HEALTH_STATUS_WARN" : "HEALTH_STATUS_HEALTHY" },
      provenance: { integrationName: "a2e-mission-cloud", dataType: "a2e-telemetry", sourceUpdateTime: v.time },
    };
  }

  function entities(org) {
    const now = Date.now();
    return { format: "application/json", note: "Lattice-style: follows the public Entities API shape; not tested against a Lattice instance.", entities: ownLive(org).map((v) => entity(v, now)) };
  }

  function view(org) {
    const vs = ownLive(org);
    return {
      source: "Simulated: destinations, rates and delivery counts are demo data. The CoT and entity shapes follow the published formats.",
      today: TODAY,
      org,
      vehicles: vs.length,
      feeds: feedsFor(org),
      rules: [
        "Outbound only: the customer's own drones, as friendly air assets. Nothing about anything else.",
        "The console accepts no command from TAK, Lattice or any other system, and sends no MAVLink command to a vehicle (ADR-0016).",
        "Each feed is the customer's to turn on or off; every change is in the audit log.",
      ],
      mavlink: MAVLINK_MAP,
      never_sent: NEVER_SENT,
      sample: { cot: vs[0] ? cotEvent(vs[0], Date.now()) : null, entity: vs[0] ? entity(vs[0], Date.now()) : null },
    };
  }

  function setFeed(org, a, actor) {
    const f = feedsFor(org).find((x) => x.id === a.id);
    if (!f) return { error: "no such feed", status: 404 };
    if (f.id === "lattice" && a.on) return { error: "Lattice needs the unit's environment URL and token first. Ask your Lattice administrator; this demo has none.", status: 409 };
    const on = Boolean(a.on);
    if (f.on === on) return { error: `${f.name} is already ${on ? "on" : "off"}`, status: 409 };
    f.on = on;
    f.changed_by = `${actor}, ${TODAY}`;
    return { ok: true, message: `${f.name} feed ${on ? "on" : "off"}` };
  }

  return { view, cot, entities, setFeed };
}
