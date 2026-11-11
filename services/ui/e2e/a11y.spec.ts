import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Accessibility gate: WCAG 2.1 A/AA checks (axe-core) on the pages a first visitor opens,
// against the demo sortie (node demo/server.mjs), like operate.spec.ts. Serious and critical
// findings fail the build; the rest are reported in the test output.
test.skip(!process.env.A2E_DEMO, "needs the demo server");
// Fade-ins are off under reduced motion; axe would otherwise catch an event row mid-fade.
test.use({ reducedMotion: "reduce" });

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const PAGES = ["operate", "ops", "fleet", "missions", "brief", "debrief", "quality", "company", "reports", "configure", "physics", "program", "integrations", "access", "audit", "release"];

interface Violation { id: string; impact: string | null; nodes: { html: string }[] }
declare global {
  interface Window { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> } }
}

for (const page of PAGES) {
  test(`${page} has no serious or critical WCAG A/AA violations`, async ({ page: p }) => {
    await p.goto(`/#${page}`);
    await p.waitForTimeout(1200);
    await p.addScriptTag({ content: AXE });
    const found = await p.evaluate(async () => {
      const res = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 2).map((n) => ({ html: n.html.slice(0, 160) })) }));
    });
    const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
    const minor = found.filter((v) => !bad.includes(v));
    if (minor.length) console.log(`${page}: minor findings`, JSON.stringify(minor));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
}
