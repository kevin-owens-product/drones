# Correlation lock and visual servoing

`onboard/track` locks a template with normalized cross-correlation on a 64×48 grayscale frame and searches ±6 pixels. A peak below 0.6 is a miss. Eight misses drop the lock. `track_servo` turns pixel error and area error into a velocity setpoint. There is no weapon command.

The headless check paints a checkerboard, moves it, blanks it for six frames, and brings it back. Fifty seeds:

| Metric | Value |
| --- | --- |
| Lock retention | 50/50 |
| Reacquisition | 0 frames after the target returns |
| Mean pixel error | 0.168 px |
| Throughput | about 80,000 frames/s on this laptop |

The test fails below 45/50 retention, above 1.5 px mean error, or under 200 frames/s. This is not a YOLO detector and it does not run on the Gazebo camera.
