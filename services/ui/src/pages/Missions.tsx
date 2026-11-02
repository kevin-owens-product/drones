import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { MissionRoute } from "./MissionRoute";

interface Viewer {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
}

interface MissionRow {
  id: string;
  name: string;
  summary: string | null;
  state: string;
  tenant_id: string | null;
  classification: string | null;
  portion_mark: string | null;
}

interface TenantRow {
  id: string;
  level: string;
}

const OBJECTIVE_KINDS = [
  ["transit", "Transit"],
  ["search", "Search"],
  ["sensor_custody", "Sensor custody"],
  ["loiter", "Loiter"],
  ["rtb", "Return to base"],
] as const;

type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number][0];

interface Objective {
  kind: ObjectiveKind;
  label: string;
  tail: string;
  lat: number;
  lon: number;
  alt_m: number;
  offset_min: number;
  duration_min: number;
}

interface KeepOut {
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
  floor_m: number;
  ceiling_m: number;
}

interface Step {
  action: "mission.review" | "mission.approve" | "mission.execute";
  label: string;
}

const TEAM_NORTH = "11111111-1111-4111-8111-111111111104";

const DEMO_HOME_TEAM: Readonly<Record<string, string>> = {
  "ada.admin": TEAM_NORTH,
  "carl.commander": TEAM_NORTH,
  "priya.planner": TEAM_NORTH,
  "owen.operator": TEAM_NORTH,
  "gwen.analyst": TEAM_NORTH,
  gwen: TEAM_NORTH,
  "mike.maintainer": TEAM_NORTH,
  "audrey.auditor": TEAM_NORTH,
  "una.south": "11111111-1111-4111-8111-111111111105",
  "frank.falcon": "11111111-1111-4111-8111-111111111204",
};

const summaryClamp = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
} as const;

const COLUMNS: readonly { state: string; label: string }[] = [
  { state: "draft", label: "Draft" },
  { state: "review", label: "Review" },
  { state: "approved", label: "Approved" },
  { state: "active", label: "Active" },
  { state: "closed", label: "Closed" },
];

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readKeepOuts(value: unknown): KeepOut[] {
  if (!Array.isArray(value)) return [];
  const zones: KeepOut[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const lat = numeric(row.lat);
    const lon = numeric(row.lon);
    const radius = numeric(row.radius_km);
    const floor = numeric(row.floor_m);
    const ceiling = numeric(row.ceiling_m);
    if (lat === null || lon === null || radius === null || floor === null || ceiling === null) continue;
    zones.push({
      name: typeof row.name === "string" ? row.name : "",
      lat,
      lon,
      radius_km: radius,
      floor_m: floor,
      ceiling_m: ceiling,
    });
  }
  return zones;
}

function moveObjective(items: Objective[], index: number, delta: number): Objective[] {
  const next = index + delta;
  if (next < 0 || next >= items.length) return items;
  const copy = items.slice();
  const [item] = copy.splice(index, 1);
  if (!item) return items;
  copy.splice(next, 0, item);
  return copy;
}

function nextStep(state: string): Step | null {
  if (state === "draft") return { action: "mission.review", label: "Send for review" };
  if (state === "review") return { action: "mission.approve", label: "Approve" };
  if (state === "approved") return { action: "mission.execute", label: "Execute" };
  if (state === "active") return { action: "mission.execute", label: "Close" };
  return null;
}

function columnLabel(state: string): string {
  return COLUMNS.find((column) => column.state === state)?.label ?? state;
}

function roleCan(roles: readonly string[], action: Step["action"]): boolean {
  const allow: Record<Step["action"], readonly string[]> = {
    "mission.review": ["planner", "mission_commander", "admin"],
    "mission.approve": ["mission_commander", "admin"],
    "mission.execute": ["operator", "mission_commander", "admin"],
  };
  return allow[action].some((role) => roles.includes(role));
}

function pillClass(state: string): string {
  if (COLUMNS.some((column) => column.state === state)) return `pill pill-${state}`;
  return "pill";
}

function resolveTenant(viewer: Viewer, teams: readonly { id: string }[]): string | null {
  const known = DEMO_HOME_TEAM[viewer.username.trim().toLowerCase()];
  if (known !== undefined) return known;
  if (teams.length === 1) return teams[0]?.id ?? null;
  return null;
}

function faultSentence(error: unknown, intent: "draft" | "move" | "load" | "edit"): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "two_person_required") return "A different person has to approve this plan.";
  if (code === "role_denied") {
    if (intent === "draft") return "Your role cannot draft a plan.";
    if (intent === "edit") return "Your role cannot edit a draft.";
    if (intent === "load") return "Your role cannot read these plans.";
    return "Your role cannot take that step.";
  }
  if (code === "illegal_transition") return "That step is not available from this state.";
  if (code === "tail_not_airworthy") return "An assigned aircraft is not airworthy.";
  if (code === "tail_not_registered") return "Every tail on the package must be a registered aircraft.";
  if (code === "package_incomplete") return "Every aircraft needs a launch and a recovery.";
  if (code === "h_hour_set") return "Set an H-hour before launch.";
  if (code === "has_objectives" || code === "tail_missing") return "The package has no aircraft.";
  if (code === "not_approved") return "The package is not approved for launch.";
  if (code === "not_draft") return "Only a draft can be edited.";
  if (code === "not_found") return "That plan is no longer on the board.";
  if (intent === "draft") return "The plan could not be filed.";
  if (intent === "edit") return "The plan could not be saved.";
  if (intent === "load") return "The board could not be loaded.";
  return "The plan could not be moved.";
}

export function MissionsPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const reportBanner = useRef(onBanner);
  reportBanner.current = onBanner;
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [keepouts, setKeepouts] = useState<KeepOut[]>([]);
  const [keepoutName, setKeepoutName] = useState("");
  const [keepoutLat, setKeepoutLat] = useState("");
  const [keepoutLon, setKeepoutLon] = useState("");
  const [keepoutRadius, setKeepoutRadius] = useState("5");
  const [keepoutFloor, setKeepoutFloor] = useState("0");
  const [keepoutCeiling, setKeepoutCeiling] = useState("3000");
  const [objectiveKind, setObjectiveKind] = useState<ObjectiveKind>("transit");
  const [objectiveLabel, setObjectiveLabel] = useState("");
  const [objectiveLat, setObjectiveLat] = useState("");
  const [objectiveLon, setObjectiveLon] = useState("");
  const [objectiveAlt, setObjectiveAlt] = useState("120");
  const [objectiveTail, setObjectiveTail] = useState("N-002");
  const [objectiveOffset, setObjectiveOffset] = useState("0");
  const [objectiveDuration, setObjectiveDuration] = useState("60");
  const [hHour, setHHour] = useState("");
  const [checks, setChecks] = useState<{ pass: boolean; detail: string }[]>([]);
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadMissions(): Promise<void> {
    const listed = await api<{ items: MissionRow[] }>("/v1/missions");
    reportBanner.current(listed.banner);
    setMissions(listed.body.items);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await api<{ items: MissionRow[] }>("/v1/missions");
        if (cancelled) return;
        reportBanner.current(listed.banner);
        setMissions(listed.body.items);
      } catch (error) {
        if (!cancelled) setFault(faultSentence(error, "load"));
      }
      let teams: TenantRow[] = [];
      try {
        const org = await api<{ items: TenantRow[] }>("/v1/org");
        if (cancelled) return;
        reportBanner.current(org.banner);
        teams = org.body.items.filter((item) => item.level === "team");
      } catch {
        // Home team falls back to a known demo membership when org cannot be read.
      }
      if (!cancelled) setTenantId(resolveTenant(viewer, teams));
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer.username, viewer.display_name, viewer.id]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFault("");
    if (!tenantId) {
      setFault("No home team is available for this account.");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setFault("A plan needs a name.");
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string; state: string }>("/v1/missions", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          name: trimmed,
          summary: summary.trim(),
        }),
      });
      reportBanner.current(created.banner);
      setName("");
      setSummary("");
      setComposerOpen(false);
      setSelectedId(created.body.id);
      await loadMissions();
    } catch (error) {
      setFault(faultSentence(error, "draft"));
    } finally {
      setBusy(false);
    }
  }

  async function onSave(mission: MissionRow) {
    setFault("");
    setBusy(true);
    try {
      const result = await api<{ id: string; name: string; summary: string }>(
        `/v1/missions/${encodeURIComponent(mission.id)}`,
        { method: "PATCH", body: JSON.stringify({ name: draftName.trim(), summary: draftSummary, planned_start: hHour ? new Date(hHour).toISOString() : null, planned_end: null }) },
      );
      reportBanner.current(result.banner);
      await loadMissions();
    } catch (error) {
      setFault(faultSentence(error, "edit"));
    } finally {
      setBusy(false);
    }
  }

  function choose(mission: MissionRow) {
    setSelectedId(mission.id);
    setDraftName(mission.name);
    setDraftSummary(mission.summary ?? "");
    setComposerOpen(false);
    setFault("");
    void loadObjectives(mission.id);
  }

  useEffect(() => {
    const handed = sessionStorage.getItem("a2e-mission-id");
    if (!handed) return;
    const mission = missions.find((item) => item.id === handed);
    if (!mission) return;
    sessionStorage.removeItem("a2e-mission-id");
    choose(mission);
  }, [missions]);

  async function loadObjectives(missionId: string) {
    try {
      const listed = await api<{ items: Partial<Objective>[]; keepouts?: unknown; planned_start: string | null }>(
        `/v1/missions/${encodeURIComponent(missionId)}/objectives`,
      );
      reportBanner.current(listed.banner);
      setHHour(listed.body.planned_start ? listed.body.planned_start.slice(0, 16) : "");
      setKeepouts(readKeepOuts(listed.body.keepouts));
      const items = Array.isArray(listed.body.items) ? listed.body.items : [];
      setObjectives(
        items
          .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
          .map((item) => ({
            kind: (item.kind ?? "transit") as ObjectiveKind,
            label: item.label ?? "",
            tail: item.tail ?? "",
            lat: Number(item.lat),
            lon: Number(item.lon),
            alt_m: Number(item.alt_m ?? 120),
            offset_min: Number(item.offset_min ?? 0),
            duration_min: Number(item.duration_min ?? 30),
          })),
      );
      const ready = await api<{ go: boolean; checks: { pass: boolean; detail: string }[] }>(
        `/v1/missions/${encodeURIComponent(missionId)}/readiness`,
      );
      reportBanner.current(ready.banner);
      setChecks(ready.body.checks);
    } catch (error) {
      setObjectives([]);
      setKeepouts([]);
      setFault(faultSentence(error, "load"));
    }
  }

  function addObjective() {
    const lat = Number(objectiveLat);
    const lon = Number(objectiveLon);
    const alt = Number(objectiveAlt);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setFault("Each objective needs a latitude and longitude on the globe.");
      return;
    }
    const offset = Number(objectiveOffset);
    const duration = Number(objectiveDuration);
    if (!objectiveTail.trim()) {
      setFault("Each objective is flown by a tail.");
      return;
    }
    setFault("");
    setObjectives((current) => [
      ...current,
      {
        kind: objectiveKind,
        label: objectiveLabel.trim(),
        tail: objectiveTail.trim().toUpperCase(),
        lat,
        lon,
        alt_m: Number.isFinite(alt) ? alt : 120,
        offset_min: Number.isFinite(offset) && offset >= 0 ? offset : 0,
        duration_min: Number.isFinite(duration) && duration > 0 ? duration : 30,
      },
    ]);
    setObjectiveLabel("");
  }

  function addKeepOut() {
    const name = keepoutName.trim();
    const lat = Number(keepoutLat);
    const lon = Number(keepoutLon);
    const radius = Number(keepoutRadius);
    const floor = Number(keepoutFloor);
    const ceiling = Number(keepoutCeiling);
    if (!name) {
      setFault("A keep-out needs a name.");
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setFault("A keep-out needs a latitude and longitude on the globe.");
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0 || radius > 500) {
      setFault("A keep-out needs a radius up to 500 km.");
      return;
    }
    if (!Number.isFinite(floor) || !Number.isFinite(ceiling) || floor > ceiling) {
      setFault("The floor has to sit at or below the ceiling.");
      return;
    }
    if (keepouts.length >= 12) {
      setFault("A plan holds twelve keep-outs.");
      return;
    }
    setFault("");
    setKeepouts((current) => [
      ...current,
      { name, lat, lon, radius_km: radius, floor_m: floor, ceiling_m: ceiling },
    ]);
    setKeepoutName("");
  }

  async function saveObjectives(mission: MissionRow) {
    setFault("");
    setBusy(true);
    try {
      const result = await api<{ count: number }>(`/v1/missions/${encodeURIComponent(mission.id)}/objectives`, {
        method: "PUT",
        body: JSON.stringify({ objectives, keepouts }),
      });
      reportBanner.current(result.banner);
      await loadObjectives(mission.id);
    } catch (error) {
      setFault(faultSentence(error, "edit"));
    } finally {
      setBusy(false);
    }
  }

  async function onTransition(mission: MissionRow, action: Step["action"]) {
    setFault("");
    setBusy(true);
    try {
      const result = await api<{ id: string; state: string }>(
        `/v1/missions/${encodeURIComponent(mission.id)}/transition`,
        { method: "POST", body: JSON.stringify({ action }) },
      );
      reportBanner.current(result.banner);
      setMissions((current) =>
        current.map((item) => (item.id === result.body.id ? { ...item, state: result.body.state } : item)),
      );
      if (result.body.state === "active") {
        const tail = objectives.map((item) => item.tail.trim()).find((item) => item.length > 0);
        if (tail) sessionStorage.setItem("a2e-live-tail", tail);
        window.location.hash = "live";
      }
      await loadMissions();
    } catch (error) {
      setFault(faultSentence(error, "move"));
    } finally {
      setBusy(false);
    }
  }

  const selected = missions.find((item) => item.id === selectedId) ?? null;
  const selectedStep = selected ? nextStep(selected.state) : null;

  return (
    <section className="page page-fill">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Missions</h1>
          <p className="lede">A plan is an ordered set of objectives. A different person approves, and a behavior cannot.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-quiet" onClick={() => setComposerOpen((open) => !open)}>
            {composerOpen ? "Hide draft" : "New plan"}
          </button>
        </div>
      </header>
      {fault ? (
        <p className="fault" role="alert">
          {fault}
        </p>
      ) : null}
      <div className="stage mission-stage">
        <div className="board">
          {COLUMNS.map((column) => {
            const cards = missions.filter((mission) => mission.state === column.state);
            return (
              <section className="board-col" key={column.state} aria-label={column.label}>
                <p className="kicker">{column.label} · {cards.length}</p>
                {cards.length === 0 ? (
                  <p className="empty">None</p>
                ) : (
                  cards.map((mission) => (
                    <button
                      key={mission.id}
                      type="button"
                      className={mission.id === selectedId ? "ticket is-selected" : "ticket"}
                      aria-pressed={mission.id === selectedId}
                      onClick={() => choose(mission)}
                    >
                      <strong>{mission.name}</strong>
                      <span className={pillClass(mission.state)}>{columnLabel(mission.state)}</span>
                      <p style={summaryClamp}>{mission.summary?.trim() ? mission.summary : "No summary."}</p>
                    </button>
                  ))
                )}
              </section>
            );
          })}
        </div>
        <aside className="panel mission-editor">
          {composerOpen ? (
            <form id="mission-create" onSubmit={(event) => void onCreate(event)}>
              <div className="panel-head">
                <h2>New plan</h2>
              </div>
              <div className="field">
                <label htmlFor="mission-name">Name</label>
                <input
                  id="mission-name"
                  value={name}
                  maxLength={120}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="mission-summary">Summary</label>
                <textarea
                  id="mission-summary"
                  value={summary}
                  rows={3}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </div>
              <p>{tenantId ? "Filing on your team." : "No home team is available for this account."}</p>
              <button className="btn btn-primary" type="submit" disabled={busy || tenantId === null}>
                Create plan
              </button>
            </form>
          ) : selected ? (
            <>
              <div className="panel-head">
                <h2>{selected.name}</h2>
                <span className={pillClass(selected.state)}>{columnLabel(selected.state)}</span>
              </div>
              <p className="meta">{selected.portion_mark?.trim() ? selected.portion_mark : "No portion mark."}</p>
              <div className="actions" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    sessionStorage.setItem("a2e-debrief-mission", selected.id);
                    window.location.hash = "debrief";
                  }}
                >
                  Open debrief
                </button>
                {objectives.some((item) => item.tail.trim().length > 0) ? (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      const tail = objectives.map((item) => item.tail.trim()).find((item) => item.length > 0);
                      if (!tail) return;
                      sessionStorage.setItem("a2e-live-tail", tail);
                      window.location.hash = "live";
                    }}
                  >
                    Watch a tail
                  </button>
                ) : null}
              </div>
              {selected.state === "draft" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onSave(selected);
                  }}
                >
                  <div className="field">
                    <label htmlFor="edit-name">Name</label>
                    <input id="edit-name" value={draftName} maxLength={120} required onChange={(event) => setDraftName(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-summary">Summary</label>
                    <textarea id="edit-summary" rows={3} value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="h-hour">Launch (H-hour)</label>
                    <input id="h-hour" type="datetime-local" value={hHour} onChange={(event) => setHHour(event.target.value)} />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={busy || draftName.trim().length === 0}>
                    Save draft
                  </button>
                </form>
              ) : (
                <p>{selected.summary?.trim() ? selected.summary : "No summary."}</p>
              )}
              <div className="panel-head">
                <h2>Launch check</h2>
              </div>
              {checks.length === 0 ? <p className="empty">No launch check yet.</p> : (
                <ul className="objective-list">
                  {checks.map((check) => (
                    <li key={check.detail}>
                      <span className={check.pass ? "pill pill-ok" : "pill pill-warn"}>{check.pass ? "Go" : "No-go"}</span>
                      <span>{check.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="panel-head">
                <h2>Objectives</h2>
                <span className="meta">{objectives.length}</span>
              </div>
              {objectives.length === 0 ? (
                <p className="empty">No objectives yet.</p>
              ) : (
                <ol className="objective-list">
                  {objectives.map((objective, index) => (
                    <li key={`${objective.kind}-${index}`}>
                      <strong>{objective.tail || "Unassigned"} · {OBJECTIVE_KINDS.find((item) => item[0] === objective.kind)?.[1]}</strong>
                      <span>{objective.label || "Untitled"}</span>
                      <span className="meta">T+{String(Math.floor(objective.offset_min / 60)).padStart(2, "0")}:{String(objective.offset_min % 60).padStart(2, "0")} for {objective.duration_min} min · {objective.lat.toFixed(2)}, {objective.lon.toFixed(2)} · {Math.round(objective.alt_m)} m</span>
                      {selected.state === "draft" ? (
                        <span className="row-actions">
                          <button type="button" className="btn btn-quiet" disabled={index === 0} onClick={() => setObjectives((current) => moveObjective(current, index, -1))}>Up</button>
                          <button type="button" className="btn btn-quiet" disabled={index === objectives.length - 1} onClick={() => setObjectives((current) => moveObjective(current, index, 1))}>Down</button>
                          <button type="button" className="btn btn-quiet" onClick={() => setObjectives((current) => current.filter((_, item) => item !== index))}>Remove</button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {selected.state === "draft" ? (
                <div className="objective-form">
                  <div className="field">
                    <label htmlFor="objective-tail">Tail</label>
                    <input id="objective-tail" value={objectiveTail} maxLength={16} onChange={(event) => setObjectiveTail(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="objective-kind">Kind</label>
                    <select id="objective-kind" value={objectiveKind} onChange={(event) => setObjectiveKind(event.target.value as ObjectiveKind)}>
                      {OBJECTIVE_KINDS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="objective-label">Label</label>
                    <input id="objective-label" value={objectiveLabel} maxLength={80} onChange={(event) => setObjectiveLabel(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="objective-lat">Latitude</label>
                    <input id="objective-lat" value={objectiveLat} inputMode="decimal" onChange={(event) => setObjectiveLat(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="objective-lon">Longitude</label>
                    <input id="objective-lon" value={objectiveLon} inputMode="decimal" onChange={(event) => setObjectiveLon(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="objective-offset">Minutes after launch</label>
                    <input id="objective-offset" value={objectiveOffset} inputMode="numeric" onChange={(event) => setObjectiveOffset(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="objective-duration">Duration min</label>
                    <input id="objective-duration" value={objectiveDuration} inputMode="numeric" onChange={(event) => setObjectiveDuration(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="objective-alt">Altitude m</label>
                    <input id="objective-alt" value={objectiveAlt} inputMode="decimal" onChange={(event) => setObjectiveAlt(event.target.value)} />
                  </div>
                  <button type="button" className="btn btn-quiet" onClick={addObjective}>Add objective</button>
                </div>
              ) : null}
              <div className="panel-head">
                <h2>Keep-outs</h2>
                <span className="meta">{keepouts.length}</span>
              </div>
              {keepouts.length === 0 ? (
                <p className="empty">No keep-outs yet.</p>
              ) : (
                <ul className="objective-list">
                  {keepouts.map((zone, index) => (
                    <li key={`${zone.name}-${index}`}>
                      <strong>{zone.name || "Unnamed"}</strong>
                      <span className="meta">
                        {zone.lat.toFixed(2)}, {zone.lon.toFixed(2)} · {zone.radius_km} km · {Math.round(zone.floor_m)}–{Math.round(zone.ceiling_m)} m
                      </span>
                      {selected.state === "draft" ? (
                        <span className="row-actions">
                          <button type="button" className="btn btn-quiet" onClick={() => setKeepouts((current) => current.filter((_, item) => item !== index))}>Remove</button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {selected.state === "draft" ? (
                <div className="objective-form">
                  <div className="field">
                    <label htmlFor="keepout-name">Name</label>
                    <input id="keepout-name" value={keepoutName} maxLength={80} onChange={(event) => setKeepoutName(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="keepout-lat">Latitude</label>
                    <input id="keepout-lat" value={keepoutLat} inputMode="decimal" onChange={(event) => setKeepoutLat(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="keepout-lon">Longitude</label>
                    <input id="keepout-lon" value={keepoutLon} inputMode="decimal" onChange={(event) => setKeepoutLon(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="keepout-radius">Radius km</label>
                    <input id="keepout-radius" value={keepoutRadius} inputMode="decimal" onChange={(event) => setKeepoutRadius(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="keepout-floor">Floor m</label>
                    <input id="keepout-floor" value={keepoutFloor} inputMode="decimal" onChange={(event) => setKeepoutFloor(event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="keepout-ceiling">Ceiling m</label>
                    <input id="keepout-ceiling" value={keepoutCeiling} inputMode="decimal" onChange={(event) => setKeepoutCeiling(event.target.value)} />
                  </div>
                  <button type="button" className="btn btn-quiet" onClick={addKeepOut}>Add</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveObjectives(selected)}>Save objectives</button>
                </div>
              ) : null}
              {selectedStep && roleCan(viewer.roles, selectedStep.action) ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void onTransition(selected, selectedStep.action)}
                >
                  {selectedStep.label}
                </button>
              ) : (
                <p className="empty">No further step.</p>
              )}
            </>
          ) : (
            <p className="empty">Select a plan.</p>
          )}
        </aside>
        <div className="map-frame mission-route">
          <MissionRoute
            stops={objectives.map((objective) => ({ label: objective.label, kind: objective.kind, tail: objective.tail, lat: objective.lat, lon: objective.lon, offsetMin: objective.offset_min }))}
            keepouts={keepouts.map((zone) => ({ name: zone.name, lat: zone.lat, lon: zone.lon, radiusKm: zone.radius_km }))}
          />
        </div>
      </div>
    </section>
  );
}
