"""Summarize closed-loop SITL trials into the eval log and a readable table.

The trials need Docker and a PX4 image and take about an hour, so their raw
rows are committed under docs/eval/ and `make eval` reads this summary rather
than rerunning them. `make sitl` reruns everything.

Every number here comes from PX4 flying in SIH: EKF2 is the real estimator and
the controller is PX4's. The onboard C code (spoof gate, tracker) runs on the
companion side exactly as it does in the unit checks.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path


def load(path: Path, key: tuple[str, ...]) -> list[dict]:
    """Read JSONL rows; a rerun of the same trial replaces the earlier row."""
    rows: dict[tuple, dict] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        rows[tuple(row[k] for k in key)] = row
    return list(rows.values())


def med(values: list[float]) -> float:
    return statistics.median(values) if values else float("nan")


def gnss(rows: list[dict]) -> tuple[list[str], list[str]]:
    by: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        by[(row["fault"], row["mode"])].append(row)
    faults = ["none", "loss", "step", "drag", "multipath"]
    modes = ["gnss_only", "fused", "gated"]
    label = {
        "gnss_only": "GNSS only",
        "fused": "GNSS + VIO",
        "gated": "GNSS + VIO + spoof gate",
    }
    md = [
        "| Fault | Estimator input | Runs | End error (median / worst) | RMSE (median) | Detected after |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for fault in faults:
        for mode in modes:
            runs = by.get((fault, mode), [])
            if not runs:
                continue
            ends = [r["err_end_m"] for r in runs]
            rmse = [r["err_rmse_m"] for r in runs]
            det = [r["detect_s"] for r in runs if r.get("detect_s") is not None]
            det_cell = f"{med(det):.1f} s (worst {max(det):.1f} s)" if det else "n/a"
            md.append(
                f"| {fault} | {label[mode]} | {len(runs)} | {med(ends):.1f} m / {max(ends):.1f} m | {med(rmse):.1f} m | {det_cell} |"
            )

    def pick(fault: str, mode: str, field: str) -> list[float]:
        return [r[field] for r in by.get((fault, mode), []) if r.get(field) is not None]

    log = [
        f"sitl_gnss_runs {len(rows)}",
        f"sitl_loss_end_err_gnss_only_m {med(pick('loss', 'gnss_only', 'err_end_m')):.1f}",
        f"sitl_loss_end_err_gated_m {med(pick('loss', 'gated', 'err_end_m')):.1f}",
        f"sitl_loss_drift_gated_m_per_min {med(pick('loss', 'gated', 'drift_m_per_min')):.2f}",
        f"sitl_drag_end_err_fused_m {med(pick('drag', 'fused', 'err_end_m')):.1f}",
        f"sitl_drag_end_err_gated_m {med(pick('drag', 'gated', 'err_end_m')):.1f}",
        f"sitl_drag_detect_worst_s {max(pick('drag', 'gated', 'detect_s') or [float('nan')]):.1f}",
        f"sitl_step_detect_worst_s {max(pick('step', 'gated', 'detect_s') or [float('nan')]):.2f}",
        "sitl_false_drops {}".format(
            int(sum(pick("none", "gated", "false_drops")) + sum(pick("multipath", "gated", "false_drops")))
        ),
    ]
    return md, log


def track(rows: list[dict]) -> tuple[list[str], list[str]]:
    by: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by[row["tracker"]].append(row)
    names = {"ncc-fixed": "v1: fixed template", "ncc-rotation-bank-coast": "v2: rotation bank, coasting, ground-frame gate"}
    md = [
        "| Tracker | Runs | Held the target (90% of frames or more) | On target (median / worst) | Dropped the lock | Ended on a look-alike | Follow error (median) | Step time p99 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    log: list[str] = []
    for key in ["ncc-fixed", "ncc-rotation-bank-coast"]:
        runs = by.get(key, [])
        if not runs:
            continue
        on = [r["on_target_frac"] for r in runs]
        false = [r["false_lock_frac"] for r in runs]  # median not reported; used for swaps
        lost = [r["lost_at_s"] for r in runs if r.get("lost_at_s") is not None]
        follow = [r["mean_follow_err_m"] for r in runs]
        p99 = [r["track_us_p99"] for r in runs]
        held = sum(1 for v in on if v >= 0.9)
        swapped = sum(1 for v in false if v >= 0.2)
        lost_cell = f"{len(lost)} of {len(runs)}" + (f", {min(lost):.0f} to {max(lost):.0f} s in" if lost else "")
        md.append(
            f"| {names[key]} | {len(runs)} | {held} of {len(runs)} | {med(on) * 100:.0f}% / {min(on) * 100:.0f}% | {lost_cell} | {swapped} of {len(runs)} | {med(follow):.1f} m | {max(p99):.0f} µs |"
        )
        tag = "v1" if key == "ncc-fixed" else "v2"
        log += [
            f"sitl_track_{tag}_on_target {med(on):.3f}",
            f"sitl_track_{tag}_held_runs {held}/{len(runs)}",
            f"sitl_track_{tag}_follow_err_m {med(follow):.1f}",
        ]
    return md, log


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gnss", type=Path, default=Path("docs/eval/sitl_gnss.jsonl"))
    ap.add_argument("--track", type=Path, default=Path("docs/eval/sitl_track.jsonl"))
    ap.add_argument("--log", type=Path, default=Path("docs/eval/sitl.txt"))
    ap.add_argument("--md", type=Path, default=Path("docs/eval/sitl.md"))
    args = ap.parse_args()
    g_md, g_log = gnss(load(args.gnss, ("fault", "mode", "seed")))
    t_md, t_log = track(load(args.track, ("tracker", "seed")))
    args.log.write_text("\n".join(["sitl results (PX4 SIH, closed loop)", *g_log, *t_log]) + "\n")
    args.md.write_text(
        "\n".join(
            [
                "# Closed-loop SITL results",
                "",
                "Generated by `sim/sitl/summarize.py` from the raw rows next to this file. PX4 v1.18 flies in SIH; EKF2 and the position controller are PX4's own. Do not edit by hand.",
                "",
                "## Navigation with GNSS faults",
                "",
                "200 by 100 m box at 5 m/s and 20 m. The fault starts 20 s after the vehicle reaches altitude and lasts 120 s. Error is EKF2's position minus SIH ground truth.",
                "",
                *g_md,
                "",
                "## Tracking an operator-designated vehicle",
                "",
                "Nadir camera rendered from the vehicle's true pose, 64 by 48 pixels at about 17 Hz. The target drives a road loop at 4 m/s past parked look-alikes and under trees. The controller follows the track; nothing else tells it where the target is. 90 s per run.",
                "",
                *t_md,
                "",
                "Held means on target in at least 90% of frames. Ended on a look-alike means the tracker accepted matches on another vehicle in at least 20% of frames. See docs/design/sitl.md for why v2 swaps in those runs.",
                "",
            ]
        )
    )
    print(args.log.read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
