# Closed-loop trials against PX4

The unit checks in `onboard/` run each module open loop against a synthetic or recorded stream. That shows the module does what it says. It does not show that a vehicle flying on the module's output stays where it should. `sim/sitl` closes that loop with the real flight stack.

Results: [docs/eval/sitl.md](../eval/sitl.md). Raw rows: `docs/eval/sitl_*.jsonl`. Rerun: `make sitl` (Docker, about an hour on four cores).

## What runs

- **PX4 v1.18 in SIH** (`px4io/px4-sitl-gazebo`, pinned by digest). SIH is PX4's built-in rigid-body quad model. EKF2, the position and attitude controllers, and commander are the real ones. No Gazebo, no GPU, so many seeded trials fit on a laptop.
- **Ground truth** is `HIL_STATE_QUATERNION`, which PX4 fills from SIH's true state. **The estimate** is `GLOBAL_POSITION_INT`, which is EKF2's output. Every error is estimate minus truth.
- **The harness is the companion computer.** It talks MAVLink on PX4's onboard port, flies offboard velocity setpoints, and runs the onboard C modules through `ctypes`, the same code the unit checks build.

## GNSS-denied navigation (`gnss_denied.py`)

GNSS reaches PX4 the way it does on a vehicle: as NMEA on a serial line. `nmea_bridge.py` runs inside the PX4 container, opens a pseudo-terminal, and PX4's own `gps` driver reads it. PX4's simulated GPS is stopped first. (PX4 v1.18 ignores `GPS_INPUT` over MAVLink in this configuration, so that path is not used.)

Visual-inertial odometry is emulated from truth with the errors a real VIO pipeline has: a scale error drawn per run (σ 0.7%), a yaw misalignment (σ 0.4°), a random-walk bias, and white noise. It reaches EKF2 as `VISION_POSITION_ESTIMATE` and `VISION_SPEED_ESTIMATE` with `EKF2_EV_CTRL=5`.

Three estimator inputs:

| Mode | What EKF2 gets |
| --- | --- |
| GNSS only | NMEA GNSS, faults and all |
| GNSS + VIO | NMEA GNSS and VIO; EKF2's own innovation gates decide |
| GNSS + VIO + spoof gate | VIO always; GNSS only while `onboard/spoof`'s χ² gate trusts it |

Five faults, each starting 20 s after the vehicle reaches 20 m and lasting 120 s while it flies a 200 × 100 m box at 5 m/s:

| Fault | What the receiver reports |
| --- | --- |
| none | Clean fixes |
| loss | No fix (jamming) |
| step | Position jumps 50 m and stays there (meaconing) |
| drag | Position walks away at 0.5 m/s, consistent with a coherent spoofer |
| multipath | 3 m correlated wander, which must not be called a spoof |

What the trials show, in plain terms:

- **Without VIO, losing GNSS is unrecoverable.** EKF2 falls back to inertial dead reckoning and is hundreds of metres off within two minutes.
- **EKF2 already rejects a 50 m step when it has VIO.** Its innovation gate catches the jump. The spoof gate also flags it within half a second.
- **A slow drag is the case the gate exists for.** EKF2 with VIO partly follows a coherent drag because each fix is only slightly off. The gate drops GNSS after 13 to 25 s and holds error to about half of fused-only.
- **The gate does not fire on clean or multipath flights.**

## Tracking (`track_loop.py`)

A camera is rendered from the vehicle's true pose every third ground-truth sample (about 17 Hz): nadir, 60° field of view, 128 × 96 downsampled to the tracker's 64 × 48, with sensor noise and a slow gain drift. The scene is procedural ground texture, a road, trees that hide the target, and parked vehicles that look like the target. The target drives a loop at 4 m/s.

The operator designation is a click at the target's position on the first frame. After that the controller knows only what the tracker reports. Nothing else tells it where the target is.

Two trackers:

- **v1** is the tracker as first written (commit `7371d42`): one fixed template, a ±6 px search, eight misses drop the lock. Its controller centres the target in the image.
- **v2** is `onboard/track` now:
  - A bank of 16 rotated copies of the designated template, so the target can turn.
  - An adaptive template that only updates while the match still looks like the designation (`ANCHOR_MIN`, `ADAPT_ANCHOR`). Without this the template drifted into the ground while the target slipped under a tree, and then ground matched everywhere.
  - Up to 60 frames of coasting.
  - On the companion side, an alpha-beta filter on the target's ground position. It points the search window at where the target should be, feeds the controller the target's velocity, and gates matches that land somewhere a moving target could not be.

What the tracker trials show:

- **v1 loses every run within 15 to 23 s**, at the first turn, because a fixed template stops matching once the target rotates.
- **v2 holds the target in 3 of 5 runs**, through turns and tree occlusion, with the vehicle about 2 m from the target throughout.
- **In 2 of 5 runs v2 ends up on a parked look-alike.** In both, the target drives within a few metres of an identical parked vehicle while turning. The rotated target scores below the parked one, and the swap happens inside the 4 m gate, so nothing flags it. A tighter gate (1.5 m) stops the swap but then drops the lock on turns. Fixing this needs association that uses motion over several frames (a parked vehicle has zero velocity; the target does not), or a detector that scores identity rather than appearance. That is the next piece of work, and the trial will show when it is done.

"On target" means the reported track position (the match, or the filter's prediction while coasting) is within 4 px of the truth. "False lock" means the tracker accepted a match more than 4 px away.

## Limits

- The camera is rendered, not Gazebo, and the target is a textured rectangle. The point is the loop, not photorealism.
- VIO is emulated from truth with realistic error terms, not run on images.
- SIH runs faster than real time and is not lock-stepped to the harness, so runs vary a little with host load. Three seeds per GNSS case and five per tracker are enough to separate the configurations, not to quote tight confidence intervals.
