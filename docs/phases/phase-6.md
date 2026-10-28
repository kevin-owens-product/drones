# Phase 6 — Edge and regions

`write_region` keeps mission writes on the home region and returns no region when that home is down. `reconcile` appends telemetry and audit, freezes a plan edited on both sides, and rejects a custody fork.

`docker-compose.edge.yml` is the trimmed stack. `scripts/airgap-bundle.sh` saves local images and the Helm chart. It does not contact a registry if the images are already present.

Stubbed: multi-region Postgres replication is not started by Compose. The pin and the reconcile rules are what a later replicator must call.
