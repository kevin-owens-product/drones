"""Reconnect after a disconnect of up to 72 hours."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Operation:
    event_id: str
    kind: str
    record_id: str
    node_id: str
    body_hash: str


@dataclass
class ReconcileResult:
    appended: list[str] = field(default_factory=list)
    frozen_plans: list[str] = field(default_factory=list)
    rejected_custody: list[str] = field(default_factory=list)


def write_region(home: str, healthy: dict[str, bool]) -> str | None:
    """Mission writes stay pinned to the home region. A dead home does not fail over silently."""
    if healthy.get(home):
        return home
    return None


def reconcile(local: list[Operation], remote: list[Operation]) -> ReconcileResult:
    """Telemetry and audit append. Divergent plans freeze. Custody forks are rejected."""
    result = ReconcileResult()
    seen = {item.event_id: item for item in remote}
    plans: dict[str, set[str]] = {}
    custody: dict[str, set[str]] = {}
    for item in remote:
        if item.kind == "mission":
            plans.setdefault(item.record_id, set()).add(item.body_hash)
        elif item.kind == "custody":
            custody.setdefault(item.record_id, set()).add(item.body_hash)
    for item in local:
        if item.event_id in seen:
            continue
        if item.kind in {"telemetry", "audit"}:
            result.appended.append(item.event_id)
            continue
        if item.kind == "mission":
            hashes = plans.setdefault(item.record_id, set())
            hashes.add(item.body_hash)
            if len(hashes) > 1:
                if item.record_id not in result.frozen_plans:
                    result.frozen_plans.append(item.record_id)
            else:
                result.appended.append(item.event_id)
            continue
        if item.kind == "custody":
            hashes = custody.setdefault(item.record_id, set())
            if hashes and item.body_hash not in hashes:
                if item.record_id not in result.rejected_custody:
                    result.rejected_custody.append(item.record_id)
                continue
            hashes.add(item.body_hash)
            result.appended.append(item.event_id)
    return result
