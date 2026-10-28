# ADR 0007: React, TypeScript, Vite, Cesium, and MapLibre

Status: Accepted
Date: 2026-10-28

## Context

Operators need a 3D globe with terrain and airspace volumes, and a 2D map when WebGL is unavailable. The UI must be buildable offline.

## Decision

React and TypeScript in strict mode, Vite for the build. CesiumJS for 3D and MapLibre for 2D, both in Phase 2. Tiles and terrain are files served from the cluster (PMTiles or a local terrain set). Cesium ion is not used. Fonts are system fonts, not a CDN. The Phase 1 console is the same app, limited to banner, fleet, org, and export, so the banner path exists before the globe does.

## Consequences

The banner text comes from `X-A2E-Banner`. If the header is missing the UI shows a fault and does not render the body. The API and the UI are same-origin: the API serves the built assets, and Vite proxies `/v1` in development, so the session cookie is first-party.
