// Routes for the round-two builds (docs/design/round-two.md): selling through
// the storefront, running a mixed-vendor fleet, field configuration, surge
// planning, the bid desk, the fix loop, allied tenants, plans and stockpile
// health. Each organisation sees only its own data; every action, refusals
// included, goes to the audit log. Pure JavaScript.

import { createQuote } from "./quote.mjs";
import { createMixedFleet } from "./mixedfleet.mjs";
import { createConfig } from "./config.mjs";
import { createSurge } from "./surge.mjs";
import { createBidDesk } from "./biddesk.mjs";
import { createCases } from "./cases.mjs";
import { createStockpile } from "./stockpile.mjs";
import { createPlans } from "./plans.mjs";
import { createRelease } from "./release.mjs";
import { CUSTOMERS } from "./company.mjs";

const NEROS = "neros";
const NEROS_ROLES = ["admin", "ops_lead"];
const CUSTOMER_ROLES = ["admin", "mission_commander", "maintainer"];
const BUYER_ROLES = [...CUSTOMER_ROLES, "planner"];

/** Who may post each action: the customer side, Neros, or either. */
const SIDE = {
  "quote.request": "customer", "quote.accept": "customer", "quote.decline": "either", "quote.price": "neros",
  "mixed.import": "customer", "mixed.retire": "customer", "mixed.ngc2": "customer", "mixed.ground": "customer",
  "config.swap": "customer", "config.reconfigure": "customer", "config.params": "customer",
  "surge.expedite": "neros", "surge.shift": "neros",
  "bid.owner": "neros",
  "case.open": "neros", "case.assign": "neros", "case.ship": "neros", "case.collect": "neros", "case.close": "neros",
  "stock.recharge": "customer", "stock.inspect": "customer", "stock.rotate": "customer", "stock.retire": "customer",
  "plans.request": "customer", "plans.set": "neros",
};

/** Which plan feature each gated route and action family needs. */
const FEATURE_OF_PATH = { "/v1/mixed": "mixed", "/v1/mixed/tail": "mixed", "/v1/config": "config", "/v1/stockpile": "stockpile" };
const FEATURE_OF_FAMILY = { mixed: "mixed", config: "config", stock: "stockpile" };

/** @param {{ company: any, thread: any, audit: { append: (e: object) => void }, holds: object[], triage?: () => any[] }} deps */
export function createMarket({ company, thread, audit, holds, triage = () => [] }) {
  const { serials, compliance } = thread;
  const surge = createSurge({ company, holds: () => holds });
  const config = createConfig({ serials });
  const stockpile = createStockpile({ serials });
  // Readiness on All vendors drops for airframes held by configuration or stockpile health.
  const notReady = (org) => {
    const out = { ...config.notReady(org) };
    for (const [u, n] of Object.entries(stockpile.notReady(org))) out[u] = (out[u] ?? 0) + n;
    return out;
  };
  const mixed = createMixedFleet({ serials, notReady });
  const quote = createQuote({ company, serials, compliance, surge });
  const cases = createCases({ serials, triage });
  const release = createRelease();
  const plans = createPlans({ serials, mixed, customers: CUSTOMERS });
  const bid = createBidDesk({ company, thread, mixed, surge, cases: () => cases.view(), release: () => release.view() });

  const isNeros = (viewer) => !viewer || !viewer.org || viewer.org === NEROS;
  const orgFor = (viewer, url, a = {}) => (viewer && viewer.org && viewer.org !== NEROS ? viewer.org : String(a.org ?? url?.searchParams.get("org") ?? "CUS-A"));

  function act(viewer, action, args) {
    const a = args ?? {};
    const side = SIDE[action];
    if (!side) return { status: 400, body: { detail: "unknown action" } };
    const actor = viewer?.display_name ?? String(a.by ?? "operator");
    const org = orgFor(viewer, null, a);
    const roles = viewer?.roles ?? [];
    const neros = viewer ? viewer.org === NEROS || !viewer.org : side === "neros";
    const resource = String(a.id ?? a.tail ?? a.serial ?? a.sku ?? org);
    const deny = (detail) => {
      audit.append({ actor, action: `market.${action}`, resource_type: action.split(".")[0], resource_id: resource, decision: "deny", reason_codes: ["role_denied"] });
      return { status: 403, body: { detail } };
    };
    if (viewer) {
      if (side === "neros" && (!neros || !roles.some((r) => NEROS_ROLES.includes(r)))) return deny("Only Neros operations can do this.");
      if (side === "customer" && !roles.some((r) => (action.startsWith("quote.") ? BUYER_ROLES : CUSTOMER_ROLES).includes(r) || (neros && NEROS_ROLES.includes(r)))) return deny("This needs the mission commander, maintainer or admin role; operators can view.");
      if (side === "either" && !roles.some((r) => BUYER_ROLES.includes(r) || NEROS_ROLES.includes(r))) return deny("Your role can view this, not change it.");
    }
    const family = action.split(".")[0];
    if (viewer && !neros && FEATURE_OF_FAMILY[family]) {
      const g = plans.gate(org, FEATURE_OF_FAMILY[family]);
      if (g) {
        audit.append({ actor, action: `market.${action}`, resource_type: family, resource_id: resource, decision: "deny", reason_codes: ["plan"] });
        return g;
      }
    }
    let out;
    if (family === "quote") out = quote.act(org, action, a, actor, viewer ? neros : side === "neros");
    else if (family === "mixed") out = mixed.act(org, action, a, actor);
    else if (family === "config") out = config.act(org, action, a, actor);
    else if (action === "surge.expedite") out = surge.expedite(a);
    else if (action === "surge.shift") out = surge.setShift(a.on);
    else if (family === "bid") out = bid.act(action, a, actor);
    else if (family === "case") out = cases.act(action, a, actor);
    else if (family === "stock") out = stockpile.act(org, action, a, actor);
    else if (family === "plans") out = plans.act(org, action, a, actor);
    else out = { error: "unknown action", status: 400 };
    if (out.error) {
      audit.append({ actor, action: `market.${action}`, resource_type: family, resource_id: resource, decision: "deny", reason_codes: ["refused"], detail: String(out.error).slice(0, 200) });
      return { status: out.status ?? 400, body: { detail: out.error } };
    }
    audit.append({ actor, action: `market.${action}`, resource_type: family, resource_id: resource, detail: String(out.message).slice(0, 200) });
    const { ok: _ok, message, ...rest } = out;
    return { status: 200, body: { ok: true, message, ...rest } };
  }

  const ROUTES = ["/v1/market/act", "/v1/quote", "/v1/mixed", "/v1/mixed/tail", "/v1/config", "/v1/config/quality", "/v1/surge", "/v1/bid", "/v1/bid/brief", "/v1/cases", "/v1/stockpile", "/v1/plans", "/v1/release"];
  const owns = (path) => ROUTES.includes(path);

  function handle(method, url, raw, viewer) {
    const path = url.pathname;
    if (method === "POST" && path === "/v1/market/act") {
      let msg = {};
      try {
        msg = JSON.parse(raw);
      } catch {
        return { status: 400, body: { detail: "json" } };
      }
      return act(viewer, String(msg.action ?? ""), msg.args ?? {});
    }
    if (method !== "GET") return { status: 405, body: { detail: "method" } };
    const org = orgFor(viewer, url);
    const neros = isNeros(viewer);
    const q = url.searchParams;
    // A tenant's plan gates its routes; Neros support sees every customer's pages.
    if (viewer && !neros && FEATURE_OF_PATH[path]) {
      const g = plans.gate(org, FEATURE_OF_PATH[path]);
      if (g) return g;
    }
    if (path === "/v1/stockpile") return { status: 200, body: stockpile.view(org, q.get("unit")) };
    if (path === "/v1/plans") return { status: 200, body: neros && !q.get("org") ? plans.view() : plans.mine(org) };
    if (path === "/v1/release") return { status: 200, body: { ...release.view(), you: viewer && !neros ? release.tenantOf(org) : null } };
    if (path === "/v1/quote") {
      const c = {};
      for (const k of ["sku", "sensor", "qty", "seats", "fleet"]) if (q.get(k) != null) c[k] = q.get(k);
      const v = quote.view(org, neros && !q.get("org"), c);
      return v.preview?.error ? { status: v.preview.status, body: { detail: v.preview.error } } : { status: 200, body: v };
    }
    if (path === "/v1/mixed") return { status: 200, body: mixed.view(org) };
    if (path === "/v1/mixed/tail") {
      const t = mixed.tail(org, String(q.get("tail") ?? ""));
      return t ? { status: 200, body: t } : { status: 404, body: { detail: "no such tail in your fleet" } };
    }
    if (path === "/v1/config") return { status: 200, body: config.view(org, q.get("unit")) };
    if (path === "/v1/config/quality") {
      if (!neros) return { status: 403, body: { detail: "Quality by configuration is Neros's own workspace." } };
      return { status: 200, body: { source: "Simulated: shared end-of-flight records grouped by each serial's current configuration.", rows: config.byConfiguration(serials.sharedRecords()) } };
    }
    if (path === "/v1/surge") {
      if (!neros) return { status: 403, body: { detail: "Surge planning is Neros's own workspace." } };
      const sku = q.get("sku") ?? "ARCHER-5";
      const out = surge.view(sku, Number(q.get("qty") ?? 400), q.get("by") ?? undefined);
      return out.ask?.error ? { status: out.ask.status, body: { detail: out.ask.error } } : { status: 200, body: out };
    }
    if (path === "/v1/bid" || path === "/v1/bid/brief" || path === "/v1/cases") {
      if (!neros) return { status: 403, body: { detail: "This is Neros's own workspace." } };
      if (path === "/v1/bid") return { status: 200, body: bid.view(q.get("id")) };
      if (path === "/v1/cases") return { status: 200, body: cases.view() };
      const b = bid.brief(String(q.get("id") ?? ""));
      return b ? { status: 200, body: b } : { status: 404, body: { detail: "no such solicitation" } };
    }
    return { status: 404, body: { detail: "unknown" } };
  }

  return { owns, handle, act, queueItems: () => [...quote.queueItems(), ...bid.queueItems(), ...cases.queueItems(), ...plans.queueItems()], quote, mixed, config, surge, bid, cases, stockpile, plans, release };
}
