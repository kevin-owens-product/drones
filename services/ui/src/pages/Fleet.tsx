import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { SpatialStage } from "../SpatialStage";
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

interface Platform {
  id: string;
  tail_number: string;
  designation: string;
  group_size: string;
  portion_mark: string;
  airworthiness: string;
  classification: string;
  home_station: string | null;
  owner_name: string | null;
}

function accessLine(viewer: Viewer): string {
  const programs = viewer.ntk_programs.join(", ");
  return [viewer.clearance, viewer.citizenship, programs].filter((part) => part.length > 0).join(" · ");
}

function groupText(groupSize: string): string {
  const number = /^group_(\d+)$/.exec(groupSize)?.[1];
  return number ?? groupSize;
}

function statusClass(airworthiness: string): string {
  if (airworthiness === "airworthy") return "pill pill-ok";
  if (airworthiness === "restricted" || airworthiness === "grounded") return "pill pill-warn";
  return "pill";
}

function statusText(airworthiness: string): string {
  if (airworthiness === "airworthy") return "Airworthy";
  if (airworthiness === "restricted") return "Restricted";
  if (airworthiness === "grounded") return "Grounded";
  if (airworthiness === "unknown") return "Unknown";
  return airworthiness;
}

function homeText(station: string | null): string {
  return station && station.trim().length > 0 ? station : "—";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

interface StationRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt_m: number;
  portion_mark: string;
}

function dockText(homeStation: string | null, stationList: StationRow[] | null): string {
  const named = (stationList ?? []).find((station) => station.name === homeStation);
  if (named) return named.name;
  return homeText(homeStation);
}

interface MaintenanceRow {
  id: string;
  tail_number: string;
  summary: string;
  status: string;
}

interface PayloadRow {
  id: string;
  name: string;
  kind: string;
  firmware: string;
  portion_mark: string;
}

export function FleetPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  const mountedRef = useRef(true);
  onBannerRef.current = onBanner;
  const [rows, setRows] = useState<Platform[] | null>(null);
  const [fault, setFault] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState("");
  const [exportIsFault, setExportIsFault] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[] | null>(null);
  const [sensors, setSensors] = useState<PayloadRow[] | null>(null);
  const [plans, setPlans] = useState<PlanAssignment[]>([]);
  const [recordsFault, setRecordsFault] = useState("");

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
        setFault(messageOf(error, "Could not load the fleet."));
      }
    }
    void loadFleet();
    return () => {
      stopped = true;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    async function loadRecords() {
      try {
        const [stationList, maintenanceList, sensorList] = await Promise.all([
          api<{ items: StationRow[] }>("/v1/ground-stations"),
          api<{ items: MaintenanceRow[] }>("/v1/maintenance"),
          api<{ items: PayloadRow[] }>("/v1/payloads"),
        ]);
        if (stopped) return;
        onBannerRef.current(sensorList.banner);
        setStations(Array.isArray(stationList.body.items) ? stationList.body.items : []);
        setMaintenance(Array.isArray(maintenanceList.body.items) ? maintenanceList.body.items : []);
        setSensors(Array.isArray(sensorList.body.items) ? sensorList.body.items : []);
        setRecordsFault("");
      } catch (error) {
        if (stopped) return;
        setStations([]);
        setMaintenance([]);
        setSensors([]);
        setRecordsFault(messageOf(error, "Could not load stations, maintenance, or sensors."));
      }
      try {
        const board = await api<{ items: PlanAssignment[] }>("/v1/operations/board");
        if (!stopped) setPlans(Array.isArray(board.body.items) ? board.body.items : []);
      } catch {
        if (!stopped) setPlans([]);
      }
    }
    void loadRecords();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const live = await api<{ items: LivePoint[] }>("/v1/telemetry/live");
        if (stopped) return;
        onBannerRef.current(live.banner);
        setPoints(Array.isArray(live.body.items) ? live.body.items : []);
      } catch {
        if (!stopped) setPoints([]);
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  async function setAirworthiness(row: Platform, status: string) {
    setPendingId(row.id);
    setExportResult("");
    setExportIsFault(false);
    try {
      const result = await api<{ airworthiness: string }>(`/v1/platforms/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ airworthiness: status }),
      });
      if (!mountedRef.current) return;
      onBanner(result.banner);
      setRows((current) => (current ?? []).map((item) => (item.id === row.id ? { ...item, airworthiness: status } : item)));
      setExportResult(`${row.tail_number} is ${status}`);
    } catch (error) {
      if (!mountedRef.current) return;
      setExportResult(messageOf(error, "status failed"));
      setExportIsFault(true);
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  }

  async function onExport(row: Platform) {
    if (pendingId !== null) return;
    setPendingId(row.id);
    setExportResult("");
    setExportIsFault(false);
    try {
      const result = await api<{ allowed: boolean }>("/v1/exports", {
        method: "POST",
        body: JSON.stringify({
          resource_type: "platform",
          resource_id: row.id,
          recipient_user_id: "22222222-2222-4222-8222-222222222202",
          purpose: "console self-check",
          format: "json",
        }),
      });
      if (!mountedRef.current) return;
      onBanner(result.banner);
      setExportResult(result.body.allowed ? `${row.tail_number} export allowed` : `${row.tail_number} export denied`);
      setExportIsFault(false);
    } catch (error) {
      if (!mountedRef.current) return;
      setExportResult(messageOf(error, "export failed"));
      setExportIsFault(true);
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  }

  useEffect(() => {
    const handed = sessionStorage.getItem("a2e-fleet-tail");
    if (!handed || rows === null) return;
    const match = rows.find((row) => row.tail_number === handed.trim());
    if (!match) return;
    sessionStorage.removeItem("a2e-fleet-tail");
    setSelectedId(match.id);
  }, [rows]);

  const roster = rows ?? [];
  const selected = roster.find((row) => row.id === selectedId) ?? null;
  const openMaintenance =
    selected === null
      ? []
      : (maintenance ?? []).filter((item) => item.tail_number === selected.tail_number && item.status === "open");

  return (
    <section className="page page-fill">
      <header className="page-head">
        <div style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: "10px 16px" }}>
          <p className="kicker">Operate</p>
          <h1 className="page-title">Registry</h1>
          <p className="meta">{accessLine(viewer)}</p>
        </div>
        <div className="actions">
          <p id="export-result" className={exportIsFault ? "fault" : "meta"}>{exportResult}</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <div className="stage">
        <SpatialStage
          points={points}
          linkNeighbors
          emphasis={roster.map((row) => row.tail_number)}
          onSelect={(tail) => {
            const match = roster.find((row) => row.tail_number === tail);
            if (match) setSelectedId(match.id);
          }}
        />
        <aside className="panel">
          {selected ? (
            <>
              <div className="panel-head">
                <h2>{selected.tail_number}</h2>
                <span className={statusClass(selected.airworthiness)}>{statusText(selected.airworthiness)}</span>
              </div>
              <p>{selected.designation}</p>
              <p className="meta">Group {groupText(selected.group_size)} · {homeText(selected.home_station)}</p>
              <p className="meta">Dock: {dockText(selected.home_station, stations)}</p>
              {(() => {
                const plan = plans.find((item) => item.tail_number === selected.tail_number);
                return plan ? <p><span className="pill pill-ok pill-plan">{planLabel(plan.state, plan.mission_name)}</span></p> : <p className="meta">Standby</p>;
              })()}
              {openMaintenance.map((item) => (
                <p key={item.id}>
                  <span className="pill pill-warn">Maintenance open</span> {item.summary}
                </p>
              ))}
              <p>{selected.portion_mark || "No portion mark."}</p>
              <button type="button" className="btn btn-quiet" disabled={pendingId !== null} onClick={() => void onExport(selected)}>
                Export
              </button>
              <div className="actions" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    sessionStorage.setItem("a2e-live-tail", selected.tail_number);
                    window.location.hash = "live";
                  }}
                >
                  Watch live
                </button>
                {(() => {
                  const plan = plans.find((item) => item.tail_number === selected.tail_number);
                  if (!plan) return null;
                  return (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => {
                        sessionStorage.setItem("a2e-mission-id", plan.mission_id);
                        window.location.hash = "missions";
                      }}
                    >
                      Open plan
                    </button>
                  );
                })()}
              </div>
              {viewer.roles.includes("maintainer") ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pendingId !== null}
                  onClick={() => void setAirworthiness(selected, selected.airworthiness === "airworthy" ? "grounded" : "airworthy")}
                >
                  {selected.airworthiness === "airworthy" ? "Ground" : "Return to service"}
                </button>
              ) : null}
            </>
          ) : (
            <p className="empty">Select a tail in the registry or on the range.</p>
          )}
        </aside>
      </div>
      <section className="panel fleet-table">
        <div className="table-wrap">
          <table id="fleet">
            <thead>
              <tr>
                <th scope="col">Tail</th>
                <th scope="col">Designation</th>
                <th scope="col">Group</th>
                <th scope="col">Portion</th>
                <th scope="col">Status</th>
                <th scope="col">Home</th>
                <th scope="col">Team</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selectedId ? "is-selected" : undefined}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>{row.tail_number}</td>
                  <td>{row.designation}</td>
                  <td>{groupText(row.group_size)}</td>
                  <td>{row.portion_mark ? <span className="pill">{row.portion_mark}</span> : "—"}</td>
                  <td><span className={statusClass(row.airworthiness)}>{statusText(row.airworthiness)}</span></td>
                  <td>{homeText(row.home_station)}</td>
                  <td>{row.owner_name && row.owner_name.trim().length > 0 ? row.owner_name : <span className="meta">Shared</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {recordsFault ? <p className="fault" role="alert">{recordsFault}</p> : null}
      <section className="panel">
        <header className="panel-head"><h2>Ground stations</h2></header>
        {stations === null ? <p className="meta">Loading ground stations.</p> : null}
        {stations !== null && stations.length === 0 ? <p className="empty">No ground stations in this view.</p> : null}
        {stations !== null && stations.length > 0 ? (
          <ul className="objective-list">
            {stations.map((station) => (
              <li key={station.id}>
                <strong>{station.name}</strong>
                <span className="meta">{station.lat.toFixed(2)}, {station.lon.toFixed(2)} · {Math.round(station.alt_m)} m{station.portion_mark ? ` · ${station.portion_mark}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="panel">
        <header className="panel-head"><h2>Maintenance</h2></header>
        {maintenance === null ? <p className="meta">Loading maintenance.</p> : null}
        {maintenance !== null && maintenance.length === 0 ? <p className="empty">No open maintenance.</p> : null}
        {maintenance !== null && maintenance.length > 0 ? (
          <ul className="objective-list">
            {maintenance.map((item) => (
              <li key={item.id}>
                <strong>{item.tail_number}</strong>
                <span className="meta">{item.summary} · {item.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="panel">
        <header className="panel-head"><h2>Sensors</h2></header>
        {sensors === null ? <p className="meta">Loading sensors.</p> : null}
        {sensors !== null && sensors.length === 0 ? <p className="empty">No sensors in this view.</p> : null}
        {sensors !== null && sensors.length > 0 ? (
          <ul className="objective-list">
            {sensors.map((sensor) => (
              <li key={sensor.id}>
                <strong>{sensor.name}</strong>
                <span className="meta">{sensor.kind} · {sensor.firmware}{sensor.portion_mark ? ` · ${sensor.portion_mark}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
