import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Command } from "./commands";
import type { Section, Viewer } from "./types";
import type { Workspace } from "./workspace";

interface Platform { id: string; tail_number: string; designation: string; airworthiness: string }
interface Mission { id: string; name: string; state: string }

/**
 * Things, not just pages, in ⌘K: every tail and every plan in this workspace, loaded the first
 * time the palette opens and refreshed when the person changes page (an action can change a
 * tail's state). Picking one opens its page with it selected, through the same hand-off the
 * pages already use for links from Operate (sessionStorage a2e-fleet-tail / a2e-mission-id).
 */
export function useEntityCommands(open: boolean, workspace: Workspace, viewer: Viewer, section: Section, go: (s: Section) => void): Command[] {
  const [tails, setTails] = useState<Platform[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  // The key of the last load; a new page or workspace loads again the next time the palette opens.
  const loadedFor = useRef("");
  const key = `${workspace}:${section}:${viewer.username}`;
  useEffect(() => {
    if (!open || loadedFor.current === key || workspace === "neros" || workspace === "responder") return;
    loadedFor.current = key;
    void api<{ items: Platform[] }>("/v1/platforms")
      .then((r) => setTails(r.body.items))
      .catch(() => undefined);
    void api<{ items: Mission[] }>("/v1/missions")
      .then((r) => setMissions(r.body.items))
      .catch(() => undefined);
  }, [open, key, workspace]);
  if (workspace === "neros" || workspace === "responder") return [];
  return [
    ...tails.map((p) => ({
      id: `tail-${p.id}`,
      label: `${p.tail_number} · ${p.designation} · ${p.airworthiness.replaceAll("_", " ")}`,
      group: "Airframe",
      run: () => {
        try {
          sessionStorage.setItem("a2e-fleet-tail", p.tail_number);
        } catch {
          /* the page opens unselected */
        }
        go("fleet");
      },
    })),
    ...missions.map((m) => ({
      id: `mission-${m.id}`,
      label: `${m.id} · ${m.name} · ${m.state}`,
      group: "Plan",
      run: () => {
        try {
          sessionStorage.setItem("a2e-mission-id", m.id);
        } catch {
          /* the page opens on its default plan */
        }
        go("missions");
      },
    })),
  ];
}
