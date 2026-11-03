// Field reports: an operator flags a problem in one tap, the console pins the
// last 30 seconds of that vehicle's telemetry and its build to the note, and
// the product view groups notes by theme and shows when a theme sits on one
// firmware build. Pure JavaScript, no Node imports, so it runs in the browser
// for the hosted demo. Themes come from keyword rules, not a model: they are
// easy to read and to argue with, and they miss what they were not told about.

/** Theme id, label, and the words that put a note in it. */
export const THEMES = [
  { id: "video", label: "Video feed", words: ["video", "feed", "camera", "picture", "frozen", "freeze", "image", "fpv"] },
  { id: "link", label: "Link and radio", words: ["link", "signal", "radio", "range", "telemetry dropped", "lost contact", "jam", "rssi"] },
  { id: "nav", label: "Navigation and GNSS", words: ["gps", "gnss", "drift", "position", "spoof", "wander", "vio", "heading"] },
  { id: "power", label: "Battery and power", words: ["battery", "voltage", "sag", "power", "esc", "brownout", "pack"] },
  { id: "airframe", label: "Airframe and props", words: ["prop", "motor", "arm", "frame", "vibration", "crack", "landing gear"] },
  { id: "console", label: "Console and workflow", words: ["console", "screen", "button", "map", "alert", "slow", "confusing", "ui"] },
];

/** Themes a note belongs to, in THEMES order; "other" when nothing matches. */
export function classify(text) {
  const t = ` ${String(text).toLowerCase()} `;
  const hits = THEMES.filter((th) => th.words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t))).map((th) => th.id);
  return hits.length ? hits : ["other"];
}

/**
 * Group reports by theme. A theme is "concentrated" when it has at least
 * `minReports` reports, at least `minOnBuild` of them on one build, and that
 * build's share of them is at least `minLift` times its share of the fleet: a
 * pointer to look at that build, not proof it is at fault.
 */
export function triage(reports, fleetShare, { minReports = 4, minOnBuild = 3, minLift = 1.5 } = {}) {
  const groups = new Map();
  for (const r of reports) {
    for (const theme of r.themes) {
      if (!groups.has(theme)) groups.set(theme, []);
      groups.get(theme).push(r);
    }
  }
  const out = [];
  for (const [theme, list] of groups) {
    const builds = new Map();
    for (const r of list) builds.set(r.firmware, (builds.get(r.firmware) ?? 0) + 1);
    const [topBuild, topCount] = [...builds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const share = topCount / list.length;
    const fleet = fleetShare[topBuild] ?? 0;
    const lift = fleet > 0 ? share / fleet : Infinity;
    const def = THEMES.find((t) => t.id === theme);
    out.push({
      theme,
      label: def ? def.label : "Other",
      count: list.length,
      units: [...new Set(list.map((r) => r.unit))].sort(),
      top_build: topBuild,
      top_build_count: topCount,
      top_build_fleet_share: fleet,
      concentrated: list.length >= minReports && topCount >= minOnBuild && lift >= minLift,
      latest: list.reduce((m, r) => (r.at > m ? r.at : m), ""),
      ids: list.sort((a, b) => b.at.localeCompare(a.at)).map((r) => r.id),
    });
  }
  return out.sort((a, b) => Number(b.concentrated) - Number(a.concentrated) || b.count - a.count || a.theme.localeCompare(b.theme));
}

/** Firmware build per demo tail, and the fleet share of each build. */
export const TAIL_BUILD = { "NX-01": "4.5.2", "NX-02": "4.6.0", "NX-03": "4.5.2", "NX-04": "4.6.0", "NX-05": "4.5.2", "NX-06": "4.5.1", "NX-07": "4.6.0", "NX-08": "4.5.2", "NX-09": "4.5.1", "NX-10": "4.5.2", "NX-11": "4.5.1", "NX-12": "4.5.2" };
/** The unit each named tail flies with, matching what each unit flies (UNITS in supply.mjs). */
export const TAIL_UNIT = { "NX-01": "Delta", "NX-02": "Delta", "NX-03": "Delta", "NX-04": "Charlie", "NX-05": "Charlie", "NX-06": "Charlie", "NX-07": "Charlie", "NX-08": "Alpha", "NX-09": "Alpha", "NX-10": "Alpha", "NX-11": "Bravo", "NX-12": "Bravo" };
export const FLEET_SHARE = { "4.5.1": 0.3, "4.5.2": 0.45, "4.6.0": 0.25 };

const SEED = [
  // days ago, hours, tail, unit, text
  [6, 9, "NX-02", "Alpha", "Video froze for about two seconds at the tree line, came back on its own."],
  [6, 14, "NX-05", "Bravo", "Battery warning came early, pack showed 30% then dropped to 18% quickly."],
  [5, 10, "NX-07", "Charlie", "Lost video feed when it banked hard, telemetry was fine."],
  [5, 16, "NX-01", "Alpha", "Map took a long time to show the new task area."],
  [4, 8, "NX-04", "Alpha", "Position drifted about 20 m in the jammed area before VIO took over."],
  [4, 11, "NX-02", "Alpha", "Camera image tore and froze on the return leg."],
  [4, 15, "NX-09", "Delta", "Link dropped twice behind the ridge, came back after 5 s."],
  [3, 9, "NX-07", "Charlie", "Video freeze again during the orbit, maybe heat?"],
  [3, 13, "NX-03", "Bravo", "Prop chipped on landing in tall grass."],
  [2, 10, "NX-04", "Alpha", "Picture froze for a second when switching to the relay."],
  [2, 12, "NX-06", "Delta", "Signal weak past 3 km, range lower than the card says."],
  [2, 17, "NX-10", "Bravo", "Alert sound for low battery is easy to miss on the console."],
  [1, 9, "NX-11", "Charlie", "ESC got hot after two back-to-back sorties, voltage sag on climb."],
  [1, 14, "NX-02", "Alpha", "Video feed stuttered whenever the radio link was weak."],
  [0, 8, "NX-08", "Delta", "Heading jumped 15 degrees on takeoff, settled after a minute."],
];

/** Seeded reports, timed relative to `now`, labelled simulated. */
export function seedReports(now = Date.now()) {
  return SEED.map(([days, hours, tail, , text], i) => {
    const unit = TAIL_UNIT[tail] ?? "Alpha";
    const at = new Date(now - days * 86_400_000);
    at.setUTCHours(hours, (i * 7) % 60, 0, 0);
    return { id: `FR-${String(i + 1).padStart(3, "0")}`, at: at.toISOString(), tail, unit, firmware: TAIL_BUILD[tail] ?? "unknown", by: "seeded", text, themes: classify(text), samples: [], seeded: true };
  });
}

/** A new report from the console. Keeps at most the last 30 s of samples it was given. */
export function fileReport(store, msg, now = Date.now()) {
  const text = String(msg.text ?? "").trim();
  const tail = String(msg.tail ?? "").trim();
  if (!text || text.length > 1000) return { error: "text must be 1 to 1000 characters" };
  if (!tail) return { error: "tail is required" };
  const samples = Array.isArray(msg.samples) ? msg.samples.filter((s) => s && typeof s.t === "number" && s.t >= now - 30_000).slice(-120) : [];
  const report = {
    id: `FR-${String(store.length + 1).padStart(3, "0")}`,
    at: new Date(now).toISOString(),
    tail,
    unit: TAIL_UNIT[tail] ?? String(msg.unit ?? "Alpha"),
    firmware: TAIL_BUILD[tail] ?? "unknown",
    by: String(msg.by ?? "operator"),
    text,
    themes: classify(text),
    samples,
    seeded: false,
  };
  store.push(report);
  return report;
}
