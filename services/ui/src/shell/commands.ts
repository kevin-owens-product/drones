import { useSyncExternalStore } from "react";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

let pageCommands: readonly Command[] = [];
const listeners = new Set<() => void>();

/** The page in view offers its own commands to the palette. */
export function setPageCommands(next: readonly Command[]): void {
  pageCommands = next;
  for (const listener of listeners) listener();
}

export function usePageCommands(): readonly Command[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pageCommands,
  );
}

/** Rank by prefix, then word start, then substring. Nothing fancy, and predictable. */
export function rank(commands: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...commands];
  const scored: { c: Command; s: number }[] = [];
  for (const c of commands) {
    const label = c.label.toLowerCase();
    let s = -1;
    if (label.startsWith(q)) s = 0;
    else if (label.split(/[\s·/-]+/).some((word) => word.startsWith(q))) s = 1;
    else if (label.includes(q)) s = 2;
    else if (c.group.toLowerCase().startsWith(q)) s = 3;
    if (s >= 0) scored.push({ c, s });
  }
  return scored.sort((a, b) => a.s - b.s).map((item) => item.c);
}
