# PX4 flight log ingest

`a2e.flight.ulg` reads a `.ulg` with pyulog 1.1.0. The fixture `services/api/tests/fixtures/px4/six-quad-instance5.ulg` was copied from instance 5 of the six-quad Gazebo run on 2026-11-03. It is 1.66 seconds of boot, not a flown mission.

The regression test fails if `sensor_combined` drops below 400 samples, `vehicle_attitude` below 250, `vehicle_local_position` below 180, or `vehicle_gps_position` below 40. The log also contains barometer, magnetometer, GPS, and optical-flow datasets. `plot_series` returns the down position and the attitude scalar for the debrief plot.

Betaflight blackbox ingest is not in this commit. The SITL image that will produce a blackbox is `deploy/betaflight/Dockerfile`, pinned to Betaflight `21e67d203d32ce46d39e996493c39c1378c4974b`.
