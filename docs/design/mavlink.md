# MAVLink gateway

PX4 SITL sends MAVLink 2 to the Docker host on UDP 14550. The gateway decodes that stream with gomavlib v3.2.1 and republishes each message as `a2e.telemetry.v1.Sample` (`proto/telemetry/v1/sample.proto`) on NATS subject `telemetry.v1.{system}.{name}`. Global position also goes into the existing Timescale batch.

## What was measured

One headless `x500_a2e` in `px4io/px4-sitl-gazebo:v1.18.0-rc1` produced, in 8 seconds of `cmd/mavlisten`:

| Message | Count |
| --- | --- |
| ATTITUDE | 138 |
| LOCAL_POSITION_NED | 138 |
| GLOBAL_POSITION_INT | 138 |
| HEARTBEAT | 3 |
| SYS_STATUS | 3 |
| BATTERY_STATUS | 2 |
| ESTIMATOR_STATUS | 2 |

That is 424 messages, about 53 per second, which matches the 50 Hz position and attitude streams in the image's MAVLink startup script.

The in-process decode test fails if heartbeat decoding drops below 200,000 messages per second or if the p99 decode time exceeds 100 microseconds. A localhost UDP round trip must deliver a signed longitude in under 100 ms.

## Not in this pass

`RC_CHANNELS` did not appear. SITL has no radio unless one is injected. The decoder handles the message; a radio frame is still required before that counter moves.
