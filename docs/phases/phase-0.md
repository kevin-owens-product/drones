# Phase 0 — Architecture

Status: complete. No application code in this phase.

## File tree

```text
docs/architecture/README.md
docs/architecture/c4-context.md
docs/architecture/c4-containers.md
docs/architecture/c4-components.md
docs/architecture/data-model.md
docs/architecture/threat-model.md
docs/architecture/control-mapping.md
docs/architecture/sequences.md
docs/architecture/adrs/README.md
docs/architecture/adrs/0001-python-fastapi.md
docs/architecture/adrs/0002-go-telemetry-gateway.md
docs/architecture/adrs/0003-nats-and-mqtt.md
docs/architecture/adrs/0004-postgres-postgis-timescale.md
docs/architecture/adrs/0005-redis-live-state.md
docs/architecture/adrs/0006-minio.md
docs/architecture/adrs/0007-react-cesium-maplibre.md
docs/architecture/adrs/0008-oidc-keycloak-piv.md
docs/architecture/adrs/0009-opa-and-rls.md
docs/architecture/adrs/0010-mediamtx.md
docs/architecture/adrs/0011-compose-and-helm.md
docs/architecture/adrs/0012-observability.md
docs/architecture/adrs/0013-tenant-hierarchy-and-sharing.md
docs/architecture/adrs/0014-hash-chained-audit.md
docs/architecture/adrs/0015-release-gate-and-system-high.md
docs/architecture/adrs/0016-no-weapons-in-the-domain.md
docs/architecture/adrs/0017-autonomy-runtime.md
docs/architecture/adrs/0018-signed-oci-behaviors.md
docs/architecture/adrs/0019-active-active-and-edge.md
docs/architecture/adrs/0020-fips-crypto.md
docs/architecture/adrs/0021-air-gap-and-no-runtime-saas.md
docs/architecture/adrs/0022-human-approval.md
docs/architecture/adrs/0023-classification-portion-marks-banners.md
docs/architecture/adrs/0024-database-role-trust-boundary.md
docs/architecture/adrs/0025-two-person-sharing.md
docs/architecture/adrs/0026-raw-sql.md
docs/phases/phase-0.md
```

## Migrations, seed, tests

None. Phase 1 is the first schema.

## Run

Read `docs/architecture/README.md`. There is nothing to start.

## What's stubbed

Nothing is stubbed inside Phase 0, because there is no runtime. Later phases own the items the ADRs mark as `# STUB`: FANTOM SDK calls, FIPS-validated module boundary, CAC/PIV broker, external MinIO KMS, image digest pins, refresh tokens, and cross-tenant write.
