"""Rank failure modes across flight logs and stub a scenario for the top one.

Reads the SITL trial rows in docs/eval/sitl_*.jsonl and, if given, PX4 .ulg
files. Each run is tagged with zero or more failure modes; modes are ranked by
how many runs hit them. This only reads logs. It never commands a vehicle.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# key: (label, scenario stub). The stub metric names an evalreport.FIELDS row
# where one exists, so the stub can be dropped into scenarios/ and gated.
MODES: dict[str, tuple[str, dict[str, Any]]] = {
    "spoof_drift": (
        "Position error over 5 m at end of a spoofed run",
        {"phase": "Phase 2", "fault": "drag", "metric": "Error after 120 s of spoofed drag, with gate", "max": 5.0},
    ),
    "denied_drift": (
        "Position error over 5 m at end of a GNSS-denied run",
        {"phase": "Phase 2", "fault": "loss", "metric": "Error after 120 s without GNSS, with VIO and gate", "max": 5.0},
    ),
    "spoof_detect_slow": (
        "Spoof caught, but after more than 10 s",
        {"phase": "Phase 2", "fault": "drag", "metric": "Spoofed drag caught within", "max": 10.0},
    ),
    "spoof_undetected": (
        "Spoof never caught by the gate",
        {"phase": "Phase 2", "fault": "drag", "metric": "Spoofed drag caught within", "max": 30.0},
    ),
    "false_gnss_drop": (
        "GNSS dropped with no fault injected",
        {"phase": "Phase 2", "fault": "multipath", "metric": "GNSS dropped in clean or multipath flight", "max": 0},
    ),
    "track_lost": (
        "Tracker lost the target and did not recover",
        {"phase": "Phase 3", "metric": "Runs that held the target, tracker v2", "min": 5},
    ),
    "track_swap": (
        "Tracker locked onto the wrong object (over 10% of frames)",
        {"phase": "Phase 3", "metric": "Frames on target, tracker v2, median run", "min": 0.95},
    ),
    "run_incomplete": ("Run did not complete", {"phase": "Phase 2", "metric": "SITL runs completed", "min": 1}),
    "ekf_reset": ("EKF position reset during flight", {"phase": "Phase 2", "metric": "EKF resets per flight", "max": 0}),
    "link_loss": ("Ground link reported lost", {"phase": "Phase 5", "metric": "Link success at 5 km", "min": 0.9}),
    "low_battery": ("Battery below 20% remaining", {"phase": "Phase 1", "metric": "Landings below 20% battery", "max": 0}),
}

SPOOF_FAULTS = {"step", "drag"}
DRIFT_M = 5.0
SLOW_DETECT_S = 10.0
SWAP_FRAC = 0.1
LOW_BATTERY = 0.2
ARMED = 2  # vehicle_status.arming_state


@dataclass
class Mode:
    key: str
    runs: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return MODES[self.key][0]


def classify_gnss(row: dict[str, Any]) -> list[str]:
    modes: list[str] = []
    fault = row.get("fault")
    err_end = row.get("err_end_m")
    detect = row.get("detect_s")
    if row.get("completed") is False:
        modes.append("run_incomplete")
    if isinstance(err_end, (int, float)) and err_end > DRIFT_M:
        if fault in SPOOF_FAULTS:
            modes.append("spoof_drift")
        elif fault == "loss":
            modes.append("denied_drift")
    if fault in SPOOF_FAULTS and row.get("mode") == "gated":
        if detect is None:
            modes.append("spoof_undetected")
        elif detect > SLOW_DETECT_S:
            modes.append("spoof_detect_slow")
    if (row.get("false_drops") or 0) > 0:
        modes.append("false_gnss_drop")
    return modes


def classify_track(row: dict[str, Any]) -> list[str]:
    modes: list[str] = []
    if row.get("lost_at_s") is not None:
        modes.append("track_lost")
    if (row.get("false_lock_frac") or 0) > SWAP_FRAC:
        modes.append("track_swap")
    return modes


def classify_ulg(path: Path) -> list[str]:
    """EKF resets, link loss and low battery from a PX4 log, where the topics exist."""
    from pyulog import ULog  # type: ignore[import-untyped]

    log = ULog(str(path))
    topics = {item.name: item.data for item in log.data_list}
    modes: list[str] = []
    status = topics.get("vehicle_status", {})
    arming = status.get("arming_state")
    if arming is None or not any(int(v) == ARMED for v in arming):
        # A log that never armed is boot or bench time: EKF init resets and a
        # not-yet-connected ground station are expected there, not failures.
        return modes
    local = topics.get("vehicle_local_position", {})
    for counter in ("xy_reset_counter", "z_reset_counter"):
        values = local.get(counter)
        if values is not None and len(values) > 1 and int(values[-1]) != int(values[0]):
            modes.append("ekf_reset")
            break
    for flag in ("data_link_lost", "gcs_connection_lost"):
        values = status.get(flag)
        if values is not None and any(int(v) for v in values):
            modes.append("link_loss")
            break
    remaining = topics.get("battery_status", {}).get("remaining")
    if remaining is not None and len(remaining) and 0 <= float(min(remaining)) < LOW_BATTERY:
        modes.append("low_battery")
    return modes


def triage_rows(source: str, rows: Iterable[dict[str, Any]], include_baselines: bool = False) -> dict[str, Mode]:
    ranked: dict[str, Mode] = {}
    for index, row in enumerate(rows, start=1):
        if "tracker" in row:
            run_id = f"{source}#{index}:{row['tracker']}/s{row.get('seed')}"
            modes = classify_track(row)
        else:
            # gnss_only has no VIO and no gate; it is the baseline that is meant to fail.
            if row.get("mode") == "gnss_only" and not include_baselines:
                continue
            run_id = f"{source}#{index}:{row.get('fault')}/{row.get('mode')}/s{row.get('seed')}"
            modes = classify_gnss(row)
        for key in modes:
            ranked.setdefault(key, Mode(key)).runs.append(run_id)
    return ranked


def triage_paths(paths: Iterable[Path], include_baselines: bool = False) -> list[Mode]:
    merged: dict[str, Mode] = {}
    for path in paths:
        if path.suffix == ".ulg":
            found = {key: Mode(key, [path.name]) for key in classify_ulg(path)}
        else:
            rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
            found = triage_rows(path.stem, rows, include_baselines)
        for key, mode in found.items():
            merged.setdefault(key, Mode(key)).runs.extend(mode.runs)
    return sorted(merged.values(), key=lambda mode: (-len(mode.runs), mode.key))


def render_ranking(modes: list[Mode], examples: int = 3) -> str:
    lines = ["| Rank | Failure mode | Runs | Example runs |", "| --- | --- | --- | --- |"]
    for rank, mode in enumerate(modes, start=1):
        sample = ", ".join(mode.runs[:examples])
        lines.append(f"| {rank} | {mode.key}: {mode.label} | {len(mode.runs)} | {sample} |")
    return "\n".join(lines)


def scenario_stub(mode: Mode) -> str:
    spec = MODES[mode.key][1]
    lines = [
        f"# Stub from a2e.triage: {mode.label}.",
        f"# Seen in {len(mode.runs)} runs, e.g. {', '.join(mode.runs[:3])}.",
        "# The bound is a proposal. Review it before committing to scenarios/.",
        f"name: triage_{mode.key}",
    ]
    lines += [f"{key}: {value}" for key, value in spec.items()]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rank failure modes in SITL .jsonl and PX4 .ulg logs.")
    parser.add_argument("logs", nargs="+", type=Path)
    parser.add_argument("--include-baselines", action="store_true", help="count gnss_only baseline runs too")
    parser.add_argument("--stub", type=Path, help="write a scenario YAML stub for the top mode here")
    args = parser.parse_args(argv)
    modes = triage_paths(args.logs, args.include_baselines)
    print(render_ranking(modes))
    if args.stub and modes:
        args.stub.write_text(scenario_stub(modes[0]))
        print(f"\nwrote {args.stub} for {modes[0].key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
