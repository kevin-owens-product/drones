// Allied tenants: releasability rules applied at the API, not the screen
// (docs/design/round-two.md, build 7).
//
// Why: allied buyers are a large share of the market, and an allied tenant on
// the same platform must never receive data its releasability rules withhold.
// Hiding a column in the UI is not enough; the field must not leave the
// server. Every response to an allied session passes through `filter`, which
// removes withheld keys at any depth and lists what it removed, with the
// reason, so the allied user sees that something was withheld and why.
//
// The rules, tenants and hosting profiles are SIM; they show the mechanism, not
// a real releasability determination. Pure JavaScript.

/** Fields withheld from allied tenants, with the reason shown to them. */
export const RULES = [
  { field: "sha256", label: "Firmware build hashes", reason: "Controlled technical data. Allied tenants see the version and whether the build is signed and released." },
  { field: "bench", label: "End-of-line bench measurements", reason: "Factory test data is US-only technical data." },
  { field: "supplier", label: "Sub-tier supplier identities", reason: "Supply-chain identities are withheld outside US programs." },
  { field: "supplier_name", label: "Sub-tier supplier names", reason: "Supply-chain identities are withheld outside US programs." },
  { field: "last_link_dbm", label: "Link margin under jamming", reason: "Electronic-warfare performance data is US-only." },
  { field: "jamming", label: "Jamming exposure per sortie", reason: "Electronic-warfare performance data is US-only." },
  { field: "fault_codes", label: "Fault codes", reason: "Diagnostic codes reveal design detail; allied tenants see the outcome." },
  { field: "program_price", label: "US program price reference", reason: "US program pricing is not shared with other buyers." },
  { field: "ngc2", label: "US Army network (NGC2) status", reason: "US Army network integration status is US-only." },
];

export const TENANTS = [
  { org: "CUS-A", name: "Customer A: Army brigade program (SIM)", country: "US", marking: "US", hosting: "Neros cloud (US)" },
  { org: "CUS-B", name: "Customer B: Marine Corps evaluation (SIM)", country: "US", marking: "US", hosting: "Neros cloud (US)" },
  { org: "CUS-C", name: "Customer C: allied partner (SIM)", country: "Allied", marking: "REL TO allied partner (SIM)", hosting: "Sovereign region, air-gapped option (SIM)" },
];

/**
 * Other keys that carry the same withheld data under another name. The birth
 * record calls its hash `firmware_sha256` and its bench readings
 * `calibrations`; both are withheld under the rule they belong to.
 */
export const ALIASES = { firmware_sha256: "sha256", calibrations: "bench" };

const WITHHELD = new Set([...RULES.map((r) => r.field), ...Object.keys(ALIASES)]);

export function createRelease() {
  const tenantOf = (org) => TENANTS.find((t) => t.org === org) ?? null;
  const allied = (viewer) => Boolean(viewer?.org && tenantOf(viewer.org)?.country !== "US" && viewer.org !== "neros");

  /** Remove withheld keys at any depth. Returns a new body and the fields it removed. */
  function strip(body) {
    const found = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const out = {};
        for (const [k, x] of Object.entries(v)) {
          if (WITHHELD.has(k)) found.add(ALIASES[k] ?? k);
          else out[k] = walk(x);
        }
        return out;
      }
      return v;
    };
    return { body: walk(body), found: [...found] };
  }

  /** Apply the viewer's releasability rules to a response. */
  function filter(res, viewer) {
    if (!allied(viewer) || !res || typeof res.body !== "object" || res.body === null) return res;
    const { body, found } = strip(res.body);
    if (!Array.isArray(body) && found.length) {
      body._withheld = found.map((f) => {
        const r = RULES.find((x) => x.field === f);
        return { field: f, label: r.label, reason: r.reason };
      });
    }
    if (!Array.isArray(body)) body._marking = tenantOf(viewer.org).marking;
    return { ...res, body };
  }

  function view() {
    return {
      source: "Simulated: releasability rules, tenant markings and hosting profiles show the mechanism, not a real determination.",
      rules: RULES,
      tenants: TENANTS.map((t) => ({ ...t, withheld: t.country === "US" ? 0 : RULES.length })),
      test: "Sign in as the allied demo user and open any page: withheld fields never reach the browser, and each page lists what was withheld and why.",
    };
  }

  return { filter, view, allied, tenantOf, strip };
}
