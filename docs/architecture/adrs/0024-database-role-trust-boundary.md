# ADR 0024: Database role trust boundary

Status: Accepted
Date: 2026-10-28

## Context

RLS policies need to know who the user is. Postgres will believe whatever the connection tells it, if the connection is allowed to set a GUC.

## Decision

The API connects as `a2e_app`, which is not a superuser and does not have `BYPASSRLS`. At the start of each transaction it sets `app.subject` to the verified token `sub`, transaction-local (`set_config(..., true)`). RLS functions read that setting and nothing else. There is one call site.

We accept the standard consequence: anyone who can open a session as `a2e_app` can set the subject to any user. The compensating controls are a Kubernetes network policy so only API pods reach the database, a password from a secret, pgaudit on DDL and role changes, and review of that single call site. We do not try to hide this behind a second password inside SQL, because the API would still hold it.

Migrations run as the database owner through a separate URL that the running API process does not have.

`FORCE ROW LEVEL SECURITY` is on for tenant tables. The owner bypasses it only because the owner is the migration role used by definer functions. Those functions lock `search_path` to `pg_catalog, public` and are not executable by `PUBLIC` unless granted.

## Consequences

A SQL injection in the API is a full impersonation bug, not just a row bug. Parameterized SQL is mandatory (ADR 0026). The app role cannot `CREATE` in `public` and cannot update `system_policy`, `audit_events`, or the chain head.
