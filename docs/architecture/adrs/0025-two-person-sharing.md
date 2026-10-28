# ADR 0025: Two-person rule for sharing agreements

Status: Accepted
Date: 2026-10-28

## Context

A sharing agreement is the only door between tenants. A single compromised admin must not be able to open it alone.

## Decision

Inserts create `draft` rows with `approved_by` null and `requested_by` equal to the caller. Activation is `approve_sharing()`, which sets `approved_by` to the session user. A trigger rejects the transition unless `approved_by` is present and different from `requested_by`. Terms are immutable after insert. To change them, revoke and create a new agreement. Expiry is required, must be in the future at insert, and must be within 365 days. Revocation is a separate function. The app role has no `UPDATE` grant on the table.

The same two-person shape will apply to mission approval in Phase 5 (ADR 0022).

## Consequences

Seed data that inserts an already-active agreement is loaded by the migration owner and still has to satisfy `approved_by <> requested_by`. The dev seed uses two different users. A tenant with only one admin cannot activate an agreement until a second admin or a mission commander exists.
