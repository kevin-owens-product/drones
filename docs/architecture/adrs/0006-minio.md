# ADR 0006: MinIO for objects

Status: Accepted
Date: 2026-10-28

## Context

Video, GRIB2, behavior artifacts, and export bundles need an S3 API that runs with no network.

## Decision

MinIO, bucket `a2e-artifacts`, anonymous access off, SSE-S3 (AES-256) on the bucket. The application uses the S3 API only through internal configuration.

## Consequences

`# STUB:` the dev server's SSE-S3 key is MinIO's internal key. Production attaches an external KMS (KES). Postgres is not used for video bytes.
