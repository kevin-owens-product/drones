from __future__ import annotations

import pytest

from a2e.behaviors.custody import Custodian, TrackTarget, allocate_custody
from a2e.behaviors.manifest import ManifestError, live_start_allowed, validate_manifest
from a2e.behaviors.route import Volume, plan_route
from a2e.behaviors.scorecard import Baseline, Scorecard, compare
from a2e.behaviors.search import Vehicle, coverage_fraction, plan_search
from a2e.behaviors.video_manager import StreamNeed, allocate_bandwidth
from a2e.behaviors.weather import avoidance_volumes, build_simple_grib2, parse_grib2
from a2e.debrief.replay import Cue, build_timeline
from a2e.edge.sync import Operation, reconcile, write_region
from a2e.missions.exports import to_csv, to_pdf, to_xapi
from a2e.missions.workflow import WorkflowError, transition
from a2e.sim.dynamics import KinematicState, Wind, step
from a2e.sim.runtime import FantomRuntime, RuntimeUnavailable, SimRuntime
from a2e.video.hls import playlist
from a2e.video.klv import encode_uas_datalink, parse_uas_datalink


def _manifest(promotion: str = "sim_validated") -> dict[str, object]:
    return {
        "name": "area-search",
        "version": "1.0.0",
        "inputs": ["polygon"],
        "outputs": ["assignments"],
        "resources": {"cpu": "500m", "memory_mb": 256},
        "safety": {"weapons_interface": "forbidden", "human_approval_required": True},
        "promotion": promotion,
    }


def test_manifest_rejects_weapons() -> None:
    body = _manifest()
    validate_manifest(body)
    bad = _manifest()
    assert isinstance(bad["safety"], dict)
    bad["safety"]["weapons_interface"] = "enabled"
    with pytest.raises(ManifestError):
        validate_manifest(bad)
    assert live_start_allowed(promotion="sim_validated", mission_state="approved") is False
    assert live_start_allowed(promotion="flight_cleared", mission_state="approved") is True


def test_search_replans_when_a_vehicle_drops() -> None:
    polygon = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    vehicles = [Vehicle("a", 0, 0), Vehicle("b", 1, 1)]
    full = plan_search(polygon, vehicles, columns=4, rows=2)
    reduced = plan_search(polygon, vehicles, columns=4, rows=2, dropped=["b"])
    assert {item.vehicle_id for item in reduced.assignments} == {"a"}
    assert reduced.cell_count == full.cell_count
    assert coverage_fraction(full, set(full.assignments[0].cells)) < 1


def test_route_goes_under_an_overhang() -> None:
    blocked = Volume(1, 1, 0, 0, 2, 3)
    route = plan_route((0, 0, 0), (3, 0, 0), volumes=[blocked], mode="energy")
    assert route.feasible
    assert all(cell[2] < 2 or cell[0] != 1 for cell in route.path)
    late = plan_route(
        (0, 0, 0),
        (3, 0, 0),
        mode="time",
        required_time_on_target=(0.0, 0.1),
        speed_cells_per_s=1.0,
    )
    assert late.feasible is False
    assert late.reason == "late"


def test_grib_round_trip_and_volumes() -> None:
    message = build_simple_grib2(2, 2, [0, 10, 30, 5])
    fields = parse_grib2(message)
    assert len(fields) == 1
    assert [int(value) for value in fields[0].values] == [0, 10, 30, 5]
    volumes = avoidance_volumes(fields[0], kind="wind", threshold=20, floor_m=0, ceiling_m=500)
    assert len(volumes) == 1
    assert volumes[0].kind == "wind"


def test_custody_ignores_non_targets_and_reallocates() -> None:
    vehicles = [Custodian("v1", 0, 0), Custodian("v2", 1, 0)]
    entities = [
        TrackTarget("bird", 0, 0, kind="clutter"),
        TrackTarget("t1", 0.1, 0),
        TrackTarget("t2", 0.9, 0),
    ]
    plan = allocate_custody(vehicles, entities)
    assert plan.regime == "x_ge_n"
    assert {item.target_id for item in plan.assignments} == {"t1", "t2"}
    lost = allocate_custody(vehicles[:1], entities)
    assert len(lost.assignments) == 1
    assert lost.unassigned


def test_video_budget_sheds_low_score_streams() -> None:
    grants = allocate_bandwidth(
        [
            StreamNeed("a", 500, 0.2, 0.2),
            StreamNeed("b", 400, 1.0, 1.0),
        ],
        budget_kbps=450,
    )
    assert [item.stream_id for item in grants] == ["b"]


def test_workflow_and_exports() -> None:
    assert transition("draft", "mission.review", actor_id="p", requested_by="p") == "review"
    with pytest.raises(WorkflowError):
        transition("draft", "mission.approve", actor_id="c", requested_by="p")
    with pytest.raises(WorkflowError):
        transition("review", "mission.approve", actor_id="p", requested_by="p")
    with pytest.raises(WorkflowError):
        transition(
            "review",
            "mission.approve",
            actor_id="c",
            requested_by="p",
            behavior_initiated=True,
        )
    text = to_csv([{"tail": "N-003", "banner": "CUI"}])
    assert "N-003" in text
    assert to_pdf("Debrief", "CUI").startswith(b"%PDF-")
    statement = to_xapi("ada", "debriefed", "mission-1", "CUI")
    assert statement["context"]["extensions"]["https://a2e.invalid/banner"] == "CUI"


def test_scorecard_flags_regression() -> None:
    failures = compare(
        Scorecard(90, 80, 120, 0, 1),
        Baseline(99, 80, 100, 0, 1),
    )
    assert "coverage_regressed" in failures
    assert "energy_regressed" in failures


def test_edge_reconcile() -> None:
    remote = [Operation("e1", "telemetry", "tail", "core", "h1")]
    local = [
        Operation("e1", "telemetry", "tail", "edge", "h1"),
        Operation("e2", "telemetry", "tail", "edge", "h2"),
        Operation("m1", "mission", "plan-1", "edge", "edit-b"),
    ]
    remote.append(Operation("m0", "mission", "plan-1", "core", "edit-a"))
    result = reconcile(local, remote)
    assert "e2" in result.appended
    assert "e1" not in result.appended
    assert result.frozen_plans == ["plan-1"]
    assert write_region("us-east", {"us-east": True, "us-west": True}) == "us-east"
    assert write_region("us-east", {"us-east": False, "us-west": True}) is None


@pytest.mark.asyncio
async def test_runtimes() -> None:
    sim = SimRuntime()
    handle = await sim.load(_manifest())
    await sim.start(handle, "draft", live=False)
    status = await sim.status(handle)
    assert status["running"] is True
    with pytest.raises(ManifestError):
        await sim.start(handle, "approved", live=True)
    fantom = FantomRuntime()
    with pytest.raises(RuntimeUnavailable):
        await fantom.load(_manifest())


def test_klv_and_timeline() -> None:
    packet = encode_uas_datalink(34.05, -106.2, 1_000)
    frame = parse_uas_datalink(packet)
    assert frame.checksum_ok
    assert frame.sensor_lat is not None
    assert abs(frame.sensor_lat - 34.05) < 0.01
    broken = bytearray(packet)
    broken[-1] ^= 0xFF
    with pytest.raises(Exception):
        parse_uas_datalink(bytes(broken))
    ordered = build_timeline(
        [Cue(20, "telemetry", {})],
        [Cue(5, "klv", {})],
    )
    assert [item.time_us for item in ordered] == [5, 20]
    assert "EXTM3U" in playlist("s1", [(1.0, "a.ts")])


def test_point_mass_moves_with_wind() -> None:
    state = KinematicState(34.0, -106.0, 100.0, 10.0, 0.0, 0.0)
    nxt = step(state, Wind(vn=5.0), 10.0)
    assert nxt.lat > state.lat
    assert nxt.alt_m == 100.0
