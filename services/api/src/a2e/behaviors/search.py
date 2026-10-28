"""Collaborative area search. Strips are replanned when a vehicle drops."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Vehicle:
    ident: str
    lat: float
    lon: float


@dataclass(frozen=True)
class SearchAssignment:
    vehicle_id: str
    cells: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class SearchPlan:
    assignments: tuple[SearchAssignment, ...]
    cell_count: int
    dropped: tuple[str, ...]


def _inside(lon: float, lat: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        intersects = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def plan_search(
    polygon: list[tuple[float, float]],
    vehicles: list[Vehicle],
    *,
    columns: int = 4,
    rows: int = 4,
    prior: dict[tuple[int, int], float] | None = None,
    prior_threshold: float = 0.8,
    dropped: list[str] | None = None,
) -> SearchPlan:
    """Cover a polygon with the vehicles still present. High priors are skipped."""
    if columns < 1 or rows < 1:
        raise ValueError("grid must be positive")
    dropped_ids = set(dropped or [])
    active = [vehicle for vehicle in vehicles if vehicle.ident not in dropped_ids]
    lons = [point[0] for point in polygon]
    lats = [point[1] for point in polygon]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    cells: list[tuple[int, int]] = []
    for row in range(rows):
        for col in range(columns):
            lon = min_lon + (col + 0.5) * (max_lon - min_lon) / columns
            lat = min_lat + (row + 0.5) * (max_lat - min_lat) / rows
            if not _inside(lon, lat, polygon):
                continue
            if prior and prior.get((col, row), 0.0) >= prior_threshold:
                continue
            cells.append((col, row))
    if not active:
        return SearchPlan((), len(cells), tuple(sorted(dropped_ids)))
    buckets: list[list[tuple[int, int]]] = [[] for _ in active]
    for index, cell in enumerate(sorted(cells)):
        buckets[index % len(active)].append(cell)
    assignments = tuple(
        SearchAssignment(vehicle.ident, tuple(bucket))
        for vehicle, bucket in zip(active, buckets, strict=True)
        if bucket
    )
    return SearchPlan(assignments, len(cells), tuple(sorted(dropped_ids)))


def coverage_fraction(plan: SearchPlan, visited: set[tuple[int, int]]) -> float:
    if plan.cell_count == 0:
        return 1.0
    owned = {cell for assignment in plan.assignments for cell in assignment.cells}
    if not owned:
        return 0.0
    return len(owned & visited) / len(owned)
