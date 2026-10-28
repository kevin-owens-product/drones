# ADR 0018: Signed OCI behavior packages

Status: Accepted
Date: 2026-10-28

## Context

Behaviors are untrusted code relative to the control plane. They need a version, a resource limit, and a promotion state a commander can point at.

## Decision

A behavior is an OCI image plus a manifest: version, inputs, outputs, required services, cpu and memory limits, safety constraints, promotion (`sim_validated`, `hitl_validated`, `flight_cleared`). cosign verifies the signature before `Load`. A package at `sim_validated` can run in the sim. Only `flight_cleared` can be started against a live tail, and only as part of an approved mission. Every version ships with a regression baseline the scorecard harness compares: coverage, custody, energy, constraint violations, replans.

## Consequences

Phase 3 builds the loader. An unsigned image does not load. A manifest without the weapons constraint does not load (ADR 0016).
