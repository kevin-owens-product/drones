# ADR 0017: AutonomyRuntime port and the FANTOM stub

Status: Accepted
Date: 2026-10-28

## Context

FANTOM Core is a government SDK this project does not have. Behaviors still need a stable lifecycle: load, configure, start, stop, status, watch outputs.

## Decision

Define `AutonomyRuntime` as a Python `Protocol` and a protobuf service with those RPCs. `SimRuntime` runs the reference behaviors in Phase 3. `FantomRuntime` implements the same methods, logs that the SDK is absent, and returns `Unavailable`. Each SDK call site is marked `# STUB: FANTOM Core SDK call`.

Reference behaviors: collaborative area search, 3D route planner (A* / RRT* on a voxel or octree, energy and time-of-flight, required time on target), GRIB2 weather volumes, multi-target ISR custody, and the mission-aware video manager.

## Consequences

No code imports a FANTOM package. A site that obtains the SDK writes an adapter behind the port and does not edit the behaviors. Humans still approve the plan the behavior produced before it becomes tasking (ADR 0022).
