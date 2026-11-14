import { useEffect, useState, type JSX } from "react";
import { readTour, saveTour, tourFor, type TourStep } from "./tourSteps";
import type { Section, Viewer } from "./types";
import type { Workspace } from "./workspace";

/**
 * The guided walk, as a card that stays in the corner while the person works the page.
 * It opens itself once for an invited visitor, and from the ⌘K command "Walk the demo".
 */
export function Tour(props: {
  viewer: Viewer;
  section: Section;
  workspace: Workspace;
  open: boolean;
  onClose: () => void;
  onGo: (section: Section, workspace?: Workspace) => void;
}): JSX.Element | null {
  const steps = tourFor(props.viewer);
  const [index, setIndex] = useState(() => Math.min(readTour().step, Math.max(0, steps.length - 1)));
  // Folded to its header line so it stops covering the page; a phone starts folded.
  const [small, setSmall] = useState(() => readTour().small ?? window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    saveTour({ ...readTour(), step: index, open: props.open, small });
  }, [index, props.open, small]);
  if (!props.open || steps.length === 0) return null;
  const step = steps[Math.min(index, steps.length - 1)] as TourStep;
  const here = props.section === step.section && (!step.workspace || props.workspace === step.workspace || !props.viewer.org);
  const last = index >= steps.length - 1;

  function go(next: number) {
    const target = steps[next];
    if (!target) return;
    setIndex(next);
    props.onGo(target.section, target.workspace);
  }

  return (
    <aside className={small ? "tour is-small" : "tour"} role="complementary" aria-label="Guided walk" data-testid="tour">
      <div className="tour-head">
        <span className="kicker">
          Walk the demo · {index + 1} of {steps.length}
        </span>
        <span>
          <button type="button" className="tour-close" onClick={() => setSmall((x) => !x)} aria-expanded={!small} aria-label={small ? "Show the guided walk" : "Fold the guided walk"} title={small ? "Show" : "Fold"}>
            {small ? "▴" : "▾"}
          </button>
          <button type="button" className="tour-close" onClick={props.onClose} aria-label="Close the guided walk">
            ×
          </button>
        </span>
      </div>
      {small ? (
        <button type="button" className="tour-mini" onClick={() => setSmall(false)}>
          {step.title}
        </button>
      ) : null}
      {small ? null : (
        <>
      <h2>{step.title}</h2>
      <p>{step.body}</p>
      <p className="tour-action">
        <strong>Try it:</strong> {step.action}
      </p>
      <div className="tour-foot">
        <button type="button" className="btn btn-quiet" disabled={index === 0} onClick={() => go(index - 1)}>
          Back
        </button>
        {here ? (
          last ? (
            <button type="button" className="btn btn-primary" onClick={props.onClose}>
              Done
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => go(index + 1)}>
              Next
            </button>
          )
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => props.onGo(step.section, step.workspace)}>
            Take me there
          </button>
        )}
      </div>
      <ol className="tour-dots" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" className={i === index ? "is-on" : i < index ? "is-done" : undefined} aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === index ? "step" : undefined} onClick={() => go(i)} />
          </li>
        ))}
      </ol>
        </>
      )}
    </aside>
  );
}
