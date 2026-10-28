# C4 — containers

A container here is a deployable process or data store, not a Docker image. Every one of these starts from `docker compose up` on a laptop. Kubernetes manifests arrive with the component that needs them; the full multi-region chart is Phase 6. Phase 1 ships a chart for the control plane.

```mermaid
C4Container
  title A2E Mission Cloud — containers

  Person(user, "Cleared user", "Browser")

  Container_Boundary(core, "Core region") {
    Container(ui, "Web console", "React, TypeScript, Vite", "Cesium globe in Phase 2. MapLibre fallback. Banner is the API header, not a client guess.")
    Container(api, "Control-plane API", "Python 3.12, FastAPI", "Tenancy, fleet, missions, release gate, debrief. Sets the database session subject from a verified token.")
    Container(gw, "Telemetry gateway", "Go", "MQTT in, schema check, rate limit, JetStream, WebSocket fan-out. Phase 2.")
    Container(sim, "Sim and behavior host", "Python", "AutonomyRuntime, five reference behaviors, scorecards. Phase 3.")
    Container(media, "Video plane", "MediaMTX, GStreamer", "RTSP/SRT in, KLV metadata, HLS out. Phase 4.")
    Container(opa, "Policy engine", "OPA", "ABAC decisions. Default deny. Baked into a signed image.")
    Container(idp, "Dev IdP", "Keycloak", "OIDC. Absent in production; the enterprise IdP replaces it.")
    ContainerDb(pg, "System of record", "Postgres 16, PostGIS, TimescaleDB", "RLS, audit chain, tracks, telemetry hypertables.")
    ContainerDb(redis, "Live state", "Redis", "Latest positions, rate limits, WebSocket presence.")
    ContainerDb(obj, "Object store", "MinIO, S3 API", "Video, GRIB2, exports, behavior artifacts. SSE-S3 AES-256.")
    ContainerDb(nats, "Message bus", "NATS JetStream", "Durable telemetry and edge leaf nodes.")
    Container(obs, "Telemetry of the system", "OpenTelemetry, Prometheus, Grafana", "JSON logs on stdout. No SaaS exporter.")
  }

  Container_Boundary(edge, "Theater edge") {
    Container(edgeapi, "Edge bundle", "Trimmed core", "Same images, smaller set. Disconnected up to 72 hours. Phase 6.")
  }

  Rel(user, ui, "Uses", "HTTPS, TLS 1.2+")
  Rel(ui, api, "API", "Same origin, session cookie")
  Rel(api, opa, "Authorize", "HTTP on the cluster network")
  Rel(api, idp, "Validate JWT / auth code", "OIDC")
  Rel(api, pg, "SQL as a2e_app", "TLS in cluster")
  Rel(api, redis, "Rate limit, live reads")
  Rel(api, obj, "Seal and store exports")
  Rel(gw, nats, "Publish validated samples")
  Rel(gw, redis, "Latest-value cache")
  Rel(gw, pg, "Batched history")
  Rel(sim, nats, "Simulated samples")
  Rel(media, obj, "Segments")
  Rel(edgeapi, nats, "Leaf node, store-and-forward")
  Rel(api, obs, "OTLP and JSON logs")
```

Active-active is the stateless tier (API, gateway, OPA). A tenant's mission writes are pinned to a home region. Telemetry is born in the theater and replicates inward. See [ADR 0019](adrs/0019-active-active-and-edge.md).

Laptop Compose speaks HTTP. TLS 1.2+ with the approved cipher list is the ingress config in `deploy/nginx/nginx.conf` and the Helm chart, not an optional extra. See [ADR 0020](adrs/0020-fips-crypto.md).
