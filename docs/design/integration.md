# Integration layer

This is the stable interface for bringing a vehicle or sensor that is not PX4 into A2E. It is telemetry only. An adapter reports state; it never receives tasking, and there is no command path through it (ADR 0016).

## Telemetry ingest (stable, version a2e/v1)

An adapter sends one JSON object per sample, by either route:

- MQTT: publish to `a2e/v1/<tenant>/<tail>/telemetry`.
- HTTP: `POST /ingest?topic=a2e/v1/<tenant>/<tail>/telemetry` on the gateway.

The object is `sample.Sample` in `services/gateway/internal/sample`. Required keys: `tail_number`, `tenant_id`, `time` (RFC 3339), `lat`, `lon`, `alt_m`, `classification`, `caveats`. Optional keys: `heading_deg` [0, 360), `ground_mps`, `climb_mps`, `battery_pct` [0, 100], `mode`, `armed`, `nav_source`, `gnss_trusted`. Leave a key out when the source does not report it.

The gateway rejects a sample when identity is missing, the tenant or tail differs from the topic, the position or an optional value is out of range, or the classification is above system high. Accepted samples are rate limited per tail.

## Versioning

- The topic prefix `a2e/v1` and the key names are the contract. Renaming or removing a key, or changing its unit, needs `a2e/v2`, served beside v1.
- Adding an optional key is allowed in v1. Old adapters keep working because every new key is optional.
- `proto/autonomy.proto` follows the same rule through its package name (`a2e.autonomy.v1`). Its header comment states the policy: removed field numbers are `reserved` and never reused.

## Conformance

`services/gateway/internal/conformance` has a reference adapter for a small ground rover with its own autopilot and no MAVLink. It maps position, course, speed in km/h, and pack voltage onto the contract. The test runs the adapter output through the same decode, topic split, and `pipeline.Ingest` the gateway uses, and checks:

- a well-formed rover sample is accepted and its values map correctly (course -90 becomes 270, 7.2 km/h becomes 2 m/s, 15.4 V on 4S becomes 50 %);
- the set of wire keys is exactly the documented list;
- tail or tenant mismatched to the topic, an out-of-range latitude, and a classification above system high are each rejected;
- an overcharged pack is clamped, not rejected.

Run it with `cd services/gateway && go test ./internal/conformance/`. A new adapter should copy that test with its own mapping.

## Limits

- The conformance test calls the pipeline in process. It does not start the HTTP server or an MQTT broker.
- The battery estimate in the reference adapter is a linear per-cell guess, good enough for display only.
- Nothing here has been run against a real non-PX4 vehicle.
