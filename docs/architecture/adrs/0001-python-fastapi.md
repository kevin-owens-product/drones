# ADR 0001: Python 3.12 and FastAPI for the control plane

Status: Accepted
Date: 2026-10-28

## Context

The control plane is request/response: tenancy, fleet, missions, release, debrief. It must be typed, tested, and boring. The hot path is telemetry, which is not this process.

## Decision

Python 3.12, FastAPI, Pydantic v2, mypy strict. Uvicorn bound to `0.0.0.0:$PORT`. SQLAlchemy is the connection library only (ADR 0026).

## Consequences

Async handlers share one transaction per request. CPU-bound sim and behavior code do not run inside the API workers; they have their own process in Phase 3. OpenAPI is mounted only when `A2E_ENV=development`.
