import { useEffect, useRef, useState } from "react";
import { SpatialStage } from "../SpatialStage";
import { api } from "../api";
import type { LivePoint } from "../live";
import { planLabel, type PlanAssignment } from "../plans";

interface Viewer {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
}

function accessLine(viewer: Viewer): string {
  const programs = viewer.ntk_programs.join(", ");
  return [viewer.clearance, viewer.citizenship, programs].filter((part) => part.length > 0).join(" · ");
}

function meters(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

const ROSTER_CAP = 12;
const LINK_STALE_AFTER_MS = 20_000;

function compareTails(left: LivePoint, right: LivePoint): number {
  return left.tail_number.localeCompare(right.tail_number);
}

function linkIsStale(time: string | undefined, now: number): boolean {
  if (typeof time !== "string" || time.length === 0) return true;
  const sent = Date.parse(time);
  if (Number.isNaN(sent)) return true;
  return now - sent > LINK_STALE_AFTER_MS;
}

function samePoints(left: readonly LivePoint[], right: readonly LivePoint[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((point, index) => {
    const other = right[index];
    return other !== undefined
      && point.tail_number === other.tail_number
      && point.lat === other.lat
      && point.lon === other.lon
      && point.alt_m === other.alt_m
      && point.classification === other.classification
      && point.time === other.time
      && point.airworthiness === other.airworthiness;
  });
}

export function LivePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [selectedTail, setSelectedTail] = useState<string | null>(null);
  const [pinnedTail, setPinnedTail] = useState<string | null>(null);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [withheld, setWithheld] = useState(0);
  const [plans, setPlans] = useState<PlanAssignment[]>([]);
  const [fault, setFault] = useState("");

  useEffect(() => {
    const handed = sessionStorage.getItem("a2e-live-tail");
    if (handed && handed.trim().length > 0) {
      sessionStorage.removeItem("a2e-live-tail");
      const tail = handed.trim();
      setQuery(tail);
      setSelectedTail(tail);
      setPinnedTail(tail);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      setNow(Date.now());
      try {
        const live = await api<{ items: LivePoint[]; withheld?: number }>("/v1/telemetry/live");
        if (stopped) return;
        onBannerRef.current(live.banner);
        const items = Array.isArray(live.body.items) ? live.body.items : [];
        const ordered = [...items].sort((a, b) => a.tail_number.localeCompare(b.tail_number));
        setPoints((current) => (samePoints(current, ordered) ? current : ordered));
        setWithheld(typeof live.body.withheld === "number" && live.body.withheld > 0 ? live.body.withheld : 0);
        setFault("");
      } catch (error) {
        if (stopped) return;
        setFault(messageOf(error, "Could not load live positions."));
      }
    }
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const result = await api<{ items: PlanAssignment[] }>("/v1/operations/board");
        if (!stopped) setPlans(Array.isArray(result.body.items) ? result.body.items : []);
      } catch {
        if (!stopped) setPlans([]);
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const searched = needle.length === 0
    ? points
    : points.filter((point) => point.tail_number.toLowerCase().includes(needle));
  const matched = alertsOnly
    ? searched.filter((point) => linkIsStale(point.time, now) || point.airworthiness === "restricted")
    : searched;
  const sorted = [...matched].sort(compareTails);
  const roster = needle.length === 0 ? sorted.slice(0, ROSTER_CAP) : sorted.slice(0, 24);
  const hidden = matched.length - roster.length;
  const staleLinks = points.filter((point) => linkIsStale(point.time, now)).length;
  const restrictedCount = points.filter((point) => point.airworthiness === "restricted").length;
  const focusTail = pinnedTail ?? (searched.length === 1 ? searched[0]?.tail_number ?? null : selectedTail);
  const planByTail = new Map(plans.map((plan) => [plan.tail_number, plan]));

  return (
    <section className="page page-fill">
      <header className="page-head">
        <div style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: "10px 16px" }}>
          <p className="kicker">Operate</p>
          <h1 className="page-title">Live</h1>
          <p className="meta">{accessLine(viewer)}</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <div className="stage">
        <SpatialStage
          points={points}
          onSelect={setSelectedTail}
          focusTail={focusTail}
        />
        <section className="panel">
          <header className="panel-head">
            <h2>Roster</h2>
            <p id="live-count" className="meta" aria-live="polite">
              {points.length.toLocaleString("en-US")} aircraft live
              {withheld > 0 ? ` · ${withheld.toLocaleString("en-US")} tracks withheld by classification` : ""}
            </p>
          </header>
          <div className="field">
            <label htmlFor="tail-search">Find a tail</label>
            <input id="tail-search" value={query} placeholder="G-0602 or N-002" onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div role="group" aria-label="Roster filter" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" }}>
            <button type="button" className={alertsOnly ? "btn btn-quiet" : "btn"} aria-pressed={!alertsOnly} onClick={() => setAlertsOnly(false)}>All</button>
            <button type="button" className={alertsOnly ? "btn" : "btn btn-quiet"} aria-pressed={alertsOnly} onClick={() => setAlertsOnly(true)}>Alerts</button>
          </div>
          <p className="meta" style={{ margin: "10px 0 12px" }}>
            {staleLinks.toLocaleString("en-US")} links stale · {restrictedCount.toLocaleString("en-US")} restricted
          </p>
          <div className="table-wrap">
            <table>
              <tbody>
                {roster.map((point) => {
                  const selected = point.tail_number === selectedTail;
                  const stale = linkIsStale(point.time, now);
                  const plan = planByTail.get(point.tail_number);
                  const pinned = pinnedTail === point.tail_number;
                  return (
                    <tr
                      key={point.tail_number}
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={() => setSelectedTail(point.tail_number)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTail(point.tail_number);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ whiteSpace: "normal", overflowWrap: "anywhere", background: selected ? "rgba(228, 177, 90, 0.12)" : "transparent" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <span>{point.tail_number}</span>
                          {selected ? (
                            <span style={{ display: "flex", gap: "6px" }}>
                              <button
                                type="button"
                                className={pinned ? "btn" : "btn btn-quiet"}
                                aria-pressed={pinned}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPinnedTail((current) => (current === point.tail_number ? null : point.tail_number));
                                }}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                {pinned ? "Unpin" : "Pin"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-quiet"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  sessionStorage.setItem("a2e-fleet-tail", point.tail_number);
                                  window.location.hash = "fleet";
                                }}
                              >
                                Fleet
                              </button>
                            </span>
                          ) : null}
                        </div>
                        <div className="meta">{meters(point.alt_m)}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {point.airworthiness === "restricted" ? <span className="pill pill-warn">Restricted</span> : null}
                          <span className={stale ? "pill pill-warn" : "pill pill-ok"}>{stale ? "Link stale" : "Link"}</span>
                        </div>
                        <div><span className="pill">{point.classification}</span></div>
                        {plan ? <div><span className="pill pill-ok pill-plan">{planLabel(plan.state, plan.mission_name)}</span></div> : null}
                        {selected ? <div className="meta">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hidden > 0 ? <p className="meta" style={{ padding: "10px 12px 12px" }}>{hidden.toLocaleString("en-US")} more on the map</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
