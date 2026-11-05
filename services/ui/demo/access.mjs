// The demo's access contract, as a table: every read route and the writes that matter,
// probed as each demo account, so that who can see and do what is a test and a document
// rather than a belief. `node demo/access-matrix.mjs` renders docs/security/demo-access-matrix.md;
// demo/access.test.mjs fails when the code and the document drift, or when a rule below breaks.
//
// What it does not claim: the demo has one scripted fleet and sortie, which each customer
// login sees as its own. Isolation between customers is enforced on accounts, requests,
// orders, quotes, plans, receiving and the work queue, not on the scripted sortie.
import { ACCOUNTS } from "./ledger.mjs";
import { RULES, ALIASES } from "./release.mjs";

/** The hosted demo's accounts, plus the allied tenant and an unsigned caller. */
export const CALLERS = [
  { key: "anon", who: null, note: "no sign-in (the local demo server)" },
  ...ACCOUNTS.map((a) => ({ key: a.username, who: { display_name: a.display_name, roles: a.roles, org: a.org }, note: `${a.roles.join(", ")} · ${a.org}` })),
  { key: "allied", who: { display_name: "Allied Mission Commander", roles: ["mission_commander", "planner"], org: "CUS-C", citizenship: "Allied (SIM)" }, note: "mission_commander, planner · CUS-C (allied)" },
];

/** Every read route the console uses, grouped the way the rail groups pages. */
export const READS = [
  ["Session", ["/v1/me", "/v1/users", "/v1/org"]],
  ["Fly", ["/v1/platforms", "/v1/telemetry/live", "/v1/operations/picture", "/v1/physics", "/v1/missions", "/v1/intent", "/v1/configure", "/v1/denial-map", "/v1/maintenance"]],
  ["Fleet", ["/v1/birth-records", "/v1/mixed", "/v1/config", "/v1/stockpile", "/v1/thread/readiness", "/v1/thread/updates"]],
  ["Supply", ["/v1/thread/receiving", "/v1/thread/accountability", "/v1/ops/portal", "/v1/quote", "/v1/plans"]],
  ["Learn", ["/v1/attrition", "/v1/field-reports", "/v1/eval/runs"]],
  ["Neros only", ["/v1/ops/queue", "/v1/company", "/v1/program", "/v1/thread/quality", "/v1/thread/compliance", "/v1/config/quality", "/v1/surge", "/v1/bid", "/v1/cases"]],
  ["Shared", ["/v1/release", "/v1/interop", "/v1/interop/cot", "/v1/interop/entities"]],
  ["Settings", ["/v1/audit"]],
  ["Unknown", ["/v1/no-such-route"]],
];

/** Writes that carry a role or tenant rule. Each runs on a fresh scenario so one probe cannot change the next. */
export const WRITES = [
  { label: "Hold a lot (Attrition)", method: "POST", path: "/v1/attrition/hold", body: { attribute: "esc_lot", value: "ESC-2611" } },
  { label: "Approve a plan (Missions)", method: "POST", path: "/v1/missions/M-1033/transition", body: { action: "mission.approve" } },
  { label: "Ground an airframe (Fleet)", method: "PATCH", path: "/v1/platforms/NX-01", body: { airworthiness: "grounded", reason: "probe" } },
  { label: "Close a work order (Fleet)", method: "POST", path: "/v1/maintenance/close", body: { id: "WO-5101" } },
  { label: "Act on the work queue (Neros)", method: "POST", path: "/v1/ops/act", body: { action: "po.expedite", args: { id: "PO-41207" } } },
  { label: "Inbound command from an external system", method: "POST", path: "/v1/interop/inbound", body: { command: "goto" } },
];

const NEROS_ONLY = READS.find(([g]) => g === "Neros only")[1];
const WITHHELD = new Set([...RULES.map((r) => r.field), ...Object.keys(ALIASES)]);

function keysDeep(x, out = new Set()) {
  if (Array.isArray(x)) for (const v of x) keysDeep(v, out);
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysDeep(v, out); }
  return out;
}

function cell(out) {
  if (out.status !== 200) return String(out.status);
  const b = out.body;
  const n = Array.isArray(b?.items) ? ` · ${b.items.length}` : "";
  return `200${n}${b?._withheld?.length ? ` · ${b._withheld.length} withheld` : ""}`;
}

/** Probe every read as every caller on one scenario, and every write on a fresh scenario per probe. */
export function probe(makeDemo) {
  const demo = makeDemo();
  const reads = READS.map(([group, paths]) => ({
    group,
    rows: paths.map((path) => ({ path, cells: CALLERS.map((c) => demo.handle("GET", new URL(`http://demo${path}`), "", c.who)) })),
  }));
  const writes = WRITES.map((w) => ({
    ...w,
    cells: CALLERS.map((c) => makeDemo().handle(w.method, new URL(`http://demo${w.path}`), JSON.stringify(w.body), c.who)),
  }));
  return { reads, writes };
}

/** The rules the test holds the demo to. Each returns a list of breaches (empty when it holds). */
export function check({ reads, writes }) {
  const breaches = [];
  const idx = (key) => CALLERS.findIndex((c) => c.key === key);
  const customers = ["commander", "operator", "maintainer", "allied"].map(idx);
  const rows = reads.flatMap((g) => g.rows);
  for (const row of rows) {
    if (NEROS_ONLY.includes(row.path)) for (const i of customers) if (row.cells[i].status === 200) breaches.push(`${CALLERS[i].key} can read ${row.path}, a Neros-only route`);
    if (row.path === "/v1/no-such-route") for (const [i, out] of row.cells.entries()) if (out.status !== 404) breaches.push(`${CALLERS[i].key} gets ${out.status} from an unknown route, not 404`);
    if (row.path === "/v1/audit") for (const k of ["ops", "commander", "operator", "maintainer", "allied"]) if (row.cells[idx(k)].status !== 403) breaches.push(`${k} can read the audit log without audit.read`);
    const allied = row.cells[idx("allied")];
    if (allied.status === 200) {
      const leaked = [...keysDeep(allied.body)].filter((k) => WITHHELD.has(k));
      if (leaked.length) breaches.push(`allied response from ${row.path} carries withheld fields: ${leaked.join(", ")}`);
    }
    const users = reads.flatMap((g) => g.rows).find((r) => r.path === "/v1/users");
    if (row === users) {
      for (const k of ["commander", "operator", "maintainer", "allied"]) {
        const who = CALLERS[idx(k)].who;
        const items = row.cells[idx(k)].body?.items ?? [];
        if (items.some((u) => u.org !== who.org)) breaches.push(`${k} can list accounts outside ${who.org}`);
      }
    }
  }
  const expectDeny = (label, keys) => {
    const w = writes.find((x) => x.label === label);
    for (const k of keys) if (w.cells[idx(k)].status !== 403) breaches.push(`${k} got ${w.cells[idx(k)].status} from "${label}", expected 403`);
  };
  expectDeny("Hold a lot (Attrition)", ["operator"]);
  expectDeny("Approve a plan (Missions)", ["operator", "maintainer"]);
  expectDeny("Ground an airframe (Fleet)", ["operator"]);
  expectDeny("Close a work order (Fleet)", ["operator"]);
  expectDeny("Act on the work queue (Neros)", ["commander", "operator", "maintainer", "allied"]);
  expectDeny("Inbound command from an external system", CALLERS.map((c) => c.key));
  return breaches;
}

/** The matrix as Markdown: the document in docs/security, regenerated by `node demo/access-matrix.mjs`. */
export function render({ reads, writes }) {
  const head = `| Route | ${CALLERS.map((c) => `\`${c.key}\``).join(" | ")} |\n|---|${CALLERS.map(() => "---").join("|")}|`;
  const lines = [
    "# Demo access matrix",
    "",
    "Generated by `node demo/access-matrix.mjs` in `services/ui` from the demo scenario; `demo/access.test.mjs` fails when this file and the code drift. Cells are the HTTP status each caller gets, with the item count for lists and the number of fields withheld from an allied tenant.",
    "",
    "What it covers: role gates (the policy matrix in `demo/ledger.mjs`, mirrored from `policies/`), workspace gates (Neros's own routes stay out of customer sessions), the audit gate, account scoping per tenant, releasability for an allied tenant, and the refusal of inbound commands (ADR-0016).",
    "",
    "What it does not claim: the demo has one scripted fleet and sortie, which each customer login sees as its own. Isolation between customers is enforced on accounts, requests, orders, quotes, plans, receiving and the work queue, not on the scripted sortie. The real API enforces both with OPA and row-level security (ADR-0009).",
    "",
    "## Callers",
    "",
    ...CALLERS.map((c) => `- \`${c.key}\`: ${c.note}`),
    "",
    "## Reads",
    "",
  ];
  for (const g of reads) {
    lines.push(`### ${g.group}`, "", head);
    for (const r of g.rows) lines.push(`| \`${r.path}\` | ${r.cells.map(cell).join(" | ")} |`);
    lines.push("");
  }
  lines.push("## Writes", "", "Each probe runs on a fresh scenario. 403 is a role or tenant refusal recorded in the audit log; 404 and 409 mean the caller was allowed but the resource or state did not fit.", "");
  lines.push(`| Write | ${CALLERS.map((c) => `\`${c.key}\``).join(" | ")} |\n|---|${CALLERS.map(() => "---").join("|")}|`);
  for (const w of writes) lines.push(`| ${w.label} \`${w.method} ${w.path}\` | ${w.cells.map((o) => String(o.status)).join(" | ")} |`);
  lines.push("");
  return lines.join("\n");
}
