import { BANNER, createDemo } from "../demo/scenario.mjs";
import attrition from "../demo/assets/attrition.json";
import terrain from "../demo/assets/terrain.json";
import readme from "../../../README.md?raw";

/**
 * Hosted demo: no server, so the scripted sortie runs in the page and answers
 * the console's /v1 calls itself. Same scenario code as demo/server.mjs, same
 * DEMO DATA banner. Built only with VITE_STATIC_DEMO=1 (npm run build:static).
 * Add ?fleet=300 to the URL for the fleet-scale view.
 */
// Demo sign-in. The hosted build has no server, so this gate runs in the
// browser: it keeps casual visitors and crawlers out, it is not a security
// boundary (the bundle and demo data are still fetchable). Only salted SHA-256
// hashes of the passwords live here; the passwords are shared out of band.
// `org` picks the workspace: Neros operations, or a customer running its own fleet.
type DemoUser = { hash: string; display_name: string; roles: string[]; org: string; citizenship?: string };
const DEMO_USERS: Record<string, DemoUser> = {
  admin: { hash: "06d8638093f35fa49aba3987dd788d1a4cc1653807adabf1be186f282b5ad33a", display_name: "Demo Admin", roles: ["admin"], org: "neros" },
  ops: { hash: "738ce6d6e833efe6610154dd0b9123eae02efdcdc87ccf9252a29aebc47938d7", display_name: "Demo Ops Lead (Neros)", roles: ["ops_lead"], org: "neros" },
  commander: { hash: "18e32bb2630f85d10a6fa11de2083f90402e78f9b9dbacb4d232d0e298a48619", display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-A" },
  operator: { hash: "ffe651590c6442ba0b5752d8429128f244573922fbfc3277df6582cf0ba518b1", display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" },
  maintainer: { hash: "37f7a353b0255284ec2aab24ae00007231ced0adc76f2ee61448b867ca70c7be", display_name: "Demo Maintainer", roles: ["maintainer"], org: "CUS-A" },
  // A public safety program (demo/dfr.mjs): the supervisor approves launches, the contract pilot flies them.
  supervisor: { hash: "ba37d8e57dbd3377ebf6ef231192c4124a19f6af3be0f7df90a09bb7bf143b04", display_name: "Demo Supervisor (Harbor police)", roles: ["mission_commander"], org: "CUS-D" },
  pilot: { hash: "e13d8bb8cbcfb34ff9a278d088bc5660a75b027d169281f6fbdaa7fe24742bf0", display_name: "Demo Pilot (contract RPIC)", roles: ["operator"], org: "CUS-D" },
  // The company staffing that console: its pilots' files and its invoice, never the console or incident records.
  contractor: { hash: "8ba5169d8867c3c6796f760e4910582fd6b099616500a5d2533c93be750a8327", display_name: "Demo Contractor (pilot company)", roles: ["contractor"], org: "CUS-D" },
  // An allied tenant: every response passes through its releasability rules (demo/release.mjs).
  allied: { hash: "51c4f22372e7dd37a22b614e69f894e82062dfb17c5d77e77c3b1132f62def54", display_name: "Allied Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-C", citizenship: "Allied (SIM)" },
};
const ORG_NAMES: Record<string, string> = { neros: "Neros Technologies (operations)", "CUS-A": "Customer A: Army brigade program (SIM)", "CUS-C": "Customer C: allied partner (SIM)", "CUS-D": "Customer D: Harbor police DFR program (SIM)" };
const SESSION_KEY = "a2e-demo-session";
const SESSION_MS = 12 * 60 * 60_000;

async function digest(username: string, password: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`a2e-demo:${username}:${password}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function signedIn(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { u?: string; exp?: number };
    return s.u && s.u in DEMO_USERS && (s.exp ?? 0) > Date.now() ? s.u : null;
  } catch {
    return null;
  }
}

/** True while a hosted-demo sign-in is live. The bare root sends everyone else to the product site. */
export function hasDemoSession(): boolean {
  return signedIn() !== null;
}

function setSession(username: string | null): void {
  try {
    if (username) localStorage.setItem(SESSION_KEY, JSON.stringify({ u: username, exp: Date.now() + SESSION_MS }));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the session lasts as long as nothing else needs it */
  }
}

async function gate(method: string, url: URL, raw: string): Promise<{ status: number; body: unknown } | null> {
  const path = url.pathname;
  if (path === "/v1/session/config") return { status: 200, body: { auth_mode: "demo", dev_login: true, system_high: "UNCLASSIFIED", login_url: "" } };
  if (path === "/v1/session/logout") {
    setSession(null);
    return { status: 200, body: { ok: true } };
  }
  if (path === "/v1/session/dev-login" && method === "POST") {
    let msg: { username?: unknown; password?: unknown } = {};
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      /* falls through to the refusal */
    }
    const username = String(msg.username ?? "").trim().toLowerCase();
    const user = DEMO_USERS[username];
    if (!user || (await digest(username, String(msg.password ?? ""))) !== user.hash) {
      return { status: 403, body: { detail: "Wrong username or password." } };
    }
    setSession(username);
    return { status: 200, body: { ok: true } };
  }
  const who = signedIn();
  if (!who) return { status: 401, body: { detail: "unauthenticated" } };
  if (path === "/v1/me") {
    const user = DEMO_USERS[who] as DemoUser;
    return { status: 200, body: { id: `demo-${who}`, username: who, display_name: user.display_name, citizenship: user.citizenship ?? "USA", clearance: "UNCLASSIFIED", ntk_programs: [], roles: user.roles, org: user.org, org_name: ORG_NAMES[user.org] ?? user.org } };
  }
  return null;
}

// What a visitor did this tab: every accepted change (approve, ship, hold, request…)
// is kept in sessionStorage and replayed when the page loads, so a reload keeps the
// story. A new tab starts fresh; "Reset the demo data" in ⌘K clears it.
const ACTIONS_KEY = "a2e-demo-actions";
const MAX_ACTIONS = 400;
type Action = { m: string; p: string; r: string; u: string | null; t: number };
// Training runs on wall-clock time and the session routes are the gate's own.
const replayable = (path: string) => !path.startsWith("/v1/session/") && !path.startsWith("/v1/training/");

function loadActions(): Action[] {
  try {
    const raw = sessionStorage.getItem(ACTIONS_KEY);
    const list = raw ? (JSON.parse(raw) as Action[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveActions(list: Action[]): void {
  try {
    sessionStorage.setItem(ACTIONS_KEY, JSON.stringify(list.slice(-MAX_ACTIONS)));
  } catch {
    /* storage full or blocked: this reload starts over, which is still correct */
  }
}

export function resetDemoData(): void {
  try {
    sessionStorage.removeItem(ACTIONS_KEY);
    sessionStorage.removeItem("a2e-ops-done");
  } catch {
    /* nothing kept */
  }
  window.location.reload();
}

export function installStaticDemo(): void {
  const params = new URLSearchParams(window.location.search);
  const demo = createDemo({
    speed: 6,
    extra: Number(params.get("fleet") ?? 0) || 0,
    terrain,
    attrition,
    readme,
    assetBase: `${import.meta.env.BASE_URL}demo-assets/`,
  });
  const actions = loadActions();
  // Replay at the time each action happened, so ids built from the clock (Brief proposals) match again.
  const clock = Date.now;
  try {
    for (const x of actions) {
      Date.now = () => x.t;
      demo.handle(x.m, new URL(x.p, window.location.origin), x.r, x.u ? (DEMO_USERS[x.u] ?? null) : null);
    }
  } finally {
    Date.now = clock;
  }
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/v1/")) {
      const method = init?.method ?? "GET";
      const raw = typeof init?.body === "string" ? init.body : "";
      const who = signedIn();
      const gated = await gate(method, url, raw);
      const out = gated ?? demo.handle(method, url, raw, who ? (DEMO_USERS[who] ?? null) : null);
      if (!gated && method === "POST" && out.status < 300 && replayable(url.pathname)) {
        actions.push({ m: method, p: `${url.pathname}${url.search}`, r: raw, u: who, t: Date.now() });
        saveActions(actions);
      }
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { "content-type": "application/json", "X-Classification-Banner": BANNER },
      });
    }
    return real(input, init);
  };
}
