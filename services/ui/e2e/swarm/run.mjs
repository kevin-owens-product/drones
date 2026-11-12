// Persona journey swarm: one browser bot per persona, all running at once, each walking that persona's
// journey from the public site through sign-in, every page in their rail and every button on each page.
// It records what a person would trip over: page errors, console errors, broken links and images, dead
// buttons, actions the UI offers but the role is refused, pages with nothing to act on, raw error text,
// sideways scroll, and data from another tenant.
//
//   npm run build:static && node e2e/swarm/serve.mjs 4180 &
//   SWARM_LOGINS=/path/to/demo-logins.md node e2e/swarm/run.mjs [--base http://localhost:4180] [--only commander]
//
// Logins are read from a markdown table (| user | password | ...), never from the repo. Output: one JSON line
// per finding on stdout and a summary on stderr; --out writes both to a folder.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg("base", process.env.SWARM_BASE ?? "http://localhost:4180");
const ONLY = arg("only", "");
const OUT = arg("out", "");
const CLICKS = Number(arg("clicks", 40));
const READONLY = process.argv.includes("--read-only"); // live site: look, never press
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

function logins() {
  const path = process.env.SWARM_LOGINS ?? "/mnt/project-files/console-visuals/demo-logins.md";
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\|\s*([a-z]+)\s*\|\s*([a-z0-9-]{8,})\s*\|/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// What each persona is, where they should land and what they must never see.
const PERSONAS = [
  { user: "admin", via: "invite", home: "ops", workspace: "neros", switches: true },
  { user: "ops", via: "form", home: "ops", workspace: "neros" },
  { user: "commander", via: "form", home: "operate", workspace: "customer", foreign: ["CUS-C", "Customer C"] },
  { user: "operator", via: "form", home: "operate", workspace: "customer", foreign: ["CUS-C", "Customer C"] },
  { user: "maintainer", via: "form", home: "fleet", workspace: "customer", foreign: ["CUS-C", "Customer C"] },
  { user: "allied", via: "invite", home: "operate", workspace: "customer", foreign: ["CUS-A", "Customer A", "firmware_sha256"] },
];
const NEROS_ONLY = ["ops", "company", "program", "quality", "compliance", "surge", "bid", "plans", "release", "cases", "eval"];
const CUSTOMER_ONLY = ["operate", "brief", "missions", "debrief", "denial", "fleet", "mixed", "stockpile", "readiness", "receiving", "accountability", "supply"];
// Buttons the sweep never presses: they end the session, wipe the story, or only move focus around the shell.
const SKIP = /log ?out|reset the demo|sign out|^menu$|close the guided walk|open command palette/i;
const RAW_ERROR = /\b(undefined|NaN|\[object Object\]|TypeError|ReferenceError|Unexpected token|failed to fetch|Internal Server Error|not_found|unauthenticated)\b/;

const findings = [];
const found = (who, page, kind, detail, extra = {}) => {
  const f = { who, page, kind, detail, ...extra };
  if (findings.some((x) => x.who === who && x.page === page && x.kind === kind && x.detail === detail)) return;
  findings.push(f);
  if (!OUT) process.stdout.write(`${JSON.stringify(f)}\n`);
};

// Record every /v1 call the console makes. The static demo swaps window.fetch at start-up, so wrap whatever is set.
const RECORDER = () => {
  window.__calls = [];
  const native = window.fetch.bind(window);
  let inner = native;
  let replaced = false;
  const wrapped = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await inner(input, init);
    try {
      const u = new URL(href, location.origin);
      if (u.pathname.startsWith("/v1/")) {
        const body = await res.clone().text();
        window.__calls.push({ m: init?.method ?? "GET", p: u.pathname + u.search, s: res.status, b: body.slice(0, 4000), t: Date.now() });
      }
    } catch {
      /* not ours */
    }
    return res;
  };
  Object.defineProperty(window, "fetch", { configurable: true, get: () => (replaced ? wrapped : native), set: (f) => { inner = f; replaced = true; } });
};

async function settle(page, ms = 700) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(ms);
}

function watch(page, who, where) {
  page.on("pageerror", (e) => found(who, where(), "page-error", String(e.message).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|ResizeObserver loop|WebGL|GPU stall|Cesium.*ion|third-party cookie/i.test(t)) return;
    found(who, where(), "console-error", t.slice(0, 300));
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && r.status() >= 400) found(who, where(), "http-error", `${r.status()} ${u.pathname}`);
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && !/net::ERR_ABORTED/.test(r.failure()?.errorText ?? "")) found(who, where(), "request-failed", `${u.pathname} ${r.failure()?.errorText}`);
  });
}

async function pageChecks(page, who, here) {
  const info = await page.evaluate((rawSrc) => {
    const raw = new RegExp(rawSrc);
    const ws = document.querySelector(".workspace") ?? document.body;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const actions = [...ws.querySelectorAll("button, a[href], input, select, textarea, [role=button]")].filter(visible);
    const enabled = actions.filter((a) => !a.disabled);
    const text = ws.innerText ?? "";
    const rawHits = text.split("\n").filter((l) => raw.test(l)).slice(0, 3);
    const heading = (ws.querySelector("h1, h2")?.textContent ?? "").trim();
    const broken = [...ws.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src"));
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const emptyPanels = [...ws.querySelectorAll(".panel, section")].filter((p) => visible(p) && (p.innerText ?? "").trim().length === 0).length;
    const nobodies = [...ws.querySelectorAll("table")].filter((t) => visible(t) && t.querySelectorAll("tbody tr").length === 0 && !/no |nothing|none/i.test(t.innerText)).length;
    const disabledNoReason = actions.filter((a) => a.disabled && a.tagName === "BUTTON" && !a.title && !a.getAttribute("aria-describedby") && !a.closest("[title]")).map((a) => (a.innerText || a.getAttribute("aria-label") || "").trim()).filter(Boolean).slice(0, 6);
    return { heading, textLen: text.trim().length, actions: enabled.length, rawHits, broken, overflow, emptyPanels, nobodies, disabledNoReason };
  }, RAW_ERROR.source);
  if (!info.heading) found(who, here, "no-heading", "the page has no h1/h2, so a visitor cannot tell where they are");
  if (info.textLen < 80) found(who, here, "blank-page", `only ${info.textLen} characters of content`);
  if (info.actions === 0) found(who, here, "not-actionable", "no enabled button, link or field on the page");
  for (const l of info.rawHits) found(who, here, "raw-error-text", l.slice(0, 200));
  for (const s of info.broken) found(who, here, "broken-image", String(s));
  if (info.overflow > 4) found(who, here, "sideways-scroll", `${info.overflow}px wider than the window at ${page.viewportSize()?.width}px`);
  if (info.nobodies) found(who, here, "empty-table", `${info.nobodies} table(s) with no rows and no empty-state text`);
  if (info.disabledNoReason.length) found(who, here, "disabled-without-reason", info.disabledNoReason.join(" | "));
  return info;
}

/** Press every enabled button on the page once and see whether anything happened. */
async function sweep(page, who, here, foreign) {
  const pressed = new Set();
  for (let i = 0; i < CLICKS; i++) {
    if ((await page.evaluate(() => location.hash.replace(/^#/, ""))) !== here) {
      await page.evaluate((h) => { location.hash = h; }, here);
      await settle(page, 600);
    }
    const buttons = page.locator(".workspace button:visible:enabled");
    const n = await buttons.count();
    let target = null;
    let label = "";
    for (let k = 0; k < n; k++) {
      const b = buttons.nth(k);
      const l = ((await b.getAttribute("aria-label").catch(() => null)) || (await b.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const key = `${l}#${k}`;
      const on = await b.evaluate((el) => el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "page" || el.classList.contains("is-active") || el.classList.contains("is-on") || el.classList.contains("is-selected")).catch(() => false);
      if (on) continue;
      if (!l || SKIP.test(l) || pressed.has(l) || pressed.has(key)) continue;
      target = b;
      label = l;
      pressed.add(l);
      break;
    }
    if (!target) break;
    const before = await page.evaluate(() => {
      window.__mut = 0;
      window.__mo?.disconnect();
      window.__mo = new MutationObserver((m) => { window.__mut += m.length; });
      window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      const vals = [...document.querySelectorAll("input, textarea, select")].map((e) => (e.type === "checkbox" || e.type === "radio" ? String(e.checked) : e.value)).join("\u0001");
      return { calls: window.__calls.length, hash: location.hash, vals, downloads: window.__downloads ?? 0 };
    });
    const ok = await target.click({ timeout: 2500 }).then(() => true).catch((e) => String(e.message).split("\n")[0]);
    if (ok !== true) {
      if (!/not stable|detached/.test(ok)) {
        const blocker = await target.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top && !el.contains(top) ? `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}` : `at ${Math.round(r.x)},${Math.round(r.y)}`;
        }).catch(() => "");
        // A live list re-rendering under the pointer is not a person's problem; something sitting on the button is.
        if (blocker.startsWith("at ")) continue;
        found(who, here, "unclickable", `"${label}" could not be pressed (covered by ${blocker})`);
        if (OUT) await page.screenshot({ path: `${OUT}/unclickable-${who}-${here}-${pressed.size}.png` }).catch(() => {});
      }
      continue;
    }
    await page.waitForTimeout(450);
    const after = await page.evaluate(() => ({ calls: window.__calls.slice(), mut: window.__mut, hash: location.hash, vals: [...document.querySelectorAll("input, textarea, select")].map((e) => (e.type === "checkbox" || e.type === "radio" ? String(e.checked) : e.value)).join("\u0001") }));
    const mine = after.calls.slice(before.calls);
    for (const c of mine) {
      if (c.m !== "GET" && (c.s === 403 || c.s === 401)) found(who, here, "offered-but-refused", `"${label}" is enabled but ${c.m} ${c.p} answered ${c.s}: ${c.b.slice(0, 140)}`);
      else if (c.s >= 500 || c.s === 404) found(who, here, "action-failed", `"${label}" → ${c.m} ${c.p} answered ${c.s}: ${c.b.slice(0, 140)}`);
      else if (c.s === 400 || c.s === 409 || c.s === 422) found(who, here, "action-rejected", `"${label}" → ${c.m} ${c.p} answered ${c.s}: ${c.b.slice(0, 160)}`);
      for (const f of foreign ?? []) if (c.b.includes(f)) found(who, here, "tenant-leak", `"${label}" → ${c.p} returned "${f}"`);
    }
    if (!mine.length && after.mut === 0 && after.hash === before.hash && after.vals === before.vals) found(who, here, "dead-button", `"${label}" did nothing visible`);
    // Close anything modal the press opened so the next press reaches the page.
    await page.keyboard.press("Escape").catch(() => {});
  }
}


/** Open the rail if it is folded away (a drawer on a phone and beside the full-screen map). */
async function openRail(page) {
  const shown = await page.evaluate(() => {
    const n = document.querySelector("nav#sections");
    if (!n) return false;
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 40 && r.left >= -1 && r.right <= window.innerWidth + 1 && s.visibility !== "hidden" && s.display !== "none";
  });
  if (!shown) {
    await page.locator(".side-toggle").click();
    await page.waitForTimeout(350);
  }
}

async function signIn(page, who, pass, via) {
  if (via === "invite") {
    const token = Buffer.from(`${who}:${pass}`).toString("base64url");
    await page.goto(`${BASE}/?invite=${token}`);
  } else {
    // The public site's "Open the console" link.
    await page.goto(`${BASE}/#home`);
    await page.locator("#username").fill(who);
    await page.locator("#password").fill(pass);
    await page.locator("#login-form button[type=submit], #login-form button").first().click();
  }
  await page.locator("nav#sections").waitFor({ state: "attached", timeout: 20000 });
  await settle(page, 1200);
  return page.evaluate(() => location.hash.replace(/^#/, ""));
}

async function persona(browser, p, pass, mobile, where = {}) {
  const tag = mobile ? `${p.user}@390` : p.user;
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  where.page = page;
  let here = "signin";
  watch(page, tag, () => { where.at = here; return here; });
  setInterval(() => { where.at = here; }, 500).unref();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));

  // Wrong password first: a typo must say so, not hang.
  if (!mobile && p.via === "form") {
    await page.goto(`${BASE}/#operate`);
    await page.locator("#username").fill(p.user);
    await page.locator("#password").fill("not-the-password");
    await page.locator("#login-form button").first().click();
    const fault = await page.locator("#fault").innerText({ timeout: 5000 }).catch(() => "");
    if (!/wrong|incorrect|invalid/i.test(fault)) found(tag, "signin", "bad-login-feedback", `wrong password showed "${fault}"`);
  }
  const landed = await signIn(page, p.user, pass, p.via);
  const fold = page.getByRole("button", { name: "Fold the guided walk" });
  if (await fold.isVisible().catch(() => false)) await fold.click();
  if (landed !== p.home) found(tag, "signin", "wrong-home", `landed on #${landed}, expected #${p.home}`);
  if (p.via === "invite" && /invite=/.test(page.url())) found(tag, "signin", "token-in-url", "invite token still in the address bar");

  const visited = [];
  const walk = async (workspaceTag) => {
    const items = await page.locator("nav#sections .side-item").evaluateAll((els) => els.map((e) => (e.querySelector("span")?.textContent ?? "").trim()));
    for (const label of items) {
      // On a phone, and beside the full-screen map, the rail is a drawer: open it first.
      await openRail(page);
      const btn = page.locator("nav#sections .side-item", { hasText: label }).first();
      const ok = await btn.click({ timeout: 8000 }).then(() => true).catch((e) => String(e.message).split("\n").filter((l) => /intercepts|outside|not visible/.test(l)).slice(-1)[0] ?? "timeout");
      if (ok !== true) {
        found(tag, label, "rail-unclickable", `rail item "${label}" could not be pressed${mobile ? " in the phone drawer" : ""}: ${String(ok).trim().slice(0, 160)}`);
        continue;
      }
      await settle(page, 900);
      here = await page.evaluate(() => location.hash.replace(/^#/, ""));
      const t0 = Date.now();
      await page.locator(".workspace h1, .workspace h2").first().waitFor({ timeout: 8000 }).catch(() => {});
      const ms = Date.now() - t0;
      if (ms > 5000) found(tag, here, "slow-page", `${ms} ms before a heading appeared`);
      visited.push(`${workspaceTag}:${here}`);
      if (mobile) {
        const drawerOpen = await page.locator(".shell.side-drawer").count();
        if (drawerOpen) found(tag, here, "drawer-stays-open", "choosing a page left the phone menu covering it");
      }
      const info = await pageChecks(page, tag, here);
      // Foreign tenant names in what the page shows.
      const text = await page.locator(".workspace").innerText().catch(() => "");
      for (const f of p.foreign ?? []) if (text.includes(f)) found(tag, here, "tenant-leak", `page shows "${f}"`);
      if (!mobile && !READONLY) await sweep(page, tag, here, p.foreign);
      void info;
    }
  };
  await walk(p.workspace);

  if (!mobile) {
    // Routes from the other workspace typed straight into the address bar.
    const other = p.workspace === "neros" ? CUSTOMER_ONLY : NEROS_ONLY;
    for (const s of other) {
      here = `probe:${s}`;
      await page.evaluate((h) => { location.hash = h; }, s);
      await settle(page, 500);
      const now = await page.evaluate(() => location.hash.replace(/^#/, ""));
      if (now === s && !p.switches) found(tag, `#${s}`, "workspace-leak", `a ${p.workspace} login can open #${s} by typing it`);
    }
    // The API answers for things this tenant must never see.
    if (p.foreign) {
      const bodies = await page.evaluate(async () => {
        const paths = ["/v1/fleet", "/v1/vehicles", "/v1/missions", "/v1/users", "/v1/ops/queue", "/v1/supply", "/v1/attrition", "/v1/reports", "/v1/company", "/v1/quotes", "/v1/cases", "/v1/release"];
        const out = [];
        for (const p of paths) {
          const r = await fetch(p);
          out.push({ p, s: r.status, b: (await r.text()).slice(0, 20000) });
        }
        return out;
      });
      for (const b of bodies) for (const f of p.foreign) if (b.s < 300 && b.b.includes(f)) found(tag, b.p, "tenant-leak", `API ${b.p} returned "${f}" to ${p.user}`);
    }
    // Command palette: every command it offers should go somewhere.
    here = "palette";
    await page.evaluate((h) => { location.hash = h; }, p.home);
    await settle(page, 500);
    await page.getByRole("button", { name: "Open command palette" }).click();
    const cmds = await page.locator("#palette-list [role=option]").allInnerTexts().catch(() => []);
    if (!cmds.length) found(tag, "palette", "palette-empty", "⌘K opened with no commands");
    await page.keyboard.press("Escape");
    if (await page.locator(".palette").count()) found(tag, "palette", "palette-stuck", "Escape did not close ⌘K");
    if (p.switches && !READONLY) {
      // Neros staff switch to the customer view and walk that too.
      await openRail(page);
      await page.locator(".side-org-btn").click({ timeout: 15000 });
      await page.getByRole("menuitemradio", { name: /Customer A/ }).click();
      await settle(page, 900);
      if (!(await page.locator(".viewing-strip").count())) found(tag, "switch", "no-viewing-strip", "customer view has no 'Viewing Customer A' strip");
      await walk("customer");
      await page.getByRole("button", { name: "Back to Neros operations" }).click().catch(() => found(tag, "switch", "no-way-back", "no 'Back to Neros operations' button"));
    }
    // Log out lands on the sign-in page.
    here = "logout";
    await openRail(page);
    await page.locator(".side-logout").click({ timeout: 15000 });
    await settle(page, 800);
    if (!(await page.locator("#login-form").count())) found(tag, "logout", "logout-broken", "log out did not show the sign-in page");
  }
  await ctx.close();
  return { who: tag, landed, visited };
}

/** The public site: every page and every link on it, the way a first visitor arrives. */
async function publicSite(browser) {
  const tag = "visitor";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let here = "/";
  watch(page, tag, () => here);
  await page.goto(`${BASE}/`);
  await settle(page, 800);
  if (!new URL(page.url()).pathname.startsWith("/product")) found(tag, "/", "wrong-home", `bare / went to ${page.url()}`);
  const queue = ["/product/", "/help/", "/developers/", "/why/"];
  const seen = new Set();
  const links = new Map();
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    here = path;
    const res = await page.goto(`${BASE}${path}`).catch(() => null);
    if (!res || res.status() >= 400) found(tag, path, "broken-link", `status ${res?.status()}`);
    await settle(page, 900);
    const out = await page.evaluate(() => {
      const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
      const anchors = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: (a.textContent ?? "").trim().slice(0, 60) }));
      const missing = anchors.filter((a) => a.href.startsWith("#") && a.href.length > 1 && !ids.has(a.href.slice(1))).map((a) => a.href);
      const broken = [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src"));
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const empty = anchors.filter((a) => a.href === "#" || a.href === "").map((a) => a.text);
      return { anchors, missing, broken, overflow, empty, title: document.title };
    });
    if (!out.title) found(tag, path, "no-title", "page has no <title>");
    for (const m of out.missing) found(tag, path, "missing-anchor", `link ${m} points at no element`);
    for (const b of out.broken) found(tag, path, "broken-image", String(b));
    for (const e of out.empty) found(tag, path, "empty-link", `"${e}" goes nowhere`);
    if (out.overflow > 4) found(tag, path, "sideways-scroll", `${out.overflow}px`);
    for (const a of out.anchors) {
      const u = new URL(a.href, `${BASE}${path}`);
      if (u.origin !== new URL(BASE).origin) continue;
      links.set(u.pathname + u.hash, { from: path, text: a.text });
      if (["/product/", "/help/", "/developers/", "/why/"].includes(u.pathname)) queue.push(u.pathname);
    }
  }
  // Same-site links: the file exists, and a hash on a site page names an element there.
  for (const [href, { from, text }] of links) {
    const u = new URL(href, BASE);
    const r = await page.request.get(`${BASE}${u.pathname}`).catch(() => null);
    if (!r || r.status() >= 400) found(tag, from, "broken-link", `"${text}" → ${href} (${r?.status()})`);
    if (u.hash && u.pathname !== "/" && ["/product/", "/help/", "/developers/", "/why/"].includes(u.pathname) && u.pathname !== from) {
      here = from;
      await page.goto(`${BASE}${href}`);
      await settle(page, 500);
      const ok = await page.evaluate((id) => !!document.getElementById(id), u.hash.slice(1));
      if (!ok) found(tag, from, "missing-anchor", `"${text}" → ${href}: no #${u.hash.slice(1)} on that page`);
    }
  }
  // Console deep links from the site, opened signed out: they must reach sign-in, not a blank page.
  for (const [href, { from, text }] of links) {
    const u = new URL(href, BASE);
    if (u.pathname !== "/" || !u.hash) continue;
    here = `${from} → ${href}`;
    await page.goto(`${BASE}${href}`);
    await settle(page, 900);
    const gate = await page.locator("#login-form, nav#sections").count();
    if (!gate) found(tag, from, "deep-link-dead", `"${text}" → ${href} showed neither sign-in nor the console`);
  }
  // Phone width for the four site pages.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/product/", "/help/", "/developers/", "/why/"]) {
    here = `${path}@390`;
    await page.goto(`${BASE}${path}`);
    await settle(page, 600);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 4) found(tag, here, "sideways-scroll", `${o}px at 390px`);
  }
  await ctx.close();
  return { who: tag, visited: [...seen] };
}

const pass = logins();
const browser = await chromium.launch({ executablePath });
const t0 = Date.now();
const bots = [];
const PARALLEL = Number(arg("parallel", 6));
let running = 0;
const waiting = [];
const slot = async (job) => {
  while (running >= PARALLEL) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
};
if (!ONLY || ONLY === "visitor") bots.push(slot(() => publicSite(browser)));
for (const p of PERSONAS) {
  if (ONLY && ONLY !== p.user) continue;
  if (!pass[p.user]) {
    found(p.user, "signin", "no-login", "no password in the logins file");
    continue;
  }
  for (const mobile of [false, true]) {
    const where = { at: "" };
    bots.push(
      slot(() => persona(browser, p, pass[p.user], mobile, where)).catch(async (e) => {
        const who = mobile ? `${p.user}@390` : p.user;
        const top = await where.page?.evaluate(() => {
          const t = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          return t ? `${t.tagName.toLowerCase()}.${[...t.classList].join(".")} ${location.hash}` : location.hash;
        }).catch(() => "");
        if (OUT) await where.page?.screenshot({ path: `${OUT}/crash-${who}.png` }).catch(() => {});
        return { who, crash: `at ${where.at} (${top}): ${String(e.message).split("\n")[0]}` };
      }),
    );
  }
}
const runs = await Promise.all(bots);
await browser.close();
for (const r of runs) if (r.crash) found(r.who, "bot", "bot-crashed", r.crash);
const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
const summary = { base: BASE, seconds: Math.round((Date.now() - t0) / 1000), bots: runs.map((r) => ({ who: r.who, pages: r.visited?.length ?? 0, crash: r.crash })), findings: findings.length, byKind };
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/findings.jsonl`, findings.map((f) => JSON.stringify(f)).join("\n") + "\n");
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
}
process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
