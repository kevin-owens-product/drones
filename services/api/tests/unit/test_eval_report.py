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
    replan_ms_at_10hz 1313
    cbba_conflicts 0
    tasks_covered_after_loss 4
    unguided_min_m 0.00
    guided_min_m 20.10
    success_50m 0.987
    success_5km 0.087
    success_jammed 0.004
    lock_retention 50/50
    reacq_frames 0.00
    mean_pixel_err 0.168
    sitl_loss_end_err_gnss_only_m 374.9
    sitl_loss_end_err_gated_m 3.4
    sitl_loss_drift_gated_m_per_min 1.24
    sitl_drag_end_err_fused_m 7.9
    sitl_drag_end_err_gated_m 4.3
    sitl_drag_detect_worst_s 25.5
    sitl_step_detect_worst_s 0.48
    sitl_false_drops 0
    sitl_track_v1_on_target 0.174
    sitl_track_v2_on_target 0.700
    sitl_track_v1_held_runs 0/5
    sitl_track_v2_held_runs 3/5
    sitl_track_v2_follow_err_m 2.1
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
    assert len(rows) == 30
    assert ("GNSS loss detect", 1.6, "s", "Phase 2") in rows
    # The unit-check and SITL rows for the same fault must not read each other's lines.
    assert found["GNSS drag detect"] == "17.1"
    assert found["Spoofed drag caught within"] == "25.5"
    assert found["Drift while GNSS denied"] == "3.00"
    assert "| GNSS drag detect | 17.1 s | Unit check | Phase 2 |" in table
    assert "| Spoofed drag caught within | 25.5 s, worst run | PX4 SITL | Phase 2 |" in table


def test_scenario_rejects_a_slow_loss() -> None:
    log = (ROOT / "docs" / "eval" / "latest.txt").read_text().replace("loss_detect_s 1.6", "loss_detect_s 9.0")
    failures = check_scenarios(log, ROOT / "scenarios")
    assert any(item.startswith("gnss_loss.yaml") for item in failures)
    assert check_scenarios((ROOT / "docs" / "eval" / "latest.txt").read_text(), ROOT / "scenarios") == []


def test_contested_and_dense_rows_parse() -> None:
    log = (
        "fleet_sorties_default 0.671 fleet_cells_default 0.735\n"
        "fleet_sorties_mesh_policy 1.000 fleet_cells_mesh_policy 1.000\n"
        "dense_min_sep_m 5.93 dense_los_events 0 geofence_breaches 0 dense_arrived 8/8\n"
        "dense_unguided_min_sep_m 0.00 dense_unguided_los_events 28\n"
    )
    found = parse_metrics(log)
    assert found["Fleet sorties completed under jammer, default failsafe"] == "0.671"
    assert found["Fleet sorties completed under jammer, mesh and lost-link policy"] == "1.000"
    assert found["Dense crossing minimum separation"] == "5.93"
    assert found["Dense crossing losses of separation"] == "0"
    assert found["Dense crossing geofence breaches"] == "0"
    assert "Guided minimum separation" not in found
    assert "Unguided minimum separation" not in found
