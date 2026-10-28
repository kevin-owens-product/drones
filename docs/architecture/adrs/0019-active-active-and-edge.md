# ADR 0019: Active-active control plane and 72-hour edge

Status: Accepted
Date: 2026-10-28

## Context

The platform runs in several regions and a theater node can lose its backhaul for up to 72 hours. Multi-master mission plans across regions will fork in ways RLS cannot untangle.

## Decision

API, gateway, and OPA scale active-active. A tenant has a home region. Mission and fleet writes are pinned there. Other regions serve reads from replicas. Telemetry is written in the region that received it and replicates inward.

The edge node runs the trimmed stack. While disconnected it appends telemetry and audit and may edit a local copy of a plan. On reconnect, telemetry and audit merge by id. A plan edited on both sides freezes until a commander resolves it. A custody chain fork is rejected until an officer reconciles it. The disconnect budget is 72 hours; a gap beyond the disk quota is reported, not silently trimmed.

## Consequences

Phase 6 implements the log and the Helm topology. Phase 1's schema already uses immutable event ids so the later merge has a key. We do not deploy multi-master Postgres.
