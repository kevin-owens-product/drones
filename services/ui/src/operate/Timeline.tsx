import { useRef, type JSX, type PointerEvent } from "react";
import type { OpsEvent } from "./vehicle";

const SPAN_MS = 10 * 60_000;

function clock(at: number): string {
  const d = new Date(at);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}Z`;
}

function pct(now: number, at: number): number {
  return Math.max(0, Math.min(100, 100 - ((now - at) / SPAN_MS) * 100));
}

export function Timeline({
  events,
  now,
  onTail,
  historyFrom,
  replayAt,
  onScrub,
}: {
  events: readonly OpsEvent[];
  now: number;
  onTail: (tail: string) => void;
  historyFrom: number;
  replayAt: number | null;
  onScrub: (at: number | null) => void;
}): JSX.Element {
  const recent = events.filter((e) => now - e.at <= SPAN_MS);
  const strip = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const atPointer = (e: PointerEvent<HTMLDivElement>): number | null => {
    const rect = strip.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return now - (1 - f) * SPAN_MS;
  };

  return (
    <section className="timeline" aria-label="Event timeline">
      <header className="timeline-head">
        <h2>Timeline</h2>
        <span className="meta">Last 10 minutes · {recent.length} events · drag the strip to replay</span>
      </header>
      <div
        ref={strip}
        className={replayAt === null ? "timeline-strip" : "timeline-strip is-replay"}
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={replayAt === null ? 0 : Math.round((now - replayAt) / 60_000)}
        aria-valuetext={replayAt === null ? "Live" : `${Math.round((now - replayAt) / 1000)} seconds ago`}
        data-testid="replay-strip"
        onPointerDown={(e) => {
          scrubbing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrub(atPointer(e));
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) onScrub(atPointer(e));
        }}
        onPointerUp={() => {
          scrubbing.current = false;
        }}
        onKeyDown={(e) => {
          const base = replayAt ?? now;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onScrub(base - 10_000);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onScrub(replayAt === null ? null : base + 10_000);
          }
        }}
      >
        <span className="timeline-recorded" style={{ left: `${pct(now, historyFrom)}%` }} aria-hidden="true" />
        {[0, 2, 4, 6, 8, 10].map((m) => (
          <span key={m} className="timeline-tick" style={{ left: `${100 - (m / 10) * 100}%` }} aria-hidden="true">
            {m === 0 ? "now" : `−${m}m`}
          </span>
        ))}
        {recent.map((e) => (
          <span key={e.id} className={`timeline-dot dot-${e.level}`} style={{ left: `${pct(now, e.at)}%` }} title={`${e.tail} · ${e.text}`} aria-hidden="true" />
        ))}
        {replayAt !== null ? <span className="timeline-head-mark" style={{ left: `${pct(now, replayAt)}%` }} aria-hidden="true" /> : null}
      </div>
      <ol className="timeline-list">
        {events.length === 0 ? <li className="meta">Quiet. Link changes, GNSS rejections, mode changes, re-plans and low batteries appear here.</li> : null}
        {events.slice(0, 40).map((e) => (
          <li key={e.id} className={`ev ev-${e.level}${replayAt !== null && e.at > replayAt ? " is-after" : ""}`}>
            <time className="mono">{clock(e.at)}</time>
            <button type="button" className="ev-tail mono" onClick={() => onTail(e.tail)}>{e.tail}</button>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
