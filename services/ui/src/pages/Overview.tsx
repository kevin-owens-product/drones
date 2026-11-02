import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { SpatialStage } from "../SpatialStage";
import type { LivePoint } from "../live";
import { type PlanAssignment } from "../plans";

interface Viewer {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
}

interface Platform {
  id: string;
  tail_number: string;
  designation: string;
  group_size: string;
  portion_mark: string;
  airworthiness: string;
  classification: string;
  home_station: string | null;
}

function accessLine(viewer: Viewer): string {
  const programs = viewer.ntk_programs.join(", ");
  return [viewer.clearance, viewer.citizenship, programs].filter((part) => part.length > 0).join(" · ");
}

function countText(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function meters(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

const ROSTER_CAP = 12;
const ALERT_CAP = 8;
const LINK_STALE_AFTER_MS = 20_000;
const NO_POINTS: LivePoint[] = [];

function linkIsStale(time: string | undefined, now: number): boolean {
  if (typeof time !== "string" || time.length === 0) return true;
  const sent = Date.parse(time);
  if (Number.isNaN(sent)) return true;
  return now - sent > LINK_STALE_AFTER_MS;
}

function compareTails(left: LivePoint, right: LivePoint): number {
  return left.tail_number.localeCompare(right.tail_number);
}

function rosterWindow(source: readonly LivePoint[], selectedTail: string | null): LivePoint[] {
  if (selectedTail !== null) {
    const selected = source.find((point) => point.tail_number === selectedTail);
    if (selected) return [selected];
  }
  return [...source].sort(compareTails).slice(0, ROSTER_CAP);
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

export function OverviewPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [rows, setRows] = useState<Platform[] | null>(null);
  const [points, setPoints] = useState<LivePoint[] | null>(null);
  const [withheld, setWithheld] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [fleetFault, setFleetFault] = useState("");
  const [liveFault, setLiveFault] = useState("");
  const [selectedTail, setSelectedTail] = useState<string | null>(null);
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);
  const [plans, setPlans] = useState<PlanAssignment[]>([]);
  const fault = [fleetFault, liveFault].filter((part) => part.length > 0).join(" ");

  useEffect(() => {
    let stopped = false;
    async function loadFleet() {
      try {
        const fleet = await api<{ items: Platform[] }>("/v1/platforms");
        if (stopped) return;
        onBannerRef.current(fleet.banner);
        setRows(Array.isArray(fleet.body.items) ? fleet.body.items : []);
      } catch (error) {
        if (stopped) return;
        setFleetFault(messageOf(error, "Could not load the fleet."));
      }
    }
    void loadFleet();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const [stationList, board] = await Promise.all([
          api<{ items: { id: string; name: string }[] }>("/v1/ground-stations"),
          api<{ items: PlanAssignment[] }>("/v1/operations/board"),
        ]);
        if (stopped) return;
        setStations(Array.isArray(stationList.body.items) ? stationList.body.items : []);
        setPlans(Array.isArray(board.body.items) ? board.body.items : []);
      } catch {
        if (!stopped) {
          setStations([]);
          setPlans([]);
        }
      }
    })();
    return () => {
      stopped = true;
    };
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
        setPoints((current) => (current !== null && samePoints(current, ordered) ? current : ordered));
        setWithheld(typeof live.body.withheld === "number" && live.body.withheld > 0 ? live.body.withheld : 0);
        setLiveFault("");
      } catch (error) {
        if (stopped) return;
        setLiveFault(messageOf(error, "Could not load live positions."));
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

  const visible = rows === null ? null : rows.length;
  const airborne = points === null ? null : points.length;
  const airworthy = rows === null ? null : rows.filter((row) => row.airworthiness === "airworthy").length;
  const restricted = rows === null ? null : rows.filter((row) => row.airworthiness === "restricted").length;
  const stale = points === null ? null : points.filter((point) => linkIsStale(point.time, now)).length;
  const stats = [
    { label: "Visible", value: countText(visible) },
    { label: "Airborne", value: countText(airborne) },
    { label: "Airworthy", value: countText(airworthy) },
    { label: "Restricted", value: countText(restricted) },
    { label: "Link stale", value: countText(stale) },
    { label: "On a plan", value: countText(plans.length) },
    ...(withheld > 0 ? [{ label: "Withheld", value: countText(withheld) }] : []),
  ];
  const livePoints = points ?? NO_POINTS;
  const alerts = livePoints
    .filter((point) => linkIsStale(point.time, now) || point.airworthiness === "restricted")
    .slice(0, ALERT_CAP);
  const roster = rosterWindow(livePoints, selectedTail);
  const hidden = livePoints.length - roster.length;
  const planGroups = new Map<string, { id: string; name: string; state: string; tails: string[] }>();
  for (const plan of plans) {
    const current = planGroups.get(plan.mission_id);
    if (current) {
      current.tails.push(plan.tail_number);
    } else {
      planGroups.set(plan.mission_id, {
        id: plan.mission_id,
        name: plan.mission_name,
        state: plan.state,
        tails: [plan.tail_number],
      });
    }
  }

  return (
    <section className="page page-fill">
      <header className="page-head">
        <div>
          <p className="kicker">Operate</p>
          <h1 className="page-title">Team picture</h1>
          <p className="lede">Continental demonstration fleet. Not a real order of battle.</p>
          <p className="meta">{accessLine(viewer)}</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <div className="stat-strip">
        {stats.map((stat) => (
          <div className="stat" key={stat.label}>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-label">{stat.label}</p>
          </div>
        ))}
      </div>
      <div className="video-wall" style={{ flex: "0 0 auto", overflow: "visible" }}>
        {stations.map((station) => {
          const count = (rows ?? []).filter((row) => row.home_station === station.name).length;
          return (
            <button
              className="video-tile"
              key={station.id}
              type="button"
              onClick={() => {
                sessionStorage.setItem("a2e-video-site", station.name);
                window.location.hash = "video";
              }}
            >
              <p className="kicker">Site</p>
              <h2>{station.name}</h2>
              <p className="meta">{count.toLocaleString("en-US")} aircraft</p>
            </button>
          );
        })}
      </div>
      {planGroups.size > 0 ? (
        <div className="video-wall" style={{ flex: "0 0 auto", overflow: "visible" }}>
          {[...planGroups.values()].map((plan) => (
            <button
              className="video-tile"
              key={plan.id}
              type="button"
              onClick={() => {
                sessionStorage.setItem("a2e-mission-id", plan.id);
                window.location.hash = "missions";
              }}
            >
              <p className="kicker">Plan</p>
              <h2>{plan.name}</h2>
              <p className="meta">{plan.state} · {plan.tails.join(", ")}</p>
            </button>
          ))}
        </div>
      ) : null}
      <section className="panel" style={{ flex: "0 0 auto", minHeight: "auto" }}>
        <header className="panel-head">
          <h2>Alerts</h2>
        </header>
        {alerts.length === 0 ? (
          <p className="meta">No link or airworthiness alerts.</p>
        ) : (
          alerts.map((point) => {
            const stale = linkIsStale(point.time, now);
            return (
              <button
                key={point.tail_number}
                type="button"
                className="btn btn-quiet"
                style={{ justifyContent: "flex-start", width: "100%" }}
                onClick={() => {
                  sessionStorage.setItem("a2e-live-tail", point.tail_number);
                  window.location.hash = "live";
                }}
              >
                {point.tail_number}
                {stale ? <span className="pill pill-warn">Link stale</span> : null}
                {point.airworthiness === "restricted" ? <span className="pill pill-warn">Restricted</span> : null}
              </button>
            );
          })
        )}
      </section>
      <div className="stage">
        <SpatialStage points={livePoints} focusTail={selectedTail} onSelect={setSelectedTail} />
        <section className="panel">
          <header className="panel-head">
            <h2>Roster</h2>
          </header>
          <div className="table-wrap">
            <table>
              <tbody>
                {roster.map((point) => {
                  const selected = point.tail_number === selectedTail;
                  return (
                    <tr
                      key={point.tail_number}
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={() => {
                        setSelectedTail((current) => (current === point.tail_number ? null : point.tail_number));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedTail((current) => (current === point.tail_number ? null : point.tail_number));
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ whiteSpace: "normal", overflowWrap: "anywhere", background: selected ? "rgba(228, 177, 90, 0.12)" : "transparent" }}>
                        {point.tail_number}
                        <div className="meta">{meters(point.alt_m)}</div>
                        <div><span className="pill">{point.classification}</span></div>
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
