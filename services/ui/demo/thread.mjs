// Routes for the serial record and everything built on it (docs/design/serial-record.md).
//
// Customers: Receiving (acceptance packages), Accountability (on hand, issued,
// ended, end-of-flight records). Neros: Quality (the field-to-lot loop and the
// supplier scorecard). Each organisation sees only its own data; Neros sees a
// customer's end-of-flight records only while that customer shares them, and
// then only the outcome fields. Every action is written to the audit log,
// refusals included. Pure JavaScript.

import { createSerials } from "./serials.mjs";
import { createCompliance } from "./compliance.mjs";
import { createReadiness } from "./readiness.mjs";
import { createUpdates } from "./updates.mjs";

const NEROS = "neros";
const NEROS_ROLES = ["admin", "ops_lead"];
const CUSTOMER_ROLES = ["admin", "mission_commander", "maintainer"];

/** Actions by side. Names are what the console posts to /v1/thread/act (and /v1/ops/act as "thread.<name>"). */
export const THREAD_CUSTOMER_ACTIONS = ["delivery.accept", "issue", "sync", "readiness.refresher", "updates.approve", "updates.canary", "updates.promote", "updates.revert"];
export const THREAD_NEROS_ACTIONS = ["rejects.replace", "quality.action", "quality.hold", "quality.close", "compliance.request", "compliance.record", "updates.publish", "updates.withdraw"];

/**
 * @param {{ births: object[], sharing: Record<string, boolean>, holds: object[], audit: { append: (e: object) => void } }} deps
 */
export function createThread({ births, sharing, holds, audit }) {
  const serials = createSerials({ births, sharing, holds });
  const compliance = createCompliance({ serials });
  const readiness = createReadiness({ serials, sharing });
  const updates = createUpdates({ serials });

  function orgFor(viewer, url) {
    if (viewer && viewer.org && viewer.org !== NEROS) return viewer.org;
    return url?.searchParams.get("org") ?? "CUS-A";
  }

  function act(viewer, action, args) {
    const a = args ?? {};
    const actor = viewer?.display_name ?? String(a.by ?? "operator");
    const neros = THREAD_NEROS_ACTIONS.includes(action);
    const cust = THREAD_CUSTOMER_ACTIONS.includes(action);
    if (!neros && !cust) return { status: 400, body: { detail: "unknown action" } };
    const org = cust ? (viewer && viewer.org && viewer.org !== NEROS ? viewer.org : String(a.org ?? "CUS-A")) : NEROS;
    const resource = String(a.id ?? a.lot ?? a.serial ?? a.release ?? org);
    const deny = (detail) => {
      audit.append({ actor, action: `thread.${action}`, resource_type: neros ? "quality" : "delivery", resource_id: resource, decision: "deny", reason_codes: ["role_denied"] });
      return { status: 403, body: { detail } };
    };
    if (viewer) {
      const roles = viewer.roles ?? [];
      const vorg = viewer.org ?? NEROS;
      if (neros && (vorg !== NEROS || !roles.some((r) => NEROS_ROLES.includes(r)))) return deny("Only Neros operations can do this.");
      if (cust && !roles.some((r) => CUSTOMER_ROLES.includes(r) || (vorg === NEROS && NEROS_ROLES.includes(r)))) return deny("Receiving, issuing and syncing need the mission commander or maintainer role; operators can view.");
    }
    let out;
    switch (action) {
      case "delivery.accept": out = serials.acceptDelivery(org, a, actor); break;
      case "issue": out = serials.issueAct(org, a); break;
      case "sync": out = serials.syncAct(org); break;
      case "rejects.replace": out = serials.replaceRejects(a); break;
      case "quality.action": out = serials.openAction(a, actor); break;
      case "quality.hold": out = serials.holdLot(a, actor); break;
      case "quality.close": out = serials.closeAction(a); break;
      case "compliance.request": out = compliance.request(a, actor); break;
      case "compliance.record": out = compliance.record(a, actor); break;
      case "readiness.refresher": out = readiness.refresher(org, a, actor); break;
      case "updates.approve":
      case "updates.canary":
      case "updates.promote":
      case "updates.revert":
      case "updates.publish":
      case "updates.withdraw": out = updates.act(org, action, a, actor); break;
      default: out = { error: "unknown action", status: 400 };
    }
    if (out.error) return { status: out.status ?? 400, body: { detail: out.error } };
    audit.append({ actor, action: `thread.${action}`, resource_type: neros ? "quality" : "delivery", resource_id: resource, detail: out.message.slice(0, 200) });
    return { status: 200, body: { ok: true, message: out.message } };
  }

  function handle(method, url, raw, viewer) {
    const path = url.pathname;
    const customer = viewer?.org && viewer.org !== NEROS;
    if (method === "POST" && path === "/v1/thread/act") {
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
    if (path === "/v1/thread/receiving") {
      const body = serials.receiving(org);
      for (const l of [...body.waiting, ...body.history]) l.compliance = compliance.summaryFor(l.id);
      return { status: 200, body };
    }
    if (path === "/v1/thread/compliance") {
      if (customer) return { status: 403, body: { detail: "Supplier evidence is Neros's own workspace; your packets are on Receiving." } };
      return { status: 200, body: compliance.view() };
    }
    if (path === "/v1/thread/packet") {
      const id = String(url.searchParams.get("lot") ?? "");
      const d = serials.deliveries.find((x) => x.id === id && (!customer || x.org === viewer.org));
      const out = d ? compliance.packet(id, !customer) : null;
      return out ? { status: 200, body: out } : { status: 404, body: { detail: "no such delivery lot" } };
    }
    if (path === "/v1/thread/updates") return { status: 200, body: updates.view(org, !customer) };
    if (path === "/v1/thread/bundle") {
      const out = updates.bundle(org, String(url.searchParams.get("release") ?? ""), String(url.searchParams.get("unit") ?? ""));
      return out ? { status: 200, body: out } : { status: 409, body: { detail: "Approve the release, and keep it out of halt, before building a bundle." } };
    }
    if (path === "/v1/thread/readiness") return { status: 200, body: readiness.view(org) };
    if (path === "/v1/thread/training-effect") {
      if (customer) return { status: 403, body: { detail: "Neros's own workspace." } };
      return { status: 200, body: readiness.nerosView() };
    }
    if (path === "/v1/thread/lot") {
      const out = serials.lotPackage(String(url.searchParams.get("id") ?? ""), customer ? viewer.org : null);
      return out ? { status: 200, body: out } : { status: 404, body: { detail: "no such delivery lot" } };
    }
    if (path === "/v1/thread/accountability") return { status: 200, body: serials.accountability(org) };
    if (path === "/v1/thread/serial") {
      const out = serials.serialRecord(String(url.searchParams.get("serial") ?? ""), customer ? viewer.org : null);
      return out ? { status: 200, body: out } : { status: 404, body: { detail: "no such serial" } };
    }
    if (path === "/v1/thread/quality") {
      if (customer) return { status: 403, body: { detail: "Quality is Neros's own workspace." } };
      return { status: 200, body: serials.quality() };
    }
    return { status: 404, body: { detail: "unknown" } };
  }

  return { handle, act, queueItems: () => [...serials.queueItems(), ...compliance.queueItems(), ...updates.queueItems()], serials, compliance, readiness, updates };
}
