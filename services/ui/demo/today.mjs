// Today: what is waiting on this person, in a customer's workspace.
//
// Neros staff open a work queue where every item carries the action that
// clears it. A customer's commander, maintainer and operator get the same
// thing here, drawn from the routes their pages already read: plans waiting
// for a second approver or blocked before H-hour, airframes a plan needs back
// in service, deliveries to sign for, Neros proposals to answer, releases to
// approve and lots the loss autopsy flags. Each action calls the route the
// page itself calls, so roles, the audit log and tenancy apply unchanged.
//
// `get(path)` returns a route's body for the same caller, or null when the
// route refuses or fails; Today never sees more than the person's pages do.
// Pure JavaScript; the data it reads is SIM.

const HOUR = 3_600_000;
const SEVERITY = { now: 0, today: 1, week: 2 };
const LEAD_ROLES = ["admin", "mission_commander", "planner", "analyst", "auditor"];
// Who can receive, sign and approve for the fleet (demo/ops.mjs, demo/thread.mjs).
const ACTING_ROLES = ["admin", "mission_commander", "maintainer"];

/** The rail profiles a person has (mirrors src/shell/workspace.ts profilesOf). No caller: the local demo, everything. */
export function profilesOf(roles) {
  if (!roles) return ["lead", "operator", "maintainer"];
  const out = [];
  if (roles.some((r) => LEAD_ROLES.includes(r))) out.push("lead");
  if (roles.includes("operator")) out.push("operator");
  if (roles.includes("maintainer")) out.push("maintainer");
  return out.length ? out : ["lead"];
}

function untilText(ms) {
  if (ms == null) return "No H-hour set";
  const m = Math.round(ms / 60_000);
  if (m < 0) return `H-hour passed ${Math.abs(m) < 120 ? `${Math.abs(m)} min` : `${Math.round(-m / 60)} h`} ago`;
  if (m < 120) return `H-hour in ${m} min`;
  if (m < 48 * 60) return `H-hour in ${Math.round(m / 60)} h`;
  return `H-hour in ${Math.round(m / 1440)} days`;
}

const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

function bySoonest(ms, { soon = 2, day = 24 } = {}) {
  if (ms == null) return "week";
  if (ms < soon * HOUR) return "now";
  if (ms < day * HOUR) return "today";
  return "week";
}

/**
 * @param {{ get: (path: string) => any, viewer: { display_name?: string, roles?: string[], org?: string } | null, now?: number }} o
 */
export function buildToday({ get, viewer, now = Date.now() }) {
  const roles = viewer?.roles ?? null;
  const mine = profilesOf(roles);
  const lead = mine.includes("lead");
  const maint = mine.includes("maintainer");
  const operator = mine.includes("operator");
  const acts = !roles || roles.some((r) => ACTING_ROLES.includes(r));
  const approves = !roles || roles.some((r) => ["admin", "mission_commander"].includes(r));
  const me = viewer?.display_name ?? null;
  const org = viewer?.org && viewer.org !== "neros" ? viewer.org : "CUS-A";
  const items = [];
  const add = (it) => items.push({ actions: [], ...it });
  const openPlan = (id, label = "Open the plan") => ({ label, go: "missions", hand: { key: "a2e-mission-id", value: id } });
  const openTail = (tail, label = `Open ${tail}`) => ({ label, go: "fleet", hand: { key: "a2e-fleet-tail", value: tail } });

  const plans = get("/v1/missions")?.items ?? [];
  const startOf = (m) => (m.planned_start ? Date.parse(m.planned_start) - now : null);
  const upcoming = plans.filter((m) => ["draft", "review", "approved"].includes(m.state));
  const blockersOf = (m) => (get(`/v1/missions/${encodeURIComponent(m.id)}/readiness`)?.checks ?? []).filter((c) => c.level === "no-go");
  // A blocked plan's own fixes for an unready tail (swap one in, or ask maintenance), offered right on the item.
  const tailFixes = (m) => {
    if (!approves && !(roles ?? []).includes("planner")) return [];
    const b = blockersOf(m).find((c) => c.fixes?.length);
    return (b?.fixes ?? []).slice(0, 2).map((f, n) => ({ label: f.label, primary: n === 0, post: { path: `/v1/missions/${encodeURIComponent(m.id)}/tail`, body: { fix: f.id } } }));
  };

  // ---- Plans: approvals, blockers before H-hour, and (for operators) the sorties they fly. ----
  if (lead) {
    for (const m of plans.filter((x) => x.state === "review")) {
      const t = startOf(m);
      const blocked = (m.no_go ?? 0) > 0;
      const self = me && m.created_by === me;
      add({
        id: `plan-review-${m.id}`, area: "Plans", severity: self ? "week" : bySoonest(t, { soon: 4 }),
        title: self ? `${m.id} ${m.name} waits for a second approver` : `Approve ${m.id}: ${m.name}`,
        detail: `Drafted by ${m.created_by ?? "a planner"}. ${untilText(t)}. ${blocked ? `${m.no_go} launch check${m.no_go === 1 ? "" : "s"} block it.` : `Launch checks: go${m.cautions ? ` with ${m.cautions} caution${m.cautions === 1 ? "" : "s"}` : ""}.`}${self ? " The two-person rule needs someone else to approve it." : ""}`,
        actions: self
          ? [openPlan(m.id)]
          : [
              ...(!blocked && approves ? [{ label: "Approve", primary: true, post: { path: `/v1/missions/${encodeURIComponent(m.id)}/transition`, body: { action: "mission.approve" } } }] : []),
              openPlan(m.id, blocked ? "Clear the blockers" : "Read the plan"),
            ],
      });
    }
    for (const m of plans.filter((x) => x.state === "approved")) {
      const t = startOf(m);
      if ((m.no_go ?? 0) > 0) {
        const blockers = blockersOf(m);
        const fixable = blockers.find((c) => c.fixes?.length) ?? blockers[0];
        const fixes = tailFixes(m);
        const asked = (m.asks ?? []).map((a) => `Maintenance asked for ${a.tail} by ${a.by}.`).join(" ");
        add({
          id: `plan-blocked-${m.id}`, area: "Plans", severity: bySoonest(t, { soon: 6 }) === "week" ? "today" : "now",
          title: `${m.id} ${m.name} cannot launch yet`,
          detail: `${untilText(t)}. ${sentence(fixable?.detail ?? "A launch check fails")}${m.no_go > 1 ? ` (and ${m.no_go - 1} more)` : ""}${asked ? ` ${asked}` : ""}${fixes.some((f) => f.label.startsWith("Swap")) ? " A swap sends the plan back to draft, so a second person approves it again." : ""}`,
          actions: [...fixes, openPlan(m.id, "Open launch checks")],
        });
      } else if (t != null && t < 2 * HOUR) {
        add({
          id: `plan-release-${m.id}`, area: "Plans", severity: "now",
          title: `${m.id} ${m.name} is go: release it to the operators`,
          detail: `${untilText(t)}. Launch checks pass${m.cautions ? ` with ${m.cautions} caution${m.cautions === 1 ? "" : "s"}` : ""}; ${(m.tails ?? []).join(", ")}.`,
          actions: [
            ...(approves ? [{ label: "Release to operators", primary: true, post: { path: `/v1/missions/${encodeURIComponent(m.id)}/transition`, body: { action: "mission.execute" } } }] : []),
            openPlan(m.id, "Read the plan"),
          ],
        });
      }
    }
    for (const m of plans.filter((x) => x.state === "draft")) {
      const t = startOf(m);
      const blocked = (m.no_go ?? 0) > 0;
      add({
        id: `plan-draft-${m.id}`, area: "Plans", severity: t == null ? "week" : bySoonest(t, { soon: 3 }),
        title: blocked ? `Draft ${m.id} ${m.name} has ${m.no_go} blocker${m.no_go === 1 ? "" : "s"}` : `Draft ${m.id} ${m.name} is ready for review`,
        detail: `${m.source ? `From Brief ${m.source}. ` : ""}${untilText(t)}. ${blocked ? (blockersOf(m).find((c) => !/^No H-hour/.test(c.detail))?.detail ?? "") : "Launch checks pass; send it to a second person."}`,
        actions: [
          ...(!blocked ? [{ label: "Send for review", primary: true, post: { path: `/v1/missions/${encodeURIComponent(m.id)}/transition`, body: { action: "mission.review" } } }] : tailFixes(m).map((f) => ({ ...f, primary: false }))),
          openPlan(m.id, blocked ? "Fix the plan" : "Read the plan"),
        ],
      });
    }
  }
  if (operator) {
    const flying = plans.filter((x) => x.state === "active");
    const next = plans.filter((x) => x.state === "approved").sort((a, b) => (startOf(a) ?? Infinity) - (startOf(b) ?? Infinity));
    for (const m of flying) {
      const tail = m.tails?.[0];
      add({
        id: `sortie-active-${m.id}`, area: "Sorties", severity: "now",
        title: `${m.id} ${m.name} is in the air`,
        detail: `${(m.tails ?? []).length} vehicle${(m.tails ?? []).length === 1 ? "" : "s"}: ${(m.tails ?? []).join(", ")}. Alerts that need you are under "Need you" on Operate.`,
        actions: [{ label: "Go to Operate", primary: true, go: "operate", ...(tail ? { hand: { key: "a2e-live-tail", value: tail } } : {}) }],
      });
    }
    for (const m of next) {
      const t = startOf(m);
      const go = (m.no_go ?? 0) === 0;
      add({
        id: `sortie-next-${m.id}`, area: "Sorties", severity: bySoonest(t, { soon: 2 }),
        title: `Next sortie: ${m.id} ${m.name}`,
        detail: `${untilText(t)}; ${(m.tails ?? []).join(", ")}. ${go ? `Go${m.cautions ? ` with ${m.cautions} caution${m.cautions === 1 ? "" : "s"}: read them before you launch` : ""}.` : `No-go: ${blockersOf(m)[0]?.detail ?? "a launch check fails"} The commander has it.`}`,
        actions: [openPlan(m.id, "Read the plan and checks")],
      });
    }
  }

  // ---- Fleet: airframes a plan needs back in service, soonest first. ----
  if (maint || lead) {
    const orders = get("/v1/maintenance")?.items ?? [];
    for (const w of orders) {
      const needed = upcoming.filter((m) => (m.tails ?? []).includes(w.tail_number)).sort((a, b) => (startOf(a) ?? Infinity) - (startOf(b) ?? Infinity));
      // A commander who asked for this tail puts it first, on the plan they asked for.
      const ask = needed.flatMap((m) => (m.asks ?? []).filter((a) => a.tail === w.tail_number).map((a) => ({ ...a, plan: m }))).at(0);
      const first = ask?.plan ?? needed[0];
      const t = first ? startOf(first) : null;
      const sev = ask ? "now" : !first ? "week" : t != null && t < 24 * HOUR ? "now" : "today";
      add({
        id: `wo-${w.id}`, area: "Fleet", severity: maint ? sev : "week",
        title: ask ? `${ask.by.replace(/^Demo /, "")} needs ${w.tail_number} for ${first.id} ${first.name}` : first ? `${w.tail_number} is on ${first.id} ${first.name}, and it is not airworthy` : `${w.tail_number}: ${w.id} is open`,
        detail: `${w.id}: ${w.summary}.${first ? ` ${untilText(t)}${needed.length > 1 ? `; also on ${needed.filter((m) => m !== first).map((m) => m.id).join(", ")}` : ""}.` : " No plan needs it yet."}${ask ? ` Asked at ${ask.at.slice(11, 16)}Z; closing the work order clears the plan's launch check.` : ""}`,
        actions: maint
          ? [{ label: `Close ${w.id} and return to service`, primary: true, post: { path: "/v1/maintenance/close", body: { id: w.id } } }, openTail(w.tail_number)]
          : [openTail(w.tail_number)],
      });
    }
  }

  // ---- Supply: Neros proposals, shipments to sign for, delivery lots to accept. ----
  if (lead || maint) {
    const portal = get("/v1/ops/portal");
    for (const r of (portal?.requests ?? []).filter((x) => x.status === "proposed")) {
      add({
        id: `proposal-${r.id}`, area: "Supply", severity: "today",
        title: `Neros proposes ${r.title}`,
        detail: `${r.id}${r.note ? `. ${r.note}` : ""}. Accept and it ships; decline and nothing happens.`,
        actions: acts
          ? [{ label: "Accept", primary: true, post: { path: "/v1/ops/act", body: { action: "proposal.accept", args: { id: r.id } } } }, { label: "Decline", post: { path: "/v1/ops/act", body: { action: "proposal.decline", args: { id: r.id } } } }]
          : [{ label: "Open Requests to Neros", go: "supply" }],
      });
    }
    for (const s of (portal?.shipments ?? []).filter((x) => x.status !== "delivered")) {
      add({
        id: `ship-${s.id}`, area: "Supply", severity: "today",
        title: `${s.id} is on the way${s.unit ? ` to ${s.unit}` : ""}${s.qty ? `: ${s.qty} ${s.name}` : ""}`,
        detail: `${s.order ? `Against ${s.order}. ` : s.request ? `For ${s.request}. ` : ""}Sign for it when it arrives${s.serials?.length ? "; the airframes join your fleet" : ""}.`,
        actions: acts ? [{ label: "Sign for it", primary: true, post: { path: "/v1/ops/act", body: { action: "shipment.receive", args: { id: s.id } } } }] : [{ label: "Open Requests to Neros", go: "supply" }],
      });
    }
    const receiving = get("/v1/thread/receiving");
    for (const l of receiving?.waiting ?? []) {
      add({
        id: `lot-${l.id}`, area: "Supply", severity: l.days_waiting >= 2 ? "now" : "today",
        title: `${l.id}: ${l.qty} ${l.name} for ${l.unit} wait for your decision`,
        detail: `Shipped ${l.shipped}, waiting ${l.days_waiting} day${l.days_waiting === 1 ? "" : "s"}. ${l.failing ? `${l.failing} serial${l.failing === 1 ? "" : "s"} fail${l.failing === 1 ? "s" : ""} their checks; accept the rest and reject those.` : "Every serial passes its checks."}`,
        actions: [{ label: "Open the package", primary: true, go: "receiving" }],
      });
    }

    // ---- Software: releases Neros published that this fleet has not approved. ----
    const updates = get("/v1/thread/updates");
    for (const r of (updates?.releases ?? []).filter((x) => x.status === "published" && x.rollout?.status === "awaiting approval")) {
      add({
        id: `release-${r.id}`, area: "Software", severity: "week",
        title: `Approve ${r.component} ${r.version} for your fleet?`,
        detail: `${r.notes}. Signed by ${r.signer}. Approving lets you fly it on a canary unit first; nothing reaches a vehicle until you do.`,
        actions: acts
          ? [{ label: "Approve for our fleet", primary: true, post: { path: "/v1/thread/act", body: { action: "updates.approve", args: { org, release: r.id } } } }, { label: "Read the release", go: "updates" }]
          : [{ label: "Read the release", go: "updates" }],
      });
    }

    // ---- Quality: lots the loss autopsy flags that this fleet has not held. ----
    const attr = get("/v1/attrition");
    const held = new Set((attr?.holds ?? []).map((h) => `${h.attribute}:${h.value}`));
    for (const a of (attr?.autopsy?.alerts ?? []).filter((x) => x.flagged && !held.has(`${x.attribute}:${x.value}`))) {
      add({
        id: `alert-${a.attribute}-${a.value}`, area: "Quality", severity: "now",
        title: `${a.value} loses airframes at ${a.ratio}x the fleet rate`,
        detail: `${a.losses} lost in ${a.sorties} sorties (p = ${a.p_value}); most often ${a.top_cause}. ${a.in_service_count} airframes in service carry it. A hold restricts them until the lot is cleared.`,
        actions: acts
          ? [{ label: `Hold ${a.in_service_count} airframes`, primary: true, post: { path: "/v1/attrition/hold", body: { attribute: a.attribute, value: a.value, by: me ?? "Demo user" } } }, { label: "Show the evidence", go: "attrition" }]
          : [{ label: "Show the evidence", go: "attrition" }],
      });
    }
  }

  items.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  const areas = [...new Set(items.map((i) => i.area))].map((area) => ({ area, count: items.filter((i) => i.area === area).length }));
  return {
    source: "Drawn from your plans, airframes, deliveries, releases and loss data (SIM). Each action calls the same route its page does.",
    profiles: mine,
    lead: operator && !lead ? "Your sorties first, then what the unit is waiting on." : maint && !lead ? "Airframes a plan needs come first, then deliveries and holds." : "What is waiting on your decision, soonest first.",
    items,
    areas,
    now: items.filter((i) => i.severity === "now").length,
  };
}
