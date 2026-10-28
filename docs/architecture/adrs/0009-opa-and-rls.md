# ADR 0009: OPA and row-level security together

Status: Accepted
Date: 2026-10-28

## Context

Attribute checks (role, clearance, citizenship, need-to-know, releasability) change often. Tenant isolation must hold even when a handler forgets a predicate. One engine will be configured wrong eventually.

## Decision

Postgres RLS is authoritative for which rows a subject can read or write. OPA is authoritative for which action the subject's roles allow, and it repeats the marking check. The API allows the action only when SQL `app_action_permitted` and OPA both allow. If they disagree, the answer is deny, and the audit row records `policy_disagreement` when SQL denied a row OPA would have allowed.

OPA's policy defaults to deny. An empty result, an HTTP error, or a timeout is a deny (503 `opa_unavailable`, no body).

The role matrix lives in `policies/role_matrix/data.json`. OPA loads it as `data.role_matrix`. The API rewrites the `role_permissions` table from that file on startup. SQL functions join the table, so a hand-edited copy cannot drift for long.

## Consequences

Two implementations of the marking rules (SQL and Rego) plus a Python copy used for banners and shared test vectors. The vectors in `policies/testdata/marking_cases.json` are the spec. A new caveat that is not implemented must fail closed in all three, and the unknown-caveat test is what proves it.

There is no application superuser. Admin is a tenant role.
