# Phase 2 — Telemetry and live ops

The Go gateway in `services/gateway` validates samples, rate-limits each tail, and keeps the latest value. `internal/pipeline/pipeline_test.go` is the 10,000 vehicle by 5 Hz check. NATS, Mosquitto, and the gateway are in `docker-compose.yml`. Timescale history is `telemetry_samples` in migration `0002_operations`.

Stubbed: the gateway process does not yet subscribe to MQTT or write Postgres. HTTP `/ingest` and the in-memory latest map are the running path. NATS and Mosquitto are in Compose for that wiring. The React console does not yet host the Cesium globe or the MapLibre fallback; those views read the same `/ingest` and `/v1/telemetry` data when they are added.
