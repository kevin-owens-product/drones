"""The captured six-quad log must keep its sensor counts."""

from __future__ import annotations

from pathlib import Path

from a2e.flight.ulg import fixture_ulg, plot_series, summarize

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "px4" / "six-quad-instance5.ulg"

# Floors are the counts in the log copied from a2e-px4-fleet instance 5 on 2026-11-03.
FLOORS = {
    "sensor_combined": 400,
    "vehicle_attitude": 250,
    "vehicle_local_position": 180,
    "vehicle_gps_position": 40,
}


def test_captured_log_has_the_sensor_suite() -> None:
    report = summarize(FIXTURE)
    assert report["duration_s"] > 1.0
    messages = set(report["messages"])
    for name in ("sensor_baro", "sensor_mag", "sensor_gps", "sensor_optical_flow", "vehicle_gps_position"):
        assert name in messages
    counts = report["counts"]
    for name, floor in FLOORS.items():
        assert counts[name] >= floor


def test_fixture_name_cannot_escape() -> None:
    assert fixture_ulg("six-quad-instance5.ulg") == FIXTURE.resolve()
    assert fixture_ulg("../dev.sql") is None
    assert fixture_ulg("nope.ulg") is None


def test_plot_series_matches_the_log() -> None:
    series = plot_series(FIXTURE)
    assert len(series["t_s"]) == len(series["z_m"])
    assert len(series["t_s"]) >= FLOORS["vehicle_local_position"]
    assert len(series["q0"]) >= FLOORS["vehicle_attitude"]
    assert all(t >= 0 for t in series["t_s"])
