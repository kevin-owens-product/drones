"""ISR sensor custody. Non-target entities are ignored. No weapons cue."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Custodian:
    ident: str
    lat: float
    lon: float
    sensor_quality: float = 1.0


@dataclass(frozen=True)
class TrackTarget:
    ident: str
    lat: float
    lon: float
    priority: float = 1.0
    kind: str = "target"


@dataclass(frozen=True)
class CustodyAssignment:
    vehicle_id: str
    target_id: str
    quality: float
    mode: str


@dataclass(frozen=True)
class CustodyPlan:
    assignments: tuple[CustodyAssignment, ...]
    unassigned: tuple[str, ...]
    regime: str


def _quality(vehicle: Custodian, target: TrackTarget) -> float:
    distance = abs(vehicle.lat - target.lat) + abs(vehicle.lon - target.lon)
    return max(0.0, min(1.0, vehicle.sensor_quality / (1.0 + distance)))


def allocate_custody(
    vehicles: list[Custodian],
    entities: list[TrackTarget],
    *,
    quality_threshold: float = 0.4,
) -> CustodyPlan:
    targets = [entity for entity in entities if entity.kind == "target"]
    targets.sort(key=lambda item: item.priority, reverse=True)
    x_count, n_count = len(vehicles), len(targets)
    if x_count == 0 or n_count == 0:
        regime = "empty"
    elif x_count >= n_count:
        regime = "x_ge_n"
    elif x_count * 3 < n_count:
        regime = "x_much_lt_n"
    else:
        regime = "x_lt_n"
    remaining = list(vehicles)
    assignments: list[CustodyAssignment] = []
    unassigned: list[str] = []
    if regime == "x_much_lt_n":
        # Time-share: each vehicle takes the next target above the threshold, round-robin.
        for index, target in enumerate(targets):
            if not remaining:
                unassigned.append(target.ident)
                continue
            vehicle = remaining[index % len(remaining)]
            quality = _quality(vehicle, target)
            if quality < quality_threshold:
                unassigned.append(target.ident)
                continue
            mode = "track" if index < len(remaining) else "search"
            assignments.append(CustodyAssignment(vehicle.ident, target.ident, quality, mode))
        return CustodyPlan(tuple(assignments), tuple(unassigned), regime)
    for target in targets:
        if not remaining:
            unassigned.append(target.ident)
            continue
        best = max(remaining, key=lambda vehicle: _quality(vehicle, target))
        quality = _quality(best, target)
        if quality < quality_threshold:
            unassigned.append(target.ident)
            continue
        mode = "track" if regime == "x_ge_n" else "track"
        if regime == "x_ge_n" and len(remaining) > n_count:
            mode = "search"
        assignments.append(CustodyAssignment(best.ident, target.ident, quality, mode))
        remaining.remove(best)
    return CustodyPlan(tuple(assignments), tuple(unassigned), regime)


def custody_fraction(plan: CustodyPlan, threshold: float) -> float:
    targets = len(plan.assignments) + len(plan.unassigned)
    if targets == 0:
        return 1.0
    held = sum(1 for item in plan.assignments if item.quality >= threshold)
    return held / targets
