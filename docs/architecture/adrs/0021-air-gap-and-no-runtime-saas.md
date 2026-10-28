# ADR 0021: Air gap and no runtime SaaS

Status: Accepted
Date: 2026-10-28

## Context

A theater node and an IL5 enclave cannot depend on a public API. The failure mode is a mission system that will not start because a tile server or a log vendor is unreachable.

## Decision

No runtime outbound call to a SaaS product. Identity, maps, weather, logs, metrics, objects, and tokens are all in-cluster or on disk. GRIB2 is a file. Tiles are files. Keycloak is a dev stand-in, not a cloud IdP. The OTel collector has no vendor exporter. Fonts are not loaded from a CDN.

The air-gap install is an image bundle and a values file (Phase 6 script). SBOMs travel with the bundle.

## Consequences

Cesium ion, Google tiles, public OIDC discovery beyond the configured issuer, and hosted Grafana are out. Tests that need the network are the ones that pull images, and they are not on the request path.
