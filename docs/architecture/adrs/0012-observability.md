# ADR 0012: Observability without a SaaS backend

Status: Accepted
Date: 2026-10-28

## Context

IL5 and air-gap deployments cannot ship traces to a vendor. Assessors still expect logs a SIEM can parse.

## Decision

Application logs are JSON on stdout (structlog): time, level, event, trace id, tenant, user, action. Redacted keys include authorization, cookie, password, token, secret. OpenTelemetry exports OTLP to an in-cluster collector. The collector's default config debug-logs and does not add a SaaS exporter. Prometheus scrapes `/metrics`. Grafana is in-cluster. `/metrics` is not on the public ingress; a separate Service is the scrape target.

## Consequences

`# STUB:` database engine logs are not JSON. pgaudit covers DDL and role changes in text logs. Dashboards beyond the datasource provisioning are Phase 7 SLO work. A trace exporter failure must not fail the request.
