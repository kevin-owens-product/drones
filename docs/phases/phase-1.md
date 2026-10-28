# Phase 1 — Platform core

Status: complete.

## What runs

`docker compose up` starts Postgres (PostGIS + TimescaleDB), Redis, MinIO, OPA, Keycloak, the API, and the local observability stack. The API applies the schema, loads `policies/role_matrix/data.json` into `role_permissions`, and seeds fictional units when `A2E_SEED=1`.

## Migrations and seed

- `services/api/migrations/sql/0001_core.sql` via Alembic revision `0001_core`
- `services/api/seeds/dev.sql` only when seeding is on, and never when `A2E_ENV=production`

## Tests

- `services/api/tests/unit` — markings, crypto, hash chain, settings guards, OPA client fail-closed
- `policies/abac_test.rego` — the same marking vectors
- `services/api/tests/integration/test_rls_and_api.py` — RLS, system high, audit immutability, release gate
- `services/ui/e2e/fleet.spec.ts` — Playwright against the console

## What's stubbed

- CAC/PIV broker
- CMVP-validated crypto module
- TLS on the laptop Compose network
- Refresh tokens
- PDF, CSV, and xAPI exporters
- Cross-tenant write
- pgaudit
- External MinIO KMS
- Image digest pins
- Grafana SLO dashboards

Phases 2–7 are not started.
