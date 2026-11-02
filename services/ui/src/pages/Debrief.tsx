import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";

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
  portion_mark: string | null;
}

interface Cue {
  time_us: number;
  kind: string;
  label?: string;
  tail?: string;
}

type ExportFormat = "csv" | "pdf" | "xapi";

interface ExportResult {
  banner?: string;
  body?: string | { actor?: { name?: string } };
  pdf_base64?: string;
}

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

function columnLabel(state: string): string {
  return COLUMNS.find((column) => column.state === state)?.label ?? state;
}

function pillClass(state: string): string {
  if (COLUMNS.some((column) => column.state === state)) return `pill pill-${state}`;
  return "pill";
}

function cueLabel(kind: string): string {
  if (kind === "telemetry") return "Position report";
  if (kind === "track") return "Sensor custody";
  if (kind === "klv") return "Sensor frame";
  if (kind === "transit") return "Transit";
  if (kind === "search") return "Search";
  if (kind === "rtb") return "Return to base";
  return kind;
}

function clock(timeUs: number): string {
  const safe = Number.isFinite(timeUs) && timeUs > 0 ? Math.floor(timeUs) : 0;
  const seconds = Math.floor(safe / 1_000_000);
  const millis = Math.floor((safe % 1_000_000) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(millis, 3)}`;
}

function isFormat(value: string): value is ExportFormat {
  return value === "csv" || value === "pdf" || value === "xapi";
}

function actorName(body: ExportResult["body"]): string | null {
  if (typeof body !== "object" || body === null) return null;
  const name = body.actor?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function faultSentence(error: unknown, denied: string, fallback: string): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "two_person_required") return "A different person has to approve this plan.";
  if (code === "role_denied") return denied;
  if (code === "format_unavailable") return "That release format is not available.";
  return fallback;
}

function describeExport(format: ExportFormat, payload: ExportResult, viewerName: string): string {
  if (format === "csv") {
    const text = typeof payload.body === "string" ? payload.body : "";
    if (text.trim() === "") return "Nothing was released. The log has no entries.";
    const count = text.trim().split("\n").length - 1;
    return count === 1 ? "Released 1 row as CSV." : `Released ${count} rows as CSV.`;
  }
  if (format === "pdf") {
    return payload.pdf_base64 ? "Prepared a one-page PDF of this debrief." : "The PDF release did not include a document.";
  }
  const actor = actorName(payload.body) ?? viewerName;
  return `Recorded that ${actor} debriefed this mission.`;
}

export function DebriefPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (b: string) => void }) {
  const reportBanner = useRef(onBanner);
  reportBanner.current = onBanner;
  const replayGen = useRef(0);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [missionId, setMissionId] = useState(() => {
    const handed = sessionStorage.getItem("a2e-debrief-mission");
    if (handed && handed.trim().length > 0) {
      sessionStorage.removeItem("a2e-debrief-mission");
      return handed.trim();
    }
    return "";
  });
  const [timeline, setTimeline] = useState<Cue[]>([]);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [outcome, setOutcome] = useState("");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = missions.find((item) => item.id === missionId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await api<{ items: MissionRow[] }>("/v1/missions");
        if (cancelled) return;
        reportBanner.current(listed.banner);
        setMissions(listed.body.items);
        setMissionId((current) => {
          if (current && listed.body.items.some((item) => item.id === current)) return current;
          return listed.body.items[0]?.id ?? "";
        });
      } catch (error) {
        if (!cancelled) setFault(faultSentence(error, "Your role cannot read these plans.", "The plans could not be loaded."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer.id]);

  useEffect(() => {
    const mission = missions.find((item) => item.id === missionId);
    if (!mission) {
      setTimeline([]);
      return;
    }
    const gen = replayGen.current + 1;
    replayGen.current = gen;
    let cancelled = false;
    setOutcome("");
    void (async () => {
      try {
        const result = await api<{ cues: Cue[] }>(`/v1/missions/${encodeURIComponent(mission.id)}/debrief`);
        if (cancelled || replayGen.current !== gen) return;
        reportBanner.current(result.banner);
        setFault("");
        setTimeline(result.body.cues);
      } catch (error) {
        if (!cancelled && replayGen.current === gen) {
          setTimeline([]);
          setFault(faultSentence(error, "Your role cannot open this flight log.", "The flight log could not be opened."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId, missions]);

  async function onExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFault("");
    setOutcome("");
    const rows = timeline.map((cue) => {
      const row: Record<string, string | number> = {
        time: clock(cue.time_us),
        event: cueLabel(cue.kind),
      };
      if (selected) {
        row.mission_id = selected.id;
        row.mission_name = selected.name;
      }
      return row;
    });
    setBusy(true);
    try {
      const result = await api<ExportResult>("/v1/debrief/export", {
        method: "POST",
        body: JSON.stringify({ format, rows }),
      });
      reportBanner.current(result.banner);
      setOutcome(describeExport(format, result.body, viewer.display_name || viewer.username));
    } catch (error) {
      setFault(faultSentence(error, "Your role cannot release this debrief.", "The debrief could not be released."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page-fill">
      <header className="page-head">
        <div>
          <p className="kicker">Plan</p>
          <h1 className="page-title">Debrief</h1>
          <p className="lede">Choose a plan to replay its sequence as a flight log.</p>
        </div>
      </header>
      {fault ? (
        <p className="fault" role="alert">
          {fault}
        </p>
      ) : null}
      <div className="split">
        <section className="panel">
          <header className="panel-head">
            <h2>Plans</h2>
          </header>
          {missions.length === 0 ? (
            <p className="empty">No plans to open.</p>
          ) : (
            missions.map((mission) => (
              <button
                key={mission.id}
                type="button"
                className={mission.id === missionId ? "ticket is-selected" : "ticket"}
                aria-pressed={mission.id === missionId}
                onClick={() => setMissionId(mission.id)}
              >
                <strong>{mission.name}</strong>
                <span className={pillClass(mission.state)}>{columnLabel(mission.state)}</span>
                <p style={summaryClamp}>{mission.summary?.trim() ? mission.summary : "No summary."}</p>
              </button>
            ))
          )}
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>{selected ? selected.name : "Flight log"}</h2>
            {selected ? <span className={pillClass(selected.state)}>{columnLabel(selected.state)}</span> : null}
          </header>
          {selected ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                sessionStorage.setItem("a2e-mission-id", selected.id);
                window.location.hash = "missions";
              }}
            >
              Open the plan
            </button>
          ) : null}
          {selected && timeline.length === 0 ? <p className="empty">Nothing to replay.</p> : null}
          {!selected ? <p className="empty">Choose a plan.</p> : null}
          {timeline.length > 0 ? (
            <ol className="log-rail">
              {timeline.map((cue, index) => (
                <li key={`${cue.time_us}-${cue.kind}-${index}`}>
                  <span className="log-time">{clock(cue.time_us)}</span>
                  <span className="log-body">
                    <strong>{cue.tail && cue.tail.trim().length > 0 ? cue.tail : "Plan"}</strong>
                    <span>{cueLabel(cue.kind)}</span>
                    {cue.label ? <span className="meta">{cue.label}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <form onSubmit={(event) => void onExport(event)}>
            <div className="field">
              <label htmlFor="export-format">Format</label>
              <select
                id="export-format"
                value={format}
                onChange={(event) => {
                  if (isFormat(event.target.value)) setFormat(event.target.value);
                }}
              >
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
                <option value="xapi">xAPI statement</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || !selected}>
              Release debrief
            </button>
            {outcome ? <p>{outcome}</p> : null}
          </form>
        </section>
      </div>
    </section>
  );
}
