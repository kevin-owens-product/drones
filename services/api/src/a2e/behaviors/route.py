"""3D route planner. Overhanging volumes block only their altitude band."""

from __future__ import annotations

import heapq
from dataclasses import dataclass

Voxel = tuple[int, int, int]
NEIGHBORS: tuple[Voxel, ...] = tuple(
    (dx, dy, dz)
    for dx in (-1, 0, 1)
    for dy in (-1, 0, 1)
    for dz in (-1, 0, 1)
    if not (dx == 0 and dy == 0 and dz == 0)
)


@dataclass(frozen=True)
class Volume:
    """Inclusive voxel box. A path may pass under or over it."""

    x0: int
    x1: int
    y0: int
    y1: int
    z0: int
    z1: int

    def blocks(self, voxel: Voxel) -> bool:
        x, y, z = voxel
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1 and self.z0 <= z <= self.z1


@dataclass(frozen=True)
class Route:
    path: tuple[Voxel, ...]
    cost: float
    feasible: bool
    reason: str = ""


def _blocked(voxel: Voxel, volumes: list[Volume], bounds: tuple[int, int, int]) -> bool:
    x, y, z = voxel
    mx, my, mz = bounds
    if not (0 <= x < mx and 0 <= y < my and 0 <= z < mz):
        return True
    return any(volume.blocks(voxel) for volume in volumes)


def _step_cost(a: Voxel, b: Voxel, mode: str) -> float:
    dx, dy, dz = abs(b[0] - a[0]), abs(b[1] - a[1]), abs(b[2] - a[2])
    distance = float((dx * dx + dy * dy + dz * dz) ** 0.5)
    if mode == "time":
        return distance
    if mode == "energy":
        climb = max(0, b[2] - a[2])
        return distance + 2.0 * float(climb)
    raise ValueError("mode must be time or energy")


def plan_route(
    start: Voxel,
    goal: Voxel,
    *,
    bounds: tuple[int, int, int] = (16, 16, 8),
    volumes: list[Volume] | None = None,
    mode: str = "time",
    required_time_on_target: tuple[float, float] | None = None,
    speed_cells_per_s: float = 1.0,
) -> Route:
    """A* on a voxel grid. required_time_on_target is (earliest, latest) arrival."""
    obstacles = volumes or []
    if _blocked(start, obstacles, bounds) or _blocked(goal, obstacles, bounds):
        return Route((start,), 0.0, False, "endpoint_blocked")

    def heuristic(voxel: Voxel) -> float:
        return _step_cost(voxel, goal, "time")

    open_heap: list[tuple[float, float, Voxel]] = [(heuristic(start), 0.0, start)]
    came: dict[Voxel, Voxel] = {}
    best: dict[Voxel, float] = {start: 0.0}
    while open_heap:
        _, cost, current = heapq.heappop(open_heap)
        if cost > best.get(current, 1e18):
            continue
        if current == goal:
            path = [current]
            while path[-1] != start:
                path.append(came[path[-1]])
            path.reverse()
            arrival = cost / speed_cells_per_s if mode == "time" else cost
            if required_time_on_target is not None and mode == "time":
                earliest, latest = required_time_on_target
                if arrival > latest:
                    return Route(tuple(path), cost, False, "late")
                if arrival < earliest:
                    # Loiter at the goal until the window opens. The path is kept.
                    wait = earliest - arrival
                    return Route(tuple(path), cost + wait * speed_cells_per_s, True, "loiter")
            return Route(tuple(path), cost, True)
        for delta in NEIGHBORS:
            nxt = (current[0] + delta[0], current[1] + delta[1], current[2] + delta[2])
            if _blocked(nxt, obstacles, bounds):
                continue
            next_cost = cost + _step_cost(current, nxt, mode)
            if next_cost < best.get(nxt, 1e18):
                best[nxt] = next_cost
                came[nxt] = current
                heapq.heappush(open_heap, (next_cost + heuristic(nxt), next_cost, nxt))
    return Route((start,), 0.0, False, "no_path")
