# ADR 0004: Postgres 16, PostGIS, and TimescaleDB

Status: Accepted
Date: 2026-10-28

## Context

We need one transactional store for RLS, one geography type for areas and stations, and one time-series path for telemetry. Operating three databases in an air gap is a cost we do not need yet.

## Decision

One Postgres 16 instance with the PostGIS and TimescaleDB extensions. Control data and audit live in ordinary tables. Telemetry becomes a hypertable in Phase 2. The dev image installs both extensions so the laptop matches the cluster.

## Consequences

A single primary per home region (ADR 0019). PostGIS is compiled into the Timescale image, and ground stations store a generated geography so a missing extension fails in Phase 1 rather than in Phase 2. `# STUB:` pgaudit is not packaged for this Alpine base; DDL auditing is a production-image item. The application hash chain is the audit record in this build.
