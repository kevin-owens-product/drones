# Phase 3 — Sim and behaviors

`AutonomyRuntime` is implemented by `SimRuntime`. `FantomRuntime` validates the manifest and then returns unavailable. Each SDK call is marked `STUB`.

Reference behaviors: collaborative search, 3D A* with overhangs, GRIB2 simple packing, ISR custody, and the video bandwidth allocator. Manifests must set `weapons_interface` to `forbidden`. Live start requires `flight_cleared` and an approved mission.

Scorecards compare coverage, custody, energy, violations, and replans to a baseline.
