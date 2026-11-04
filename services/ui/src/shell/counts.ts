import { useEffect, useState } from "react";
import { api } from "../api";
import type { Section, Viewer } from "./types";
import { can, type Workspace } from "./workspace";

export type NavCounts = Partial<Record<Section, number>>;

/**
 * What is waiting on this person, for the rail: work-queue items that need someone now, deliveries waiting to be
 * received, and plans waiting for a second person's approval. Read from the same routes the pages use, refreshed
 * whenever the person moves between pages (an action on a page changes its count). A count that fails to load is
 * simply not shown.
 */
export function useNavCounts(workspace: Workspace, viewer: Viewer, section: Section): NavCounts {
  const [counts, setCounts] = useState<NavCounts>({});
  useEffect(() => {
    let live = true;
    const set = (id: Section, n: number) => {
      if (live) setCounts((c) => (c[id] === n ? c : { ...c, [id]: n }));
    };
    const neros = viewer.org === "neros" || !viewer.org;
    if (workspace !== "customer") {
      void api<{ items: { severity: string }[] }>("/v1/ops/queue")
        .then((r) => set("ops", r.body.items.filter((i) => i.severity === "high").length))
        .catch(() => undefined);
    }
    if (workspace !== "neros") {
      void api<{ stats: { waiting: number } }>(`/v1/thread/receiving${neros ? "?org=CUS-A" : ""}`)
        .then((r) => set("receiving", r.body.stats.waiting))
        .catch(() => undefined);
      if (can(viewer, "mission.approve")) {
        void api<{ items: { state: string }[] }>("/v1/missions")
          .then((r) => set("missions", r.body.items.filter((m) => m.state === "review").length))
          .catch(() => undefined);
      }
    }
    return () => {
      live = false;
    };
  }, [workspace, viewer, section]);
  return counts;
}
