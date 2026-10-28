# A2E Mission Cloud

Plans, monitors, simulates, and debriefs missions for Group 1–3 uncrewed aircraft. Humans approve every plan and every tasking change. The platform does not employ weapons or release effects. Tracking means ISR sensor custody.

This build's system high is **CUI**. The schema can store higher markings, and the release gate will not show or export them.

## Status

| Phase | State |
| --- | --- |
| 0 Architecture | Done. [docs/architecture](docs/architecture/README.md) |
| 1 Platform core | Done. Tenancy, RLS, OIDC, ABAC, audit, release gate, fleet registry |
| 2 Telemetry | Gateway, 10k x 5 Hz test, Timescale table, NATS and MQTT in Compose |
| 3 Sim and behaviors | SimRuntime, FANTOM stub, five reference behaviors, scorecard |
| 4 Video | KLV parser, HLS playlist, MediaMTX, bandwidth allocator |
| 5 Missions and debrief | Approval workflow, timeline, CSV, PDF, xAPI through the release action |
| 6 Edge | Home-region pin, reconcile, edge Compose, air-gap bundle script |
| 7 Hardening | Pen-test checklist, SSP starter, POA&M, performance report |

## Run the core

```bash
cp .env.example .env
make ui    # optional; builds the React console into the API image tree
make up    # docker compose up --build
```

Open `http://localhost:8000`. The dev realm is `a2e-dev`. Dev users share the password `dev-only-change-me` (Keycloak only). Banner floor is CUI.

Sign in as `gwen.analyst` (GBR, CUI). She sees tails `N-002` and `N-003`. She does not see `N-001`, which is `CUI//NOFORN`.

Postgres is published on **5433** in the integration notes below so it does not collide with another local Postgres on 5432. Compose itself publishes 5432; stop anything else bound there first, or change the host port in `docker-compose.yml`.

## Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -e "./services/api[dev]"
make test-unit
make opa
```

Integration tests need the database image and OPA:

```bash
docker build -t a2e-postgres deploy/postgres
docker run -d --name a2e-pg -p 5433:5432 \
  -e POSTGRES_USER=a2e -e POSTGRES_PASSWORD=change-me-db -e POSTGRES_DB=a2e \
  a2e-postgres postgres -c shared_preload_libraries=timescaledb
docker run -d --name a2e-opa -p 8181:8181 \
  -v "$PWD/policies:/policies" openpolicyagent/opa:0.70.0 \
  run --server --addr=0.0.0.0:8181 /policies
```

Then, with the variables from `.env.example` pointed at `localhost:5433` and `A2E_AUTH_MODE=test`, `A2E_DEV_LOGIN=1`, `A2E_SEED=1`:

```bash
.venv/bin/python -m a2e.bootstrap
cd services/api && ../.venv/bin/python -m pytest tests/integration
```

Playwright (after the API is up in test auth mode and `make ui`):

```bash
cd services/ui && npx playwright install chromium && npm run e2e
```

## Layout

```text
docs/architecture/     Phase 0
policies/              Rego and the role matrix
services/api/          FastAPI control plane
services/ui/           React console
deploy/                Postgres image, OPA image, nginx TLS, Helm
```

Helm, for a cluster that already has secrets (do not use `values-dev.yaml` outside a laptop):

```bash
helm template a2e deploy/helm/a2e -f deploy/helm/a2e/values-dev.yaml
```

Later phases are summarized in `docs/phases/`. The gateway image runs its 10k test during `docker build`. Behavior and mission calls are under `/v1/behaviors`, `/v1/missions`, `/v1/sim`, `/v1/video`, `/v1/debrief`, and `/v1/edge`.

## What's stubbed in Phase 1

- CAC/PIV. OIDC is the seam. Keycloak is the dev IdP only.
- FIPS-validated module. Algorithms are AES-256-GCM, SHA-256, and TLS 1.2+ ciphers in `deploy/nginx/nginx.conf`. The laptop image is not a CMVP module.
- Laptop Compose speaks HTTP.
- Refresh tokens.
- Export formats other than JSON (PDF, CSV, xAPI return `format_unavailable` after the gate runs).
- Cross-tenant write, even if a sharing row says `read_write`.
- pgaudit on this image.
- MinIO external KMS. The bucket uses SSE-S3.
- Image digest pins. CI builds a CycloneDX SBOM and signs with cosign only when `COSIGN_KEY` is set.
- Grafana dashboards beyond the Prometheus datasource.
- FANTOM, telemetry gateway, sim, video, missions, and edge sync. Those are later phases. The domain has no weapons type for them to grow into.
