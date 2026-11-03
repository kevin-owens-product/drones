# End-of-line bench (hardware in the loop)

`sim/bench` is the station a factory runs on each flight controller before an airframe leaves the line. Plug the board in over USB, run one command, and in about ten seconds you get a pass or fail with reasons. You also get a **birth record**: the JSON that `a2e.birth.from_dict` reads and that the console turns into "airworthy" or "grounded: EOL bench test failed: …". The bench is the evidence the digital thread was waiting for.

```
python sim/bench/bench.py --connect /dev/ttyACM0 --serial NX-0042 \
    --parts parts.json --firmware build/px4_fmu-v6x_default.px4 --out out/NX-0042.json
```

## What it checks

The board sits at rest on the bench. The bench asks it for data and checks the answers against a variant profile (`profiles/variant-a.json`):

| Check | Fails when |
| --- | --- |
| heartbeat | no heartbeat in 10 s, or it isn't a PX4 quadrotor |
| disarmed | any heartbeat during the capture says ARMED |
| link loss | more than 1% of MAVLink packets go missing (by sequence number) |
| firmware | `AUTOPILOT_VERSION` doesn't match the release in the profile |
| sensors | gyro, accel, mag or baro not present, enabled and healthy in `SYS_STATUS` |
| params | a failsafe parameter is missing or off profile: RC loss and data link loss actions and timeouts, low battery action, geofence action, critical battery threshold |
| IMU | at rest: gyro noise, gyro bias, accel noise, and gravity magnitude within limits |
| attitude rate | the board can't stream `ATTITUDE` at 45 Hz or more |

The four IMU numbers are written into the birth record as calibrations with their limits. The record's `eol.note` is the first failure, so the console shows the reason that matters.

## It cannot fly the board

The bench never arms, changes mode, spins motors, or writes a parameter (ADR-0016). This is enforced in code, not left to convention. `capture.SafeSender` is the only path for outgoing messages. It allows a ground-station heartbeat, parameter reads, and the two commands that set a stream rate or request one message. Anything else raises `Refused`, and a test checks that arm, set mode, motor test and actuator test are refused. If a board reports itself armed while on the bench, the run fails and tells the operator to stop.

## What has been tested, and what hasn't

- **Check logic:** unit tests on synthetic captures, one for each fault.
- **Transport:** run end to end over real MAVLink on loopback UDP against `emulator.py`. The emulator is a pretend flight controller that answers the same requests PX4 does, and can be told to misbehave: noisy IMU, wrong failsafe parameter, armed, lossy link, or failed magnetometer. CI runs it. `make bench-demo` runs every fault.
- **Not yet run against a real board.** The emulator proves the plumbing, not the limits. Each limit in the profile is a placeholder that shows the shape, not a measured spec. The first real boards will show what normal gyro noise and bias look like for this IMU, and the limits should be set from that spread.
- **Not run against PX4 SITL here,** because this environment has no Docker. `--connect udpin:0.0.0.0:14550` against the SIH container in `sim/sitl` should work as is. Note that SIH's simulated sensors are cleaner than real ones.

## To run it on hardware

1. A PX4 board on the release you ship, connected over USB, with props off or no motors attached. The bench doesn't need either, but it is the right habit.
2. Set `firmware` and the parameter values in the profile from that release's parameter file.
3. Run the command above with a real serial number and a parts file (see `examples/parts.json`).
4. Run about twenty known-good boards, then set the IMU limits from that spread, for example mean plus four standard deviations.

## Next

- **Upload.** An API route that accepts the birth record from the station, so results reach the console without a file copy. The parser and verdict already exist in `a2e.birth`.
- **Spin test.** A powered motor and ESC check (current draw and RPM per motor) would catch the ESC lot problem the attrition autopsy found, at the factory instead of in the field. It needs the board armed with props off, in a fixture. That is a deliberate exception to "never arms", so it needs its own decision and its own interlock, and it isn't in this scaffold.
- **Full HITL.** PX4 can fly against simulated sensors while running on the real board. That is the step after the spin test.
