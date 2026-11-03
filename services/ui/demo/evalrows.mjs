// The Eval page in the demo reads the results table that `make eval` writes
// into the README (between the eval markers), so the hosted demo shows the same
// numbers the repository reports, each with where it was measured.

/** Parse the README eval table into rows. Never throws; returns [] when the markers are missing. */
export function parseEvalTable(markdown) {
  const text = String(markdown ?? "");
  const a = text.indexOf("<!-- eval:start -->");
  const b = text.indexOf("<!-- eval:end -->");
  if (a < 0 || b < a) return [];
  const rows = [];
  for (const line of text.slice(a, b).split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4 || cells[0] === "Metric" || cells[0].startsWith("---")) continue;
    const [metric, raw, measured_in, phase] = cells;
    const m = raw.match(/^(-?[\d.]+)\s*(.*)$/);
    rows.push({ metric, value: m ? m[1] : raw, unit: m ? m[2] : "", measured_in, phase, git_sha: "README", recorded_at: "" });
  }
  return rows;
}
