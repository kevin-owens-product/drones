// Intent to plan: an operator types a mission brief in plain words, and the
// console turns it into the same plan primitives the mission planner uses
// (tasks on named places, vehicles per task, reserves, deadlines), shows the
// result as a diff, and does nothing until a person approves it.
//
// The parser is a small deterministic grammar that runs offline. That keeps it
// inside the air gap (ADR-0021) and makes every reading explainable: each task
// cites the words it came from, and anything it could not read is listed, not
// guessed. A language model could propose the same structure behind the same
// approval step; it is not wired in. Requests to strike, release or engage are
// refused outright (ADR-0016).

/** Named places in the demo range, local metres. */
export const PLACES = [
  { id: "A", kind: "area", label: "Area A (north-west field)", names: ["area a", "north-west field", "northwest field"], x: -1200, y: 550 },
  { id: "B", kind: "area", label: "Area B (north field)", names: ["area b", "north field"], x: 100, y: 550 },
  { id: "C", kind: "area", label: "Area C (north-east field)", names: ["area c", "north-east field", "northeast field"], x: 1400, y: 550 },
  { id: "D", kind: "area", label: "Area D (west pasture)", names: ["area d", "west pasture"], x: -1350, y: -450 },
  { id: "T1", kind: "point", label: "Culvert", names: ["culvert", "t1"], x: 2300, y: -50 },
  { id: "T2", kind: "point", label: "Gate 3", names: ["gate 3", "gate three", "t2"], x: 1600, y: -700 },
  { id: "T3", kind: "point", label: "Ridge", names: ["ridge", "t3"], x: -900, y: -1100 },
  { id: "T4", kind: "point", label: "Road junction", names: ["road junction", "junction", "t4"], x: 700, y: -200 },
];

const VERBS = {
  search: ["search", "sweep", "look for"],
  survey: ["survey", "map", "cover"],
  observe: ["observe", "watch", "overwatch", "monitor"],
  relay: ["relay", "hold a relay", "comms relay"],
  inspect: ["check", "inspect", "look at"],
};

const REFUSE = /\b(strike|attack|engage|destroy|bomb|drop on|release on|kill|neutrali[sz]e|target (?:the )?(?:enemy|vehicle|person|people|troops))\b/;

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1, single: 1, pair: 2 };
const num = (w) => (w in NUMBERS ? NUMBERS[w] : Number.parseInt(w, 10));

function findPlace(text) {
  let best = null;
  for (const p of PLACES)
    for (const n of p.names) {
      const i = text.indexOf(n);
      if (i >= 0 && (!best || n.length > best.len)) best = { place: p, len: n.length, at: i };
    }
  return best?.place ?? null;
}

function findVerb(text) {
  for (const [kind, words] of Object.entries(VERBS)) for (const w of words) if (new RegExp(`\\b${w}\\b`).test(text)) return { kind, word: w };
  return null;
}

/** Read a brief into structured intent. Never throws; problems come back as `unread` and `refused`. */
export function parse(brief) {
  const text = String(brief ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return { tasks: [], reserve: 0, deadline: null, avoid: [], unread: ["(empty brief)"], refused: null };
  const refused = text.match(REFUSE);
  if (refused) return { tasks: [], reserve: 0, deadline: null, avoid: [], unread: [], refused: `"${refused[0]}" is not something this system plans. It surveys, observes, relays and inspects; it never arms or releases (ADR-0016).` };

  const clauses = text.split(/,|;|\bthen\b|\band then\b|\. /).map((c) => c.trim()).filter(Boolean);
  const tasks = [];
  const unread = [];
  const avoid = [];
  let reserve = 0;
  let deadline = null;
  for (const clause of clauses) {
    let used = false;
    const res = clause.match(/\bkeep (\w+) (?:in reserve|back|on the pad|spare)/);
    if (res) {
      reserve = num(res[1]) || 0;
      used = true;
    }
    const dl = clause.match(/\b(?:before|by|no later than)\s+(\d{1,2}):?(\d{2})\b/);
    if (dl) {
      deadline = `${dl[1].padStart(2, "0")}:${dl[2]}`;
      used = true;
    }
    if (/\bavoid\b.*\b(jamming|jammed|j1)\b/.test(clause)) {
      avoid.push("J1");
      used = true;
    }
    const verb = findVerb(clause);
    const place = findPlace(clause);
    if (verb && place) {
      const count = clause.match(/\bwith (\w+)(?: vehicles?| drones?| aircraft)?\b/) ?? clause.match(/\b(\w+) (?:vehicles?|drones?)\b/);
      const n = count ? num(count[1]) : NaN;
      const dur = clause.match(/\bfor (\d+) ?(?:min|mins|minutes)\b/);
      tasks.push({ kind: verb.kind, place: place.id, label: place.label, vehicles: Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 1, minutes: dur ? Number(dur[1]) : null, from: clause });
      used = true;
    } else if (verb && !place) {
      unread.push(`"${clause}": no place I know. Try one of: ${PLACES.map((p) => p.names[0]).join(", ")}.`);
      used = true;
    }
    if (!used) unread.push(`"${clause}"`);
  }
  return { tasks, reserve, deadline, avoid, unread, refused: null };
}

/**
 * Assign vehicles to the parsed tasks: nearest available first, reserves held
 * back from the ones that are left. `fleet` is [{ tail, x, y, available, why? }].
 */
export function assign(intent, fleet) {
  const free = fleet.filter((v) => v.available).map((v) => ({ ...v }));
  const plan = [];
  const short = [];
  for (const t of intent.tasks) {
    const place = PLACES.find((p) => p.id === t.place);
    free.sort((a, b) => Math.hypot(a.x - place.x, a.y - place.y) - Math.hypot(b.x - place.x, b.y - place.y));
    const need = Math.max(0, Math.min(t.vehicles, free.length - intent.reserve));
    const took = free.splice(0, need).map((v) => v.tail);
    if (took.length < t.vehicles) short.push(`${t.label} wanted ${t.vehicles}, got ${took.length}`);
    plan.push({ ...t, tails: took });
  }
  const reserve = free.slice(0, intent.reserve).map((v) => v.tail);
  if (reserve.length < intent.reserve) short.push(`reserve wanted ${intent.reserve}, got ${reserve.length}`);
  const unavailable = fleet.filter((v) => !v.available).map((v) => ({ tail: v.tail, why: v.why ?? "not available" }));
  return { plan, reserve, idle: free.slice(intent.reserve).map((v) => v.tail), unavailable, short };
}

/** Parse, assign and package a proposal that waits for approval. */
export function propose(brief, fleet, now = Date.now()) {
  const intent = parse(brief);
  const result = intent.refused ? { plan: [], reserve: [], idle: [], unavailable: [], short: [] } : assign(intent, fleet);
  return {
    id: `P-${now.toString(36).toUpperCase()}`,
    brief: String(brief ?? ""),
    parser: "Deterministic grammar (offline). No language model.",
    intent,
    ...result,
    status: intent.refused ? "refused" : intent.tasks.length ? "awaiting approval" : "nothing to plan",
  };
}
