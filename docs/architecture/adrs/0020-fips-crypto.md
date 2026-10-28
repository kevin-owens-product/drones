# ADR 0020: FIPS-approved cryptographic algorithms

Status: Accepted
Date: 2026-10-28

## Context

The target environment expects FIPS 140-validated modules. A laptop image from a public Python base is not that module. Pretending it is would be the worse failure.

## Decision

Algorithms in this codebase are limited to AES-256-GCM, SHA-256, HMAC-SHA-256, and TLS 1.2+ cipher suites `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`, `TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384`, and `TLS_AES_256_GCM_SHA384`. JWT algorithms are RS256 and ES256. The ingress config lives in `deploy/nginx/nginx.conf`.

At rest: MinIO SSE-S3 for objects; AES-256-GCM in `crypto.py` for export snapshots, with the key in `A2E_DATA_KEY` (32 bytes), not in a table. Associated data binds tenant and resource. Postgres volume encryption (LUKS or the cloud volume's AES-256) is a deployment requirement because RLS has to read markings in the clear. Those columns are not field-encrypted.

`# STUB:` the dev containers do not load a CMVP-validated OpenSSL or Python cryptographic module. Production images must enable the vendor FIPS provider and the deployment evidence is an accreditation artifact, not this compose file. The all-zero development data key is refused when `A2E_ENV=production`.

Laptop Compose speaks HTTP so engineers are not trained to click through a self-signed warning. That is not the production path.

## Consequences

A new hash or cipher needs an ADR. `md5`, `sha1`, and `TLS 1.0/1.1` are not available as options in our configs.
