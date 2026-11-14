// Retake the documentation screenshots from the current build: every page in each persona's rail, plus the
// states the docs and the product site point at (a selected plan, the wind view, the camera ladder, wear).
//
//   npm run build:static && node e2e/swarm/serve.mjs 4180 &
//   SWARM_LOGINS=/path/to/demo-logins.md node e2e/docs/shots.mjs --out /path/to/folder \
//     [--site public/site-media] [--media ../../docs/media] [--only commander|site-pages|none] [--gallery respond,invoice]
//     [--base http://localhost:4180]
//
// Logins come from the same markdown table as the persona swarm, never from the repo. Pages are captured at
// 1440×900 and 2× pixels for people to read. --site also writes the product site's 1600×950 webp gallery and
// --media the README's 1600×1000 pictures; --only none skips the per-role sweep.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg("base", "http://localhost:4180");
const OUT = arg("out", "shots");
const SITE = arg("site", "");
const ONLY = arg("only", "");
const MEDIA = arg("media", "");
// --gallery respond,invoice retakes only those site pictures.
const PICK = arg("gallery", "").split(",").filter(Boolean);
mkdirSync(OUT, { recursive: true });

function logins() {
  const path = process.env.SWARM_LOGINS ?? "/mnt/project-files/console-visuals/demo-logins.md";
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\|\s*([a-z]+)\s*\|\s*([a-z0-9-]{8,})\s*\|/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const settle = (page, ms = 1200) => page.waitForLoadState("domcontentloaded").then(() => page.waitForTimeout(ms));

async function open(browser, user, pass, viewport = { width: 1440, height: 900 }, scale = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion: "reduce" });
  // A seen, closed guided walk keeps it out of the pictures.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("dmc-tour", JSON.stringify({ step: 0, open: false, seen: true }));
    } catch {
      /* no storage */
    }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?invite=${Buffer.from(`${user}:${pass}`).toString("base64url")}`);
  await page.locator("nav#sections").waitFor({ state: "attached", timeout: 20000 });
  await settle(page, 1500);
  return { ctx, page };
}

async function go(page, section, ms = 1600) {
  await page.evaluate((h) => { location.hash = h; }, section);
  await settle(page, ms);
  await page.mouse.move(0, 0);
}

/** The pages in this person's rail, in order: press each rail button and read where it went. */
async function railOf(page) {
  const out = [];
  const n = await page.locator("nav#sections .side-groups .side-item").count();
  for (let i = 0; i < n; i++) {
    // The rail can be folded away on Operate, so press it from the page rather than with the pointer.
    const h = await page.evaluate((k) => {
      document.querySelectorAll("nav#sections .side-groups .side-item")[k]?.click();
      return new Promise((r) => setTimeout(() => r(location.hash.replace(/^#/, "")), 200));
    }, i);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** Select a row (a tail or a plan) by its visible text. */
async function pick(page, re, ms = 1200) {
  const el = page.locator(".workspace").getByText(re).first();
  if (await el.count()) {
    await el.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(ms);
  }
}

/** Scroll the panel holding this text to the top of the view. */
async function reveal(page, re) {
  const el = page.locator(".workspace").getByText(re).first();
  if (await el.count()) await el.evaluate((e) => (e.closest(".panel, section, article") ?? e).scrollIntoView({ block: "start" })).catch(() => {});
  await page.waitForTimeout(700);
}

const shot = (page, name, opts = {}) => page.screenshot({ path: join(OUT, `${name}.png`), ...opts }).then(() => console.error(`  ${name}`));

/** Press the first visible control whose text matches, if there is one. */
async function press(page, re, ms = 900) {
  const el = page.locator(".workspace").getByRole("button", { name: re }).first();
  if (await el.count()) {
    // Bring the panel that holds the control to the top of the view, so the picture shows what it changed.
    await el.evaluate((e) => (e.closest(".panel, section") ?? e).scrollIntoView({ block: "start" })).catch(() => {});
    await el.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(ms);
    return true;
  }
  return false;
}

async function physicsStates(page, prefix) {
  // Missions: pick the energy no-go plan and show its checks, then the wind and video-link views of its map.
  await go(page, "missions");
  const row = page.locator(".workspace").getByText(/M-1034/).first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(1200); }
  await shot(page, `${prefix}-missions-plan`);
  await shot(page, `${prefix}-missions-plan-full`, { fullPage: true });
  if (await press(page, /^wind$/i, 1600)) await shot(page, `${prefix}-missions-wind`);
  if (await press(page, /video link/i, 1600)) await shot(page, `${prefix}-missions-video-link`);
  // Brief: the camera height ladder on a drafted plan.
  await go(page, "brief");
  await shot(page, `${prefix}-brief`, { fullPage: true });
  // Operate: the radio shadow layer on the live map.
  await go(page, "operate", 2500);
  await pick(page, /NX-06/);
  if (await press(page, /radio shadow/i, 1800)) await shot(page, `${prefix}-operate-radio-shadow`);
  // Airframes: wear by flight load for a selected tail.
  await go(page, "fleet");
  await pick(page, /^NX-10$/);
  await shot(page, `${prefix}-airframes-wear`, { fullPage: true });
}

const PERSONAS = [
  { user: "ops", prefix: "ops" },
  { user: "commander", prefix: "commander", physics: true },
  { user: "operator", prefix: "operator" },
  { user: "maintainer", prefix: "maintainer" },
  { user: "allied", prefix: "allied" },
  { user: "supervisor", prefix: "supervisor" },
  { user: "pilot", prefix: "pilot" },
  { user: "contractor", prefix: "contractor" },
  { user: "admin", prefix: "admin", admin: true },
];

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const L = logins();
for (const p of PERSONAS) {
  if ((ONLY && p.user !== ONLY) || ONLY === "none") continue;
  console.error(p.user);
  const { ctx, page } = await open(browser, p.user, L[p.user]);
  const rail = await railOf(page);
  for (const s of rail) {
    await go(page, s, s === "operate" ? 3000 : 1600);
    if (s === "operate") await pick(page, /NX-06/);
    await shot(page, `${p.prefix}-${s}`);
  }
  if (p.admin) for (const s of ["access", "audit", "integrations"]) { await go(page, s); await shot(page, `${p.prefix}-${s}`); }
  if (p.physics) await physicsStates(page, p.prefix);
  // A phone: the role's home.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await phone.addInitScript(() => { try { localStorage.setItem("dmc-tour", JSON.stringify({ step: 0, open: false, seen: true })); } catch { /* none */ } });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/?invite=${Buffer.from(`${p.user}:${L[p.user]}`).toString("base64url")}`);
  await pp.locator("nav#sections").waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
  await settle(pp, 2500);
  await shot(pp, `${p.prefix}-phone-home`);
  await phone.close();
  await ctx.close();
}

// The public pages, as a visitor sees them.
if (!ONLY || ONLY === "site-pages") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  for (const path of ["product", "why", "help", "developers"]) {
    await page.goto(`${BASE}/${path}/`);
    await settle(page, 2500);
    await shot(page, `site-${path}`);
  }
  await ctx.close();
}

// The README's pictures in docs/media: 1600×1000 png.
if (MEDIA) {
  mkdirSync(MEDIA, { recursive: true });
  const selectPlan = async (page) => pick(page, /M-1034/);
  const README = [
    ["commander", "operate", "operate", (page) => pick(page, /NX-06/)],
    ["commander", "operate", "operating-picture", async (page) => { await pick(page, /NX-04/); }],
    ["commander", "operate", "launch", async (page) => { await page.keyboard.press("l"); await page.waitForTimeout(1200); await pick(page, /NX-12/); }],
    ["commander", "missions", "missions-wind", async (page) => { await selectPlan(page); await press(page, /^wind$/i, 1800); }],
    ["commander", "fleet", "airframes-wear", async (page) => {
      await pick(page, /^NX-10$/);
      const wear = page.locator(".workspace").getByText(/wear by flight load/i).first();
      if (await wear.count()) await wear.evaluate((e) => (e.closest(".panel, section") ?? e).scrollIntoView({ block: "start" })).catch(() => {});
      await page.waitForTimeout(600);
    }],
    ["ops", "ops", "work-queue"],
  ];
  const sessions = {};
  for (const [user, section, name, before] of README) {
    sessions[user] ??= await open(browser, user, L[user], { width: 1600, height: 1000 }, 1);
    const { page } = sessions[user];
    await go(page, section, section === "operate" ? 3500 : 1800);
    if (before) await before(page);
    await page.screenshot({ path: join(MEDIA, `${name}.png`) });
    console.error(`  media ${name}`);
  }
  for (const s of Object.values(sessions)) await s.ctx.close();
}

// The product site's gallery: 1600×950 webp, one per figure, named as the site expects.
if (SITE) {
  mkdirSync(SITE, { recursive: true });
  const GALLERY = [
    ["commander", "operate", "operate", (page) => pick(page, /NX-06/)],
    ["commander", "brief", "brief"],
    ["ops", "attrition", "attrition"],
    ["ops", "cases", "fix-loop"],
    ["commander", "readiness", "readiness"],
    ["ops", "quote", "quote"],
    ["ops", "bid", "bid-desk"],
    ["commander", "mixed", "mixed-fleet"],
    ["allied", "updates", "allied"],
    ["commander", "supply", "supply"],
    ["commander", "denial", "denial", (page) => press(page, /^control link$/i, 1800)],
    ["ops", "ops", "work-queue"],
    ["commander", "missions", "missions-wind", async (page) => {
      const row = page.locator(".workspace").getByText(/M-1034/).first();
      if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(1200); }
      await press(page, /^wind$/i, 1800);
    }],
    ["commander", "missions", "launch-checks", async (page) => {
      const row = page.locator(".workspace").getByText(/M-1034/).first();
      if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(1200); }
      await reveal(page, /^conditions at launch$/i);
    }],
    ["commander", "configure", "loadout"],
    ["maintainer", "fleet", "wear", async (page) => {
      await pick(page, /^NX-10$/);
      await reveal(page, /^next sortie/i);
    }],
    // The public safety program, one picture per seat.
    // The supervisor approves the water rescue so the map shows a call, a route and the docks' reach.
    ["supervisor", "respond", "respond", async (page) => {
      await page.locator(".workspace").getByRole("button", { name: "Approve launch" }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.evaluate(() => document.getElementById("rs-queue")?.closest("section")?.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(700);
    }],
    ["pilot", "records", "flight-records"],
    ["supervisor", "crew", "roster"],
    ["contractor", "contract", "invoice"],
  ];
  const sessions = {};
  for (const [user, section, name, before] of GALLERY.filter(([, , n]) => !PICK.length || PICK.includes(n))) {
    sessions[user] ??= await open(browser, user, L[user], { width: 1600, height: 950 }, 1);
    const { page } = sessions[user];
    await go(page, section, section === "operate" ? 3500 : 1800);
    if (before) await before(page);
    const png = join(SITE, `${name}.png`);
    await page.screenshot({ path: png });
    execFileSync("python3", ["-c", "import sys;from PIL import Image;Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2],'WEBP',quality=82,method=6)", png, png.replace(/\.png$/, ".webp")]);
    console.error(`  site ${name}`);
  }
  for (const s of Object.values(sessions)) await s.ctx.close();
}
await browser.close();
