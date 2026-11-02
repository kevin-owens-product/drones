import { useEffect, useRef, useState } from "react";
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

interface StreamRow {
  id: string;
  name: string;
  protocol: string;
  path: string;
  portion_mark: string;
}

interface StationRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface PlatformRow {
  id: string;
  tail_number: string;
  home_station: string | null;
  airworthiness: string;
  designation: string;
}

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : "";
}

function linkIsStale(time: string | undefined, now: number): boolean {
  if (typeof time !== "string" || time.length === 0) return true;
  const sent = Date.parse(time);
  if (Number.isNaN(sent)) return true;
  return now - sent > 20_000;
}

function openLive(tail: string) {
  sessionStorage.setItem("a2e-live-tail", tail);
  window.location.hash = "live";
}

export function VideoPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [live, setLive] = useState<LivePoint[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [site, setSite] = useState("all");
  const [showLabels, setShowLabels] = useState(true);
  const [plans, setPlans] = useState<PlanAssignment[]>([]);
  const [access, setAccess] = useState<"loading" | "open" | "limited" | "failed">("loading");
  void viewer;

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const [streamList, stationList, platformList] = await Promise.all([
          api<{ items: StreamRow[] }>("/v1/video/streams"),
          api<{ items: StationRow[] }>("/v1/ground-stations"),
          api<{ items: PlatformRow[] }>("/v1/platforms"),
        ]);
        if (stopped) return;
        onBannerRef.current(platformList.banner);
        setStreams(Array.isArray(streamList.body.items) ? streamList.body.items : []);
        setStations(Array.isArray(stationList.body.items) ? stationList.body.items : []);
        setPlatforms(Array.isArray(platformList.body.items) ? platformList.body.items : []);
        setAccess("open");
      } catch (error) {
        if (stopped) return;
        const code = codeOf(error);
        setAccess(code === "role_denied" || code === "denied" ? "limited" : "failed");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [viewer.id]);

  useEffect(() => {
    const handed = sessionStorage.getItem("a2e-video-site");
    if (handed && handed.trim().length > 0) {
      sessionStorage.removeItem("a2e-video-site");
      setSite(handed.trim());
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      setNow(Date.now());
      try {
        const result = await api<{ items: LivePoint[] }>("/v1/telemetry/live");
        if (stopped) return;
        setLive(Array.isArray(result.body.items) ? result.body.items : []);
      } catch {
        if (!stopped) setLive([]);
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
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
  }, [viewer.id]);

  const sites = ["all", ...stations.map((station) => station.name)];
  const docks = site === "all" ? stations : stations.filter((station) => station.name === site);
  const aircraft = platforms.filter((row) => site === "all" || row.home_station === site);
  const byTail = new Map(live.map((point) => [point.tail_number, point]));
  const planByTail = new Map(plans.map((plan) => [plan.tail_number, plan]));

  return (
    <section className="page page-fill" id="page-video">
      <header className="page-head">
        <div>
          <p className="kicker">Operate</p>
          <h1 className="page-title">Video wall</h1>
          <p className="lede">One view of every dock and registered aircraft. Tiles show status. They do not decode a picture.</p>
        </div>
        <div className="field" style={{ minWidth: "180px" }}>
          <label htmlFor="site-filter">Site</label>
          <select id="site-filter" value={site} onChange={(event) => setSite(event.target.value)}>
            {sites.map((name) => (
              <option key={name} value={name}>{name === "all" ? "All sites" : name}</option>
            ))}
          </select>
        </div>
        <button type="button" className={showLabels ? "btn btn-primary" : "btn"} onClick={() => setShowLabels((current) => !current)}>
          {showLabels ? "Labels on" : "Labels off"}
        </button>
      </header>
      {access === "limited" ? <div className="denied panel">Sensor streams are not available to this role.</div> : null}
      {access === "failed" ? <p className="fault" role="alert">The video wall could not be loaded.</p> : null}
      {access === "loading" ? <p className="meta">Loading docks and aircraft.</p> : null}
      {access === "open" ? (
        <div className="video-wall">
          {docks.map((station) => {
            const atDock = platforms.filter((row) => row.home_station === station.name).length;
            return (
              <article className="video-tile" key={station.id}>
                <p className="kicker">Dock</p>
                <h2>{station.name}</h2>
                <p className="meta">{station.lat.toFixed(2)}, {station.lon.toFixed(2)}</p>
                <p className="meta">{atDock.toLocaleString("en-US")} aircraft</p>
                <p className="empty">No dock picture.</p>
              </article>
            );
          })}
          {aircraft.map((row) => {
            const point = byTail.get(row.tail_number);
            const plan = planByTail.get(row.tail_number);
            const stale = point ? linkIsStale(point.time, now) : true;
            return (
              <button className="video-tile" key={row.id} type="button" onClick={() => openLive(row.tail_number)}>
                <p className="kicker">Aircraft</p>
                <h2>{row.tail_number}</h2>
                <p className="meta">{row.designation}</p>
                {plan ? <p><span className="pill pill-ok pill-plan">{planLabel(plan.state, plan.mission_name)}</span></p> : <p className="meta">Standby</p>}
                {showLabels ? (
                  <p>
                    <span className={stale ? "pill pill-warn" : "pill pill-ok"}>{point ? (stale ? "Link stale" : "Link") : "No track"}</span>
                    {row.airworthiness === "restricted" ? <span className="pill pill-warn"> Restricted</span> : null}
                    {point ? <span className="meta"> {Math.round(point.alt_m)} m</span> : null}
                  </p>
                ) : null}
                {point ? (
                  <div className="alt-meter" aria-hidden="true">
                    <span style={{ height: `${Math.min(100, Math.max(8, Math.round(point.alt_m / 4)))}%` }} />
                  </div>
                ) : null}
                <p className="empty">No aircraft picture.</p>
              </button>
            );
          })}
          {streams.map((stream) => (
            <article className="video-tile" key={stream.id}>
              <p className="kicker">{stream.protocol}</p>
              <h2>{stream.name}</h2>
              <p className="meta">{stream.path}</p>
              <p className="empty">Registered stream. Pixels are not decoded.</p>
            </article>
          ))}
          {docks.length === 0 && aircraft.length === 0 && streams.length === 0 ? (
            <p className="empty">No docks, aircraft, or streams in this site.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
