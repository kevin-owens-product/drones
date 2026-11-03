.PHONY: up down demo test test-unit test-integration lint opa ui sbom ci

up:
	@test -f .env || (echo "Copy .env.example to .env first" && exit 1)
	docker compose up --build

demo:
	@test -f .env || cp .env.example .env
	docker compose up --build

down:
	docker compose down

PY := $(CURDIR)/.venv/bin/python

$(PY):
	python3 -m venv $(CURDIR)/.venv
	$(PY) -m pip install -e "$(CURDIR)/services/api[dev]"

test-unit: $(PY)
	cd services/api && $(PY) -m pytest tests/unit --cov=a2e --cov-report=term-missing

test-integration: $(PY)
	@test -f .env || (echo "Copy .env.example to .env and start postgres + opa" && exit 1)
	set -a && . ./.env && set +a && cd services/api && $(PY) -m pytest tests/integration

test: test-unit test-crsf test-spoof test-failsafe test-cbba test-separate test-link

test-crsf:
	$(MAKE) -C firmware/crsf test

test-spoof:
	$(MAKE) -C onboard/spoof test

test-failsafe:
	$(MAKE) -C onboard/failsafe test

test-cbba:
	$(MAKE) -C onboard/alloc test

test-separate:
	$(MAKE) -C onboard/separate test

test-link:
	$(MAKE) -C onboard/link test

eval: $(PY)
	mkdir -p docs/eval
	set -e; { $(MAKE) -C firmware/crsf test; \
	  $(MAKE) -C onboard/spoof test; \
	  $(MAKE) -C onboard/alloc test; \
	  $(MAKE) -C onboard/separate test; \
	  $(MAKE) -C onboard/link test; } > docs/eval/latest.txt
	$(PY) -c 'from pathlib import Path; import sys; sys.path.insert(0, "services/api/src"); from a2e.evalreport import write_readme; write_readme(Path("README.md"), Path("docs/eval/latest.txt").read_text())'
	@echo "wrote README results from docs/eval/latest.txt"

lint: $(PY)
	cd services/api && $(PY) -m ruff check src tests && $(PY) -m mypy src

opa:
	docker run --rm -v "$(CURDIR)/policies:/policies" openpolicyagent/opa:0.70.0 test /policies -v

ui:
	cd services/ui && npm install && npm run build

sbom:
	./scripts/sbom.sh

ci: lint opa test-unit
