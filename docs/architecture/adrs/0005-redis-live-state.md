# ADR 0005: Redis for live state

Status: Accepted
Date: 2026-10-28

## Context

The UI needs the latest position of a tail, and the API needs a rate limit, without reading the hypertable for every map frame.

## Decision

Redis holds latest-value hashes, WebSocket presence, and fixed-window rate limits. It is not a system of record. A Redis flush loses no audit rows and no mission plans. Production requires a password and refuses to disable the rate limiter. If Redis errors, login and rate-limited routes fail closed.

## Consequences

Phase 2 must tolerate a cold cache by reading the latest Timescale row once. Dev Compose sets a password from `.env`. AOF is on so a laptop reboot does not blank the demo.
