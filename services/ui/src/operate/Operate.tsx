import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api, type PlatformRow } from "../api";
import type { LivePoint } from "../live";
import { setPageCommands, type Command } from "../shell/commands";
import type { Viewer } from "../shell/types";
import { Hud } from "./Hud";
import { TacMap, type Trail } from "./TacMap";
import { Timeline } from "./Timeline";
import { blocker, checks, isGo, median, onGround, seconds, tick, type Check, type ReadyClock } from "./readiness";
import { ago, diffEvents, fmt, mergeFleet, type OpsEvent, type Vehicle } from "./vehicle";

type Filter = "all" | "attention" | "denied" | "launch";

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

function RailRow({ v, selected, onSelect, launch }: { v: Vehicle; selected: boolean; onSelect: () => void; launch?: readonly Check[] | undefined }): JSX.Element {
  const p = v.live;
  const go = launch ? isGo(launch) : false;
  return (
    <li>
      <button type="button" className={`vrow health-${v.health}${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={onSelect} data-tail={v.tail}>
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
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [fault, setFault] = useState("");
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [trails, setTrails] = useState<Map<string, Trail>>(() => new Map());
  const search = useRef<HTMLInputElement>(null);
  const previous = useRef<Map<string, Vehicle> | null>(null);
  const eventId = useRef(0);
  const readyClock = useRef<ReadyClock>(new Map());
  const [readyTimes, setReadyTimes] = useState<number[]>([]);
  void viewer;

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
        const live = await api<{ items: LivePoint[]; withheld?: number }>("/v1/telemetry/live");
        if (stopped) return;
        onBannerRef.current(live.banner);
        const items = Array.isArray(live.body.items) ? live.body.items : [];
        setPoints(items);
        setTrails((old) => {
          const next = new Map<string, Trail>();
          for (const point of items) {
            const prev = old.get(point.tail_number) ?? [];
            const last = prev[prev.length - 1];
            const moved = !last || last[0] !== point.lat || last[1] !== point.lon;
            next.set(point.tail_number, moved ? [...prev, [point.lat, point.lon] as const].slice(-90) : prev);
          }
          return next;
        });
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

  const fleet = useMemo(() => mergeFleet(registry, points, now), [registry, points, now]);
  const launch = useMemo(() => new Map(fleet.filter(onGround).map((v) => [v.tail, checks(v)] as const)), [fleet]);

  useEffect(() => {
    const before = previous.current;
    if (before) {
      const fresh = diffEvents(before, fleet, now, () => ++eventId.current);
      if (fresh.length > 0) setEvents((list) => [...fresh.reverse(), ...list].slice(0, 200));
    } else if (fleet.length > 0) {
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
  const shown = fleet.filter((v) => {
    if (needle && !v.tail.toLowerCase().includes(needle) && !v.designation.toLowerCase().includes(needle)) return false;
    if (filter === "attention") return v.health === "alert" || v.health === "warn";
    if (filter === "denied") return v.live?.gnss_trusted === false;
    if (filter === "launch") return launch.has(v.tail);
    return true;
  });
  const current = fleet.find((v) => v.tail === selected) ?? null;
  const counts = {
    live: fleet.filter((v) => v.live !== null).length,
    attention: fleet.filter((v) => v.health === "alert" || v.health === "warn").length,
    denied: fleet.filter((v) => v.live?.gnss_trusted === false).length,
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
      } else if (event.key === "Escape") {
        setSelected(null);
        setFollow(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

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

  return (
    <section className="operate" aria-label="Operate">
      <aside className="op-rail" aria-label="Vehicles">
        <div className="op-summary">
          <div><strong className="mono">{counts.live}</strong><span className="meta">live</span></div>
          <div className={counts.attention ? "is-alert" : undefined}><strong className="mono">{counts.attention}</strong><span className="meta">need you</span></div>
          <div className={counts.denied ? "is-warn" : undefined}><strong className="mono">{counts.denied}</strong><span className="meta">GNSS denied</span></div>
          <div className={counts.ready ? "is-ok" : undefined}><strong className="mono">{counts.ready}<span className="op-summary-of">/{counts.ground}</span></strong><span className="meta">ready</span></div>
        </div>
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
            <RailRow key={v.tail} v={v} launch={filter === "launch" ? launch.get(v.tail) : undefined} selected={v.tail === selected} onSelect={() => setSelected(v.tail === selected ? null : v.tail)} />
          ))}
          {shown.length === 0 ? <li className="meta vlist-empty">No vehicles match.</li> : null}
        </ul>
        {withheld > 0 ? <p className="meta op-withheld">{withheld} tracks withheld by classification</p> : null}
      </aside>

      <div className="op-map">
        {fault ? <p className="fault op-fault" role="alert">{fault}</p> : null}
        <TacMap fleet={fleet} trails={trails} selected={selected} follow={follow} onSelect={setSelected} />
        <div className="op-map-tools">
          <button type="button" className={follow ? "chip is-on" : "chip"} aria-pressed={follow} disabled={!selected} onClick={() => setFollow((on) => !on)}>
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
              <Stat label="Battery" value={fmt(p?.battery_pct, 0, "%")} />
              <Stat label="Last sample" value={ago(current.linkAgeMs)} />
              <Stat label="Position" value={p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : "—"} />
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
            </div>
            <p className="meta op-note">This console monitors. It does not send flight commands or arm vehicles; GO is advice to the operator, and tasking goes through an approved mission plan.</p>
          </>
        ) : (
          <div className="op-empty">
            <Hud vehicle={null} />
            <p className="meta">Pick a vehicle from the list or the map. <kbd>J</kbd> <kbd>K</kbd> step through the list, <kbd>L</kbd> shows launch readiness, <kbd>⌘K</kbd> searches everything.</p>
          </div>
        )}
      </aside>

      <Timeline
        events={events}
        now={now}
        onTail={(tail) => {
          setSelected(tail);
          setFollow(true);
        }}
      />
    </section>
  );
}
