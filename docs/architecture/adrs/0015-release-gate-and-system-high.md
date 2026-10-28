# ADR 0015: Release gate and system high watermark

Status: Accepted
Date: 2026-10-28

## Context

The schema must be able to store markings above CUI so a later build does not migrate the type. This repository is not an accredited high-side system. "Able to hold" must not become "able to serve."

## Decision

`system_policy.system_high` is `CUI` unless an unclassified deployment sets both the row and `A2E_SYSTEM_HIGH` to `UNCLASSIFIED`. The API refuses to start if the two differ, or if either is above CUI. Rows above the watermark are invisible to every subject, including one whose personnel clearance is higher.

The release gate runs on every export. The caller must already be able to read the row (otherwise 404). The recipient must pass clearance, citizenship, caveats, and need-to-know, and there must be a path: same hierarchy, or an active sharing agreement that itself permits the marking. SQL `app_release_allowed` and OPA both have to allow. The snapshot is sealed with AES-256-GCM and the decision is audited.

Self-export is allowed and audited. It is a download, not a cross-domain transfer, and it still hits the gate.

Formats other than JSON are refused after the check, with reason `format_unavailable`, so the attempt is logged. PDF, CSV, and xAPI are Phase 5.

## Consequences

You cannot use this build as a SECRET system by inserting SECRET rows. They sit unreadable until a future accreditation raises the watermark in code, in the policy row, and in the deployment approval.
