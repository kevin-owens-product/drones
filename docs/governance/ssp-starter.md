# System security plan starter

This is an engineering starter for an SSP, not an authorization to operate. System high for this repository is CUI. Impact Level 5 accreditation is a deployment activity outside this repo.

## System

A2E Mission Cloud plans, monitors, simulates, and debriefs Group 1–3 uncrewed aircraft. It does not employ weapons or release effects. Tracking is ISR sensor custody.

## Boundaries

The authorization boundary is the Compose stack or the Helm release: API, gateway, OPA, Postgres, Redis, NATS, MinIO, MediaMTX, and the console. Keycloak is inside the boundary only in development. Production uses the enterprise IdP. There is no runtime SaaS dependency.

## Users and roles

Roles are admin, mission commander, planner, operator, analyst, maintainer, and auditor. Privileges are the matrix in `policies/role_matrix/data.json`, enforced in SQL and in OPA. There is no application superuser.

## Control inheritance

See `docs/architecture/control-mapping.md`. Controls marked partial or gap are copied into `poam.md`.

## Audit

`audit_events` is append-only and hash-chained. Login failures, exports, sharing approvals, and mission transitions are on that chain. Application logs are JSON on stdout.

## Cryptography

AES-256-GCM for export snapshots and MinIO SSE-S3. TLS 1.2+ cipher list is in `deploy/nginx/nginx.conf`. Laptop Compose is HTTP. The process is not a CMVP-validated module; that is a deployment action.
