"""Turn onboard test logs into the README results table."""

from __future__ import annotations

import re
from pathlib import Path

START = "<!-- eval:start -->"
END = "<!-- eval:end -->"

UNIT = "Unit check"
SITL = "PX4 SITL"

# name, regex, unit, phase, where it was measured.
#
# "Unit check" rows come from the onboard C tests: the module runs against a
# recorded or synthetic stream, open loop. "PX4 SITL" rows come from
# sim/sitl: PX4 flies in SIH with its own EKF2 and controllers, and the
# onboard code closes the loop. Those trials take an hour, so their summary
# is committed in docs/eval/sitl.txt and `make sitl` reruns them.
FIELDS: tuple[tuple[str, str, str, str, str], ...] = (
    ("GNSS loss detect", r"loss_detect_s ([0-9.]+)", "s", "Phase 2", UNIT),
    ("GNSS step detect", r"(?<!sitl_)step_detect_s ([0-9.]+)", "s", "Phase 2", UNIT),
    ("GNSS drag detect", r"(?<!sitl_)drag_detect_s ([0-9.]+)", "s", "Phase 2", UNIT),
    ("Spoof false alarms", r"false_alarms_per_hour ([0-9.]+)", "per hour", "Phase 2", UNIT),
    ("Drift while GNSS denied", r"(?<![a-z_])drift_m_per_min ([0-9.]+)", "m/min", "Phase 2", UNIT),
    ("Position RMSE while denied", r"(?<![a-z_])rmse_m ([0-9.]+)", "m", "Phase 2", UNIT),
    ("Error after 120 s without GNSS, GNSS only", r"sitl_loss_end_err_gnss_only_m ([0-9.]+)", "m", "Phase 2", SITL),
    ("Error after 120 s without GNSS, with VIO and gate", r"sitl_loss_end_err_gated_m ([0-9.]+)", "m", "Phase 2", SITL),
    ("Drift without GNSS, with VIO and gate", r"sitl_loss_drift_gated_m_per_min ([0-9.]+)", "m/min", "Phase 2", SITL),
    ("Error after 120 s of spoofed drag, no gate", r"sitl_drag_end_err_fused_m ([0-9.]+)", "m", "Phase 2", SITL),
    ("Error after 120 s of spoofed drag, with gate", r"sitl_drag_end_err_gated_m ([0-9.]+)", "m", "Phase 2", SITL),
    ("Spoofed drag caught within", r"sitl_drag_detect_worst_s ([0-9.]+)", "s, worst run", "Phase 2", SITL),
    ("Spoofed 50 m step caught within", r"sitl_step_detect_worst_s ([0-9.]+)", "s, worst run", "Phase 2", SITL),
    ("GNSS dropped in clean or multipath flight", r"sitl_false_drops ([0-9]+)", "times", "Phase 2", SITL),
    ("Re-plan latency after vehicle loss", r"replan_ms_at_10hz ([0-9.]+)", "ms at 10 Hz", "Phase 4", UNIT),
    ("Tasks held by two vehicles", r"cbba_conflicts ([0-9]+)", "in 500 lossy runs", "Phase 4", UNIT),
    ("Tasks covered after loss", r"tasks_covered_after_loss ([0-9.]+)", "tasks", "Phase 4", UNIT),
    ("Guided minimum separation", r"(?<![a-z])guided_min_m ([0-9.]+)", "m", "Phase 4", UNIT),
    ("Unguided minimum separation", r"unguided_min_m ([0-9.]+)", "m", "Phase 4", UNIT),
    ("Link success at 50 m", r"success_50m ([0-9.]+)", "fraction", "Phase 5", UNIT),
    ("Link success at 5 km", r"success_5km ([0-9.]+)", "fraction", "Phase 5", UNIT),
    ("Link success inside jammer", r"success_jammed ([0-9.]+)", "fraction", "Phase 5", UNIT),
    ("Fleet sorties completed under jammer, default failsafe", r"fleet_sorties_default ([0-9.]+)", "fraction", "Phase 5", UNIT),
    (
        "Fleet sorties completed under jammer, mesh and lost-link policy",
        r"fleet_sorties_mesh_policy ([0-9.]+)",
        "fraction",
        "Phase 5",
        UNIT,
    ),
    ("Dense crossing minimum separation", r"dense_min_sep_m ([0-9.]+)", "m", "Phase 4", UNIT),
    ("Dense crossing losses of separation", r"dense_los_events ([0-9]+)", "events", "Phase 4", UNIT),
    ("Dense crossing geofence breaches", r"geofence_breaches ([0-9]+)", "events", "Phase 4", UNIT),
    ("Lock retention", r"lock_retention ([0-9]+)/50", "of 50 runs", "Phase 3", UNIT),
    ("Reacquisition", r"reacq_frames ([0-9.]+)", "frames", "Phase 3", UNIT),
    ("Mean pixel error", r"mean_pixel_err ([0-9.]+)", "px", "Phase 3", UNIT),
    ("Frames on target, tracker v1, median run", r"sitl_track_v1_on_target ([0-9.]+)", "fraction", "Phase 3", SITL),
    ("Frames on target, tracker v2, median run", r"sitl_track_v2_on_target ([0-9.]+)", "fraction", "Phase 3", SITL),
    ("Runs that held the target, tracker v1", r"sitl_track_v1_held_runs ([0-9]+)/", "of 5 runs", "Phase 3", SITL),
    ("Runs that held the target, tracker v2", r"sitl_track_v2_held_runs ([0-9]+)/", "of 5 runs", "Phase 3", SITL),
    ("Follow error, tracker v2, median run", r"sitl_track_v2_follow_err_m ([0-9.]+)", "m", "Phase 3", SITL),
)


def metric_rows(log: str) -> list[tuple[str, float, str, str]]:
    found = parse_metrics(log)
    rows: list[tuple[str, float, str, str]] = []
    for name, _pattern, unit, phase, _source in FIELDS:
        if name not in found:
            continue
        rows.append((name, float(found[name]), unit, phase))
    return rows


def store_metrics(dsn: str, log: str, git_sha: str) -> int:
    import psycopg

    rows = metric_rows(log)
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO eval_runs (git_sha, metric, value, unit, phase)
                VALUES (%s, %s, %s, %s, %s)
                """,
                [(git_sha, name, value, unit, phase) for name, value, unit, phase in rows],
            )
        conn.commit()
    return len(rows)


def parse_metrics(log: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for name, pattern, _unit, _phase, _source in FIELDS:
        match = re.search(pattern, log)
        if match is not None:
            found[name] = match.group(1)
    return found


def render_table(found: dict[str, str]) -> str:
    lines = [
        "| Metric | Value | Measured in | Phase |",
        "| --- | --- | --- | --- |",
    ]
    for name, _pattern, unit, phase, source in FIELDS:
        value = found.get(name)
        cell = "not measured" if value is None else f"{value} {unit}"
        lines.append(f"| {name} | {cell} | {source} | {phase} |")
    return "\n".join(lines)


def splice_readme(readme: str, table: str) -> str:
    if START not in readme or END not in readme:
        raise ValueError("README is missing eval markers")
    head, rest = readme.split(START, 1)
    _, tail = rest.split(END, 1)
    return f"{head}{START}\n\n{table}\n\n{END}{tail}"


def check_scenarios(log: str, scenario_dir: Path) -> list[str]:
    import yaml  # type: ignore[import-untyped]

    found = parse_metrics(log)
    failures: list[str] = []
    for path in sorted(scenario_dir.glob("*.yaml")):
        doc = yaml.safe_load(path.read_text())
        if not isinstance(doc, dict) or "metric" not in doc:
            failures.append(f"{path.name}: missing metric")
            continue
        name = str(doc["metric"])
        if name not in found:
            failures.append(f"{path.name}: {name} was not measured")
            continue
        value = float(found[name])
        if "max" in doc and value > float(doc["max"]):
            failures.append(f"{path.name}: {name} {value} above {doc['max']}")
        if "min" in doc and value < float(doc["min"]):
            failures.append(f"{path.name}: {name} {value} below {doc['min']}")
    return failures


def write_readme(path: Path, log: str) -> dict[str, str]:
    found = parse_metrics(log)
    missing = [name for name, *_rest in FIELDS if name not in found]
    if missing:
        raise ValueError("eval log missing " + ", ".join(missing))
    text = path.read_text()
    path.write_text(splice_readme(text, render_table(found)))
    return found
