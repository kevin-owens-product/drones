# ADR 0014: Hash-chained audit log

Status: Accepted
Date: 2026-10-28

## Context

Exports, sharing approvals, custody changes, and authentication failures have to be attributable later. A table anyone with the app role can update is not an audit log.

## Decision

`audit_events` is append-only. A trigger rejects update and delete. The app role has no insert, update, or delete. Inserts go through `append_audit` (actor must equal the session subject) or `append_system_audit` (whitelist of `auth.*` actions, actor is the disabled system user).

The chain is `row_hash = SHA-256(prev_hash_bytes || canonical_utf8)`. The canonical string is stored on the row. The database recomputes the hash from the previous head, which it locks, and rejects a mismatch. The verifier recomputes canonical form from the columns as well, so a mismatched body is an alarm even though the trigger cannot do that second check itself.

Genesis head is 64 hex zeros. Custody events use the same construction per tail.

## Consequences

A race on the head returns a conflict and the API retries. The holder of the Postgres owner role can still rewrite history; that role is not the API's role. `python -m a2e.verify_audit` walks the chain.
