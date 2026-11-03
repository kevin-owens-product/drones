# Scenario gate and failure-mode triage

Two small pieces. The scenario gate makes `scenarios/*.yaml` block a pull request and explains why. The triage tool turns flight logs into a ranked list of failure modes and a scenario stub for the worst one, so field and sim failures become new gates.

## Scenario gate

`.github/workflows/eval.yml` runs `make eval` on every pull request. That runs the onboard unit suites and reads the committed PX4 SITL summary in `docs/eval/sitl.txt`; it does not rerun the hour-long PX4 trials. `make eval` already exits non-zero when a scenario bound breaks. A second step, which runs even on failure, calls `python -m a2e.evalreport docs/eval/latest.txt` and appends a pass/fail table to `$GITHUB_STEP_SUMMARY`. It exits 1 if any scenario fails or was not measured.

Run it locally with `make eval`, then `python -m a2e.evalreport docs/eval/latest.txt`.

Unit check, run here on 2026-11-03 with `make eval` in this worktree: 9 of 9 scenarios pass.

## Triage

`python -m a2e.triage docs/eval/sitl_gnss.jsonl docs/eval/sitl_track.jsonl [--stub out.yaml] [--include-baselines]`

Each run row is tagged with zero or more modes: `spoof_drift` (end error over 5 m in a step or drag run), `denied_drift` (same, GNSS loss), `spoof_detect_slow` (gate caught the spoof after more than 10 s), `spoof_undetected` (gate never caught it), `false_gnss_drop`, `track_lost` (lost_at_s set), `track_swap` (false_lock_frac over 0.1), and `run_incomplete`. PX4 `.ulg` files add `ekf_reset` (local position reset counter changed), `link_loss` (vehicle_status GCS or data link lost) and `low_battery` (battery_status remaining under 20%). A `.ulg` that never armed is skipped, because EKF init resets and a missing ground station are normal at boot.

Modes are ranked by run count. Run ids are `<file>#<line>:<fault>/<mode>/s<seed>` or `<file>#<line>:<tracker>/s<seed>`. The `gnss_only` rows are the no-VIO, no-gate baseline and are skipped unless `--include-baselines` is set.

`--stub` writes a YAML in the `scenarios/` format for the top mode. Its metric names a row in `evalreport.FIELDS` where one exists, so it can be gated as-is. The bound is a proposal for a human to review; the tool never writes into `scenarios/`.

The PR workflow appends this ranking to the step summary as advisory output. It does not fail the build.

## Output on the committed logs

Sim (PX4 SIH, closed loop), rows in `docs/eval/sitl_gnss.jsonl` and `docs/eval/sitl_track.jsonl`, triaged here on 2026-11-03, baselines excluded:

| Rank | Failure mode | Runs | Example runs |
| --- | --- | --- | --- |
| 1 | spoof_drift | 6 | sitl_gnss#27:drag/fused/s0, sitl_gnss#28:drag/gated/s0, sitl_gnss#30:drag/fused/s1 |
| 2 | track_lost | 5 | sitl_track#1:ncc-fixed/s0, sitl_track#2:ncc-fixed/s1, sitl_track#3:ncc-fixed/s2 |
| 3 | spoof_detect_slow | 3 | sitl_gnss#28:drag/gated/s0, sitl_gnss#31:drag/gated/s1, sitl_gnss#34:drag/gated/s2 |
| 4 | track_swap | 2 | sitl_track#7:ncc-rotation-bank-coast/s1, sitl_track#9:ncc-rotation-bank-coast/s3 |

With `--include-baselines`, `spoof_drift` rises to 13 runs. The stub for the top mode is `metric: Error after 120 s of spoofed drag, with gate`, `max: 5.0`. The committed SITL summary has 4.3 m for that metric, so the stub would pass today; it guards against regression.

The six-quad `.ulg` fixture is a 1.66 s boot log that never armed, so it yields no modes.

## Limits

- The thresholds (5 m, 10 s, 0.1) are judgement calls, not derived from requirements.
- All five track_lost runs are tracker v1; the ranking does not weight by which tracker ships.
- `ekf_reset`, `link_loss` and `low_battery` are only checked in `.ulg` files, and the only one here never armed, so those rules are untested against a real flight.
- Stubs for `ekf_reset`, `low_battery` and `run_incomplete` name metrics that `evalreport.FIELDS` does not yet produce; the gate would report them as not measured.
- No database or upload path. Logs are read from disk.
- The tool only reads logs and advises. It sends no commands.
