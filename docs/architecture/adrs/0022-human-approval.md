# ADR 0022: Human approval of plans and tasking

Status: Accepted
Date: 2026-10-28

## Context

Behaviors will propose routes, search patterns, and sensor-custody assignments. An aircraft must not fly a proposal the software approved by itself.

## Decision

Mission state is `draft → review → approved → active → closed`. Entering `approved` requires a human commander distinct from the requester. Entering `active` requires an operator and an approved plan. A behavior may write a draft or a suggestion. It cannot write `approved` or `active`. Changing a live tail's tasking is a new review, not a silent patch. The same two-person shape is already enforced for sharing agreements (ADR 0025).

## Consequences

Phase 5 builds the workflow. The Phase 3 runtime can start a behavior in simulation without that workflow, and against a live tail only when the mission is already `approved`. `flight_cleared` on a package is necessary and not sufficient.
