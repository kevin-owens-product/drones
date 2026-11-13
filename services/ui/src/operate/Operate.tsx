import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api, type PlatformRow } from "../api";
import type { LivePoint } from "../live";
import { setPageCommands, type Command } from "../shell/commands";
import type { Viewer } from "../shell/types";
import { Hud } from "./Hud";
import { DEFAULT_LAYERS, LAYER_NAMES, loadPicture, loadRadio, replanText, replans, type Layers, type Picture, type RadioGrid } from "./picture";
import { TacMap, type Pulse, type Trail } from "./TacMap";
import { Timeline } from "./Timeline";
import { blocker, checks, isGo, median, onGround, seconds, tick, type Check, type ReadyClock } from "./readiness";
import { ago, diffEvents, fmt, mergeFleet, type OpsEvent, type Vehicle } from "./vehicle";
import { isLiveSim, liveBase, liveCommand, liveSnapshot, setLiveBase, type LiveSnapshot } from "../livesim";
import { can } from "../shell/workspace";
import { FlyPanel, liveMarks, SwarmPanel, type LiveStatus, type PickFor } from "./LiveSim";

// Three.js is large; load it only when the operator asks for 3D.
const Map3D = lazy(() => import("./Map3D").then((m) => ({ default: m.Map3D })));

type Filter = "all" | "attention" | "denied" | "launch";

/** One poll as the console received it, kept for replay. */
interface Snapshot {
  at: number;
  points: LivePoint[];
  picture: Picture | null;
}

const HISTORY_MS = 10 * 60_000;
const HISTORY_POINTS = 150_000;
const TRAIL_MS = 90_000;
const PULSE_MS = 3200;
const DENSITY_ABOVE = 60;

function loadLayers(): Layers {
  try {
    const raw = localStorage.getItem("a2e-map-layers");
    return raw ? { ...DEFAULT_LAYERS, ...(JSON.parse(raw) as Partial<Layers>) } : DEFAULT_LAYERS;
  } catch {
    return DEFAULT_LAYERS;
  }
}

/** Trails from received history up to a moment: one point per sample that moved. */
function trailsAt(history: readonly Snapshot[], until: number): Map<string, Trail> {
  const out = new Map<string, [number, number][]>();
  for (const snap of history) {
    if (snap.at > until) break;
    if (snap.at < until - TRAIL_MS) continue;
    for (const p of snap.points) {
      const list = out.get(p.tail_number) ?? [];
      const last = list[list.length - 1];
      if (!last || last[0] !== p.lat || last[1] !== p.lon) list.push([p.lat, p.lon]);
      out.set(p.tail_number, list);
    }
  }
  return out;
}

/** The newest snapshot at or before a moment. */
function snapshotAt(history: readonly Snapshot[], at: number): Snapshot | null {
  let lo = 0;
  let hi = history.length - 1;
  let found: Snapshot | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const snap = history[mid]!;
    if (snap.at <= at) {
      found = snap;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found ?? history[0] ?? null;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function Battery({ pct }: { pct: number | undefined }): JSX.Element {
  if (typeof pct !== "number") return <span className="battery battery-none" aria-label="Battery unknown" />;
  const level = pct < 25 ? "low" : pct < 50 ? "mid" : "ok";
  return (
    <span className={`battery battery-${level}`} role="img" aria-label={`Battery ${Math.round(pct)}%`}>
      <span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
    </span>
  );
}

function RailRow({ v, selected, onSelect, launch, pulse }: { v: Vehicle; selected: boolean; onSelect: () => void; launch?: readonly Check[] | undefined; pulse?: Pulse | undefined }): JSX.Element {
  const p = v.live;
  const go = launch ? isGo(launch) : false;
  return (
    <li>
      <button type="button" className={`vrow health-${v.health}${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={onSelect} data-tail={v.tail}>
        {pulse ? <span key={pulse.id} className={`vrow-flash flash-${pulse.level}`} aria-hidden="true" /> : null}
        <span className="vrow-dot" aria-hidden="true" />
        <span className="vrow-main">
          <span className="vrow-top">
            <span className="mono vrow-tail">{v.tail}</span>
            {launch ? <span className={go ? "tag tag-go" : "tag tag-nogo"}>{go ? "GO" : "NO-GO"}</span> : p?.mode ? <span className="tag">{p.mode}</span> : null}
            {p?.gnss_trusted === false ? <span className="tag tag-warn">{(p.nav_source ?? "DR").toUpperCase()}</span> : null}
          </span>
          <span className="vrow-sub meta">
            {launch
              ? (blocker(launch) ?? "All checks pass")
              : v.reasons.length > 0
                ? v.reasons.join(" · ")
                : `${fmt(p?.alt_m, 0, " m")} · ${fmt(p?.ground_mps, 1, " m/s")}`}
          </span>
        </span>
        <span className="vrow-side">
          <Battery pct={p?.battery_pct} />
          <span className="mono meta">{ago(v.linkAgeMs)}</span>
        </span>
      </button>
    </li>
  );
}

function Readiness({ list, entry, now }: { list: readonly Check[]; entry: { upAt: number | null; readyAt: number | null } | undefined; now: number }): JSX.Element {
  const go = isGo(list);
  let clock = "Waiting for power-on";
  if (entry?.readyAt != null) clock = entry.upAt === null ? "Ready when the console opened" : `Ready ${seconds(entry.readyAt - entry.upAt)} after power-on`;
  else if (entry?.upAt != null) clock = `Powered on ${seconds(now - entry.upAt)} ago`;
  else if (entry) clock = "Power-on time not seen";
  return (
    <section className="ready" aria-label="Launch readiness">
      <header className="ready-head">
        <span className={go ? "ready-verdict is-go" : "ready-verdict is-nogo"}>{go ? "GO" : "NO-GO"}</span>
        <span className="meta">{clock}</span>
      </header>
      <ul className="ready-checks">
        {list.map((c) => (
          <li key={c.id} className={c.ok ? "is-ok" : "is-bad"}>
            <span className="ready-mark" aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
            <span>{c.label}</span>
            <span className="mono meta">{c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}

export function OperatePage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }): JSX.Element {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [registry, setRegistry] = useState<PlatformRow[]>([]);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [withheld, setWithheld] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(() => {
    // A tail handed over from Missions or Fleet ("Watch live").
    const handed = sessionStorage.getItem("a2e-live-tail");
    if (handed) sessionStorage.removeItem("a2e-live-tail");
    return handed?.trim() || null;
  });
  const [follow, setFollow] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [fault, setFault] = useState("");
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [layers, setLayers] = useState<Layers>(loadLayers);
  const [radio, setRadio] = useState<RadioGrid | null>(null);
  useEffect(() => {
    // The terrain does not move: fetch the radio grid once, when the layer is first switched on.
    if (layers.radio && !radio) void loadRadio().then(setRadio);
  }, [layers.radio, radio]);
  const [densityPref, setDensityPref] = useState<boolean | null>(null);
  const [view3d, setView3d] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportNote, setReportNote] = useState("");
  const history = useRef<Snapshot[]>([]);
  const historyPoints = useRef(0);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const previous = useRef<Map<string, Vehicle> | null>(null);
  const eventId = useRef(0);
  const readyClock = useRef<ReadyClock>(new Map());
  const [readyTimes, setReadyTimes] = useState<number[]>([]);
  // Live sim (opt-in with ?live=1): PX4 vehicles through the bridge in sim/swarm.
  const [liveUrl, setLiveUrl] = useState<string | null>(() => liveBase());
  const liveUrlRef = useRef(liveUrl);
  liveUrlRef.current = liveUrl;
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(() => (liveUrl ? "connecting" : "off"));
  const [liveSnap, setLiveSnap] = useState<LiveSnapshot | null>(null);
  const liveSince = useRef(-1);
  const [scripted, setScripted] = useState(() => {
    try {
      return localStorage.getItem("a2e-live-scripted") === "1";
    } catch {
      return false;
    }
  });
  const [picking, setPicking] = useState<PickFor | null>(null);
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const canCommand = can(viewer, "vehicle.command");
  const logLive = useCallback((tail: string, level: OpsEvent["level"], text: string) => {
    setEvents((list) => [{ id: ++eventId.current, at: Date.now(), tail, level, text }, ...list].slice(0, 200));
  }, []);


  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const result = await api<{ items: PlatformRow[] }>("/v1/platforms");
        if (!stopped) setRegistry(Array.isArray(result.body.items) ? result.body.items : []);
      } catch {
        if (!stopped) setRegistry([]);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const base = liveUrlRef.current;
        const simCall = base ? liveSnapshot(base, Math.max(0, liveSince.current)).catch(() => null) : Promise.resolve(null);
        const [live, pic, sim] = await Promise.all([api<{ items: LivePoint[]; withheld?: number }>("/v1/telemetry/live"), loadPicture(), simCall]);
        if (stopped) return;
        onBannerRef.current(live.banner);
        let items = Array.isArray(live.body.items) ? live.body.items : [];
        if (base && liveUrlRef.current === base) {
          if (sim && Array.isArray(sim.items)) {
            setLiveStatus("up");
            setLiveSnap(sim);
            items = [...items, ...sim.items];
            // The bridge's own log (PX4 status text, command results, separation). Mode changes
            // come from the console's own diff, so they are not doubled. On first contact, only the last minute.
            const first = liveSince.current < 0;
            const fresh = (sim.events ?? []).filter((e) => !e.text.startsWith("Mode ") && (!first || e.at > Date.now() - 60_000));
            if (sim.events?.length) liveSince.current = Math.max(liveSince.current, ...sim.events.map((e) => e.id));
            else if (first) liveSince.current = 0;
            if (fresh.length) setEvents((list) => [...fresh.reverse().map<OpsEvent>((e) => ({ id: ++eventId.current, at: e.at, tail: e.tail, level: e.level, text: e.text })), ...list].slice(0, 200));
          } else setLiveStatus("down");
        }
        const at = Date.now();
        const list = history.current;
        list.push({ at, points: items, picture: pic });
        historyPoints.current += items.length;
        while (list.length > 1 && (list[0]!.at < at - HISTORY_MS || historyPoints.current > HISTORY_POINTS)) {
          historyPoints.current -= list.shift()!.points.length;
        }
        setPoints(items);
        setPicture(pic);
        setWithheld(typeof live.body.withheld === "number" ? live.body.withheld : 0);
        setFault("");
      } catch (error) {
        if (!stopped) setFault(messageOf(error, "Could not load live positions."));
      } finally {
        if (!stopped) setNow(Date.now());
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  // With live sim up, the map and list show the PX4 swarm alone unless the scripted fleet is asked for.
  const liveUp = liveUrl !== null && liveStatus === "up";
  const scriptedShown = !liveUp || scripted;
  const registryShown = useMemo(
    () => (liveUp && liveSnap ? [...(scriptedShown ? registry : []), ...liveSnap.platforms] : registry),
    [liveUp, liveSnap, scriptedShown, registry],
  );
  const keep = useCallback((list: readonly LivePoint[]) => (scriptedShown ? [...list] : list.filter((pt) => isLiveSim(pt))), [scriptedShown]);
  const fleet = useMemo(() => mergeFleet(registryShown, keep(points), now), [registryShown, keep, points, now]);

  const lastPicture = useRef<Picture | null>(null);
  const scriptedRef = useRef(scriptedShown);
  scriptedRef.current = scriptedShown;
  useEffect(() => {
    const changes = replans(lastPicture.current, picture);
    if (picture) lastPicture.current = picture;
    if (changes.length === 0 || !scriptedRef.current) return;
    const at = Date.now();
    const fresh = replanText(changes).map<OpsEvent>((r) => ({ id: ++eventId.current, at, tail: r.tail, level: "info", text: r.text }));
    setEvents((list) => [...fresh, ...list].slice(0, 200));
  }, [picture]);

  useEffect(() => {
    try {
      localStorage.setItem("a2e-map-layers", JSON.stringify(layers));
    } catch {
      // Private window or blocked storage: layers reset next visit.
    }
  }, [layers]);

  // Replay: show the fleet as this console received it at an earlier moment.
  // Events, readiness and alerts keep running on live data underneath.
  const replaySnap = replayAt === null ? null : snapshotAt(history.current, replayAt);
  const shownAt = replaySnap ? replaySnap.at : now;
  const view = useMemo(
    () => (replaySnap ? mergeFleet(registryShown, keep(replaySnap.points), replaySnap.at) : fleet),
    [replaySnap, registryShown, keep, fleet],
  );
  // With only the live swarm on the map, the scripted sortie's tasks, survey areas and routes are not theirs.
  const rawPicture = replaySnap ? replaySnap.picture : picture;
  const viewPicture = useMemo(() => (rawPicture && !scriptedShown ? { ...rawPicture, tasks: [], areas: [], routes: [] } : rawPicture), [rawPicture, scriptedShown]);
  const trails = useMemo(() => trailsAt(history.current, shownAt), [shownAt]);
  const historyFrom = history.current[0]?.at ?? now;

  useEffect(() => {
    if (!playing || replayAt === null) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const t = performance.now();
      const dt = t - last;
      last = t;
      setReplayAt((at) => {
        if (at === null) return null;
        const next = at + dt;
        if (next >= Date.now() - 1000) {
          setPlaying(false);
          return null;
        }
        return next;
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [playing, replayAt === null]);

  // A fresh warning or alert pulses its vehicle on the map, in the list and on
  // the timeline at once, so the eye lands on it wherever it is.
  const pulses = useMemo(() => {
    const out = new Map<string, Pulse>();
    if (replayAt !== null) return out;
    for (const e of events) {
      if (now - e.at > PULSE_MS) break;
      if (e.level === "info" && !e.text.startsWith("Re-plan")) continue;
      if (!out.has(e.tail)) out.set(e.tail, { id: e.id, level: e.level });
    }
    return out;
  }, [events, now, replayAt]);
  const launch = useMemo(() => new Map(fleet.filter(onGround).map((v) => [v.tail, checks(v)] as const)), [fleet]);

  useEffect(() => {
    const before = previous.current;
    // Until the console has heard at least one vehicle, nothing has changed yet:
    // the first fleet with live data seeds the log with what already needs attention.
    if (before && [...before.values()].some((v) => v.live !== null)) {
      const fresh = diffEvents(before, fleet, now, () => ++eventId.current);
      if (fresh.length > 0) setEvents((list) => [...fresh.reverse(), ...list].slice(0, 200));
    } else if (fleet.some((v) => v.live !== null)) {
      const seed = fleet
        .filter((v) => v.health === "alert" || v.health === "warn")
        .map<OpsEvent>((v) => ({ id: ++eventId.current, at: now, tail: v.tail, level: v.health === "alert" ? "alert" : "warn", text: v.reasons.join(" · ") }));
      setEvents(seed);
    }
    if (fleet.length > 0) {
      const go = new Map([...launch].map(([tail, list]) => [tail, isGo(list)] as const));
      // Vehicles already up when the console first hears the fleet have no power-on time.
      const heardBefore = before !== null && [...before.values()].some((v) => v.live !== null);
      const { clock, ready } = tick(readyClock.current, fleet, go, now, !heardBefore);
      readyClock.current = clock;
      if (ready.length > 0) {
        const timed = ready.flatMap((r) => (r.ms === null ? [] : [r.ms]));
        if (timed.length > 0) setReadyTimes((list) => [...list, ...timed].slice(-50));
        const fresh = ready.map<OpsEvent>((r) => ({ id: ++eventId.current, at: now, tail: r.tail, level: "info", text: r.ms === null ? "Ready to launch" : `Ready to launch, ${seconds(r.ms)} from power-on` }));
        setEvents((list) => [...fresh, ...list].slice(0, 200));
      }
      previous.current = new Map(fleet.map((v) => [v.tail, v]));
    }
  }, [fleet, launch, now]);

  const needle = query.trim().toLowerCase();
  const shown = view.filter((v) => {
    if (needle && !v.tail.toLowerCase().includes(needle) && !v.designation.toLowerCase().includes(needle)) return false;
    if (filter === "attention") return v.health === "alert" || v.health === "warn";
    if (filter === "denied") return v.live?.gnss_trusted === false;
    if (filter === "launch") return launch.has(v.tail);
    return true;
  });
  const current = view.find((v) => v.tail === selected) ?? null;
  const liveCount = view.filter((v) => v.live !== null).length;
  const density = densityPref ?? liveCount > DENSITY_ABOVE;
  const counts = {
    live: liveCount,
    attention: view.filter((v) => v.health === "alert" || v.health === "warn").length,
    denied: view.filter((v) => v.live?.gnss_trusted === false).length,
    ready: [...launch.values()].filter(isGo).length,
    ground: launch.size,
  };
  const readyMedian = median(readyTimes);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (shown.length === 0) return;
      const index = shown.findIndex((v) => v.tail === selected);
      const next = shown[(index + dir + shown.length) % shown.length] ?? shown[0];
      if (next) setSelected(next.tail);
    },
    [shown, selected],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        if (event.key === "Escape" && event.target === search.current) search.current?.blur();
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      } else if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
      } else if (key === "f") {
        setFollow((on) => !on);
      } else if (key === "a") {
        setFilter((f) => (f === "attention" ? "all" : "attention"));
      } else if (key === "l") {
        setFilter((f) => (f === "launch" ? "all" : "launch"));
      } else if (key === "r" && selected) {
        event.preventDefault();
        setReporting(true);
        setReportNote("");
      } else if (event.key === "Escape") {
        if (picking) {
          setPicking(null);
          return;
        }
        if (replayAt !== null) {
          setReplayAt(null);
          setPlaying(false);
          return;
        }
        setSelected(null);
        setFollow(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, replayAt, selected, picking]);

  async function fileReport(tail: string) {
    const since = Date.now() - 30_000;
    const samples = history.current
      .filter((snap) => snap.at >= since)
      .flatMap((snap) => {
        const pt = snap.points.find((q) => q.tail_number === tail);
        return pt
          ? [{ t: snap.at, alt_m: pt.alt_m, ground_mps: pt.ground_mps, battery_pct: pt.battery_pct, mode: pt.mode, nav_source: pt.nav_source, gnss_trusted: pt.gnss_trusted, pos_sigma_m: pt.pos_sigma_m }]
          : [];
      });
    try {
      const out = await api<{ id: string; themes: string[] }>("/v1/field-reports", {
        method: "POST",
        body: JSON.stringify({ tail, text: reportText, samples, by: viewer.display_name }),
      });
      setReportNote(`Filed ${out.body.id} with ${samples.length} telemetry samples from the last 30 s. Theme: ${out.body.themes.join(", ")}.`);
      setReportText("");
      setReporting(false);
    } catch (error) {
      setReportNote(messageOf(error, "Could not file the report."));
    }
  }

  useEffect(() => {
    if (!selected) return;
    document.querySelector(`[data-tail="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const tails = fleet.map((v) => `${v.tail}|${v.live?.mode ?? ""}|${v.health}`).join(",");
  useEffect(() => {
    const commands: Command[] = [
      { id: "follow", label: follow ? "Stop following on the map" : "Follow the selected vehicle", group: "Map", hint: "F", run: () => setFollow((on) => !on) },
      { id: "attention", label: "Show vehicles that need me", group: "Filter", hint: "A", run: () => setFilter("attention") },
      { id: "denied", label: "Show GNSS-denied vehicles", group: "Filter", run: () => setFilter("denied") },
      { id: "launch", label: "Check launch readiness", group: "Filter", hint: "L", run: () => setFilter("launch") },
      { id: "all", label: "Show the whole fleet", group: "Filter", run: () => setFilter("all") },
      ...fleet.map<Command>((v) => ({
        id: `v-${v.tail}`,
        label: `${v.tail}${v.live?.mode ? ` · ${v.live.mode}` : ""}${v.reasons.length ? ` · ${v.reasons[0]}` : ""}`,
        group: "Vehicle",
        run: () => {
          setSelected(v.tail);
          setFollow(true);
        },
      })),
    ];
    setPageCommands(commands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tails, follow]);
  useEffect(() => () => setPageCommands([]), []);

  const p = current?.live ?? null;
  const marks = liveUp ? liveMarks(liveSnap, picked, isLiveSim(p) ? p : null) : [];
  function onPick(lat: number, lon: number) {
    const what = picking;
    setPicking(null);
    if (!what || !liveUrl) return;
    if (what.for === "goto") {
      const at = fleet.find((v) => v.tail === what.tail)?.live?.alt_m;
      void liveCommand(liveUrl, what.tail, { action: "goto", lat, lon, ...(typeof at === "number" && at > 3 ? { alt_m: Math.round(at) } : {}) }).then(
        (out) => logLive(what.tail, out.ok ? "info" : "warn", `Go to: ${out.detail}`),
        () => logLive(what.tail, "warn", "Go to: the bridge did not answer"),
      );
    } else setPicked([lat, lon]);
  }

  return (
    <section className="operate" aria-label="Operate">
      <aside className="op-rail" aria-label="Vehicles">
        <div className="op-summary">
          <div><strong className="mono">{counts.live}</strong><span className="meta">live</span></div>
          <div className={counts.attention ? "is-alert" : undefined}><strong className="mono">{counts.attention}</strong><span className="meta">need you</span></div>
          <div className={counts.denied ? "is-warn" : undefined}><strong className="mono">{counts.denied}</strong><span className="meta">GNSS denied</span></div>
          <div className={counts.ready ? "is-ok" : undefined}><strong className="mono">{counts.ready}<span className="op-summary-of">/{counts.ground}</span></strong><span className="meta">ready</span></div>
        </div>
        {liveUrl ? (
          <SwarmPanel
            base={liveUrl}
            status={liveStatus}
            snap={liveSnap}
            launch={launch}
            canCommand={canCommand}
            picking={picking}
            picked={picked}
            onPicking={setPicking}
            onClearPick={() => setPicked(null)}
            scripted={scripted}
            onScripted={(on) => {
              setScripted(on);
              try {
                localStorage.setItem("a2e-live-scripted", on ? "1" : "0");
              } catch {
                /* not remembered */
              }
            }}
            onOff={() => {
              setLiveBase(null);
              setLiveUrl(null);
              setLiveStatus("off");
              setLiveSnap(null);
            }}
            log={logLive}
          />
        ) : null}
        <div className="op-search">
          <input ref={search} id="tail-search" aria-label="Find a vehicle" placeholder="Find a vehicle" value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd>/</kbd>
        </div>
        <div className="chips" role="group" aria-label="Filter">
          {(["all", "attention", "denied", "launch"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "chip is-on" : "chip"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "attention" ? "Need you" : f === "denied" ? "GNSS denied" : "Launch"}
            </button>
          ))}
        </div>
        {filter === "launch" ? (
          <p className="meta op-launch-note" data-testid="ready-median">
            {readyMedian === null ? "Power-on to ready: no vehicle timed yet" : `Power-on to ready: median ${seconds(readyMedian)} across ${readyTimes.length} ${readyTimes.length === 1 ? "vehicle" : "vehicles"}`}
          </p>
        ) : null}
        <ul id="fleet" className="vlist">
          {shown.map((v) => (
            <RailRow key={v.tail} v={v} pulse={pulses.get(v.tail)} launch={filter === "launch" ? launch.get(v.tail) : undefined} selected={v.tail === selected} onSelect={() => setSelected(v.tail === selected ? null : v.tail)} />
          ))}
          {shown.length === 0 ? <li className="meta vlist-empty">No vehicles match.</li> : null}
        </ul>
        {withheld > 0 ? <p className="meta op-withheld">{withheld} tracks withheld by classification</p> : null}
      </aside>

      <div className={replayAt === null ? "op-map" : "op-map is-replay"}>
        {fault ? <p className="fault op-fault" role="alert">{fault}</p> : null}
        {view3d ? (
          <Suspense fallback={<p className="meta op-3d-loading">Loading the 3D view…</p>}>
            <Map3D fleet={view} picture={viewPicture} layers={layers} selected={selected} follow={follow} onSelect={setSelected} />
          </Suspense>
        ) : (
          <TacMap fleet={view} trails={trails} selected={selected} follow={follow} onSelect={setSelected} picture={viewPicture} layers={layers} pulses={pulses} density={density} radio={layers.radio ? radio : null} marks={marks} onPick={picking ? onPick : undefined} minSpanM={scriptedShown ? 400 : 160} />
        )}
        {picture || liveCount > 20 ? (
          <div className="op-layers chips" role="group" aria-label="Map layers">
            {picture
              ? (Object.keys(LAYER_NAMES) as (keyof Layers)[])
                  .filter((k) => k !== "terrain" || picture.basemap)
                  .map((k) => (
                    <button key={k} type="button" className={layers[k] ? "chip is-on" : "chip"} aria-pressed={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>
                      {LAYER_NAMES[k]}
                    </button>
                  ))
              : null}
            <button type="button" className={view3d ? "chip chip-3d is-on" : "chip chip-3d"} aria-pressed={view3d} onClick={() => setView3d((on) => !on)}>
              3D
            </button>
            {liveCount > 20 && !view3d ? (
              <button type="button" className={density ? "chip is-on" : "chip"} aria-pressed={density} onClick={() => setDensityPref(!density)}>
                Density
              </button>
            ) : null}
          </div>
        ) : null}
        {replaySnap ? (
          <div className="op-replay" role="status" data-testid="replay-banner">
            <span className="op-replay-tag">REPLAY</span>
            <span className="mono">{new Date(replaySnap.at).toISOString().slice(11, 19)}Z</span>
            <span className="meta">{seconds(now - replaySnap.at)} ago · as this console received it</span>
            <button type="button" className="chip" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="chip is-on" onClick={() => { setReplayAt(null); setPlaying(false); }}>Back to live <kbd>Esc</kbd></button>
          </div>
        ) : null}
        <div className="op-map-tools">
          <button type="button" className={follow ? "chip is-on" : "chip"} aria-pressed={follow} disabled={!selected} title={selected ? undefined : "Pick a vehicle to follow"} onClick={() => setFollow((on) => !on)}>
            Follow <kbd>F</kbd>
          </button>
        </div>
      </div>

      <aside className="op-detail" aria-label="Selected vehicle">
        {current ? (
          <>
            <header className="op-detail-head">
              <div>
                <h2 className="mono">{current.tail}</h2>
                <p className="meta">{current.designation || "Unregistered airframe"}</p>
              </div>
              <span className={`health-badge health-${current.health}`}>
                {current.health === "ok" ? "Nominal" : current.health === "offline" ? "Offline" : current.reasons[0]}
              </span>
            </header>
            {launch.has(current.tail) ? <Readiness list={launch.get(current.tail) ?? []} entry={readyClock.current.get(current.tail)} now={now} /> : null}
            <Hud vehicle={current} />
            <dl className="stats">
              <Stat label="Mode" value={p?.mode ?? "—"} />
              <Stat label="Nav source" value={p ? (p.nav_source === "none" ? "NO FIX" : p.gnss_trusted === false ? (p.nav_source ?? "dead reckoning").toUpperCase() : "GNSS") : "—"} />
              <Stat label="Ground speed" value={fmt(p?.ground_mps, 1, " m/s")} />
              <Stat label="Climb" value={fmt(p?.climb_mps, 1, " m/s")} />
              <Stat label="Altitude" value={fmt(p?.alt_m, 0, " m")} />
              <Stat label="Heading" value={fmt(p?.heading_deg, 0, "°")} />
              <Stat label="Battery" value={typeof p?.pack_v === "number" ? `${fmt(p?.battery_pct, 0, "%")} · ${p.pack_v.toFixed(1)} V` : fmt(p?.battery_pct, 0, "%")} />
              {typeof p?.air_mps === "number" ? <Stat label="Airspeed" value={fmt(p.air_mps, 1, " m/s")} /> : null}
              {typeof p?.wind_mps === "number" ? <Stat label="Wind" value={`${fmt(p.wind_mps, 0, " m/s")} from ${fmt(p.wind_from_deg, 0, "°")}`} /> : null}
              {typeof p?.power_w === "number" && p.armed !== false ? <Stat label="Power" value={fmt(p.power_w, 0, " W")} /> : null}
              {typeof p?.endurance_min === "number" && typeof p?.home_min === "number" ? (
                <Stat label="Energy" value={`${p.endurance_min.toFixed(0)} min left · ${p.home_min.toFixed(0)} min home`} />
              ) : null}
              {typeof p?.link_margin_db === "number" ? <Stat label="Link margin" value={`${p.link_margin_db} dB${typeof p.rssi_dbm === "number" ? ` · ${p.rssi_dbm} dBm` : ""}`} /> : null}
              <Stat label="Last sample" value={ago(current.linkAgeMs)} />
              <Stat label="Position" value={p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : "—"} />
              <Stat label="Position error (95%)" value={typeof p?.pos_sigma_m === "number" ? `±${Math.round(2.45 * p.pos_sigma_m)} m` : "—"} />
              <Stat label="Marking" value={p?.classification ?? "—"} />
            </dl>
            {current.reasons.length > 0 ? (
              <ul className="reasons">
                {current.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <div className="op-actions">
              <button type="button" className="btn" onClick={() => setFollow((on) => !on)}>{follow ? "Stop following" : "Follow on map"}</button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  sessionStorage.setItem("a2e-fleet-tail", current.tail);
                  window.location.hash = "fleet";
                }}
              >
                Registry record
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setReporting((on) => !on);
                  setReportNote("");
                }}
              >
                Report issue <kbd>R</kbd>
              </button>
            </div>
            {reporting ? (
              <form
                className="op-report"
                onSubmit={(event) => {
                  event.preventDefault();
                  void fileReport(current.tail);
                }}
              >
                <label htmlFor="op-report-text">What went wrong with {current.tail}?</label>
                <textarea
                  id="op-report-text"
                  autoFocus
                  rows={3}
                  maxLength={1000}
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setReporting(false);
                  }}
                  placeholder="Video froze at the tree line…"
                />
                <div className="op-report-actions">
                  <span className="meta">The last 30 s of telemetry and the firmware build go with it.</span>
                  <button type="submit" className="btn btn-primary" disabled={!reportText.trim()}>
                    File report
                  </button>
                </div>
              </form>
            ) : null}
            {reportNote ? (
              <p className="meta op-report-note" role="status">
                {reportNote}
              </p>
            ) : null}
            {isLiveSim(p) && liveUrl ? (
              <FlyPanel base={liveUrl} point={p} checks={launch.get(current.tail)} canCommand={canCommand} picking={picking} onPicking={setPicking} log={logLive} />
            ) : (
              <p className="meta op-note">This console monitors. It does not send flight commands or arm vehicles; GO is advice to the operator, and tasking goes through an approved mission plan.</p>
            )}
          </>
        ) : (
          <div className="op-empty">
            <Hud vehicle={null} />
            <p className="meta">Pick a vehicle from the list or the map. <kbd>J</kbd> <kbd>K</kbd> step through the list, <kbd>L</kbd> shows launch readiness, <kbd>⌘K</kbd> jumps to any page, vehicle or command.</p>
          </div>
        )}
      </aside>

      <Timeline
        events={events}
        now={now}
        historyFrom={historyFrom}
        replayAt={replayAt}
        onScrub={(at) => {
          setPlaying(false);
          setReplayAt(at === null || at >= Date.now() - 1500 ? null : Math.max(historyFrom, at));
        }}
        onTail={(tail) => {
          setSelected(tail);
          setFollow(true);
        }}
      />
    </section>
  );
}
