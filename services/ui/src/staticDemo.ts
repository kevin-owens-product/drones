import { BANNER, createDemo } from "../demo/scenario.mjs";
import attrition from "../demo/assets/attrition.json";
import terrain from "../demo/assets/terrain.json";

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
type DemoUser = { hash: string; display_name: string; roles: string[] };
const DEMO_USERS: Record<string, DemoUser> = {
  admin: { hash: "06d8638093f35fa49aba3987dd788d1a4cc1653807adabf1be186f282b5ad33a", display_name: "Demo Admin", roles: ["admin"] },
  commander: { hash: "18e32bb2630f85d10a6fa11de2083f90402e78f9b9dbacb4d232d0e298a48619", display_name: "Demo Mission Commander", roles: ["mission_commander", "planner"] },
  operator: { hash: "ffe651590c6442ba0b5752d8429128f244573922fbfc3277df6582cf0ba518b1", display_name: "Demo Operator", roles: ["operator"] },
  maintainer: { hash: "37f7a353b0255284ec2aab24ae00007231ced0adc76f2ee61448b867ca70c7be", display_name: "Demo Maintainer", roles: ["maintainer"] },
};
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
    return { status: 200, body: { id: `demo-${who}`, username: who, display_name: user.display_name, citizenship: "USA", clearance: "UNCLASSIFIED", ntk_programs: [], roles: user.roles } };
  }
  return null;
}

export function installStaticDemo(): void {
  const params = new URLSearchParams(window.location.search);
  const demo = createDemo({
    speed: 6,
    extra: Number(params.get("fleet") ?? 0) || 0,
    terrain,
    attrition,
    assetBase: `${import.meta.env.BASE_URL}demo-assets/`,
  });
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/v1/")) {
      const method = init?.method ?? "GET";
      const raw = typeof init?.body === "string" ? init.body : "";
      const out = (await gate(method, url, raw)) ?? demo.handle(method, url, raw);
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { "content-type": "application/json", "X-A2E-Banner": BANNER },
      });
    }
    return real(input, init);
  };
}
