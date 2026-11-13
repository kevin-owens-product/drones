# ADR 0027: Operator flight commands through the live sim bridge

Status: Accepted
Date: 2026-11-13

## Context

Until now the console only monitored: GO was advice, and the operator armed and launched on the vehicle's own controls. To fly a swarm from the platform, first in PX4's simulator and later on PX4 hardware, the console has to send commands. That changes a stated product rule, so the boundary needs writing down.

## Decision

The console sends flight commands only to vehicles that reach it through the live sim bridge (`sim/swarm/bridge.py`), and only when someone switched live sim on in that browser (`?live=1`). The hosted demo's scripted fleet stays monitor-only.

- The commands are arm and take off, go to a point, hold, return to launch, land, and two swarm tasks (a formation and an area sweep). There is no payload, weapon or release command ([ADR 0016](0016-no-weapons-in-the-domain.md)).
- A launch needs the vehicle's launch checks to pass; the swarm launch sends only the vehicles that are GO.
- A role needs `vehicle.command` (mission commander, operator, admin). Others see the swarm with the controls disabled and the reason.
- Every command and its PX4 answer goes on the Operate timeline. The bridge accepts calls only from this machine (it listens on 127.0.0.1) and from the console's own origins.
- The vehicle keeps its own safety: PX4's lost-link action is set to return to launch, so a vehicle that loses the bridge comes home without the console.

## Consequences

The console can be demonstrated flying real PX4 flight software. Commands from the hosted demo are impossible without a bridge on the viewer's own machine. Before this flies hardware outside a test range, the commands need the server-side policy check and the hash-chained audit that tasking already has ([ADR 0022](0022-human-approval.md), [ADR 0014](0014-hash-chained-audit.md)); the timeline is not an audit record.
