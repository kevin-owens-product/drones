import { useState, type JSX } from "react";
import { liveCommand, liveSwarm, type LiveResult, type LiveSimPoint, type LiveSnapshot, type SwarmTask, type VehicleAction } from "../livesim";
import type { MapMark } from "./TacMap";
import { blocker, isGo, type Check } from "./readiness";

/** What a click on the map is for while picking. */
export type PickFor = { for: "formation" | "sweep" } | { for: "goto"; tail: string };

export type LiveStatus = "off" | "connecting" | "up" | "down";

type Log = (tail: string, level: "info" | "warn" | "alert", text: string) => void;

const SHAPES = [
  { id: "line", label: "Line abreast" },
  { id: "column", label: "Column" },
  { id: "wedge", label: "Wedge" },
  { id: "circle", label: "Circle" },
] as const;

function num(value: string, fallback: number, lo: number, hi: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

async function send(run: () => Promise<LiveResult>, log: Log, tail: string, label: string): Promise<LiveResult> {
  try {
    const out = await run();
    log(tail, out.ok ? "info" : "warn", `${label}: ${out.detail}`);
    return out;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "bridge did not answer";
    log(tail, "warn", `${label}: ${detail}`);
    return { ok: false, detail };
  }
}

/** Map overlays for the swarm's current task and a picked point. */
export function liveMarks(snap: LiveSnapshot | null, picked: [number, number] | null, selected: LiveSimPoint | null): MapMark[] {
  const out: MapMark[] = [];
  const s = snap?.swarm;
  if (s?.task === "sweep" && s.corners?.length) {
    out.push({ kind: "area", points: s.corners });
    for (const p of s.paths ?? []) out.push({ kind: "path", points: p.points });
  }
  if (s?.task === "formation") for (const slot of s.slots ?? []) out.push({ kind: "slot", points: [[slot.lat, slot.lon]], label: slot.tail });
  const goal = selected?.task?.kind === "goto" ? selected.task.goal : null;
  if (goal) out.push({ kind: "slot", points: [[goal[0], goal[1]]], label: "Goal" });
  if (picked) out.push({ kind: "pick", points: [picked], label: "Picked" });
  return out;
}

export function SwarmPanel(props: {
  base: string;
  status: LiveStatus;
  snap: LiveSnapshot | null;
  launch: ReadonlyMap<string, readonly Check[]>;
  canCommand: boolean;
  picking: PickFor | null;
  picked: [number, number] | null;
  onPicking: (p: PickFor | null) => void;
  onClearPick: () => void;
  scripted: boolean;
  onScripted: (on: boolean) => void;
  onOff: () => void;
  log: Log;
}): JSX.Element {
  const { base, status, snap, launch, canCommand, picked, log } = props;
  const [alt, setAlt] = useState("20");
  const [shape, setShape] = useState("line");
  const [spacing, setSpacing] = useState("15");
  const [heading, setHeading] = useState("0");
  const [width, setWidth] = useState("160");
  const [height, setHeight] = useState("120");
  const [lane, setLane] = useState("20");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const items = snap?.items ?? [];
  const air = items.filter((p) => p.armed && !p.landed);
  const ground = items.filter((p) => !p.armed);
  const go = ground.filter((p) => {
    const list = launch.get(p.tail_number);
    return list ? isGo(list) : false;
  });
  const noGo = ground.length - go.length;
  const sweeping = items.filter((p) => p.task?.kind === "sweep" && typeof p.task.progress === "number");
  const progress = sweeping.length ? Math.round(sweeping.reduce((a, p) => a + (p.task?.progress ?? 0), 0) / sweeping.length) : null;
  const why = canCommand ? null : "Your role cannot command vehicles";
  const at = picked ? { lat: picked[0], lon: picked[1] } : {};

  async function run(task: SwarmTask, label: string) {
    setBusy(true);
    setNote(`${label}…`);
    const out = await send(() => liveSwarm(base, task), log, "SWARM", label);
    setNote(out.ok ? `${label}: sent` : out.detail);
    setBusy(false);
  }

  if (status === "down" || status === "connecting") {
    return (
      <section className="live-panel" aria-label="Live sim">
        <header className="live-head">
          <strong>Live sim</strong>
          <span className="tag tag-warn">{status === "connecting" ? "CONNECTING" : "NO BRIDGE"}</span>
        </header>
        <p className="meta">
          {status === "connecting" ? `Looking for the bridge at ${base}.` : `No bridge at ${base}. Start the simulator with make swarm-up, then this page connects on its own.`}
        </p>
        <button type="button" className="btn btn-quiet" onClick={props.onOff}>Switch live sim off</button>
      </section>
    );
  }

  const task = snap?.swarm.task ?? "idle";
  return (
    <section className="live-panel" aria-label="Live sim swarm" data-testid="live-panel">
      <header className="live-head">
        <strong>Live sim swarm</strong>
        <span className="tag tag-go">PX4 · LIVE</span>
        <span className="meta">{items.length} on the bridge · {air.length} airborne</span>
      </header>
      <p className="meta live-task">
        {task === "idle" ? "No swarm task yet." : `Task: ${task}${snap?.swarm.shape ? ` (${snap.swarm.shape})` : ""}${progress !== null ? ` · ${progress}% swept` : ""}`}
      </p>

      <div className="live-row">
        <label>
          <span className="meta">Height</span>
          <input aria-label="Launch height in metres" inputMode="numeric" value={alt} onChange={(e) => setAlt(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !canCommand || go.length === 0}
          title={why ?? (go.length === 0 ? (ground.length ? "No vehicle on the ground passes its launch checks" : "Every vehicle is already up") : undefined)}
          onClick={() => void run({ task: "launch", alt_m: num(alt, 20, 5, 120), tails: go.map((p) => p.tail_number) }, `Launch ${go.length}`)}
        >
          Launch {go.length} GO
        </button>
        {noGo > 0 ? <span className="meta live-nogo">{noGo} held by launch checks</span> : null}
      </div>

      <fieldset className="live-group" disabled={busy || !canCommand || air.length === 0}>
        <legend>Formation</legend>
        <div className="live-row">
          <select aria-label="Formation shape" value={shape} onChange={(e) => setShape(e.target.value)}>
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <label>
            <span className="meta">Spacing</span>
            <input aria-label="Spacing in metres" inputMode="numeric" value={spacing} onChange={(e) => setSpacing(e.target.value)} />
          </label>
          <label>
            <span className="meta">Heading</span>
            <input aria-label="Heading in degrees" inputMode="numeric" value={heading} onChange={(e) => setHeading(e.target.value)} />
          </label>
        </div>
        <div className="live-row">
          <button
            type="button"
            className={props.picking?.for === "formation" ? "chip is-on" : "chip"}
            onClick={() => props.onPicking(props.picking?.for === "formation" ? null : { for: "formation" })}
          >
            {props.picking?.for === "formation" ? "Click the map…" : picked ? "Move the point" : "Pick a point"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void run({ task: "formation", shape, spacing_m: num(spacing, 12, 4, 100), heading_deg: num(heading, 0, -360, 360), alt_m: num(alt, 20, 5, 120), ...at }, `Formation ${shape}`)}
          >
            Fly formation {picked ? "at the point" : "here"}
          </button>
        </div>
      </fieldset>

      <fieldset className="live-group" disabled={busy || !canCommand || air.length === 0}>
        <legend>Area sweep</legend>
        <div className="live-row">
          <label>
            <span className="meta">Width</span>
            <input aria-label="Sweep width in metres" inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <label>
            <span className="meta">Length</span>
            <input aria-label="Sweep length in metres" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
          <label>
            <span className="meta">Lanes</span>
            <input aria-label="Lane spacing in metres" inputMode="numeric" value={lane} onChange={(e) => setLane(e.target.value)} />
          </label>
        </div>
        <div className="live-row">
          <button
            type="button"
            className={props.picking?.for === "sweep" ? "chip is-on" : "chip"}
            onClick={() => props.onPicking(props.picking?.for === "sweep" ? null : { for: "sweep" })}
          >
            {props.picking?.for === "sweep" ? "Click the map…" : picked ? "Move the centre" : "Pick the centre"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void run(
                { task: "sweep", width_m: num(width, 160, 20, 2000), height_m: num(height, 120, 20, 2000), lane_m: num(lane, 20, 5, 200), heading_deg: num(heading, 0, -360, 360), alt_m: num(alt, 20, 5, 120), then: "rtl", ...at },
                "Area sweep",
              )
            }
          >
            Sweep, then home
          </button>
        </div>
      </fieldset>

      <div className="live-row" role="group" aria-label="Whole swarm">
        {(["hold", "rtl", "land"] as const).map((t) => (
          <button key={t} type="button" className="btn btn-quiet" disabled={busy || !canCommand || air.length === 0} title={why ?? undefined} onClick={() => void run({ task: t }, t === "hold" ? "Hold all" : t === "rtl" ? "Return all" : "Land all")}>
            {t === "hold" ? "Hold all" : t === "rtl" ? "Return all" : "Land all"}
          </button>
        ))}
        {picked ? (
          <button type="button" className="chip" onClick={props.onClearPick}>Clear point</button>
        ) : null}
      </div>
      {note ? <p className="meta live-note" role="status">{note}</p> : null}
      {why ? <p className="meta live-note">{why}.</p> : null}
      <label className="live-check">
        <input type="checkbox" checked={props.scripted} onChange={(e) => props.onScripted(e.target.checked)} />
        <span className="meta">Show the scripted demo fleet too</span>
      </label>
    </section>
  );
}

/** Commands for one live sim vehicle, in its detail panel. */
export function FlyPanel(props: {
  base: string;
  point: LiveSimPoint;
  checks: readonly Check[] | undefined;
  canCommand: boolean;
  picking: PickFor | null;
  onPicking: (p: PickFor | null) => void;
  log: Log;
}): JSX.Element {
  const { base, point: p, canCommand, log } = props;
  const [alt, setAlt] = useState("20");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const tail = p.tail_number;
  const onGround = !p.armed;
  const go = props.checks ? isGo(props.checks) : false;
  const cut = p.link === "cut";
  const why = canCommand ? null : "Your role cannot command vehicles";

  async function act(command: VehicleAction, label: string) {
    setBusy(true);
    const out = await send(() => liveCommand(base, tail, command), log, tail, label);
    setNote(out.detail);
    setBusy(false);
  }

  return (
    <section className="live-fly" aria-label={`Fly ${tail}`} data-testid="fly-panel">
      <header className="live-head">
        <strong>Fly {tail}</strong>
        <span className="meta">{p.task && p.task.kind !== "idle" ? p.task.detail : onGround ? "On the pad" : "Airborne"}</span>
      </header>
      {onGround ? (
        <div className="live-row">
          <label>
            <span className="meta">Height</span>
            <input aria-label="Take-off height in metres" inputMode="numeric" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !canCommand || !go || cut}
            title={why ?? (!go && props.checks ? (blocker(props.checks) ?? undefined) : undefined)}
            onClick={() => void act({ action: "launch", alt_m: num(alt, 20, 5, 120) }, "Launch")}
          >
            Arm and take off
          </button>
          {!go && props.checks ? <span className="meta live-nogo">{blocker(props.checks)}</span> : null}
        </div>
      ) : (
        <div className="live-row">
          <button
            type="button"
            className={props.picking?.for === "goto" ? "chip is-on" : "chip"}
            disabled={busy || !canCommand || cut}
            onClick={() => props.onPicking(props.picking?.for === "goto" ? null : { for: "goto", tail })}
          >
            {props.picking?.for === "goto" ? "Click the map…" : "Go to a point"}
          </button>
          <button type="button" className="btn btn-quiet" disabled={busy || !canCommand || cut} onClick={() => void act({ action: "hold" }, "Hold")}>Hold</button>
          <button type="button" className="btn btn-quiet" disabled={busy || !canCommand || cut} onClick={() => void act({ action: "rtl" }, "Return to launch")}>Return</button>
          <button type="button" className="btn btn-quiet" disabled={busy || !canCommand || cut} onClick={() => void act({ action: "land" }, "Land")}>Land here</button>
        </div>
      )}
      <div className="live-row">
        <button type="button" className="btn btn-quiet" disabled={busy || !canCommand} onClick={() => void act({ action: "link", on: cut }, cut ? "Restore link" : "Cut link")}>
          {cut ? "Restore the link" : "Test lost link"}
        </button>
        <span className="meta">{cut ? "Link cut: PX4 returns home on its own after about 10 s." : "Cuts this vehicle's link to see PX4's own lost-link return."}</span>
      </div>
      {note ? <p className="meta live-note" role="status">{note}</p> : null}
      {why ? <p className="meta live-note">{why}.</p> : null}
      <p className="meta op-note">Live sim: these commands go to PX4 over MAVLink through the bridge and are logged on the timeline. Launch needs the vehicle's launch checks to pass.</p>
    </section>
  );
}
