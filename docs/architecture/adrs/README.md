# Architecture decision records

Status of every record below is **Accepted** as of 2026-10-28. The conservative option is the one recorded when the requirement allowed more than one reading.

| ADR | Decision |
| --- | --- |
| [0001](0001-python-fastapi.md) | Python 3.12 and FastAPI for the control plane |
| [0002](0002-go-telemetry-gateway.md) | Go for the telemetry gateway |
| [0003](0003-nats-and-mqtt.md) | NATS JetStream, MQTT for vehicles |
| [0004](0004-postgres-postgis-timescale.md) | Postgres 16, PostGIS, TimescaleDB |
| [0005](0005-redis-live-state.md) | Redis for live state and rate limits |
| [0006](0006-minio.md) | MinIO for objects |
| [0007](0007-react-cesium-maplibre.md) | React, Vite, Cesium, MapLibre |
| [0008](0008-oidc-keycloak-piv.md) | OIDC, Keycloak in dev, CAC/PIV in production |
| [0009](0009-opa-and-rls.md) | OPA and Postgres RLS together |
| [0010](0010-mediamtx.md) | MediaMTX for video |
| [0011](0011-compose-and-helm.md) | Compose on the laptop, Helm on the cluster |
| [0012](0012-observability.md) | OpenTelemetry, Prometheus, Grafana, JSON logs |
| [0013](0013-tenant-hierarchy-and-sharing.md) | Branch, command, unit, team, and sharing |
| [0014](0014-hash-chained-audit.md) | Hash-chained append-only audit |
| [0015](0015-release-gate-and-system-high.md) | Release gate and CUI system high |
| [0016](0016-no-weapons-in-the-domain.md) | No weapons employment in the domain |
| [0017](0017-autonomy-runtime.md) | AutonomyRuntime port and FANTOM stub |
| [0018](0018-signed-oci-behaviors.md) | Signed OCI behavior packages |
| [0019](0019-active-active-and-edge.md) | Active-active stateless tier, 72h edge |
| [0020](0020-fips-crypto.md) | FIPS-approved algorithms |
| [0021](0021-air-gap-and-no-runtime-saas.md) | No runtime SaaS |
| [0022](0022-human-approval.md) | Human approval of plans and tasking |
| [0023](0023-classification-portion-marks-banners.md) | Portion marks and banners |
| [0024](0024-database-role-trust-boundary.md) | What the app database role is trusted to do |
| [0025](0025-two-person-sharing.md) | Two-person rule for sharing agreements |
| [0026](0026-raw-sql.md) | Raw SQL instead of an ORM |
