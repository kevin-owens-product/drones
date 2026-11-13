import type { Section, Viewer } from "./types";
import { can, isResponderOrg, type Workspace } from "./workspace";

/**
 * A guided walk through the demo: the loop from a customer's shared field data to Neros's
 * decision, and back to the customer's fleet. Each step is a page and one thing to do there.
 * The walk is for a first visit (an invite link opens it), and it stays one ⌘K command away.
 * Nothing here moves state: the person takes each action themselves, which is the point.
 */
export interface TourStep {
  id: string;
  section: Section;
  /** The workspace the page lives in; Neros staff switch to "customer" to see what a customer sees. */
  workspace?: Workspace;
  title: string;
  body: string;
  /** What to press or type, shown as the step's instruction. */
  action: string;
}

const NEROS: readonly TourStep[] = [
  {
    id: "queue",
    section: "ops",
    workspace: "neros",
    title: "Start where Neros starts: the work queue",
    body: "Everything that needs a decision today, drawn from orders, the line, suppliers, quality and customers. The first item is Customer A's shared loss data saying they run out of Archer 5 in six days.",
    action: "Press “Propose 19 + spares”. The customer decides; nothing ships until they approve.",
  },
  {
    id: "quality",
    section: "quality",
    workspace: "neros",
    title: "Field evidence finds a bad lot",
    body: "Shared field sorties joined to factory genealogy. ESC lot ESC-2611 fails 12 times more often than the other lots, so every airframe built from it is suspect.",
    action: "Open “ESC-2611” and press “Hold the lot”. The hold reaches the customer's fleet in the next step.",
  },
  {
    id: "fleet",
    section: "fleet",
    workspace: "customer",
    title: "See what the customer sees",
    body: "This is Customer A's own workspace: their airframes, their records, nothing of Neros's internals. NX-05 was built with the held lot, so it is now restricted and the reason is on its record.",
    action: "Select NX-05 and read its birth record and quality hold.",
  },
  {
    id: "brief",
    section: "brief",
    workspace: "customer",
    title: "From intent to a plan, with a second person",
    body: "A commander types what they need in plain words; the planner turns it into a plan against the real fleet state. Approval is a separate role, so no one plans and approves alone.",
    action: "Type “Survey the north field with three drones”, press “Read brief”, then “Approve”.",
  },
  {
    id: "operate",
    section: "operate",
    workspace: "customer",
    title: "Watch the sortie",
    body: "Nine airborne, three on the pad, one real physics model behind every number. NX-06 reaches its bingo energy and returns on its own; the console only watches, it never arms or commands.",
    action: "Press L for launch readiness, J and K to move between vehicles, F to follow one.",
  },
  {
    id: "debrief",
    section: "debrief",
    workspace: "customer",
    title: "Every flight writes its own record",
    body: "Energy, link and events for the sortie, exported in the format the customer's training system reads. This is the record that flows back to Neros, only as the customer chooses to share it.",
    action: "Pick a vehicle and export the record as CSV or xAPI.",
  },
  {
    id: "audit",
    section: "audit",
    workspace: "neros",
    title: "Everything you just did is on the chain",
    body: "Each action above is an audit entry, hash-chained, with the role decision that allowed or refused it. An operator trying to approve a plan lands here too, as a refusal.",
    action: "Check the chain status reads “Chain intact”.",
  },
];

const CUSTOMER: readonly TourStep[] = [
  {
    id: "operate",
    section: "operate",
    title: "Your fleet, live",
    body: "Nine airborne, three on the pad, one physics model behind every number. NX-06 reaches its bingo energy and returns on its own; the console only watches, it never arms or commands.",
    action: "Press L for launch readiness, J and K to move between vehicles, F to follow one.",
  },
  {
    id: "fleet",
    section: "fleet",
    title: "Every airframe carries its factory record",
    body: "NX-12 failed its end-of-line hover test and stays grounded. NX-05 was built with an ESC lot that field data flagged, so it is restricted until the lot is cleared.",
    action: "Select NX-05 and read its birth record and quality hold.",
  },
  {
    id: "missions",
    section: "missions",
    title: "Plans that check themselves",
    body: "Each plan runs launch checks against the fleet as it is now: grounded tails, battery state and the energy the route needs. M-1034 fails its energy check and says why.",
    action: "Open M-1034 and read its launch checks.",
  },
  {
    id: "brief",
    section: "brief",
    title: "From intent to a plan, with a second person",
    body: "Type what you need in plain words; the planner turns it into a plan against the real fleet state. Approval is a separate role, so no one plans and approves alone.",
    action: "Type “Survey the north field with three drones”, press “Read brief”, then “Approve”.",
  },
  {
    id: "debrief",
    section: "debrief",
    title: "Every flight writes its own record",
    body: "Energy, link and events for the sortie, exported in the format your training system reads. Loss data reaches Neros only as you choose to share it.",
    action: "Pick a vehicle and export the record as CSV or xAPI.",
  },
  {
    id: "supply",
    section: "supply",
    title: "Ask Neros for what the field data says you need",
    body: "Requests to Neros: resupply proposed from your shared loss data, returns, training. You approve; Neros picks, packs and ships; the record follows the serials.",
    action: "Approve the open resupply proposal.",
  },
];

/** The public safety program's walk: a call to a launch to a record. Each seat sees the steps it acts on. */
const RESPONDER: readonly TourStep[] = [
  {
    id: "respond-call",
    section: "respond",
    workspace: "responder",
    title: "A call comes in; the supervisor approves",
    body: "Dispatch sends the call. The console picks the nearest ready dock by flight time and runs its checks. A supervisor approves every launch; the pilot never self-initiates a flight.",
    action: "Approve the water rescue. Then sign in as the pilot (or have them) to launch it.",
  },
  {
    id: "respond-veto",
    section: "respond",
    workspace: "responder",
    title: "The pilot's safety call stands",
    body: "On scene, the gusts rise past the waiver limit. Ending the flight is the pilot's decision under Part 107, and the supervisor's screen has no button to override it. The reason goes on the record.",
    action: "As the pilot, launch the approved call and end the flight when the gust alert shows.",
  },
  {
    id: "records",
    section: "records",
    workspace: "responder",
    title: "Every flight gets its record before the shift ends",
    body: "Times, aircraft, dock, incident number, approver, pilot, weather and airspace come from the flight. The pilot writes what happened. A correction is a new version beside the original, sealed into the same chain.",
    action: "File the waiting record, then correct it and see both versions.",
  },
  {
    id: "contract-approve",
    section: "contract",
    workspace: "responder",
    title: "The month closes on the shift logs",
    body: "The contractor's invoice is built from the signed shift logs: unstaffed hours and hours worked by a pilot who was not current are not payable, and a shift whose records are not filed is held until they are. The activity report sits beside it.",
    action: "Read the held and excluded lines, then approve or return the invoice once the contractor submits it.",
  },
];

/** The contractor's seat: its pilots' files and its invoice. It never sees the console or the incident records. */
const CONTRACTOR: readonly TourStep[] = [
  {
    id: "contractor-files",
    section: "crew",
    workspace: "responder",
    title: "Keep every pilot's file current",
    body: "A pilot with a lapsed credential cannot be rostered. A. Reyes's TWIC expired on October 30, so the program manager cannot put him on console until the renewal is on file.",
    action: "Open A. Reyes's file and record the TWIC renewal.",
  },
  {
    id: "contractor-month",
    section: "contract",
    workspace: "responder",
    title: "Submit the month",
    body: "The report and the invoice come from the signed shift logs, so there is nothing to type. One shift is held until its flight record is filed, and the day Reyes worked without a current TWIC is not payable.",
    action: "Submit the October report and invoice to the program manager.",
  },
];

/** The steps this person can take: Neros staff who can switch walk the whole loop; a customer walks their fleet. */
export function tourFor(viewer: Pick<Viewer, "roles" | "org">): readonly TourStep[] {
  if (!viewer.org) return [...NEROS.filter((s) => s.workspace === "neros" && s.id !== "audit"), ...CUSTOMER];
  if (isResponderOrg(viewer.org)) {
    if (viewer.roles.includes("contractor") && !viewer.roles.some((r) => r === "operator" || can(viewer, "mission.approve"))) return CONTRACTOR;
    return can(viewer, "mission.approve") ? RESPONDER : RESPONDER.filter((s) => s.section !== "contract");
  }
  if (viewer.org !== "neros") return CUSTOMER.filter((s) => s.section !== "brief" || can(viewer, "mission.draft"));
  const switcher = viewer.roles.includes("admin");
  return NEROS.filter((s) => (switcher || s.workspace === "neros") && (s.section !== "audit" || can(viewer, "audit.read")));
}

const KEY = "dmc-tour";
type Saved = { step: number; open: boolean; seen: boolean; small?: boolean };

export function readTour(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { step: 0, open: false, seen: false, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* no memory of the tour */
  }
  return { step: 0, open: false, seen: false };
}

export function saveTour(next: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not remembered */
  }
}
