import { invited, notify } from "../src/notify";
import { esc, mountChrome } from "./chrome";
import { ATTRITION, call } from "./live";
import { mountScope, type ScopeEvent } from "./scope";

mountChrome("product");
if (invited()) notify("Product page opened", "An invited visitor opened the product page.", "product-open");

// Live hero picture.
const scope = document.getElementById("scope");
const feed = document.getElementById("feed");
const set = (id: string, v: number) => {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v);
};
if (scope) {
  mountScope(
    scope,
    (s) => {
      set("s-air", s.air);
      set("s-vio", s.vio);
      set("s-att", s.attention);
      set("s-rep", s.replans);
    },
    (e: ScopeEvent) => {
      if (!feed) return;
      const div = document.createElement("div");
      div.className = `feed-item ${e.tone === "warn" ? "" : e.tone}`;
      div.innerHTML = `<b>${esc(e.tail)}</b> ${esc(e.text)}`;
      feed.prepend(div);
      while (feed.children.length > 3) feed.lastElementChild?.remove();
    },
  );
}
const clock = document.getElementById("clock");
setInterval(() => {
  if (clock) clock.textContent = `${new Date().toISOString().slice(11, 19)}Z`;
}, 1000);

// Platform tabs and screenshot galleries.
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab]"));
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const t of tabs) t.setAttribute("aria-selected", String(t === tab));
    document.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab));
  });
}
document.querySelectorAll<HTMLElement>("[data-gallery]").forEach((g) => {
  const img = g.querySelector<HTMLImageElement>("figure img");
  const cap = g.querySelector<HTMLElement>("figcaption span");
  const thumbs = Array.from(g.querySelectorAll<HTMLButtonElement>(".thumb"));
  for (const th of thumbs) {
    th.addEventListener("click", () => {
      if (img && th.dataset.src) img.src = th.dataset.src;
      if (cap && th.dataset.cap) cap.textContent = th.dataset.cap;
      for (const o of thumbs) o.setAttribute("aria-pressed", String(o === th));
    });
  }
});

// One serial, read live from the demo API.
type Birth = { serial: string; tail_number: string; sku: string; parts: Array<{ part: string; lot: string }>; calibrations: Array<{ name: string; value: number; high: number }>; firmware_sha256: string; eol: { passed: boolean; note: string }; recorded_at: string; verdict: { status: string; reason: string } };
const serialEl = document.getElementById("serial");
if (serialEl) {
  const births = (call("GET", "/v1/birth-records").body as { items: Birth[] }).items;
  const flagged = (ATTRITION.autopsy?.alerts ?? []).filter((a) => a.flagged);
  const pick = births.find((b) => b.parts.some((p) => flagged.some((f) => f.value === p.lot))) ?? births.find((b) => b.tail_number === "NX-05") ?? births[0];
  if (pick) {
    const hit = flagged.find((f) => pick.parts.some((p) => p.lot === f.value));
    const steps: Array<[string, string, string]> = [
      ["", `Born on the bench, ${pick.recorded_at.slice(0, 10)}`, `${pick.parts.map((p) => `${p.part} ${p.lot}`).join(" · ")}`],
      [pick.eol.passed ? "" : "bad", pick.eol.passed ? "End-of-line hover test passed" : "End-of-line hover test failed", `${pick.calibrations.map((c) => `${c.name} ${c.value} (≤ ${c.high})`).join(" · ")} · firmware ${pick.firmware_sha256.slice(0, 12)}…`],
      ["", "Shipped and received by Customer A", "Custody recorded at receiving, with the packet that travelled with it"],
      ["", `Flying as ${pick.tail_number}`, "Launch checks read airworthiness from this record"],
      hit
        ? ["warn", `Lot ${hit.value} flagged by the autopsy`, `Losing airframes at ${hit.ratio.toFixed(2)}× the expected rate across the fleet`]
        : ["", "No lot alerts", "The autopsy watches every lot this serial carries"],
      hit ? ["warn", "Quality hold proposed", "A hold restricts every tail carrying the lot until the fix loop measures a change"] : ["", "Verdict", pick.verdict.reason],
    ];
    serialEl.innerHTML = `
      <div class="serial-head"><b>${esc(pick.serial)}</b><span class="tag tag-sim">SIM · live API</span></div>
      <p style="color:var(--muted);margin-bottom:10px">${esc(pick.sku)} · tail ${esc(pick.tail_number)} · from <code>GET /v1/birth-records</code> and <code>GET /v1/attrition</code></p>
      <ol>${steps.map(([cls, a, b]) => `<li class="${cls}"><i></i><div>${esc(a)}<small>${esc(b)}</small></div></li>`).join("")}</ol>
      <a class="btn btn-sm" style="margin-top:14px" href="/#fleet">Open this fleet in the console →</a>`;
  }
}
