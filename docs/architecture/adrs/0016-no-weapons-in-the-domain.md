# ADR 0016: No weapons employment in the domain model

Status: Accepted
Date: 2026-10-28

## Context

The product plans, monitors, simulates, and debriefs Group 1–3 aircraft. The requirement says the platform does not include weapons employment or effects release, and that tracking means ISR sensor custody.

## Decision

The domain has no weapon, store, effector, employment, or release-authority type. Payload kinds are sensors and a communications relay: `eo`, `ir`, `eo_ir`, `sar`, `lidar`, `comms_relay`, `acoustic`. Mission task kinds, when they arrive, are transit, search, sensor custody, loiter, and return. Behavior manifests must set `weapons_interface` to `forbidden` and `human_approval_required` to true; the loader will reject anything else.

Telemetry and KLV are not a path to a stores-management or fire-control interface, because no such interface is part of the system.

## Consequences

A later request to add employment has to change an enum, a manifest constraint, this ADR, and an accreditation decision. It will not fit in an unused JSON field. Custody quality is a sensor score, not a target-quality-for-engagement score.
