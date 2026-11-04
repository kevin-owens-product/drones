// Routes for the round-two builds (docs/design/round-two.md): selling through
// the storefront, running a mixed-vendor fleet, field configuration, surge
// planning, the bid desk, the fix loop, allied tenants, plans and stockpile
// health. Each organisation sees only its own data; every action, refusals
// included, goes to the audit log. Pure JavaScript.

import { createQuote } from "./quote.mjs";
import { createMixedFleet } from "./mixedfleet.mjs";
import { createConfig } from "./config.mjs";
import { createSurge } from "./surge.mjs";

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
};

/** @param {{ company: any, thread: any, audit: { append: (e: object) => void }, holds: object[] }} deps */
export function createMarket({ company, thread, audit, holds }) {
  const { serials, compliance } = thread;
  const surge = createSurge({ company, holds: () => holds });
  const config = createConfig({ serials });
  const notReady = (org) => config.notReady(org);
  const mixed = createMixedFleet({ serials, notReady });
  const quote = createQuote({ company, serials, compliance, surge });

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
    let out;
    const family = action.split(".")[0];
    if (family === "quote") out = quote.act(org, action, a, actor, viewer ? neros : side === "neros");
    else if (family === "mixed") out = mixed.act(org, action, a, actor);
    else if (family === "config") out = config.act(org, action, a, actor);
    else if (action === "surge.expedite") out = surge.expedite(a);
    else if (action === "surge.shift") out = surge.setShift(a.on);
    else out = { error: "unknown action", status: 400 };
    if (out.error) {
      audit.append({ actor, action: `market.${action}`, resource_type: family, resource_id: resource, decision: "deny", reason_codes: ["refused"], detail: String(out.error).slice(0, 200) });
      return { status: out.status ?? 400, body: { detail: out.error } };
    }
    audit.append({ actor, action: `market.${action}`, resource_type: family, resource_id: resource, detail: String(out.message).slice(0, 200) });
    const { ok: _ok, message, ...rest } = out;
    return { status: 200, body: { ok: true, message, ...rest } };
  }

  const ROUTES = ["/v1/market/act", "/v1/quote", "/v1/mixed", "/v1/mixed/tail", "/v1/config", "/v1/config/quality", "/v1/surge"];
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
    return { status: 404, body: { detail: "unknown" } };
  }

  return { owns, handle, act, queueItems: () => [...quote.queueItems()], quote, mixed, config, surge };
}
