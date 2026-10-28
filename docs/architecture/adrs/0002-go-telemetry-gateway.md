# ADR 0002: Go for the telemetry gateway

Status: Accepted
Date: 2026-10-28

## Context

The scale target is 10,000 aircraft at 5 Hz, p99 ingest-to-UI under 2 seconds. That is 50,000 small messages per second and a fan-out problem, not a CRUD problem.

## Decision

A Go process owns MQTT ingress, schema validation, per-tail rate limits, JetStream publish, the Redis latest-value write, and the WebSocket fan-out. The UI receives clustered updates at about 2 Hz per viewport, not the raw firehose. History is a batched Timescale consumer.

## Consequences

Phase 2 adds the module. The API never sits on the vehicle path. A gateway bug cannot approve a mission, because the gateway has no mission-write client.
