from __future__ import annotations

import random
from collections.abc import Mapping
from dataclasses import replace

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from a2e.rollout import (
    STAGES,
    Manifest,
    Rollout,
    RolloutError,
    RolloutStatus,
    SignedManifest,
    VehicleState,
    sign_manifest,
)

FLEET = [f"N-{i:04d}" for i in range(1000)]
BASELINE = {"failsafe_rate": 0.02, "ekf_resets_per_hr": 0.50}
KEY = Ed25519PrivateKey.generate()


def manifest(build: str) -> Manifest:
    return Manifest(build_id=build, version="1.4.0", artifact_sha256="ab" * 32, target="companion")


def healthy(_: str) -> Mapping[str, float]:
    return {"failsafe_rate": 0.02, "ekf_resets_per_hr": 0.48}


def regressed(_: str) -> Mapping[str, float]:
    return {"failsafe_rate": 0.09, "ekf_resets_per_hr": 0.50}


def run(rollout: Rollout, metrics, offline_rate: float, seed: int, max_ticks: int = 60) -> int:
    rng = random.Random(seed)
    for tick in range(1, max_ticks + 1):
        online = {v for v in FLEET if rng.random() >= offline_rate}
        if rollout.tick(online, metrics) is not RolloutStatus.RUNNING:
            return tick
    return max_ticks


def test_good_build_reaches_full_fleet_with_offline_vehicles() -> None:
    rollout = Rollout(sign_manifest(KEY, manifest("b-good")), KEY.public_key(), FLEET, BASELINE)
    ticks = run(rollout, healthy, offline_rate=0.15, seed=7)
    assert rollout.status is RolloutStatus.COMPLETE, rollout.counts()
    assert rollout.stage == len(STAGES) - 1
    assert rollout.counts()["verified"] == 1000
    assert ticks < 60


def test_offline_vehicle_catches_up_when_link_returns() -> None:
    rollout = Rollout(sign_manifest(KEY, manifest("b-late")), KEY.public_key(), FLEET, BASELINE)
    straggler = rollout.cohort(len(STAGES) - 1)[-1]
    everyone_but = set(FLEET) - {straggler}
    for _ in range(30):
        rollout.tick(everyone_but, healthy)
    assert rollout.stage == len(STAGES) - 1
    assert rollout.state[straggler] is VehicleState.PENDING
    assert rollout.status is RolloutStatus.RUNNING
    for _ in range(3):
        rollout.tick(set(FLEET), healthy)
    assert rollout.state[straggler] is VehicleState.VERIFIED
    assert rollout.status is RolloutStatus.COMPLETE


def test_bad_build_halts_at_canary_and_rolls_back() -> None:
    rollout = Rollout(sign_manifest(KEY, manifest("b-bad")), KEY.public_key(), FLEET, BASELINE)
    run(rollout, regressed, offline_rate=0.0, seed=3)
    canary = set(rollout.cohort(0))
    assert len(canary) == 10
    assert rollout.status is RolloutStatus.HALTED
    assert rollout.stage == 0
    assert "failsafe_rate" in rollout.halt_reason
    beyond = [v for v in FLEET if v not in canary and rollout.state[v] is not VehicleState.PENDING]
    assert beyond == []
    assert all(rollout.state[v] is VehicleState.ROLLED_BACK for v in canary)


def test_offline_canary_rolls_back_when_it_reconnects() -> None:
    rollout = Rollout(sign_manifest(KEY, manifest("b-bad2")), KEY.public_key(), FLEET, BASELINE)
    away = rollout.cohort(0)[0]
    rollout.tick(set(FLEET), regressed)  # whole canary downloads the build
    assert rollout.state[away] is VehicleState.STAGED
    for _ in range(2):  # away drops its link; the other nine install and report
        rollout.tick(set(FLEET) - {away}, regressed)
    assert rollout.status is RolloutStatus.HALTED
    assert rollout.state[away] is VehicleState.STAGED
    rollout.tick({away}, regressed)
    assert rollout.state[away] is VehicleState.ROLLED_BACK


def test_tampered_manifest_is_rejected() -> None:
    signed = sign_manifest(KEY, manifest("b-good"))
    forged = SignedManifest(replace(signed.manifest, artifact_sha256="cd" * 32), signed.signature)
    with pytest.raises(RolloutError):
        Rollout(forged, KEY.public_key(), FLEET, BASELINE)
    other = Ed25519PrivateKey.generate()
    with pytest.raises(RolloutError):
        Rollout(sign_manifest(other, manifest("b-good")), KEY.public_key(), FLEET, BASELINE)
