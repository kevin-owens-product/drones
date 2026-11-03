"""Turn onboard test logs into the README results table."""

from __future__ import annotations

import re
from pathlib import Path

START = "<!-- eval:start -->"
END = "<!-- eval:end -->"

# name, regex, unit, phase
FIELDS: tuple[tuple[str, str, str, str], ...] = (
    ("GNSS loss detect", r"loss_detect_s ([0-9.]+)", "s", "Phase 2"),
    ("GNSS step detect", r"step_detect_s ([0-9.]+)", "s", "Phase 2"),
    ("GNSS drag detect", r"drag_detect_s ([0-9.]+)", "s", "Phase 2"),
    ("Spoof false alarms", r"false_alarms_per_hour ([0-9.]+)", "per hour", "Phase 2"),
    ("Drift while GNSS denied", r"drift_m_per_min ([0-9.]+)", "m/min", "Phase 2"),
    ("Position RMSE while denied", r"rmse_m ([0-9.]+)", "m", "Phase 2"),
    ("Re-plan time after vehicle loss", r"replan_us ([0-9.]+)", "µs", "Phase 4"),
    ("Tasks covered after loss", r"tasks_covered_after_loss ([0-9.]+)", "tasks", "Phase 4"),
    ("Guided minimum separation", r"(?<![a-z])guided_min_m ([0-9.]+)", "m", "Phase 4"),
    ("Unguided minimum separation", r"unguided_min_m ([0-9.]+)", "m", "Phase 4"),
    ("Link success at 50 m", r"success_50m ([0-9.]+)", "fraction", "Phase 5"),
    ("Link success at 5 km", r"success_5km ([0-9.]+)", "fraction", "Phase 5"),
    ("Link success inside jammer", r"success_jammed ([0-9.]+)", "fraction", "Phase 5"),
    ("Lock retention", r"lock_retention ([0-9]+)/50", "of 50 runs", "Phase 3"),
    ("Reacquisition", r"reacq_frames ([0-9.]+)", "frames", "Phase 3"),
    ("Mean pixel error", r"mean_pixel_err ([0-9.]+)", "px", "Phase 3"),
)


def metric_rows(log: str) -> list[tuple[str, float, str, str]]:
    found = parse_metrics(log)
    rows: list[tuple[str, float, str, str]] = []
    for name, _pattern, unit, phase in FIELDS:
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
    for name, pattern, _unit, _phase in FIELDS:
        match = re.search(pattern, log)
        if match is not None:
            found[name] = match.group(1)
    return found


def render_table(found: dict[str, str]) -> str:
    lines = [
        "| Metric | Value | Where |",
        "| --- | --- | --- |",
    ]
    for name, _pattern, unit, phase in FIELDS:
        value = found.get(name)
        cell = "not measured" if value is None else f"{value} {unit}"
        lines.append(f"| {name} | {cell} | {phase} |")
    return "\n".join(lines)


def splice_readme(readme: str, table: str) -> str:
    if START not in readme or END not in readme:
        raise ValueError("README is missing eval markers")
    head, rest = readme.split(START, 1)
    _, tail = rest.split(END, 1)
    return f"{head}{START}\n\n{table}\n\n{END}{tail}"


def write_readme(path: Path, log: str) -> dict[str, str]:
    found = parse_metrics(log)
    missing = [name for name, *_rest in FIELDS if name not in found]
    if missing:
        raise ValueError("eval log missing " + ", ".join(missing))
    text = path.read_text()
    path.write_text(splice_readme(text, render_table(found)))
    return found
