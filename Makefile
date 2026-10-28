.PHONY: up down test test-unit test-integration lint opa ui sbom ci

up:
	@test -f .env || (echo "Copy .env.example to .env first" && exit 1)
	docker compose up --build

down:
	docker compose down

test-unit:
	cd services/api && python -m pytest tests/unit --cov=a2e --cov-report=term-missing

test-integration:
	@test -f .env || (echo "Copy .env.example to .env and start postgres + opa" && exit 1)
	set -a && . ./.env && set +a && cd services/api && python -m pytest tests/integration

test: test-unit

lint:
	cd services/api && ruff check src tests && mypy src

opa:
	docker run --rm -v "$(CURDIR)/policies:/policies" openpolicyagent/opa:0.70.0 test /policies -v

ui:
	cd services/ui && npm install && npm run build

sbom:
	./scripts/sbom.sh

ci: lint opa test-unit
