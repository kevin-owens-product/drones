# Phase 2 — Telemetry and live ops

The Go gateway in `services/gateway` validates samples, rate-limits each tail, and keeps the latest value. `internal/pipeline/pipeline_test.go` is the 10,000 vehicle by 5 Hz check. Accepted samples go to the Redis hash `telemetry:latest`, a NATS subject `telemetry.{tenant}.{tail}`, and Timescale through `ingest_telemetry_batch`. MQTT topic `dmc/v1/{tenant}/{tail}/telemetry` is the vehicle path. `GET /v1/telemetry/live` returns only rows the caller may see. The console draws those rows on a MapLibre map and a Cesium globe. `A2E_GATEWAY_DEMO=1` publishes N-002 and N-003 so the map is not empty.

Anonymous MQTT and MediaMTX remain lab stubs. The 10k measurement is in-process and does not include NATS, Redis, or a browser.
