// Bid desk: answer a solicitation from the record, row by row
// (docs/design/round-two.md, build 5).
//
// Why: every program office asks the same questions in different words, and
// the honest answer to most of them is already in the platform: acceptance
// rates, supplier evidence, surge dates, signed releases, mixed-vendor logs.
// Each requirement row is checked against live data when the page loads. A row
// reads "met" only when the record it links to exists and shows what the row
// claims; otherwise it is downgraded to "partial" and says why. Requirements
// about weapons effects (terminal guidance, warheads, arming) read "out of
// scope" under ADR-0016 and can never be met here.
//
// Solicitation wording is paraphrased from public program descriptions; the
// assessments, owners and dates are SIM. Pure JavaScript.

import { TODAY } from "./company.mjs";
import { addDays } from "./serials.mjs";

/** Pages a row may link to as evidence. A link outside this list never counts. */
export const EVIDENCE_PAGES = ["mixed", "config", "surge", "quote", "receiving", "accountability", "quality", "compliance", "updates", "readiness", "program", "attrition", "integrations", "cases"];

export const OUT_OF_SCOPE = "Out of scope (ADR-0016): this platform records how a drone ended, not what it did. No targeting, terminal guidance, warhead or arming fields exist.";

const SOLICITATIONS = [
  {
    id: "DD-P3", name: "Drone Dominance Phase III production (SIM paraphrase)", buyer: "Army, via the UAS Marketplace", due: addDays(TODAY, 24),
    rows: [
      { id: "osa", req: "Open systems architecture: work with government-furnished control software", check: "mixed_gov" },
      { id: "multi", req: "Show readiness across a mixed-vendor formation", check: "mixed_vendors" },
      { id: "nav", req: "Operate when GNSS is denied or degraded", check: "gnss_denied" },
      { id: "rate", req: "High-rate production: 400 airframes inside 8 weeks", check: "surge_400" },
      { id: "source", req: "Domestic or allied sourcing for flight-critical components (FY25 NDAA §848 style)", check: "sourcing" },
      { id: "updates", req: "Flash signed software updates before deployment, with rollback", check: "signed_updates" },
      { id: "accept", req: "Acceptance at receiving at or above the program's Gauntlet rate", check: "acceptance" },
      { id: "single", req: "One operator flies several drones at once", check: "not_built", note: "Not in this platform: multi-vehicle control belongs to the government control software." },
      { id: "atr", req: "Automatic target recognition for terminal guidance", check: "adr0016" },
      { id: "esad", req: "Electronic safe-arm device and lethality data", check: "adr0016" },
    ],
  },
  {
    id: "PBAS-FO", name: "Purpose-built attritable systems follow-on (SIM paraphrase)", buyer: "Army PEO Aviation (SIM)", due: addDays(TODAY, 41),
    rows: [
      { id: "ontime", req: "Deliver against committed dates", check: "on_time" },
      { id: "accept", req: "Report acceptance and first-pass yield per lot", check: "acceptance" },
      { id: "account", req: "Account for every serial from issue to end of life", check: "accountability" },
      { id: "fix", req: "Show field problems are fixed and measured, not just closed", check: "fix_loop" },
      { id: "config", req: "Support field reconfiguration between airframe sizes", check: "config" },
    ],
  },
  {
    id: "ALLY-T", name: "Allied partner tender (SIM)", buyer: "Allied ministry of defence (SIM)", due: addDays(TODAY, 60),
    rows: [
      { id: "rel", req: "Releasability: no US-only data in the allied tenant", check: "releasability" },
      { id: "sov", req: "Sovereign or air-gapped hosting option", check: "sovereign" },
      { id: "local", req: "Local build partner for final assembly", check: "not_built", note: "Commercial question for Neros leadership; no build partner is on record." },
      { id: "export", req: "Export license in place before delivery", check: "export" },
    ],
  },
];

/**
 * @param {{ company: any, thread: any, mixed: any, surge: any, cases?: () => any, release?: () => any }} deps
 */
export function createBidDesk({ company, thread, mixed, surge, cases = () => null, release = () => null }) {
  const { serials, compliance, updates } = thread;
  /** owner assignments: `${sol}:${row}` -> { owner, due, at, by } */
  const owners = new Map();

  // Each check returns { status, value, evidence: { page, label, count } }.
  const CHECKS = {
    mixed_gov() {
      const v = mixed.view("CUS-A");
      const n = v.others.filter((t) => t.source === "Government control software export").length;
      return { status: n ? "met" : "gap", value: `${n} tails imported from government control software exports`, evidence: { page: "mixed", label: "All vendors", count: n } };
    },
    mixed_vendors() {
      const v = mixed.view("CUS-A");
      return { status: v.counts.vendors >= 3 ? "met" : "partial", value: `${v.counts.vendors} vendors, ${v.counts.tails} tails in one readiness picture`, evidence: { page: "mixed", label: "All vendors", count: v.counts.tails } };
    },
    gnss_denied() {
      const vio = serials.records.filter((r) => r.nav_source === "vio");
      const ok = vio.filter((r) => r.outcome === "completed").length;
      return { status: vio.length ? "met" : "gap", value: `${vio.length} sorties on visual-inertial navigation, ${ok} completed`, evidence: { page: "attrition", label: "Attrition", count: vio.length } };
    },
    surge_400() {
      const o = surge.options("ARCHER-5", 400, addDays(TODAY, 56));
      const pick = o.options?.find((x) => x.meets);
      return { status: pick ? (pick.label === "As planned" ? "met" : "partial") : "gap", value: o.verdict ?? "", evidence: { page: "surge", label: "Surge planner", count: pick ? 1 : 0 } };
    },
    sourcing() {
      const c = compliance.view();
      return { status: c.counts.gap === 0 ? "met" : "partial", value: c.counts.gap === 0 ? "Every component lot has its origin evidence on file" : `${c.counts.gap} component lots still missing origin evidence; FCC exemption ends in ${c.days_left} days`, evidence: { page: "compliance", label: "Compliance", count: c.counts.complete } };
    },
    signed_updates() {
      const v = updates.view("CUS-A", true);
      const n = v.releases.filter((r) => r.status === "published" && r.signature).length;
      return { status: n ? "met" : "gap", value: `${n} signed releases published, each staged by canary with a halt rule`, evidence: { page: "updates", label: "Software updates", count: n } };
    },
    acceptance() {
      const a = serials.acceptanceStats();
      const rate = a.rate ?? 0;
      return { status: a.lots && rate >= a.program.rate ? "met" : "partial", value: `${(rate * 100).toFixed(1)}% of ${a.serials} serials accepted across ${a.lots} lots (program reference ${(a.program.rate * 100).toFixed(0)}%)`, evidence: { page: "receiving", label: "Receiving", count: a.lots } };
    },
    on_time() {
      const open = company.orders.filter((o) => o.qty > o.delivered);
      const late = open.filter((o) => o.due < TODAY).length;
      return { status: open.length && !late ? "met" : "partial", value: `${open.length} open orders, ${late} past due`, evidence: { page: "program", label: "Program", count: open.length } };
    },
    accountability() {
      const a = serials.accountability("CUS-A");
      const n = a.records?.length ?? 0;
      return { status: n ? "met" : "gap", value: `${serials.records.filter((r) => r.org === "CUS-A").length} end-of-flight records tie each expended serial to its sortie`, evidence: { page: "accountability", label: "Accountability", count: n } };
    },
    fix_loop() {
      const c = cases();
      const n = c ? c.cases.filter((x) => x.status === "closed" && x.measured).length : 0;
      return { status: n ? "met" : "partial", value: n ? `${n} field cases closed with a measured cohort-against-control effect; median ${c.stats.median_days ?? "?"} days from report to measured fix` : "No case has closed with a measured effect yet", evidence: { page: "cases", label: "Field fixes", count: n } };
    },
    config() {
      return { status: "met", value: "5, 8 and 10-inch conversions checked against the rules and held until parameters load", evidence: { page: "config", label: "Configuration", count: serials.serials.size } };
    },
    releasability() {
      const r = release();
      const n = r ? r.rules.length : 0;
      return { status: n ? "met" : "gap", value: n ? `${n} US-only fields withheld from allied sessions at the API, each with its reason` : "No releasability rules are configured", evidence: { page: "release", label: "Releasability", count: n } };
    },
    sovereign() {
      const r = release();
      const p = r?.tenants.find((t) => t.hosting && t.hosting !== "Neros cloud (US)");
      return { status: p ? "partial" : "gap", value: p ? `${p.hosting} profile defined for ${p.name}; not yet stood up` : "No sovereign hosting profile", evidence: { page: "release", label: "Releasability", count: p ? 1 : 0 } };
    },
    export() {
      const o = company.orders.find((x) => x.customer === "CUS-C");
      const st = o?.export?.status ?? "none";
      return { status: st === "approved" ? "met" : "partial", value: o ? `${o.id}: ${o.export?.license ?? "license"} ${st}` : "No allied order", evidence: { page: "program", label: "Program", count: o ? 1 : 0 } };
    },
    not_built: () => ({ status: "gap", value: "", evidence: null }),
    adr0016: () => ({ status: "out_of_scope", value: OUT_OF_SCOPE, evidence: null }),
  };
  // Releasability and fix-loop pages are linked by these ids too.
  const PAGES = new Set([...EVIDENCE_PAGES, "release"]);

  function assess(sol) {
    return sol.rows.map((row) => {
      let r = CHECKS[row.check]();
      // A "met" row must link to a page that exists and a record count above zero.
      if (r.status === "met" && !(r.evidence && PAGES.has(r.evidence.page) && r.evidence.count > 0)) {
        r = { ...r, status: "partial", value: `${r.value} (evidence missing, so not claimed as met)` };
      }
      const o = owners.get(`${sol.id}:${row.id}`) ?? null;
      return { id: row.id, req: row.req, status: r.status, value: row.note ?? r.value, evidence: r.evidence, owner: o };
    });
  }

  function view(id = null) {
    const list = SOLICITATIONS.map((s) => {
      const rows = assess(s);
      const scored = rows.filter((r) => r.status !== "out_of_scope");
      return { id: s.id, name: s.name, buyer: s.buyer, due: s.due, met: scored.filter((r) => r.status === "met").length, of: scored.length, gaps: rows.filter((r) => r.status === "gap" || r.status === "partial").length, out_of_scope: rows.length - scored.length };
    });
    const pick = SOLICITATIONS.find((s) => s.id === id) ?? SOLICITATIONS[0];
    return {
      source: "Simulated: solicitation wording paraphrased from public program descriptions; every assessment is computed from this demo's records when the page loads.",
      today: TODAY,
      solicitations: list,
      current: { id: pick.id, name: pick.name, buyer: pick.buyer, due: pick.due, rows: assess(pick) },
      owners_pool: ["Product", "Manufacturing", "Quality", "Supply chain", "Software", "Contracts"],
    };
  }

  function brief(id) {
    const s = SOLICITATIONS.find((x) => x.id === id);
    if (!s) return null;
    const rows = assess(s);
    const label = { met: "Met", partial: "Partial", gap: "Gap", out_of_scope: "Out of scope" };
    const lines = [
      `# ${s.name}`,
      "",
      `Buyer: ${s.buyer}. Due ${s.due}. Generated ${TODAY} from the Neros record (SIM).`,
      "",
      "| Requirement | Status | Evidence | Owner |",
      "|---|---|---|---|",
      ...rows.map((r) => `| ${r.req} | ${label[r.status]} | ${(r.value || "").replace(/\|/g, "/")}${r.evidence ? ` (${r.evidence.label})` : ""} | ${r.owner ? `${r.owner.owner}, due ${r.owner.due}` : ""} |`),
      "",
      "Weapons-effects requirements are answered out of scope under ADR-0016.",
    ];
    return { id: s.id, markdown: lines.join("\n") };
  }

  function act(action, a, actor) {
    if (action !== "bid.owner") return { error: "unknown action", status: 400 };
    const s = SOLICITATIONS.find((x) => x.id === a.id);
    const row = s?.rows.find((r) => r.id === a.row);
    if (!row) return { error: "no such requirement", status: 404 };
    if (row.check === "adr0016") return { error: "This requirement is out of scope under ADR-0016; there is nothing to assign.", status: 409 };
    const r = assess(s).find((x) => x.id === row.id);
    if (r.status === "met") return { error: "This row is already met from the record.", status: 409 };
    const owner = String(a.owner ?? "").trim();
    if (!owner) return { error: "pick an owner", status: 400 };
    const due = String(a.due ?? addDays(TODAY, 10));
    if (due > s.due) return { error: `The fix is due after the bid (${s.due}). Pick an earlier date or answer it as partial.`, status: 409 };
    owners.set(`${s.id}:${row.id}`, { owner, due, at: TODAY, by: actor });
    return { ok: true, message: `${row.req}: assigned to ${owner}, due ${due}.` };
  }

  function queueItems() {
    const out = [];
    for (const s of SOLICITATIONS) {
      const open = assess(s).filter((r) => (r.status === "gap" || r.status === "partial") && !r.owner);
      if (!open.length) continue;
      out.push({
        id: `q-bid-${s.id}`, area: "Bids", severity: "medium", org: null,
        title: `${s.name}: ${open.length} requirement${open.length === 1 ? "" : "s"} without an owner`,
        detail: `Due ${s.due}. ${open.map((r) => r.req).slice(0, 3).join("; ")}${open.length > 3 ? "…" : ""}`,
        actions: [{ label: `Assign "${open[0].req.slice(0, 40)}" to Product`, action: "market.bid.owner", args: { id: s.id, row: open[0].id, owner: "Product" }, primary: true }],
      });
    }
    return out;
  }

  return { view, brief, act, queueItems, SOLICITATIONS };
}
