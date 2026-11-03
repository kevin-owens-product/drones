import { useEffect, useRef, useState } from "react";
import { api } from "../api";
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
  airworthiness_reason?: string | null;
  classification: string;
  home_station?: string | null;
  owner_name?: string | null;
}

/** Factory birth record, in the shape a2e.birth.from_dict reads, plus the verdict. */
interface BirthRow {
  serial: string;
  tail_number: string;
  parts: { part: string; lot: string }[];
  calibrations: { name: string; value: number; low: number; high: number }[];
  firmware_sha256: string;
  eol: { kind: string; passed: boolean; note: string };
  recorded_at: string;
  verdict: { status: string; reason: string };
}

interface QualityAlert {
  attribute: string;
  value: string;
  ratio: number;
  losses: number;
  in_service_count: number;
  top_cause: string;
  flagged: boolean;
}

interface Hold {
  attribute: string;
  value: string;
  serials: number;
  by: string;
  at: string;
}

/** Attrition reports lots as "esc_lot"; birth records name the part "esc". */
function partOf(attribute: string): string {
  return attribute.replace(/_lot$/, "").replaceAll("_", " ");
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

function homeText(station: string | null | undefined): string {
  return station && station.trim().length > 0 ? station : "—";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

interface MaintenanceRow {
  id: string;
  tail_number: string;
  summary: string;
  status: string;
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
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [births, setBirths] = useState<BirthRow[] | null>(null);
  const [alerts, setAlerts] = useState<QualityAlert[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
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
      // Each source is optional: a deployment without birth records or a baked
      // attrition report still shows the registry.
      const [births, maint, attr] = await Promise.allSettled([
        api<{ items: BirthRow[] }>("/v1/birth-records"),
        api<{ items: MaintenanceRow[] }>("/v1/maintenance"),
        api<{ autopsy?: { alerts?: QualityAlert[] }; holds?: Hold[] }>("/v1/attrition"),
      ]);
      if (stopped) return;
      setBirths(births.status === "fulfilled" && Array.isArray(births.value.body.items) ? births.value.body.items : []);
      setMaintenance(maint.status === "fulfilled" && Array.isArray(maint.value.body.items) ? maint.value.body.items : []);
      if (attr.status === "fulfilled") {
        setAlerts((attr.value.body.autopsy?.alerts ?? []).filter((a) => a.flagged));
        setHolds(attr.value.body.holds ?? []);
      }
      setRecordsFault(births.status === "rejected" && maint.status === "rejected" ? "Could not load birth records or maintenance." : "");
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
    selected === null ? [] : maintenance.filter((item) => item.tail_number === selected.tail_number && item.status === "open");
  const birthOf = (tail: string) => (births ?? []).find((b) => b.tail_number === tail) ?? null;
  const birth = selected ? birthOf(selected.tail_number) : null;
  const flaggedLot = (rec: BirthRow | null) =>
    rec ? alerts.find((a) => rec.parts.some((p) => p.part === partOf(a.attribute) && p.lot === a.value)) ?? null : null;
  const openOrders = maintenance.filter((item) => item.status === "open");

  return (
    <section className="page" data-testid="fleet">
      <header className="page-head">
        <div style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: "10px 16px" }}>
          <p className="kicker">Fleet</p>
          <h1 className="page-title">Fleet</h1>
          <p className="lede">Every airframe, why it can or can't fly, and the factory record behind that call.</p>
          <p className="meta">{accessLine(viewer)}</p>
        </div>
        <div className="actions">
          <p id="export-result" className={exportIsFault ? "fault" : "meta"}>{exportResult}</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <div className="fleet-grid">
      <section className="panel fleet-registry">
        <div className="table-wrap">
          <table id="fleet">
            <thead>
              <tr>
                <th scope="col">Tail</th>
                <th scope="col">Serial</th>
                <th scope="col">Designation</th>
                <th scope="col">Status</th>
                <th scope="col">Why</th>
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
                  <td className="meta">{birthOf(row.tail_number)?.serial ?? "—"}</td>
                  <td>{row.designation}</td>
                  <td><span className={statusClass(row.airworthiness)}>{statusText(row.airworthiness)}</span></td>
                  <td className="meta">
                    {row.airworthiness_reason ?? (flaggedLot(birthOf(row.tail_number)) ? `Carries flagged lot ${flaggedLot(birthOf(row.tail_number))?.value}` : birthOf(row.tail_number)?.verdict.reason ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
        <aside className="panel fleet-detail">
          {selected ? (
            <>
              <div className="panel-head">
                <h2>{selected.tail_number}</h2>
                <span className={statusClass(selected.airworthiness)}>{statusText(selected.airworthiness)}</span>
              </div>
              <p>{selected.designation}</p>
              <p className="meta">{groupText(selected.group_size)} · Home {homeText(selected.home_station)}</p>
              {selected.airworthiness_reason ? <p className="fault">{selected.airworthiness_reason}</p> : null}
              {(() => {
                const plan = plans.find((item) => item.tail_number === selected.tail_number);
                return plan ? <p><span className="pill pill-ok pill-plan">{planLabel(plan.state, plan.mission_name)}</span></p> : <p className="meta">Standby</p>;
              })()}
              {openMaintenance.map((item) => (
                <p key={item.id}>
                  <span className="pill pill-warn">Maintenance open</span> {item.summary}
                </p>
              ))}
              {birth ? (
                <div className="birth" data-testid="birth-record">
                  <h3>Birth record <span className="meta">{birth.serial}</span></h3>
                  <ul className="objective-list">
                    {birth.parts.map((part) => {
                      const flagged = alerts.find((a) => partOf(a.attribute) === part.part && a.value === part.lot);
                      return (
                        <li key={part.part}>
                          <strong>{part.part}</strong>
                          <span className="meta">
                            <a
                              href="#company"
                              title="Open this lot in Company, Supply chain"
                              onClick={() => {
                                try {
                                  sessionStorage.setItem("a2e-company-tab", "supply");
                                  sessionStorage.setItem("a2e-company-lot", part.lot);
                                } catch {
                                  /* the link still opens the page */
                                }
                              }}
                            >
                              {part.lot}
                            </a>
                            {flagged ? (
                              <>
                                {" "}
                                <span className="pill pill-warn">Flagged by Attrition</span>
                              </>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                    {birth.calibrations.map((cal) => {
                      const ok = cal.value >= cal.low && cal.value <= cal.high;
                      return (
                        <li key={cal.name}>
                          <strong>{cal.name} cal</strong>
                          <span className={ok ? "meta" : "fault"}>
                            {cal.value} (limit {cal.low} to {cal.high})
                          </span>
                        </li>
                      );
                    })}
                    <li>
                      <strong>EOL {birth.eol.kind} test</strong>
                      <span className={birth.eol.passed ? "meta" : "fault"}>{birth.eol.passed ? "Passed" : `Failed${birth.eol.note ? `: ${birth.eol.note}` : ""}`}</span>
                    </li>
                    <li>
                      <strong>Firmware</strong>
                      <span className="meta"><code title={birth.firmware_sha256}>{birth.firmware_sha256.slice(0, 12)}</code> · {birth.recorded_at.slice(0, 10)}</span>
                    </li>
                  </ul>
                </div>
              ) : births !== null ? (
                <p className="meta">No birth record for this tail.</p>
              ) : null}
              <div className="actions" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    sessionStorage.setItem("a2e-live-tail", selected.tail_number);
                    window.location.hash = "operate";
                  }}
                >
                  Watch live
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    try {
                      sessionStorage.setItem("a2e-company-tab", "overview");
                      sessionStorage.setItem("a2e-company-tail", selected.tail_number);
                    } catch {
                      /* the page opens on its default tail */
                    }
                    window.location.hash = "company";
                  }}
                >
                  Trace contract to field
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
            <p className="empty">Select a tail to see its birth record.</p>
          )}
        </aside>
      </div>
      {recordsFault ? <p className="fault" role="alert">{recordsFault}</p> : null}
      <section className="panel" data-testid="quality-holds">
        <header className="panel-head">
          <h2>Quality holds</h2>
          <a className="btn btn-quiet" href="#attrition">Open Attrition</a>
        </header>
        {alerts.length === 0 ? <p className="empty">No parts lot stands out in the loss data.</p> : null}
        {alerts.length > 0 ? (
          <ul className="objective-list">
            {alerts.map((a) => {
              const held = holds.find((h) => h.attribute === a.attribute && h.value === a.value);
              const tails = (births ?? []).filter((b) => b.parts.some((p) => p.part === partOf(a.attribute) && p.lot === a.value)).map((b) => b.tail_number);
              return (
                <li key={`${a.attribute}:${a.value}`}>
                  <strong>
                    {partOf(a.attribute).toUpperCase()} lot {a.value}{" "}
                    <span className={held ? "pill pill-ok" : "pill pill-warn"}>{held ? `Held by ${held.by}` : "Not held yet"}</span>
                  </strong>
                  <span className="meta">
                    {a.ratio.toFixed(1)}x expected losses ({a.losses}), mostly {a.top_cause}. {a.in_service_count} airframes from it still in service
                    {tails.length > 0 ? `, including ${tails.join(", ")} in this registry` : ""}.
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      {openOrders.length > 0 ? (
        <section className="panel">
          <header className="panel-head"><h2>Open maintenance</h2></header>
          <ul className="objective-list">
            {openOrders.map((item) => (
              <li key={item.id}>
                <strong>{item.tail_number}</strong>
                <span className="meta">{item.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
