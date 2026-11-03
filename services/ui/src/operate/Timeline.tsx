import type { JSX } from "react";
import type { OpsEvent } from "./vehicle";

const SPAN_MS = 10 * 60_000;

function clock(at: number): string {
  const d = new Date(at);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}Z`;
}

export function Timeline({ events, now, onTail }: { events: readonly OpsEvent[]; now: number; onTail: (tail: string) => void }): JSX.Element {
  const recent = events.filter((e) => now - e.at <= SPAN_MS);
  return (
    <section className="timeline" aria-label="Event timeline">
      <header className="timeline-head">
        <h2>Timeline</h2>
        <span className="meta">Last 10 minutes · {recent.length} events</span>
      </header>
      <div className="timeline-strip" aria-hidden="true">
        {[0, 2, 4, 6, 8, 10].map((m) => (
          <span key={m} className="timeline-tick" style={{ left: `${100 - (m / 10) * 100}%` }}>
            {m === 0 ? "now" : `−${m}m`}
          </span>
        ))}
        {recent.map((e) => (
          <span key={e.id} className={`timeline-dot dot-${e.level}`} style={{ left: `${100 - ((now - e.at) / SPAN_MS) * 100}%` }} title={`${e.tail} · ${e.text}`} />
        ))}
      </div>
      <ol className="timeline-list">
        {events.length === 0 ? <li className="meta">Quiet. Link changes, GNSS rejections, mode changes and low batteries appear here.</li> : null}
        {events.slice(0, 40).map((e) => (
          <li key={e.id} className={`ev ev-${e.level}`}>
            <time className="mono">{clock(e.at)}</time>
            <button type="button" className="ev-tail mono" onClick={() => onTail(e.tail)}>{e.tail}</button>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
