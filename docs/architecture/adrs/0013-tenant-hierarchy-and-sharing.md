# ADR 0013: Tenant hierarchy and sharing agreements

Status: Accepted
Date: 2026-10-28

## Context

The org tree is Branch → Command → Unit → Team. Many branches (USAF, USA, USN, USMC, USSF, SOCOM) share one deployment. Data must not cross tenants unless a record says it may.

## Decision

Every org node is a tenant. Membership at a node covers descendants, not ancestors or siblings. Reads roll down. Writes require a role on that coverage.

A sharing agreement is an explicit row: provider, consumer, categories, max classification, `allow_noforn` (default false), `include_descendants` (default false), expiry, two-person approval (ADR 0025). Absent a matching active agreement, RLS returns no foreign rows.

`read_write` may be stored and is ignored. `# STUB:` cross-tenant write stays denied until a follow-on ADR enables it. Category `audit` is rejected by a check constraint.

Seed data uses fictional subordinate units under real branch codes. Branch codes are the tenant type the product has to support. Subordinate names are not real units.

## Consequences

Command staff are members of the command node, not of every team. A team operator cannot read the sister team. An agreement does not grant the consumer the provider's roles.
