import { mountChrome } from "./chrome";

mountChrome("help");

const q = document.getElementById("q") as HTMLInputElement | null;
const articles = Array.from(document.querySelectorAll<HTMLElement>(".article"));
const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#side a"));
const empty = document.getElementById("empty");

function filter(term: string) {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const a of articles) {
    const hay = `${a.dataset.tags ?? ""} ${a.textContent ?? ""}`.toLowerCase();
    const hit = words.every((w) => hay.includes(w));
    a.hidden = !hit;
    if (hit) shown++;
    const link = links.find((l) => l.hash === `#${a.id}`);
    link?.classList.toggle("dim", !hit);
  }
  empty?.classList.toggle("on", shown === 0);
}

q?.addEventListener("input", () => filter(q.value));
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== q) {
    e.preventDefault();
    q?.focus();
  } else if (e.key === "Escape" && document.activeElement === q && q) {
    q.value = "";
    filter("");
    q.blur();
  }
});
const initial = new URLSearchParams(window.location.search).get("q");
if (q && initial) {
  q.value = initial;
  filter(initial);
}

// Scroll spy for the sidebar.
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const l of links) l.classList.toggle("active", l.hash === `#${e.target.id}`);
    }
  },
  { rootMargin: "-90px 0px -70% 0px" },
);
articles.forEach((a) => spy.observe(a));

// "Was this helpful?" stays in this browser only.
for (const a of articles) {
  const row = document.createElement("div");
  row.className = "helpful";
  row.innerHTML = `Was this helpful? <button data-v="yes">Yes</button><button data-v="no">No</button>`;
  row.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    row.textContent = b.dataset.v === "yes" ? "Thanks." : "Thanks. Tell Kevin what was missing.";
  });
  a.append(row);
}
