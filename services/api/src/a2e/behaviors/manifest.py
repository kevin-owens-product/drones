"""Signed behavior manifests. A package that can employ a weapon is rejected."""

from __future__ import annotations

import hashlib
import json
from typing import Any

REQUIRED_SAFETY = {
    "weapons_interface": "forbidden",
    "human_approval_required": True,
}


class ManifestError(ValueError):
    pass


def canonical_manifest(body: dict[str, Any]) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest_manifest(body: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_manifest(body).encode("utf-8")).hexdigest()


def validate_manifest(body: dict[str, Any]) -> None:
    for field in ("name", "version", "inputs", "outputs", "resources", "safety", "promotion"):
        if field not in body:
            raise ManifestError(f"missing {field}")
    safety = body["safety"]
    if not isinstance(safety, dict):
        raise ManifestError("safety must be an object")
    if safety.get("weapons_interface") != "forbidden":
        raise ManifestError("weapons_interface must be forbidden")
    if safety.get("human_approval_required") is not True:
        raise ManifestError("human_approval_required must be true")
    promotion = body["promotion"]
    if promotion not in {"sim_validated", "hitl_validated", "flight_cleared"}:
        raise ManifestError("unknown promotion state")
    resources = body["resources"]
    if not isinstance(resources, dict):
        raise ManifestError("resources must be an object")
    for key in ("cpu", "memory_mb"):
        if key not in resources:
            raise ManifestError(f"missing resources.{key}")


def live_start_allowed(*, promotion: str, mission_state: str) -> bool:
    """A live tail starts only from an approved mission and a flight-cleared package."""
    return promotion == "flight_cleared" and mission_state == "approved"
