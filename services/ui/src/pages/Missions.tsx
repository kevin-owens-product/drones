import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { MissionRoute } from "./MissionRoute";
import { RangeMap, colorFor, toMetres, type MapPath, type RangeFrame } from "./RangeMap";
import "./plan.css";

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
  tails?: string[];
  planned_start?: string | null;
  created_by?: string;
  approved_by?: string | null;
  go?: boolean | null;
  no_go?: number;
  cautions?: number;
  source?: string | null;
}

interface Check {
  pass: boolean;
  detail: string;
  level?: "go" | "caution" | "no-go";
  area?: string;
}

interface HistoryStep {
  action: string;
  by: string;
  at: string;
  note: string;
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

const KIND_FILL: Record<string, string> = { transit: "#8eb4ff", search: "#3fd69a", sensor_custody: "#b6a5ff", loiter: "#5cc8ff", rtb: "#5b6775" };

const ACTION_LABEL: Record<string, string> = {
  "mission.draft": "Drafted",
  "mission.review": "Sent for review",
  "mission.approve": "Approved",
  "mission.execute": "Launched",
  "mission.close": "Closed",
};

function when(iso: string | null | undefined): string {
  if (!iso) return "not set";
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - Date.now()) / 60_000);
  const rel = Math.abs(mins) < 90 ? `${Math.abs(mins)} min` : Math.abs(mins) < 48 * 60 ? `${Math.round(Math.abs(mins) / 60)} h` : `${Math.round(Math.abs(mins) / 1440)} d`;
  return `${d.toISOString().slice(5, 16).replace("T", " ")}Z (${mins >= 0 ? "in " : ""}${rel}${mins < 0 ? " ago" : ""})`;
}

function Schedule({ objectives, tails }: { objectives: Objective[]; tails: string[] }) {
  if (objectives.length === 0) return null;
  const end = Math.max(...objectives.map((o) => o.offset_min + o.duration_min), 10);
  const W = 1000;
  const left = 64;
  const row = 20;
  const H = tails.length * row + 22;
  const sx = (m: number) => left + ((W - left - 10) * m) / end;
  return (
    <svg className="ms-gantt" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Schedule: what each vehicle does after H-hour">
      {tails.map((tail, i) => (
        <g key={tail}>
          <text x={4} y={6 + i * row + 12} className="ms-g-tail" style={{ fill: colorFor(tails, tail) }}>
            {tail}
          </text>
          {objectives
            .filter((o) => o.tail === tail)
            .map((o, k) => (
              <rect key={k} x={sx(o.offset_min)} y={6 + i * row + 2} width={Math.max(3, sx(o.offset_min + o.duration_min) - sx(o.offset_min))} height={row - 6} fill={KIND_FILL[o.kind] ?? "#5cc8ff"} opacity={0.75}>
                <title>
                  {tail}: {OBJECTIVE_KINDS.find((x) => x[0] === o.kind)?.[1]} {o.label}, T+{o.offset_min} for {o.duration_min} min
                </title>
              </rect>
            ))}
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={sx(f * end)} y={H - 3} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>
          T+{Math.round(f * end)} min
        </text>
      ))}
    </svg>
  );
}

export function MissionsPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const reportBanner = useRef(onBanner);
  reportBanner.current = onBanner;
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [range, setRange] = useState<RangeFrame | null>(null);
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
  const [keepoutRadius, setKeepoutRadius] = useState("0.3");
  const [keepoutFloor, setKeepoutFloor] = useState("0");
  const [keepoutCeiling, setKeepoutCeiling] = useState("120");
  const [objectiveKind, setObjectiveKind] = useState<ObjectiveKind>("loiter");
  const [objectiveLabel, setObjectiveLabel] = useState("");
  const [objectiveLat, setObjectiveLat] = useState("35.7342");
  const [objectiveLon, setObjectiveLon] = useState("-120.7577");
  const [objectiveAlt, setObjectiveAlt] = useState("110");
  const [objectiveTail, setObjectiveTail] = useState("NX-10");
  const [objectiveOffset, setObjectiveOffset] = useState("0");
  const [objectiveDuration, setObjectiveDuration] = useState("20");
  const [hHour, setHHour] = useState("");
  const [checks, setChecks] = useState<Check[]>([]);
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadMissions(): Promise<MissionRow[]> {
    const listed = await api<{ items: MissionRow[]; range?: RangeFrame | null }>("/v1/missions");
    reportBanner.current(listed.banner);
    setMissions(listed.body.items);
    if (listed.body.range) setRange(listed.body.range);
    return listed.body.items;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await loadMissions();
        if (cancelled) return;
        const handed = sessionStorage.getItem("a2e-mission-id");
        const first = items.find((m) => m.id === handed) ?? items.find((m) => m.state === "review") ?? items.find((m) => m.state === "active") ?? items[0];
        if (handed) sessionStorage.removeItem("a2e-mission-id");
        if (first) choose(first);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        body: JSON.stringify({ tenant_id: tenantId, name: trimmed, summary: summary.trim() }),
      });
      reportBanner.current(created.banner);
      setName("");
      setSummary("");
      setComposerOpen(false);
      const items = await loadMissions();
      const made = items.find((m) => m.id === created.body.id);
      if (made) choose(made);
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
      const result = await api<{ id: string; name: string; summary: string }>(`/v1/missions/${encodeURIComponent(mission.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: draftName.trim(), summary: draftSummary, planned_start: hHour ? new Date(hHour).toISOString() : null, planned_end: null }),
      });
      reportBanner.current(result.banner);
      await loadMissions();
      await loadObjectives(mission.id);
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

  async function loadObjectives(missionId: string) {
    try {
      const listed = await api<{ items: Partial<Objective>[]; keepouts?: unknown; planned_start: string | null }>(`/v1/missions/${encodeURIComponent(missionId)}/objectives`);
      reportBanner.current(listed.banner);
      setHHour(listed.body.planned_start ? toLocalInput(listed.body.planned_start) : "");
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
      const ready = await api<{ go: boolean; checks: Check[] }>(`/v1/missions/${encodeURIComponent(missionId)}/readiness`);
      reportBanner.current(ready.banner);
      setChecks(ready.body.checks);
    } catch (error) {
      setObjectives([]);
      setKeepouts([]);
      setFault(faultSentence(error, "load"));
    }
    try {
      const h = await api<{ items: HistoryStep[] }>(`/v1/missions/${encodeURIComponent(missionId)}/history`);
      setHistory(Array.isArray(h.body.items) ? h.body.items : []);
    } catch {
      setHistory([]);
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
    const zoneName = keepoutName.trim();
    const lat = Number(keepoutLat);
    const lon = Number(keepoutLon);
    const radius = Number(keepoutRadius);
    const floor = Number(keepoutFloor);
    const ceiling = Number(keepoutCeiling);
    if (!zoneName) {
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
    setKeepouts((current) => [...current, { name: zoneName, lat, lon, radius_km: radius, floor_m: floor, ceiling_m: ceiling }]);
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
      await loadMissions();
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
      const result = await api<{ id: string; state: string }>(`/v1/missions/${encodeURIComponent(mission.id)}/transition`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      reportBanner.current(result.banner);
      await loadMissions();
      await loadObjectives(mission.id);
      if (result.body.state === "active") {
        const tail = objectives.map((item) => item.tail.trim()).find((item) => item.length > 0);
        if (tail) sessionStorage.setItem("a2e-live-tail", tail);
      }
    } catch (error) {
      setFault(faultSentence(error, "move"));
      await loadObjectives(mission.id).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const selected = missions.find((item) => item.id === selectedId) ?? null;
  const selectedStep = selected ? nextStep(selected.state) : null;
  const tails = [...new Set(objectives.map((o) => o.tail).filter(Boolean))];
  const frame = range?.frame;
  const inRange =
    !!range?.basemap &&
    objectives.every((o) => {
      const [x, y] = toMetres(frame, o.lat, o.lon);
      const bm = range.basemap!;
      return x >= bm.west && x <= bm.east && y >= bm.south && y <= bm.north;
    });
  const planPaths: MapPath[] = range
    ? tails.map((tail) => ({
        id: tail,
        color: colorFor(tails, tail),
        pts: [
          [range.station.x, range.station.y] as [number, number],
          ...objectives
            .filter((o) => o.tail === tail)
            .sort((a, b) => a.offset_min - b.offset_min)
            .map((o) => toMetres(frame, o.lat, o.lon)),
        ],
        dashed: selected?.state !== "active" && selected?.state !== "closed",
      }))
    : [];
  const nogo = checks.filter((c) => (c.level ? c.level === "no-go" : !c.pass));
  const caution = checks.filter((c) => c.level === "caution");
  const stepAllowed = selectedStep ? roleCan(viewer.roles, selectedStep.action) : false;
  // Editing a draft is the planner's job; everyone else reads it.
  const canEdit = ["planner", "mission_commander", "admin"].some((role) => viewer.roles.includes(role));
  const blockedByChecks = selected?.state === "approved" && nogo.length > 0;

  return (
    <section className="page ins-page ms-page" data-testid="missions">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Missions</h1>
          <p className="lede">A plan is an ordered set of objectives for named vehicles. Launch checks say what blocks it and why; a different person approves it, and a behavior never can. Moving a plan here commands no vehicle.</p>
        </div>
        <div className="actions">
          <span className="pill pill-warn">SIM PLANS</span>
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
      {composerOpen ? (
        <form className="panel" id="mission-create" onSubmit={(event) => void onCreate(event)}>
          <div className="panel-head">
            <h2>New plan</h2>
            <span className="meta">{tenantId ? "Filing on your team." : "No home team is available for this account."}</span>
          </div>
          <div className="ms-editor">
            <div className="field">
              <label htmlFor="mission-name">Name</label>
              <input id="mission-name" value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="mission-summary">Summary</label>
              <input id="mission-summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || tenantId === null}>
              Create plan
            </button>
          </div>
        </form>
      ) : null}
      <div className="ms-board">
        {COLUMNS.map((column) => {
          const cards = missions.filter((mission) => mission.state === column.state);
          return (
            <section className="panel ms-col" key={column.state} aria-label={column.label}>
              <p className="kicker">
                {column.label} · {cards.length}
              </p>
              {cards.length === 0 ? (
                <p className="empty">None</p>
              ) : (
                cards.map((mission) => (
                  <button key={mission.id} type="button" className={mission.id === selectedId ? "ticket is-selected" : "ticket"} aria-pressed={mission.id === selectedId} onClick={() => choose(mission)}>
                    <strong>{mission.name}</strong>
                    <p style={summaryClamp} className="meta">
                      {mission.summary?.trim() ? mission.summary : "No summary."}
                    </p>
                    {mission.tails?.length ? (
                      <span className="ms-tails">
                        {mission.tails.map((t) => (
                          <span key={t} className="ms-tail">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="meta">
                      {mission.id} · {mission.state === "closed" || mission.state === "active" ? "Flown " : "H-hour "}
                      {when(mission.planned_start)}
                    </span>
                    {mission.go === false ? (
                      <span className="ms-ready is-nogo">No-go: {mission.no_go} blocking</span>
                    ) : mission.go === true ? (
                      <span className={mission.cautions ? "ms-ready is-caution" : "ms-ready is-go"}>Go{mission.cautions ? ` with ${mission.cautions} caution${mission.cautions > 1 ? "s" : ""}` : ""}</span>
                    ) : null}
                    {mission.source && !(mission.summary ?? "").includes(mission.source) ? <span className="meta">From Brief {mission.source}</span> : null}
                  </button>
                ))
              )}
            </section>
          );
        })}
      </div>

      {selected ? (
        <div className="ms-detail">
          <div className="ms-side">
            <section className="panel">
              <div className="panel-head">
                <h2>
                  {selected.name} <span className="meta mono">{selected.id}</span>
                </h2>
                <span className={pillClass(selected.state)}>{columnLabel(selected.state)}</span>
              </div>
              {range && inRange ? (
                <RangeMap
                  range={range}
                  paths={planPaths}
                  markers={tails.map((tail) => {
                    const last = objectives.filter((o) => o.tail === tail && o.kind !== "rtb").sort((a, b) => b.offset_min - a.offset_min)[0];
                    const [x, y] = last ? toMetres(frame, last.lat, last.lon) : [range.station.x, range.station.y];
                    return { id: tail, label: tail, x, y, color: colorFor(tails, tail) };
                  })}
                  keepouts={keepouts.map((k) => {
                    const [x, y] = toMetres(frame, k.lat, k.lon);
                    return { name: k.name, x, y, r: k.radius_km * 1000 };
                  })}
                  label="Plan map: each vehicle's route from the GCS, the jamming zone and keep-outs"
                />
              ) : (
                <div className="map-frame mission-route" style={{ height: 320 }}>
                  <MissionRoute
                    stops={objectives.map((objective) => ({ label: objective.label, kind: objective.kind, tail: objective.tail, lat: objective.lat, lon: objective.lon, offsetMin: objective.offset_min }))}
                    keepouts={keepouts.map((zone) => ({ name: zone.name, lat: zone.lat, lon: zone.lon, radiusKm: zone.radius_km }))}
                  />
                </div>
              )}
              <div className="pl-legend">
                {Object.entries(KIND_FILL).map(([k, c]) => (
                  <span key={k}>
                    <i style={{ background: c }} />
                    {OBJECTIVE_KINDS.find((x) => x[0] === k)?.[1]}
                  </span>
                ))}
              </div>
              <Schedule objectives={objectives} tails={tails} />
            </section>
            <section className="panel">
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
                      <strong style={{ color: colorFor(tails, objective.tail) }}>
                        {objective.tail || "Unassigned"} · {OBJECTIVE_KINDS.find((item) => item[0] === objective.kind)?.[1]}
                      </strong>
                      <span>{objective.label || "Untitled"}</span>
                      <span className="meta">
                        T+{String(Math.floor(objective.offset_min / 60)).padStart(2, "0")}:{String(objective.offset_min % 60).padStart(2, "0")} for {objective.duration_min} min · {objective.lat.toFixed(4)}, {objective.lon.toFixed(4)} · {Math.round(objective.alt_m)} m
                      </span>
                      {selected.state === "draft" && canEdit ? (
                        <span className="row-actions">
                          <button type="button" className="btn btn-quiet" disabled={index === 0} onClick={() => setObjectives((current) => moveObjective(current, index, -1))}>
                            Up
                          </button>
                          <button type="button" className="btn btn-quiet" disabled={index === objectives.length - 1} onClick={() => setObjectives((current) => moveObjective(current, index, 1))}>
                            Down
                          </button>
                          <button type="button" className="btn btn-quiet" onClick={() => setObjectives((current) => current.filter((_, item) => item !== index))}>
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {selected.state === "draft" && !canEdit ? <p className="meta">Editing a draft needs the planner, mission commander or admin role.</p> : null}
              {selected.state === "draft" && canEdit ? (
                <>
                  <p className="meta">Add an objective. The default point is the road junction; places on the range are in the map labels.</p>
                  <div className="ms-editor">
                    <div className="field">
                      <label htmlFor="objective-tail">Tail</label>
                      <input id="objective-tail" value={objectiveTail} maxLength={16} onChange={(event) => setObjectiveTail(event.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="objective-kind">Kind</label>
                      <select id="objective-kind" value={objectiveKind} onChange={(event) => setObjectiveKind(event.target.value as ObjectiveKind)}>
                        {OBJECTIVE_KINDS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="objective-label">Label</label>
                      <input id="objective-label" value={objectiveLabel} maxLength={80} onChange={(event) => setObjectiveLabel(event.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="objective-alt">Altitude m</label>
                      <input id="objective-alt" value={objectiveAlt} inputMode="decimal" onChange={(event) => setObjectiveAlt(event.target.value)} />
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
                  </div>
                  <div className="actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    <button type="button" className="btn btn-quiet" onClick={addObjective}>
                      Add objective
                    </button>
                  </div>
                  <div className="panel-head">
                    <h2>Keep-outs</h2>
                    <span className="meta">{keepouts.length}</span>
                  </div>
                  {keepouts.map((zone, index) => (
                    <p key={`${zone.name}-${index}`} className="meta">
                      <strong>{zone.name}</strong> {zone.lat.toFixed(4)}, {zone.lon.toFixed(4)} · {zone.radius_km} km · {Math.round(zone.floor_m)}–{Math.round(zone.ceiling_m)} m{" "}
                      <button type="button" className="btn btn-quiet" onClick={() => setKeepouts((current) => current.filter((_, item) => item !== index))}>
                        Remove
                      </button>
                    </p>
                  ))}
                  <div className="ms-editor">
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
                    <button type="button" className="btn btn-quiet" onClick={addKeepOut}>
                      Add keep-out
                    </button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveObjectives(selected)}>
                      Save objectives
                    </button>
                  </div>
                </>
              ) : keepouts.length ? (
                <p className="meta">Keep-outs: {keepouts.map((k) => `${k.name} (${k.radius_km} km, ${k.floor_m}–${k.ceiling_m} m)`).join("; ")}</p>
              ) : null}
            </section>
          </div>

          <div className="ms-side">
            <section className="panel">
              <div className="panel-head">
                <h2>Next step</h2>
                {selected.state === "active" || selected.state === "closed" ? (
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
                ) : null}
              </div>
              <p>{selected.summary?.trim() ? selected.summary : "No summary."}</p>
              <p className="meta">
                {selected.portion_mark?.trim() ? `${selected.portion_mark} · ` : ""}H-hour {when(selected.planned_start)}
              </p>
              {selectedStep ? (
                stepAllowed ? (
                  <>
                    <button type="button" className="btn btn-primary" disabled={busy || blockedByChecks} onClick={() => void onTransition(selected, selectedStep.action)}>
                      {selectedStep.label}
                    </button>
                    {blockedByChecks ? <p className="meta">Launch is blocked until the no-go checks below clear.</p> : null}
                    {selected.state === "review" && selected.created_by === viewer.display_name ? <p className="meta">You drafted this plan, so the two-person rule needs someone else to approve it.</p> : null}
                    {selected.state === "approved" ? <p className="meta">Launching hands the plan to the operators. The console monitors; it does not fly or arm anything.</p> : null}
                  </>
                ) : (
                  <p className="empty">
                    {selectedStep.label} needs the {selectedStep.action === "mission.approve" ? "mission commander or admin" : selectedStep.action === "mission.review" ? "planner, mission commander or admin" : "operator, mission commander or admin"} role.
                  </p>
                )
              ) : (
                <p className="empty">Closed. The replay is on Debrief.</p>
              )}
            </section>
            {selected.state !== "closed" && selected.state !== "active" ? (
              <section className="panel">
                <div className="panel-head">
                  <h2>Launch checks</h2>
                  <span className="ms-check-head">
                    <a
                      className="btn btn-quiet"
                      href="#physics"
                      onClick={() => {
                        try {
                          sessionStorage.setItem("a2e-physics-mission", selected.id);
                        } catch {
                          /* the check opens on its default plan */
                        }
                      }}
                    >
                      Physics check
                    </a>
                    <span className={nogo.length ? "pill pill-warn" : "pill pill-ok"}>{nogo.length ? `No-go · ${nogo.length}` : caution.length ? `Go · ${caution.length} caution` : "Go"}</span>
                  </span>
                </div>
                {checks.length === 0 ? (
                  <p className="empty">No launch check yet.</p>
                ) : (
                  <ul className="ms-checks">
                    {[...checks]
                      .sort((a, b) => ["no-go", "caution", "go"].indexOf(a.level ?? (a.pass ? "go" : "no-go")) - ["no-go", "caution", "go"].indexOf(b.level ?? (b.pass ? "go" : "no-go")))
                      .map((check) => {
                        const level = check.level ?? (check.pass ? "go" : "no-go");
                        return (
                          <li key={check.detail}>
                            <span className={`ms-lv ms-lv-${level}`}>{level}</span>
                            <span>{check.detail}</span>
                          </li>
                        );
                      })}
                  </ul>
                )}
                {checks.some((c) => c.area === "physics" && c.level !== "go") ? (
                  <p className="meta">
                    Terrain, cold-pack and thrust findings come from the <a href="#physics" onClick={() => sessionStorage.setItem("a2e-physics-mission", selected.id)}>physics check</a>, which has the fixes.
                  </p>
                ) : null}
                {checks.some((c) => /held lot|ESC-2611/.test(c.detail)) ? (
                  <p className="meta">
                    Lot status comes from <a href="#attrition">Attrition</a>; airworthiness from <a href="#fleet">Fleet</a>.
                  </p>
                ) : null}
              </section>
            ) : null}
            <section className="panel">
              <div className="panel-head">
                <h2>Approval chain</h2>
              </div>
              {history.length === 0 ? (
                <p className="empty">No history recorded.</p>
              ) : (
                <ol className="ms-chain">
                  {history.map((h, i) => (
                    <li key={i}>
                      <span className={h.note.startsWith("Refused") ? "ms-dot is-deny" : "ms-dot"} />
                      <span>
                        <strong>{h.note.startsWith("Refused") ? "Refused" : (ACTION_LABEL[h.action] ?? h.action)}</strong> by {h.by} · <span className="meta">{when(h.at)}</span>
                        {h.note ? <span className="meta"> · {h.note}</span> : null}
                      </span>
                    </li>
                  ))}
                  {selectedStep ? (
                    <li>
                      <span className="ms-dot is-next" />
                      <span className="meta">Next: {selectedStep.label.toLowerCase()}</span>
                    </li>
                  ) : null}
                </ol>
              )}
              <p className="meta">
                Every step and every refusal is in the <a href="#audit">Audit log</a>.
              </p>
            </section>
            {selected.state === "draft" && canEdit ? (
              <form
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSave(selected);
                }}
              >
                <div className="panel-head">
                  <h2>Edit draft</h2>
                </div>
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
            ) : null}
          </div>
        </div>
      ) : (
        <p className="empty">Select a plan.</p>
      )}
    </section>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
