"""Kinematic fleet sim: one operator supervising N survey vehicles.

No PX4, no Docker. Vehicles fly straight lines at constant speed, survey a
task cell for a fixed time, then move on. Exception events arrive as Poisson
processes per vehicle. A held vehicle makes no progress until the single
operator clears it. If the operator does not reach it before the event's
deadline, the onboard failsafe takes over and the vehicle leaves the mission
(or, for a task conflict, drops its current task). Orphaned tasks are
re-allocated to the live vehicles with a Python port of onboard/alloc CBBA.

The console only monitors and advises (ADR 0016). "Clearing" here is an
acknowledgement plus a supervisory decision, not a flight command model.
"""
from __future__ import annotations

import argparse
import heapq
import math
import random
from dataclasses import dataclass, field

# ---------------------------------------------------------------- CBBA port
# onboard/alloc caps at 8 agents and 16 tasks, so it cannot run N=100. On a
# fully connected lossless network CBBA converges to the sequential greedy
# assignment (Choi, Brunet, How 2009, Thm. 1). This is that assignment, with
# the same score (reward * discount^seconds), best-insertion marginal gain,
# bid warping (cap at the agent's previous bid) and lower-index tie break as
# onboard/alloc/src/cbba.c. test_scale.py cross-checks it against the C code.
SPEED_MPS = 10.0
DISCOUNT = 0.98
EPS = 1e-9


def path_score(x: float, y: float, path: list[int], tasks: list[tuple[float, float, float]]) -> float:
    t = 0.0
    total = 0.0
    for j in path:
        tx, ty, r = tasks[j]
        t += math.hypot(tx - x, ty - y) / SPEED_MPS
        total += r * DISCOUNT**t
        x, y = tx, ty
    return total


def marginal(x: float, y: float, path: list[int], j: int, tasks: list[tuple[float, float, float]]) -> tuple[float, int]:
    base = path_score(x, y, path, tasks)
    best, best_pos = -1e300, 0
    for pos in range(len(path) + 1):
        gain = path_score(x, y, path[:pos] + [j] + path[pos:], tasks) - base
        if gain > best:
            best, best_pos = gain, pos
    return best, best_pos


def greedy_cbba(
    agents: list[tuple[float, float]],
    tasks: list[tuple[float, float, float]],
    bundle: int,
    paths: list[list[int]] | None = None,
    open_tasks: list[int] | None = None,
) -> list[list[int]]:
    """Assign open tasks; returns each agent's path (existing paths kept as prefix context)."""
    paths = [list(p) for p in (paths or [[] for _ in agents])]
    last_bid = [math.inf] * len(agents)
    free = set(range(len(tasks)) if open_tasks is None else open_tasks)
    added = [0] * len(agents)
    cache: dict[int, tuple[float, int, int]] = {}

    def best_for(i: int) -> tuple[float, int, int]:
        bc, bj, bp = 0.0, -1, 0
        for j in sorted(free):
            c, pos = marginal(agents[i][0], agents[i][1], paths[i], j, tasks)
            c = min(c, last_bid[i])
            if c > bc + EPS:
                bc, bj, bp = c, j, pos
        return bc, bj, bp

    while free:
        win = None
        for i in range(len(agents)):
            if added[i] >= bundle:
                continue
            if i not in cache or cache[i][1] not in free:
                cache[i] = best_for(i)
            c, j, pos = cache[i]
            if j >= 0 and (win is None or c > win[0] + EPS):
                win = (c, i, j, pos)
        if win is None:
            break
        c, i, j, pos = win
        paths[i].insert(pos, j)
        last_bid[i] = c
        added[i] += 1
        free.discard(j)
        cache.pop(i, None)
    return paths


# ---------------------------------------------------------------- fleet sim
# Model parameters. These are assumptions for the sweep, not field data.
EVENTS = {
    # name: (rate per vehicle-hour, mean operator service s, failsafe deadline s, lost_on_timeout)
    "link_lost": (0.6, 45.0, 120.0, True),
    "gnss_rejected": (0.4, 60.0, 90.0, True),
    "low_battery": (0.3, 30.0, 180.0, True),
    "task_conflict": (0.5, 40.0, 240.0, False),
}


@dataclass
class Params:
    n: int = 10
    tasks_per_vehicle: int = 4
    survey_s: float = 300.0
    window_s: float = 2400.0
    density_km2_per_vehicle: float = 0.4
    rate_scale: float = 1.0
    seed: int = 0
    dt: float = 2.0


@dataclass
class Vehicle:
    x: float
    y: float
    path: list[int] = field(default_factory=list)
    work_left: float = 0.0
    alive: bool = True
    held: str | None = None
    held_since: float = 0.0
    flight_s: float = 0.0
    next_event: float = math.inf


@dataclass
class Result:
    n: int
    success: bool
    tasks_done: int
    tasks_total: int
    events: int
    interventions: int
    timeouts: int
    vehicles_lost: int
    reallocations: int
    vehicle_hours: float
    operator_busy_s: float
    elapsed_s: float


def run(p: Params) -> Result:
    rng = random.Random(p.seed * 7919 + p.n)
    side = 1000.0 * math.sqrt(p.density_km2_per_vehicle * p.n)
    m = p.n * p.tasks_per_vehicle
    tasks = [(rng.uniform(0, side), rng.uniform(0, side), 1.0) for _ in range(m)]
    vs = [Vehicle(rng.uniform(0, side), rng.uniform(0, side)) for _ in range(p.n)]
    total_rate = sum(e[0] for e in EVENTS.values()) * p.rate_scale / 3600.0
    names = list(EVENTS)
    weights = [EVENTS[k][0] for k in names]

    def draw_next(now: float) -> float:
        return now + rng.expovariate(total_rate) if total_rate > 0 else math.inf

    for v, path in zip(vs, greedy_cbba([(v.x, v.y) for v in vs], tasks, p.tasks_per_vehicle)):
        v.path = path
        v.work_left = p.survey_s
        v.next_event = draw_next(0.0)

    done: set[int] = set()
    queue: list[tuple[float, int]] = []  # (deadline, vehicle) earliest-deadline-first
    serving: tuple[int, float] | None = None  # (vehicle, finish time)
    events = interventions = timeouts = lost = reallocs = 0
    busy = 0.0
    orphans: list[int] = []
    t = 0.0

    def release(i: int, all_tasks: bool) -> None:
        v = vs[i]
        if v.path:
            take = v.path if all_tasks else v.path[:1]
            orphans.extend(take)
            v.path = [] if all_tasks else v.path[1:]
            v.work_left = p.survey_s

    while t < p.window_s and len(done) < m:
        # operator
        if serving and t >= serving[1]:
            vs[serving[0]].held = None
            interventions += 1
            serving = None
        if serving is None:
            while queue:
                dl, i = heapq.heappop(queue)
                if vs[i].alive and vs[i].held:
                    svc = rng.expovariate(1.0 / EVENTS[vs[i].held][1])
                    serving = (i, t + svc)
                    break
        if serving:
            busy += p.dt
        # vehicles
        for i, v in enumerate(vs):
            if not v.alive:
                continue
            if v.path or v.held:
                v.flight_s += p.dt
            if v.held:
                kind = v.held
                if (serving is None or serving[0] != i) and t - v.held_since >= EVENTS[kind][2]:
                    timeouts += 1
                    v.held = None
                    if EVENTS[kind][3]:
                        v.alive = False
                        lost += 1
                        release(i, True)
                    else:
                        release(i, False)
                continue
            if t >= v.next_event and v.path:
                kind = rng.choices(names, weights)[0]
                events += 1
                v.held, v.held_since = kind, t
                heapq.heappush(queue, (t + EVENTS[kind][2], i))
                v.next_event = draw_next(t)
                continue
            if not v.path:
                continue
            tx, ty, _ = tasks[v.path[0]]
            d = math.hypot(tx - v.x, ty - v.y)
            step = SPEED_MPS * p.dt
            if d > step:
                v.x += (tx - v.x) / d * step
                v.y += (ty - v.y) / d * step
            else:
                v.x, v.y = tx, ty
                v.work_left -= p.dt
                if v.work_left <= 0:
                    done.add(v.path.pop(0))
                    v.work_left = p.survey_s
        if orphans:
            live = [i for i, v in enumerate(vs) if v.alive and v.held is None]
            if live:
                new = greedy_cbba(
                    [(vs[i].x, vs[i].y) for i in live], tasks, len(orphans),
                    paths=[vs[i].path for i in live], open_tasks=orphans,
                )
                for i, path in zip(live, new):
                    if path and not vs[i].path:
                        vs[i].work_left = p.survey_s
                    vs[i].path = path
                reallocs += 1
                orphans = []
        t += p.dt

    return Result(p.n, len(done) == m, len(done), m, events, interventions, timeouts, lost,
                  reallocs, sum(v.flight_s for v in vs) / 3600.0, busy, t)


def sweep(ns: list[int], seeds: int, rate_scale: float = 1.0) -> list[dict[str, float]]:
    rows = []
    for n in ns:
        rs = [run(Params(n=n, seed=s, rate_scale=rate_scale)) for s in range(seeds)]
        vh = sum(r.vehicle_hours for r in rs)
        rows.append({
            "n": n,
            "runs": len(rs),
            "success": sum(r.success for r in rs) / len(rs),
            "tasks_done": sum(r.tasks_done for r in rs) / sum(r.tasks_total for r in rs),
            "events_per_vh": sum(r.events for r in rs) / vh,
            "interventions_per_vh": sum(r.interventions for r in rs) / vh,
            "timeouts_per_run": sum(r.timeouts for r in rs) / len(rs),
            "lost_per_run": sum(r.vehicles_lost for r in rs) / len(rs),
            "operator_util": sum(r.operator_busy_s for r in rs) / sum(r.elapsed_s for r in rs),
            # one operator per run, on shift for the whole window
            "sorties_per_op_hour": sum(r.n - r.vehicles_lost for r in rs) / (len(rs) * Params().window_s / 3600.0),
        })
    return rows


def to_markdown(rows: list[dict[str, float]], seeds: int) -> str:
    out = [
        "| Vehicles per operator | Runs | Mission success | Tasks done | Exceptions / veh-h | "
        "Interventions / veh-h | Failsafe timeouts / run | Vehicles lost / run | Operator busy | "
        "Effective sorties / operator-h |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        out.append(
            f"| {r['n']} | {r['runs']} | {r['success']:.0%} | {r['tasks_done']:.1%} | {r['events_per_vh']:.2f} | "
            f"{r['interventions_per_vh']:.2f} | {r['timeouts_per_run']:.1f} | {r['lost_per_run']:.1f} | "
            f"{r['operator_util']:.0%} | {r['sorties_per_op_hour']:.1f} |"
        )
    base = rows[0]["success"]
    knee = next((r["n"] for r in rows if r["success"] < base - 0.1), None)
    out.append("")
    out.append(
        f"Knee: success first falls more than 10 points below the N={rows[0]['n']} value at "
        + (f"N={knee} vehicles per operator." if knee else "no N in this sweep.")
    )
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", default="5,10,20,30,40,50,100")
    ap.add_argument("--seeds", type=int, default=10)
    ap.add_argument("--rate-scale", type=float, default=1.0)
    a = ap.parse_args()
    ns = [int(x) for x in a.n.split(",")]
    print(to_markdown(sweep(ns, a.seeds, a.rate_scale), a.seeds))


if __name__ == "__main__":
    main()
