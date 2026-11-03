"""Failure-mode triage over SITL rows, and the scenario gate summary."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml  # type: ignore[import-untyped]

from a2e.evalreport import FIELDS, check_scenarios, render_gate
from a2e.evalreport import main as gate_main
from a2e.triage import MODES, main, render_ranking, scenario_stub, triage_paths, triage_rows

ROOT = Path(__file__).resolve().parents[4]
EVAL = ROOT / "docs" / "eval"


def test_rows_are_tagged_and_ranked() -> None:
    rows = [
        {"fault": "drag", "mode": "gated", "seed": 0, "detect_s": 25.0, "err_end_m": 6.0, "false_drops": 0},
        {"fault": "drag", "mode": "gated", "seed": 1, "detect_s": None, "err_end_m": 9.0, "false_drops": 0},
        {"fault": "loss", "mode": "fused", "seed": 0, "detect_s": None, "err_end_m": 3.0, "false_drops": 1},
        {"fault": "loss", "mode": "gnss_only", "seed": 0, "detect_s": None, "err_end_m": 400.0, "false_drops": 0},
        {"tracker": "v2", "seed": 3, "lost_at_s": 12.0, "false_lock_frac": 0.6},
    ]
    found = triage_rows("t", rows)
    assert found["spoof_drift"].runs == ["t#1:drag/gated/s0", "t#2:drag/gated/s1"]
    assert found["spoof_detect_slow"].runs == ["t#1:drag/gated/s0"]
    assert found["spoof_undetected"].runs == ["t#2:drag/gated/s1"]
    assert found["false_gnss_drop"].runs == ["t#3:loss/fused/s0"]
    assert "denied_drift" not in found  # the gnss_only baseline is skipped by default
    assert triage_rows("t", rows, include_baselines=True)["denied_drift"].runs == ["t#4:loss/gnss_only/s0"]
    assert found["track_lost"].runs == found["track_swap"].runs == ["t#5:v2/s3"]


def test_committed_sitl_logs_rank_and_stub_is_a_valid_scenario(tmp_path: Path) -> None:
    modes = triage_paths(sorted(EVAL.glob("sitl_*.jsonl")))
    assert modes, "the committed SITL rows should show at least one failure mode"
    counts = [len(mode.runs) for mode in modes]
    assert counts == sorted(counts, reverse=True)
    assert "| 1 |" in render_ranking(modes)

    stub = yaml.safe_load(scenario_stub(modes[0]))
    assert stub["name"] == f"triage_{modes[0].key}"
    assert "max" in stub or "min" in stub
    # The stub follows scenarios/ format, so the gate can read it.
    (tmp_path / "stub.yaml").write_text(scenario_stub(modes[0]))
    failures = check_scenarios((EVAL / "latest.txt").read_text(), tmp_path)
    assert all("missing metric" not in item for item in failures)


def test_stub_metrics_with_a_field_match_evalreport() -> None:
    names = {name for name, *_rest in FIELDS}
    gated = {"spoof_drift", "denied_drift", "spoof_detect_slow", "spoof_undetected", "false_gnss_drop", "track_lost"}
    for key in gated:
        assert MODES[key][1]["metric"] in names


def test_cli_writes_stub(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "top.yaml"
    assert main([str(EVAL / "sitl_track.jsonl"), "--stub", str(out)]) == 0
    assert out.read_text().startswith("# Stub from a2e.triage")


def test_gate_summary_marks_failures() -> None:
    log = (EVAL / "latest.txt").read_text()
    ok = render_gate(log, ROOT / "scenarios")
    assert "FAIL" not in ok
    bad = render_gate(log.replace("loss_detect_s 1.6", "loss_detect_s 9.0"), ROOT / "scenarios")
    assert "| gnss_loss.yaml | GNSS loss detect | 9.0 | max 5 | FAIL |" in bad


def test_boot_only_ulog_is_not_a_failure() -> None:
    fixture = ROOT / "services" / "api" / "tests" / "fixtures" / "px4" / "six-quad-instance5.ulg"
    assert triage_paths([fixture]) == []


def test_gate_cli_appends_step_summary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    assert gate_main([str(EVAL / "latest.txt"), "--scenarios", str(ROOT / "scenarios")]) == 0
    assert summary.read_text().startswith("### Scenario gate: ")
