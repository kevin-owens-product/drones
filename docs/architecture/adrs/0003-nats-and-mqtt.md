# ADR 0003: NATS JetStream and MQTT ingress

Status: Accepted
Date: 2026-10-28

## Context

Aircraft and radios already speak MQTT. The core needs durable, replayable streams and a leaf node that keeps accepting data while a theater is disconnected.

## Decision

Vehicles publish MQTT. The gateway is the only subscriber that writes to JetStream. JetStream is the durability and the edge leaf protocol. We do not run a second cloud Kafka. Mosquitto is unnecessary because the gateway terminates MQTT itself in Phase 2; adding a broker would be another identity domain.

## Consequences

MQTT topics are `a2e/v1/{tenant}/{tail}/telemetry`. The gateway rejects a publish whose tenant does not match the connection credential. Core services that need telemetry subscribe to JetStream, not to MQTT.
