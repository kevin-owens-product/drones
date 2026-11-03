"""The blackbox fixture is the log the SITL wrote with device VIRTUAL."""

from __future__ import annotations

from pathlib import Path

from a2e.flight.blackbox import fixture_blackbox, plot_series, summarize

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "betaflight" / "sitl.bfl"


def test_sitl_log_keeps_the_intra_interval() -> None:
    summary = summarize(FIXTURE)
    series = plot_series(FIXTURE)
    assert "21e67d203" in summary["firmware"]
    assert summary["frames"] >= 100
    assert summary["duration_s"] > 1
    assert series["t_s"][0] == 0
    assert series["t_s"][-1] > 1
    assert all(b > a for a, b in zip(series["t_s"], series["t_s"][1:], strict=False))
    assert series["gyro_roll"] == [0.0] * len(series["gyro_roll"])


def test_fixture_name_cannot_escape() -> None:
    assert fixture_blackbox("sitl.bfl") == FIXTURE.resolve()
    assert fixture_blackbox("../dev.sql") is None
    assert fixture_blackbox("nope.bfl") is None
