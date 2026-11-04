import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { planLabel, type PlanAssignment } from "../plans";
import { can, inCustomerView } from "../shell/workspace";
import { Donut, TileGrid, type Tone } from "../viz/viz";

interface Viewer {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
  org?: string;
}

interface Platform {
  id: string;
  tail_number: string;
  designation: string;
  group_size: string;
  portion_mark: string;
  airworthiness: string;
  airworthiness_reason?: string | null;
  /** Set when the last work order on this tail closed and it flies again. */
  service_note?: string | null;
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
  const [statusPick, setStatusPick] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [births, setBirths] = useState<BirthRow[] | null>(null);
  const [alerts, setAlerts] = useState<QualityAlert[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [plans, setPlans] = useState<PlanAssignment[]>([]);
  const [recordsFault, setRecordsFault] = useState("");
  // Bumped after every change so the registry, holds and work orders reload from the one record.
  const [version, setVersion] = useState(0);
  const customer = inCustomerView(viewer);
  const canWrite = can(viewer, "fleet.write");

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
    };
  }, [version]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
  }, [version]);

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
      setExportResult(status === "airworthy" ? `${row.tail_number} is back in service.` : `${row.tail_number} is grounded.`);
      setVersion((v) => v + 1);
    } catch (error) {
      if (!mountedRef.current) return;
      setExportResult(messageOf(error, "status failed"));
      setExportIsFault(true);
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  }

  async function closeOrder(id: string) {
    setPendingId(id);
    setExportResult("");
    setExportIsFault(false);
    try {
      const result = await api<{ work_order: { tail: string } }>("/v1/maintenance/close", { method: "POST", body: JSON.stringify({ id }) });
      if (!mountedRef.current) return;
      onBanner(result.banner);
      setExportResult(`${id} closed; parts issued for ${result.body.work_order.tail}.`);
      setVersion((v) => v + 1);
    } catch (error) {
      if (!mountedRef.current) return;
      setExportResult(messageOf(error, "Could not close the work order."));
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
  const toneOf = (a: string): Tone => (a === "airworthy" ? "ok" : a === "restricted" ? "warn" : a === "grounded" ? "bad" : "muted");
  const states = ["airworthy", "restricted", "grounded", "unknown"];
  const slices = states.map((a) => ({ label: statusText(a), value: roster.filter((r) => r.airworthiness === a).length, tone: toneOf(a) })).filter((x) => x.value > 0);
  const ready = roster.filter((r) => r.airworthiness === "airworthy").length;
  const lotCarriers = roster.filter((r) => flaggedLot(birthOf(r.tail_number)) && r.airworthiness === "airworthy").length;

  return (
    <section className="page" data-testid="fleet">
      <header className="page-head">
        <div style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: "10px 16px" }}>
          <p className="kicker">Fleet</p>
          <h1 className="page-title">Airframes</h1>
          <p className="lede">Every airframe, why it can or can't fly, and the factory record behind that call.</p>
          <p className="meta">{accessLine(viewer)}</p>
        </div>
        <div className="actions">
          <p id="export-result" className={exportIsFault ? "fault" : "meta"}>{exportResult}</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {roster.length ? (
        <section className="panel fleet-glance" data-testid="fleet-glance">
          <div className="fleet-glance-ring">
            <Donut slices={slices} center={`${Math.round((ready / roster.length) * 100)}%`} sub="ready to fly" active={statusPick} onPick={setStatusPick} />
            <ul className="fleet-glance-key">
              {slices.map((x) => (
                <li key={x.label}>
                  <button type="button" className={statusPick === x.label ? "is-on" : undefined} onClick={() => setStatusPick(statusPick === x.label ? null : x.label)}>
                    <i className={`tone-${x.tone}`} /> <strong className="mono">{x.value}</strong> {x.label}
                  </button>
                </li>
              ))}
              {openOrders.length ? <li className="meta">{openOrders.length} open work order{openOrders.length === 1 ? "" : "s"}</li> : null}
              {lotCarriers ? <li className="fleet-glance-warn">{lotCarriers} flying on a flagged lot</li> : null}
            </ul>
          </div>
          <TileGrid
            picked={selectedId}
            onPick={setSelectedId}
            dim={(t) => statusPick !== null && t.group !== statusPick}
            tiles={roster.map((r) => {
              const lot = flaggedLot(birthOf(r.tail_number));
              const wo = openOrders.find((o) => o.tail_number === r.tail_number);
              return {
                id: r.id,
                title: r.tail_number,
                sub: [r.designation, wo ? wo.id : lot ? `lot ${lot.value}` : null].filter(Boolean).join(" · "),
                tone: r.airworthiness === "airworthy" && lot ? "warn" : toneOf(r.airworthiness),
                group: statusText(r.airworthiness),
                badge: r.airworthiness !== "airworthy" ? statusText(r.airworthiness) : lot ? "Flagged lot" : undefined,
                note: r.airworthiness_reason ?? r.service_note ?? (lot ? `Carries flagged lot ${lot.value}` : birthOf(r.tail_number)?.verdict.reason ?? undefined),
              };
            })}
          />
        </section>
      ) : null}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(row.id);
                    }
                  }}
                  tabIndex={0}
                  aria-selected={row.id === selectedId}
                >
                  <td>{row.tail_number}</td>
                  <td className="meta">{birthOf(row.tail_number)?.serial ?? "—"}</td>
                  <td>{row.designation}</td>
                  <td><span className={statusClass(row.airworthiness)}>{statusText(row.airworthiness)}</span></td>
                  <td className="meta">
                    {row.airworthiness_reason ?? row.service_note ?? (flaggedLot(birthOf(row.tail_number)) ? `Carries flagged lot ${flaggedLot(birthOf(row.tail_number))?.value}` : birthOf(row.tail_number)?.verdict.reason ?? "—")}
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
              {!selected.airworthiness_reason && selected.service_note ? <p className="meta">{selected.service_note}</p> : null}
              {(() => {
                const plan = plans.find((item) => item.tail_number === selected.tail_number);
                return plan ? <p><span className="pill pill-ok pill-plan">{planLabel(plan.state, plan.mission_name)}</span></p> : <p className="meta">Standby</p>;
              })()}
              {openMaintenance.map((item) => (
                <p key={item.id}>
                  <span className="pill pill-warn">{item.id} open</span> {item.summary}{" "}
                  {canWrite ? (
                    <button type="button" className="btn btn-quiet" disabled={pendingId !== null} onClick={() => void closeOrder(item.id)}>
                      Close work order
                    </button>
                  ) : null}
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
                            {customer ? part.lot : (
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
                            )}
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
                {customer ? null : (
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
                )}
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
              {canWrite ? (
                selected.airworthiness === "airworthy" ? (
                  <button type="button" className="btn btn-primary" disabled={pendingId !== null} onClick={() => void setAirworthiness(selected, "grounded")}>
                    Ground
                  </button>
                ) : openMaintenance.length > 0 ? (
                  <p className="meta" data-testid="rts-blocked">
                    Close {openMaintenance.map((item) => item.id).join(", ")} to return {selected.tail_number} to service.
                  </p>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={pendingId !== null} onClick={() => void setAirworthiness(selected, "airworthy")}>
                    Return to service
                  </button>
                )
              ) : (
                <p className="meta">Grounding and returning airframes needs the maintainer, mission commander or admin role.</p>
              )}
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
                    {a.ratio.toFixed(1)}x expected losses ({a.losses}), mostly {a.top_cause}.{" "}
                    {held
                      ? tails.length > 0
                        ? `${tails.join(", ")} restricted until the part is inspected and replaced.`
                        : "No airframe in this registry carries it."
                      : tails.length > 0
                        ? `${tails.join(", ")} in this registry ${tails.length === 1 ? "carries" : "carry"} it and ${tails.length === 1 ? "is" : "are"} still flying.`
                        : `${a.in_service_count} airframes from it are still in service.`}
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
                <strong>{item.tail_number} · {item.id}</strong>
                <span className="meta">{item.summary}</span>
                {canWrite ? (
                  <button type="button" className="btn btn-quiet" disabled={pendingId !== null} onClick={() => void closeOrder(item.id)}>
                    Close work order
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
