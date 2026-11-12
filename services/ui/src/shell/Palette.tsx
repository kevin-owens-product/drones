import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { rank, type Command } from "./commands";

export function Palette({ open, commands, onClose }: { open: boolean; commands: readonly Command[]; onClose: () => void }): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => rank(commands, query).slice(0, 12), [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Escape closes it wherever focus is, not only from the search box.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement !== input.current) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function run(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  return (
    <div className="palette-scrim" role="presentation" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder="Jump to a vehicle, a page, or an action"
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul id="palette-list" className="palette-list" role="listbox">
          {results.length === 0 ? <li className="palette-empty">Nothing matches.</li> : null}
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span className="palette-group">{command.group}</span>
              <span className="palette-label">{command.label}</span>
              {command.hint ? <kbd>{command.hint}</kbd> : null}
            </li>
          ))}
        </ul>
        <footer className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
