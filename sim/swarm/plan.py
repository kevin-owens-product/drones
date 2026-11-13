"""Swarm geometry: where each vehicle goes for a formation or an area sweep.

Pure functions on a local north/east plane in metres, so they test without a
simulator. The bridge turns the results into MAVLink commands.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise, permutations

EARTH_R = 6_378_137.0

SHAPES = ("line", "column", "wedge", "circle")


@dataclass(frozen=True)
class Ref:
    """A lat/lon origin for a local north/east plane."""

    lat: float
    lon: float

    def to_ne(self, lat: float, lon: float) -> tuple[float, float]:
        n = math.radians(lat - self.lat) * EARTH_R
        e = math.radians(lon - self.lon) * EARTH_R * math.cos(math.radians(self.lat))
        return n, e

    def to_ll(self, n: float, e: float) -> tuple[float, float]:
        lat = self.lat + math.degrees(n / EARTH_R)
        lon = self.lon + math.degrees(e / (EARTH_R * math.cos(math.radians(self.lat))))
        return lat, lon


def _rotate(n: float, e: float, heading_deg: float) -> tuple[float, float]:
    """Rotate a body-frame offset (n forward, e right) to a heading clockwise from north."""
    h = math.radians(heading_deg)
    return n * math.cos(h) - e * math.sin(h), n * math.sin(h) + e * math.cos(h)


def formation_slots(shape: str, count: int, spacing_m: float, heading_deg: float = 0.0) -> list[tuple[float, float]]:
    """Offsets (north, east) from the formation centre, one per vehicle.

    line: abreast, across the heading. column: one behind another along it.
    wedge: a V pointing along the heading. circle: evenly round the centre.
    """
    if shape not in SHAPES:
        raise ValueError(f"shape must be one of {', '.join(SHAPES)}")
    if count < 1:
        return []
    if spacing_m <= 0:
        raise ValueError("spacing must be positive")
    body: list[tuple[float, float]] = []
    mid = (count - 1) / 2
    if shape == "line":
        body = [(0.0, (i - mid) * spacing_m) for i in range(count)]
    elif shape == "column":
        body = [((mid - i) * spacing_m, 0.0) for i in range(count)]
    elif shape == "wedge":
        # Leader at the tip, then pairs falling back left and right.
        rows = [(0.0, 0.0)]
        k = 1
        while len(rows) < count:
            for side in (-1, 1):
                if len(rows) < count:
                    rows.append((-k * spacing_m * 0.866, side * k * spacing_m * 0.5))
            k += 1
        # Centre the wedge on its own centroid so it flies to the point asked for.
        cn = sum(r[0] for r in rows) / count
        body = [(n - cn, e) for n, e in rows]
    elif shape == "circle":
        if count == 1:
            body = [(0.0, 0.0)]
        else:
            # Radius that keeps neighbours spacing_m apart on the chord.
            r = spacing_m / (2 * math.sin(math.pi / count))
            body = [(r * math.cos(2 * math.pi * i / count), r * math.sin(2 * math.pi * i / count)) for i in range(count)]
    return [_rotate(n, e, heading_deg) for n, e in body]


def assign(starts: list[tuple[float, float]], goals: list[tuple[float, float]]) -> list[int]:
    """Give each start a goal so the longest leg is as short as it can be, then the total.

    Exact for up to 8 vehicles (8! orderings); greedy nearest pairs above that.
    Minimising the longest leg first keeps vehicles from crossing the whole
    formation, which is what makes paths cross.
    """
    n = len(starts)
    if n != len(goals):
        raise ValueError("starts and goals differ in length")
    dist = [[math.hypot(s[0] - g[0], s[1] - g[1]) for g in goals] for s in starts]
    if n <= 8:
        best: tuple[float, float, tuple[int, ...]] | None = None
        for perm in permutations(range(n)):
            legs = [dist[i][perm[i]] for i in range(n)]
            key = (max(legs) if legs else 0.0, sum(legs), perm)
            if best is None or key[:2] < best[:2]:
                best = key
        return list(best[2]) if best else []
    pairs = sorted((dist[i][j], i, j) for i in range(n) for j in range(n))
    out = [-1] * n
    used: set[int] = set()
    for _, i, j in pairs:
        if out[i] == -1 and j not in used:
            out[i] = j
            used.add(j)
    return out


def sweep_lanes(
    count: int, width_m: float, height_m: float, lane_m: float, heading_deg: float = 0.0
) -> list[list[tuple[float, float]]]:
    """Split a rectangle into one strip per vehicle and fly each strip as a lawnmower.

    The rectangle is centred on the origin, width across the heading and height
    along it. Returns, per vehicle, its waypoints (north, east). Lanes run along
    the heading, lane_m apart, so the camera footprint should be at least lane_m.
    """
    if count < 1:
        return []
    if min(width_m, height_m, lane_m) <= 0:
        raise ValueError("width, height and lane spacing must be positive")
    strip = width_m / count
    out: list[list[tuple[float, float]]] = []
    for k in range(count):
        left = -width_m / 2 + k * strip
        lanes = max(1, math.ceil(strip / lane_m))
        step = strip / lanes
        points: list[tuple[float, float]] = []
        for j in range(lanes):
            e = left + step * (j + 0.5)
            ends = (-height_m / 2, height_m / 2) if j % 2 == 0 else (height_m / 2, -height_m / 2)
            points.extend((n, e) for n in ends)
        out.append([_rotate(n, e, heading_deg) for n, e in points])
    return out


def path_length(points: list[tuple[float, float]]) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in pairwise(points))


def stagger(index: int, base_alt_m: float, step_m: float = 3.0) -> float:
    """Each vehicle flies its own height, so two that meet in transit are still apart vertically."""
    return base_alt_m + index * step_m
