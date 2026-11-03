"""Bench tests. The check logic runs anywhere; the transport test needs pymavlink."""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime
from pathlib import Path

import bench
import checks
import pytest
from capture import (
    MAV_CMD_REQUEST_MESSAGE,
    MAV_CMD_SET_MESSAGE_INTERVAL,
    Refused,
    SafeSender,
)

PROFILE = json.loads((Path(__file__).parent / "profiles" / "variant-a.json").read_text())
GOOD_PARAMS = {"NAV_RCL_ACT": 2, "NAV_DLL_ACT": 2, "COM_DL_LOSS_T": 10, "COM_RC_LOSS_T": 0.5, "COM_LOW_BAT_ACT": 3, "GF_ACTION": 3, "BAT_CRIT_THR": 0.07}
SHA = "a" * 64


def good_capture(gyro_sigma: float = 0.003, seed: int = 3) -> checks.Capture:
    rng = random.Random(seed)
    imu = [
        (rng.gauss(0, gyro_sigma), rng.gauss(0, gyro_sigma), rng.gauss(0, gyro_sigma), rng.gauss(0, 0.03), rng.gauss(0, 0.03), rng.gauss(-9.81, 0.03))
        for _ in range(500)
    ]
    return checks.Capture(
        duration_s=10,
        heartbeats=[{"autopilot": 12, "type": 2, "base_mode": 1}] * 10,
        flight_sw_version=(1 << 24) | (18 << 16),
        sys_status={"present": 15, "enabled": 15, "health": 15},
        params={k: float(v) for k, v in GOOD_PARAMS.items()},
        imu=imu,
        attitude_count=500,
        seq_total=2000,
    )


def failing(cap: checks.Capture) -> list[str]:
    return [c.name for c in checks.run(cap, PROFILE) if not c.passed]


def test_a_good_board_passes_every_check():
    assert failing(good_capture()) == []


def test_each_fault_fails_the_check_that_names_it():
    cap = good_capture(gyro_sigma=0.03)
    assert failing(cap) == ["imu gyro_noise_rad_s"]

    cap = good_capture()
    cap.params["NAV_DLL_ACT"] = 0
    assert failing(cap) == ["param NAV_DLL_ACT"]

    cap = good_capture()
    del cap.params["GF_ACTION"]
    assert failing(cap) == ["param GF_ACTION"]

    cap = good_capture()
    cap.sys_status = {"present": 15, "enabled": 15, "health": 11}
    assert failing(cap) == ["sensors"]

    cap = good_capture()
    cap.flight_sw_version = (1 << 24) | (17 << 16)
    assert failing(cap) == ["firmware"]

    cap = good_capture()
    cap.attitude_count = 200
    assert failing(cap) == ["attitude rate"]


def test_armed_is_a_failure_and_reported_before_content_checks():
    cap = good_capture()
    cap.heartbeats = cap.heartbeats[:5] + [{"autopilot": 12, "type": 2, "base_mode": 1 | 128}]
    cap.seq_lost, cap.seq_total = 100, 2000
    results = checks.run(cap, PROFILE)
    assert checks.first_failure(results).startswith("disarmed")


def test_no_heartbeat_is_one_failure_with_a_hint():
    results = checks.run(checks.Capture(duration_s=0), PROFILE)
    assert [c.name for c in results] == ["heartbeat"]
    assert "cable" in results[0].detail


def test_px4_version_decodes():
    assert checks.decode_px4_version((1 << 24) | (18 << 16) | (2 << 8) | 255) == "1.18.2"


class Recorder:
    def __init__(self) -> None:
        self.sent: list[tuple[str, tuple]] = []

    def __getattr__(self, name):  # type: ignore[no-untyped-def]
        return lambda *args: self.sent.append((name, args))


def test_the_sender_only_reads():
    rec = Recorder()
    tx = SafeSender(rec)
    tx.heartbeat()
    tx.param_request_list()
    tx.param_request_read("NAV_DLL_ACT")
    tx.stream(30, 50)
    tx.request(148)
    assert [n for n, _ in rec.sent] == ["heartbeat_send", "param_request_list_send", "param_request_read_send", "command_long_send", "command_long_send"]
    assert {args[2] for n, args in rec.sent if n == "command_long_send"} == {MAV_CMD_SET_MESSAGE_INTERVAL, MAV_CMD_REQUEST_MESSAGE}

    for cmd in (400, 176, 209, 310):  # arm/disarm, set mode, motor test, actuator test
        with pytest.raises(Refused):
            tx.command(cmd, 1)
    for name in ("param_set", "set_position_target_local_ned_send", "manual_control_send"):
        with pytest.raises(Refused):
            getattr(tx, name)
    assert len(rec.sent) == 5


def test_birth_record_reads_back_as_the_console_verdict():
    birth = pytest.importorskip("a2e.birth")
    parts = [{"part": "FC-H743", "lot": "L1"}]

    ok = bench.birth_record("NX-0042", parts, SHA, checks.run(good_capture(), PROFILE), datetime.now(UTC))
    assert birth.verdict(birth.from_dict(ok)).status == "airworthy"
    assert {c["name"] for c in ok["calibrations"]} == {"gyro_noise_rad_s", "gyro_bias_rad_s", "accel_noise_m_s2", "accel_gravity_m_s2"}

    bad = bench.birth_record("NX-0043", parts, SHA, checks.run(good_capture(gyro_sigma=0.03), PROFILE), datetime.now(UTC))
    v = birth.verdict(birth.from_dict(bad))
    assert v.status == "grounded"
    assert "gyro_noise_rad_s" in v.reason


@pytest.mark.parametrize(("fault", "expect"), [("good", None), ("bad-param", "param NAV_DLL_ACT"), ("no-mag", "sensors")])
def test_end_to_end_over_mavlink_against_the_emulator(fault, expect, tmp_path):
    pytest.importorskip("pymavlink")
    out = tmp_path / "r.json"
    port = {"good": 14661, "bad-param": 14662, "no-mag": 14663}[fault]
    import emulator
    from capture import capture

    _, stop = emulator.start(port, fault, 20)
    try:
        cap = capture(f"udpin:127.0.0.1:{port}", 0, 3.0, list(PROFILE["params"]))
    finally:
        stop.set()
    results = checks.run(cap, PROFILE)
    assert (checks.first_failure(results).split(":")[0] or None) == expect
    record = bench.birth_record("E2E", [], SHA, results, datetime.now(UTC))
    out.write_text(json.dumps(record))
    assert record["eol"]["passed"] is (expect is None)
