"""Signed, staged fleet updates (bet 6, first slice).

A build ships as an Ed25519-signed manifest. The rollout moves through cohorts
(1%, 10%, 50%, 100%). Each vehicle walks pending -> staged -> applied -> verified,
or ends rolled_back. A health gate compares the cohort's metrics to a baseline
and halts and rolls back on regression. Vehicles offline during a stage keep
their state and catch up on the next tick they are reachable.

This module moves software, not flight commands. It never arms, launches, or
commands a vehicle (ADR 0016).
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass, field
from enum import StrEnum

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from a2e.chain import canonical_json

STAGES: tuple[float, ...] = (0.01, 0.10, 0.50, 1.00)


class RolloutError(Exception):
    pass


@dataclass(frozen=True)
class Manifest:
    build_id: str
    version: str
    artifact_sha256: str
    target: str  # e.g. "px4-companion"

    def payload(self) -> bytes:
        return canonical_json(asdict(self)).encode()


@dataclass(frozen=True)
class SignedManifest:
    manifest: Manifest
    signature: bytes


def sign_manifest(key: Ed25519PrivateKey, manifest: Manifest) -> SignedManifest:
    return SignedManifest(manifest, key.sign(manifest.payload()))


def verify_manifest(public_key: Ed25519PublicKey, signed: SignedManifest) -> Manifest:
    try:
        public_key.verify(signed.signature, signed.manifest.payload())
    except InvalidSignature as exc:
        raise RolloutError(f"manifest signature invalid for {signed.manifest.build_id}") from exc
    return signed.manifest


class VehicleState(StrEnum):
    PENDING = "pending"
    STAGED = "staged"
    APPLIED = "applied"
    VERIFIED = "verified"
    ROLLED_BACK = "rolled_back"


class RolloutStatus(StrEnum):
    RUNNING = "running"
    HALTED = "halted"
    COMPLETE = "complete"


@dataclass(frozen=True)
class HealthGate:
    """Lower-is-better metrics. A metric regresses when the cohort mean exceeds
    baseline * (1 + rel_tolerance) + abs_tolerance."""

    rel_tolerance: float = 0.10
    abs_tolerance: float = 0.01
    min_reporting: float = 0.80  # share of the cohort that must have verified

    def regressions(self, baseline: Mapping[str, float], cohort: Mapping[str, float]) -> list[str]:
        return [
            name
            for name, base in baseline.items()
            if cohort.get(name, 0.0) > base * (1 + self.rel_tolerance) + self.abs_tolerance
        ]


Metrics = Callable[[str], Mapping[str, float]]


@dataclass
class Rollout:
    signed: SignedManifest
    public_key: Ed25519PublicKey
    vehicles: Iterable[str]
    baseline: Mapping[str, float]
    gate: HealthGate = field(default_factory=HealthGate)
    stage: int = 0
    status: RolloutStatus = RolloutStatus.RUNNING
    halt_reason: str = ""
    state: dict[str, VehicleState] = field(init=False)
    order: list[str] = field(init=False)

    def __post_init__(self) -> None:
        manifest = verify_manifest(self.public_key, self.signed)  # refuse before touching state
        ids = sorted(set(self.vehicles))
        if not ids:
            raise RolloutError("empty fleet")

        def rank(vid: str) -> str:
            return hashlib.sha256(f"{manifest.build_id}:{vid}".encode()).hexdigest()

        self.order = sorted(ids, key=rank)
        self.state = {vid: VehicleState.PENDING for vid in ids}

    def cohort(self, stage: int | None = None) -> list[str]:
        idx = self.stage if stage is None else stage
        size = max(1, round(len(self.order) * STAGES[idx]))
        return self.order[:size]

    def counts(self) -> dict[str, int]:
        out = {s.value: 0 for s in VehicleState}
        for s in self.state.values():
            out[s.value] += 1
        return out

    def tick(self, online: set[str], metrics: Metrics) -> RolloutStatus:
        """One reconcile pass. Only vehicles in `online` change state."""
        if self.status is RolloutStatus.HALTED:
            self._roll_back(online)
            return self.status
        for vid in self.cohort():
            if vid in online:
                self._advance(vid)
        if self._gate(metrics):
            self.status = RolloutStatus.HALTED
            self._roll_back(online)
        elif all(s is VehicleState.VERIFIED for s in self.state.values()):
            self.status = RolloutStatus.COMPLETE
        return self.status

    def _advance(self, vid: str) -> None:
        # One hop per tick models download, then install, then post-install check.
        nxt = {
            VehicleState.PENDING: VehicleState.STAGED,
            VehicleState.STAGED: VehicleState.APPLIED,
            VehicleState.APPLIED: VehicleState.VERIFIED,
        }
        cur = self.state[vid]
        if cur in nxt:
            self.state[vid] = nxt[cur]

    def _gate(self, metrics: Metrics) -> bool:
        """Return True when the current cohort regressed and the rollout must halt."""
        cohort = self.cohort()
        verified = [v for v in cohort if self.state[v] is VehicleState.VERIFIED]
        if len(verified) < self.gate.min_reporting * len(cohort):
            return False
        means: dict[str, float] = {}
        for name in self.baseline:
            means[name] = sum(metrics(v).get(name, 0.0) for v in verified) / len(verified)
        bad = self.gate.regressions(self.baseline, means)
        if bad:
            self.halt_reason = f"stage {STAGES[self.stage]:.0%} regressed: {', '.join(bad)}"
            return True
        if self.stage + 1 < len(STAGES):
            self.stage += 1
        return False

    def _roll_back(self, online: set[str]) -> None:
        for vid, s in self.state.items():
            if vid in online and s in (
                VehicleState.STAGED,
                VehicleState.APPLIED,
                VehicleState.VERIFIED,
            ):
                self.state[vid] = VehicleState.ROLLED_BACK
