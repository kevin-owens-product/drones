# Performance report

## Target

10,000 vehicles at 5 Hz, p99 from ingest until the latest value is visible, under 2 seconds. History in Timescale is asynchronous and is not on that path.

## Method

`services/gateway` keeps the latest sample per tail after validation and a 5 Hz rate limit. `go test ./internal/pipeline` publishes 10,000 tails times 5 samples on one process and fails if that second of traffic is not fully visible within 2 seconds.

The k6 script `deploy/load/k6-telemetry.js` is a 20-VU smoke test against `POST /ingest` once the gateway container is up. It does not replace the 10k test.

## Result

Measured on 2026-10-28 with `go test -v ./internal/pipeline` inside `golang:1.22-alpine`:

`10k vehicles x 5 samples in 35.982333ms, slowest tick 15.776917ms`

That is 50,000 samples, one second of the 5 Hz design load, visible in 36 ms. The budget is 2 seconds. This measurement is in-process. NATS, Redis, and the browser add a hop; they are not included in the 36 ms.

## What this does not measure

WebGL frame time, HLS transcode, or a multi-region failover. Those are separate from the ingest budget.
