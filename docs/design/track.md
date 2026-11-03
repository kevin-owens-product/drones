# Correlation lock and visual servoing

`onboard/track` follows an operator-designated object with normalized cross-correlation on a 64×48 grayscale frame. There is no weapon command and no autonomous target selection: the operator designates, and the tracker keeps that designation.

## How it works

- **Designation.** `track_init` copies an 8×8 template at the operator's click and builds a bank of 16 rotated copies (22.5° apart) with bilinear sampling.
- **Search.** `track_step` searches around the predicted position (`fx + vx`, `fy + vy`). The window starts at ±6 px and widens by one pixel per missed frame, up to ±18. Each candidate is scored against the current template and the bank rotations next to the last one, with a small distance penalty so a nearby match beats a far one of equal score.
- **Acceptance.** A peak below 0.6 is a miss. A peak that no longer looks like the designation (best bank match below 0.5) is also a miss.
- **Adaptation.** Above 0.85, and only while the match still resembles the designation (bank match 0.7 or better), the template blends 15% toward the current patch. The guard matters: without it, a target sliding under a tree pulled the template into the ground texture, and then ground matched everywhere.
- **Motion gate.** `track_motion_keep` refuses a match that jumps more than 1.5 m from the predicted ground position, and gives up after 3 s of refusals so the operator can designate again. A target that brakes and stops is still followed. [Results](sitl.md).
- **Coasting.** On a miss the lock holds its prediction for up to 60 frames before it drops.
- **Ground-frame filter (companion side).** Pixel velocity is meaningless when the camera is chasing the target, so the companion keeps an alpha-beta filter on the target's ground position. Each frame it points the search at the filter's prediction, and it rejects matches that land more than 4 m from where the target could be.
- **Servo.** `track_servo` turns pixel and area error into a velocity setpoint for image-centred following. The closed-loop harness follows the filtered ground position instead.

## Checks

`make -C onboard/track test`:

| Check | Value |
| --- | --- |
| Lock retention, checkerboard moved and blanked, 50 seeds | 50/50 |
| Reacquisition after the target returns | 0 frames |
| Mean pixel error | under 0.2 px |
| Target hidden for 40 frames on textured ground | 0 false matches, reacquired on return |

The test fails below 45/50 retention, above 1.5 px mean error, or under 200 frames/s.

Closed loop against PX4 with a rendered camera, look-alikes and occlusion: [docs/design/sitl.md](sitl.md) and [docs/eval/sitl.md](../eval/sitl.md).

`POST /v1/flight/track` records a lock, a loss, or an abort. The operator must confirm. A missing confirmation is an audit deny with `not_confirmed`. A confirmed event is an audit allow naming the event and the vehicle. There is no weapon command on this route.
