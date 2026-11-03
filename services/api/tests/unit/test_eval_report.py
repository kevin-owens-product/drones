from pathlib import Path

from a2e.evalreport import check_scenarios, metric_rows, parse_metrics, render_table, splice_readme

ROOT = Path(__file__).resolve().parents[4]


def test_parse_and_splice_round_trip() -> None:
    log = """
    crsf_frames_per_sec 1000000
    loss_detect_s 1.6
    step_detect_s 0.2
    drag_detect_s 17.1
    false_alarms_per_hour 0
    drift_m_per_min 3.00
    rmse_m 1.76
    replan_us 0.03
    tasks_covered_after_loss 4
    unguided_min_m 0.00
    guided_min_m 20.10
    success_50m 0.987
    success_5km 0.087
    success_jammed 0.004
    lock_retention 50/50
    reacq_frames 0.00
    mean_pixel_err 0.168
    """
    found = parse_metrics(log)
    assert found["GNSS loss detect"] == "1.6"
    assert found["Guided minimum separation"] == "20.10"
    table = render_table(found)
    readme = "before\n<!-- eval:start -->\nold\n<!-- eval:end -->\nafter\n"
    out = splice_readme(readme, table)
    assert "1.6 s" in out
    assert "0.004 fraction" in out
    assert "50 of 50 runs" in out
    assert out.startswith("before\n")
    assert out.endswith("after\n")
    rows = metric_rows(log)
    assert len(rows) == 16
    assert ("GNSS loss detect", 1.6, "s", "Phase 2") in rows


def test_scenario_rejects_a_slow_loss() -> None:
    log = (ROOT / "docs" / "eval" / "latest.txt").read_text().replace("loss_detect_s 1.6", "loss_detect_s 9.0")
    failures = check_scenarios(log, ROOT / "scenarios")
    assert any(item.startswith("gnss_loss.yaml") for item in failures)
    assert check_scenarios((ROOT / "docs" / "eval" / "latest.txt").read_text(), ROOT / "scenarios") == []
