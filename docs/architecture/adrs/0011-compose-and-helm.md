# ADR 0011: Docker Compose and Helm

Status: Accepted
Date: 2026-10-28

## Context

Every component has to run on a laptop and on Kubernetes, including an air-gapped cluster that will never see a hosted control plane.

## Decision

`docker compose up` is the laptop path. Helm is the cluster path. Production values do not create passwords; they reference existing secrets. `values-dev.yaml` may create the obvious dev secrets and is not a production input. The chart `fail`s if `env=production` and `authMode=test`, or if dev secrets are combined with production.

Phase 1 charts the control plane (API, OPA, optional dev Postgres, optional dev Keycloak). Phase 6 adds regions, edge, and the air-gap bundle.

## Consequences

Image tags are pinned. Digest pins are `# STUB` until Phase 7. Postgres in the chart is a dev StatefulSet, not a CloudNativePG or accredited DBaaS. Real deployments point `database.host` at the accredited service and leave `postgres.devInstance` false.
