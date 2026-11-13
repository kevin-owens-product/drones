import { MAVLINK_MAP, NEVER_SENT } from "../demo/interop.mjs";
import { esc, highlight, mountChrome } from "./chrome";
import { call, PERSONAS, type Persona } from "./live";

mountChrome("developers");

type Endpoint = { group: string; method: "GET" | "POST"; path: string; desc: string; persona: Persona; body?: string };

const ENDPOINTS: Endpoint[] = [
  { group: "Operate", method: "GET", path: "/v1/telemetry/live", desc: "Latest dmc/v1 sample per vehicle. Poll at 1-2 Hz or subscribe on NATS.", persona: "commander" },
  { group: "Operate", method: "GET", path: "/v1/operations/picture", desc: "The map's overlays: survey areas and coverage, jamming zones, link quality, CBBA task allocation.", persona: "commander" },
  { group: "Operate", method: "GET", path: "/v1/platforms", desc: "The fleet register with airworthiness and the reason when restricted or grounded.", persona: "commander" },
  { group: "Operate", method: "GET", path: "/v1/missions", desc: "Mission plans with launch checks tied to the fleet record.", persona: "commander" },
  { group: "Operate", method: "POST", path: "/v1/intent/propose", desc: "Turn plain intent into a plan proposal. Deterministic offline grammar, no language model. Approval is a separate call by a different person.", persona: "operator", body: '{"brief": "Search the north field with two vehicles before 14:00, keep two in reserve"}' },
  { group: "Physics", method: "GET", path: "/v1/physics", desc: "The performance model's assumed coefficients (power curve, pack, wind, link budget) and the conditions the live sortie flies in. Every number is SIM.", persona: "commander" },
  { group: "Physics", method: "GET", path: "/v1/missions/M-1034/physics?temp_c=-6&wind_mps=7&gust_mps=12", desc: "Fly one plan through the terrain, the cold, the gusts and the wind over the hills. Findings come with fixes; POST the fix to re-plan.", persona: "commander" },
  { group: "Physics", method: "GET", path: "/v1/envelope?temp_c=-10&wind_mps=6", desc: "Packs and thrust per airframe: cold climb-out voltage, preheat time, thrust in a gust, strongest go wind.", persona: "commander" },
  { group: "Physics", method: "GET", path: "/v1/coverage?link=c2&band=915&agl_m=100&ew=1", desc: "Control-link margin from the ground-station mast to every 200 m cell over the terrain, at a height, band and jammer state (link=video for the video link).", persona: "commander" },
  { group: "Physics", method: "GET", path: "/v1/wear?tail=NX-08", desc: "Wear by flight load for one tail: bearing life per motor and arm fatigue from hard landings, against a flat hours schedule.", persona: "maintainer" },
  { group: "Record", method: "GET", path: "/v1/birth-records", desc: "Per-serial birth records from the end-of-line bench: lots, calibrations, firmware hash, verdict.", persona: "commander" },
  { group: "Record", method: "GET", path: "/v1/maintenance", desc: "Open work orders that block return to service.", persona: "maintainer" },
  { group: "Record", method: "GET", path: "/v1/attrition", desc: "Loss autopsy: lots ranked by loss ratio against the fleet baseline.", persona: "commander" },
  { group: "Record", method: "GET", path: "/v1/thread/readiness", desc: "Operator currency, simulator qualification and refreshers due.", persona: "commander" },
  { group: "Record", method: "GET", path: "/v1/stockpile", desc: "Pack age, charge and storage per serial, and the airframes each pack holds from ready.", persona: "commander" },
  { group: "Record", method: "GET", path: "/v1/mixed", desc: "Readiness across every vendor's tails. Gated by plan: Customer B (Record) gets a 403 that names the plan it needs.", persona: "commander" },
  { group: "Sell", method: "GET", path: "/v1/quote?sku=ARCHER-5&qty=120&seats=16", desc: "Price a package. The total equals its lines; delivery comes from factory capacity.", persona: "commander" },
  { group: "Sell", method: "GET", path: "/v1/surge?sku=ARCHER-5&qty=400", desc: "The date a surge can ship, against the slowest part, with expedite and second-shift options. Manufacturer only.", persona: "neros" },
  { group: "Sell", method: "GET", path: "/v1/bid", desc: "Bid desk: each requirement answered from the record, with evidence links.", persona: "neros" },
  { group: "Sell", method: "GET", path: "/v1/plans", desc: "Each tenant's plan, the routes it unlocks, and usage counted from the records.", persona: "neros" },
  { group: "Operations", method: "GET", path: "/v1/ops/queue", desc: "The manufacturer's work queue. Each item carries the action that clears it. A customer gets a 403.", persona: "neros" },
  { group: "Operations", method: "GET", path: "/v1/ops/portal", desc: "The customer's Requests to Neros portal: requests, shipments, sharing.", persona: "commander" },
  { group: "Operations", method: "GET", path: "/v1/cases", desc: "Field fixes cases. A case closes only on a measured cohort-against-control effect.", persona: "neros" },
  { group: "Public safety", method: "GET", path: "/v1/dfr", desc: "The first responder console: calls waiting with priority and wait time, each dock's readiness, the nearest ready dock by flight time, flights in the air and the shift's checks. Customer D only; another customer gets a 403, and the contractor seat gets a 403 that says why.", persona: "supervisor" },
  { group: "Public safety", method: "POST", path: "/v1/dfr/act", desc: "Every console decision is one action with a role rule: the supervisor approves (call.approve), the pilot launches (call.launch) and can decline or end a flight (call.decline, flight.terminate) with no role able to override it. This one takes the next call from the simulated dispatch feed.", persona: "supervisor", body: '{"action": "feed.next"}' },
  { group: "Public safety", method: "GET", path: "/v1/dfr/records", desc: "Flight records prefilled from each flight, their versions and hashes, requests not flown and who decided, signed shift logs, mishaps with the 24-hour clock, the care log, retention and legal holds, and whether the evidence chain is intact.", persona: "pilot" },
  { group: "Public safety", method: "GET", path: "/v1/dfr/crew", desc: "The 14-day console roster and each pilot's currency file: certificate, recurrent training, hours, TWIC, CJIS, supervised time, and what falls due within 30 days.", persona: "supervisor" },
  { group: "Public safety", method: "GET", path: "/v1/dfr/program", desc: "The month's activity report and invoice, both built from the signed shift logs: unstaffed hours and hours worked while not current are not payable. Program manager and contractor only; a pilot gets a 403.", persona: "contractor" },
  { group: "Trust", method: "GET", path: "/v1/release", desc: "Releasability rules. The allied persona gets _withheld and _marking on every filtered response.", persona: "allied" },
  { group: "Trust", method: "GET", path: "/v1/thread/updates", desc: "Fleet software updates as the allied commander: build hashes are withheld, and _withheld says which rule removed them.", persona: "allied" },
  { group: "Trust", method: "GET", path: "/v1/audit", desc: "The hash-chained audit log: every allow and deny with reason codes.", persona: "neros" },
  { group: "Trust", method: "GET", path: "/v1/users", desc: "Accounts, scoped to the caller's tenant.", persona: "commander" },
  { group: "Feeds", method: "GET", path: "/v1/interop/cot", desc: "Cursor-on-Target XML for a TAK Server. Own fleet only.", persona: "commander" },
  { group: "Feeds", method: "GET", path: "/v1/interop/entities", desc: "Lattice-style entities. Own fleet only.", persona: "commander" },
  { group: "Feeds", method: "POST", path: "/v1/interop/inbound?from=external-c2", desc: "Any inbound command. Always refused with 403 and written to the audit log (ADR 0016).", persona: "commander", body: '{"command": "goto", "tail": "NX-01"}' },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const persona = $<HTMLSelectElement>("ex-persona");
const method = $<HTMLSelectElement>("ex-method");
const path = $<HTMLInputElement>("ex-path");
const list = $<HTMLDivElement>("ex-list");
const desc = $<HTMLDivElement>("ex-desc");
const status = $<HTMLDivElement>("ex-status");
const res = $<HTMLPreElement>("ex-res");
const code = $<HTMLPreElement>("ex-code");
let body = "";
let lang = "curl";

persona.innerHTML = (Object.keys(PERSONAS) as Persona[]).map((k) => `<option value="${k}">${esc(PERSONAS[k].label)}</option>`).join("");

let group = "";
list.innerHTML = ENDPOINTS.map((e, i) => {
  const head = e.group !== group ? `<div class="grp">${esc((group = e.group))}</div>` : "";
  return `${head}<button data-i="${i}" aria-pressed="false"><span class="verb ${e.method}">${e.method}</span>${esc(e.path.split("?")[0])}</button>`;
}).join("");

function snippet(): string {
  const m = method.value;
  const p = path.value;
  const host = "https://dmc.example.mil";
  if (lang === "python") {
    return `import requests\n\ns = requests.Session()  # carries the OIDC session cookie\nr = s.${m.toLowerCase()}("${host}${p}"${m === "POST" ? `, json=${body || "{}"}` : ""})\nprint(r.headers["X-Classification-Banner"])  # show the marking\nprint(r.json())`;
  }
  if (lang === "ts") {
    return `const r = await fetch("${host}${p}", {\n  method: "${m}",\n  credentials: "include",${m === "POST" ? `\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify(${body || "{}"}),` : ""}\n});\nconsole.log(r.headers.get("X-Classification-Banner"), await r.json());`;
  }
  return `curl -s -X ${m} "${host}${p}" \\\n  -b session.txt${m === "POST" ? ` \\\n  -H 'content-type: application/json' \\\n  -d '${body || "{}"}'` : ""} \\\n  -D - | jq .`;
}

function send() {
  const out = call(method.value, path.value, body, persona.value as Persona);
  const ok = out.status < 400;
  const json = JSON.stringify(out.body, null, 2);
  const shown = json.length > 60_000 ? `${json.slice(0, 60_000)}\n… (${(json.length / 1024).toFixed(0)} KB, truncated)` : json;
  status.innerHTML = `<b class="${ok ? "ok" : "bad"}">${out.status} ${ok ? "OK" : out.status === 403 ? "Forbidden" : out.status === 404 ? "Not found" : "Error"}</b><span>${out.ms.toFixed(1)} ms</span><span>${(json.length / 1024).toFixed(1)} KB</span><span>X-Classification-Banner: UNCLASSIFIED // DEMO DATA</span><span>as ${esc(PERSONAS[persona.value as Persona].who.display_name)} · ${esc(PERSONAS[persona.value as Persona].who.org)}</span>`;
  res.innerHTML = highlight(shown);
  code.textContent = snippet();
}

function load(i: number, run = true) {
  const e = ENDPOINTS[i];
  if (!e) return;
  method.value = e.method;
  path.value = e.path;
  persona.value = e.persona;
  body = e.body ?? "";
  desc.innerHTML = `${esc(e.desc)}${e.body ? `<br/><code>${esc(e.body)}</code>` : ""}`;
  list.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.i === String(i))));
  if (run) send();
}

list.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
  if (b) load(Number(b.dataset.i));
});
$("ex-send").addEventListener("click", send);
path.addEventListener("keydown", (e) => e.key === "Enter" && send());
persona.addEventListener("change", send);
document.querySelectorAll<HTMLButtonElement>(".codetabs button").forEach((b) =>
  b.addEventListener("click", () => {
    lang = b.dataset.lang ?? "curl";
    document.querySelectorAll(".codetabs button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
    code.textContent = snippet();
  }),
);

// "Try it" buttons elsewhere on the page.
document.querySelectorAll<HTMLButtonElement>("[data-try]").forEach((b) =>
  b.addEventListener("click", () => {
    const [m, p, who] = (b.dataset.try ?? "").split(" ");
    const i = ENDPOINTS.findIndex((e) => e.method === m && e.path.split("?")[0] === (p ?? "").split("?")[0]);
    if (i >= 0) load(i, false);
    method.value = m ?? "GET";
    path.value = p ?? "/";
    persona.value = who ?? "commander";
    if (b.dataset.body) {
      body = b.dataset.body;
      desc.innerHTML = `This request: <code>${esc(body)}</code>`;
    }
    send();
    document.getElementById("explorer")?.scrollIntoView({ behavior: "smooth" });
  }),
);

load(0);

// Reference table from the same list.
const ref = document.querySelector<HTMLTableSectionElement>("#ref tbody");
if (ref) {
  ref.innerHTML = ENDPOINTS.map((e, i) => `<tr><td><span class="verb ${e.method} mono">${e.method}</span></td><td><a href="#explorer" data-ref="${i}"><code>${esc(e.path.split("?")[0])}</code></a></td><td>${esc(e.desc)}</td></tr>`).join("");
  ref.addEventListener("click", (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a[data-ref]");
    if (a) load(Number(a.dataset.ref));
  });
}

// Live telemetry sample.
const sample = $<HTMLPreElement>("sample");
const tick = () => {
  const items = (call("GET", "/v1/telemetry/live").body as { items: Array<{ tail_number: string }> }).items;
  const one = items.find((s) => s.tail_number === "NX-04") ?? items[0];
  const { pos_sigma_m: _sigma, ...wire } = (one ?? {}) as Record<string, unknown>;
  sample.innerHTML = highlight(JSON.stringify(wire, (_k, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v), 2));
};
tick();
setInterval(tick, 1000);

// MAVLink map, straight from demo/interop.mjs.
const mav = document.querySelector<HTMLTableSectionElement>("#mav tbody");
if (mav) mav.innerHTML = MAVLINK_MAP.map((r) => `<tr><td><code>${esc(r.field)}</code></td><td><code>${esc(r.message)}</code></td><td>${esc(r.source)}</td></tr>`).join("");
$("never").innerHTML = NEVER_SENT.map((n) => `<code>${esc(n)}</code>`).join(", ");

// Outbound feeds.
const feed = $<HTMLPreElement>("feed");
function showFeed(kind: string) {
  if (kind === "cot") {
    const out = call("GET", "/v1/interop/cot", "", "commander").body as { xml: string };
    feed.textContent = out.xml.replace(/></g, ">\n<").split("\n").slice(0, 40).join("\n");
  } else {
    const out = call("GET", "/v1/interop/entities", "", "commander").body as { entities: unknown[] };
    feed.innerHTML = highlight(JSON.stringify(out.entities.slice(0, 2), null, 2));
  }
}
document.querySelectorAll<HTMLButtonElement>("[data-feed]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-feed]").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
    showFeed(b.dataset.feed ?? "cot");
  }),
);
showFeed("cot");

// Sidebar scroll spy.
const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#side a"));
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) for (const l of links) l.classList.toggle("active", l.hash === `#${e.target.id}`);
  },
  { rootMargin: "-90px 0px -70% 0px" },
);
document.querySelectorAll(".article").forEach((a) => spy.observe(a));
