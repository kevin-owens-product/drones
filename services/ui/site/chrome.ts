import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./site.css";

/** Shared header, footer and scroll reveal for the public pages. */
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5cc8ff"/><stop offset="1" stop-color="#8be0c4"/></linearGradient></defs><circle cx="7" cy="7" r="3.2" fill="none" stroke="url(#lg)" stroke-width="2"/><circle cx="25" cy="7" r="3.2" fill="none" stroke="url(#lg)" stroke-width="2"/><circle cx="7" cy="25" r="3.2" fill="none" stroke="url(#lg)" stroke-width="2"/><circle cx="25" cy="25" r="3.2" fill="none" stroke="url(#lg)" stroke-width="2"/><path d="M9.5 9.5l13 13M22.5 9.5l-13 13" stroke="url(#lg)" stroke-width="2" stroke-linecap="round"/><rect x="13" y="13" width="6" height="6" rx="1.5" fill="#5cc8ff"/></svg>`;

const LINKS: Array<[string, string]> = [
  ["/product/#platform", "Platform"],
  ["/product/#evidence", "Evidence"],
  ["/product/#pricing", "Pricing"],
  ["/help/", "Help"],
  ["/developers/", "Developers"],
];

export function mountChrome(current: "product" | "help" | "developers"): void {
  const nav = document.querySelector<HTMLElement>("[data-site-nav]");
  if (nav) {
    nav.className = "nav";
    nav.innerHTML = `
      <div class="marking">UNCLASSIFIED // DEMO DATA</div>
      <div class="wrap nav-in">
        <a class="logo" href="/product/">${LOGO}<span>A2E <small>Mission Cloud</small></span></a>
        <nav class="nav-links" aria-label="Site">
          ${LINKS.map(([href, label]) => `<a href="${href}"${href.startsWith(`/${current}/`) && href.endsWith("/") ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
        </nav>
        <div class="nav-cta">
          <a class="btn btn-sm" href="/help/#accounts">Get demo access</a>
          <a class="btn btn-sm btn-primary" href="/#operate">Open the console →</a>
        </div>
        <button class="nav-toggle" aria-expanded="false" aria-label="Menu">Menu</button>
      </div>`;
    const toggle = nav.querySelector<HTMLButtonElement>(".nav-toggle");
    toggle?.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  const foot = document.querySelector<HTMLElement>("[data-site-foot]");
  if (foot) {
    foot.className = "foot";
    foot.innerHTML = `
      <div class="wrap">
        <div class="foot-grid">
          <div>
            <a class="logo" href="/product/">${LOGO}<span>A2E <small>Mission Cloud</small></span></a>
            <p style="margin-top:14px;max-width:340px">The operating record and the sale around every drone: built at the factory, flown by the unit, improved from the field.</p>
          </div>
          <div><h4>Product</h4><ul>
            <li><a href="/product/#platform">Platform</a></li>
            <li><a href="/product/#loop">Factory to field</a></li>
            <li><a href="/product/#evidence">Evidence</a></li>
            <li><a href="/product/#pricing">Pricing</a></li>
            <li><a href="/#operate">Live console</a></li>
          </ul></div>
          <div><h4>Help</h4><ul>
            <li><a href="/help/#start">Getting started</a></li>
            <li><a href="/help/#accounts">Demo accounts</a></li>
            <li><a href="/help/#operate">The Operate screen</a></li>
            <li><a href="/help/#shortcuts">Keyboard shortcuts</a></li>
            <li><a href="/help/#simulated">What is simulated</a></li>
          </ul></div>
          <div><h4>Developers</h4><ul>
            <li><a href="/developers/#quickstart">Quickstart</a></li>
            <li><a href="/developers/#explorer">API explorer</a></li>
            <li><a href="/developers/#ingest">Telemetry ingest</a></li>
            <li><a href="/developers/#feeds">TAK and entity feeds</a></li>
            <li><a href="https://github.com/kevin-owens-product/drones">Source on GitHub</a></li>
          </ul></div>
        </div>
        <p class="disclaimer">A2E Mission Cloud is an independent concept product built by Kevin Owens. It is not affiliated with, endorsed by or a product of Neros Technologies or any vendor named in the demo. Manufacturer catalogue items appear as published; every fleet, order, price, customer and flight on this site is simulated demo data, and every metric says where it was measured. The domain has no weapon, payload-release or fire-control type (ADR 0016).</p>
      </div>`;
  }

  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io?.unobserve(e.target);
          }
        }
      }, { rootMargin: "0px 0px -8% 0px" })
    : null;
  document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
}

export function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Small JSON highlighter for the developer pages. */
export function highlight(json: string): string {
  return esc(json).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g, (m, str: string | undefined, colon: string | undefined, kw: string | undefined, num: string | undefined) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (kw) return `<span class="n">${kw}</span>`;
    if (num) return `<span class="n">${num}</span>`;
    return m;
  });
}
