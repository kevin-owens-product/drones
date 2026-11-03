.PHONY: up down demo test test-unit test-integration test-scale scale lint opa ui sbom ci bench-demo

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

test: test-unit test-crsf test-spoof test-failsafe test-cbba test-separate test-link test-track test-mesh test-flowhold test-associate test-scale test-contested

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

test-track:
	$(MAKE) -C onboard/track test

test-mesh:
	$(MAKE) -C onboard/mesh test

test-flowhold:
	$(MAKE) -C onboard/flowhold test

test-contested:
	$(MAKE) -C onboard/contested test

test-associate:
	$(MAKE) -C onboard/associate test

# Kinematic supervision sim: unit checks (< 20 s), and the sweep behind docs/eval/scale.md.
test-scale:
	python3 -m unittest discover -s sim/scale -p 'test_*.py'

scale:
	python3 sim/scale/fleet.py --seeds 20

eval: $(PY)
	mkdir -p docs/eval
	set -e; { $(MAKE) -C firmware/crsf test; \
	  $(MAKE) -C onboard/spoof test; \
	  $(MAKE) -C onboard/alloc test; \
	  $(MAKE) -C onboard/separate test; \
	  $(MAKE) -C onboard/link test; \
	  $(MAKE) -C onboard/track test; \
	  $(MAKE) -C onboard/contested test; \
	  cat docs/eval/sitl.txt; } > docs/eval/latest.txt
	$(PY) -c 'from pathlib import Path; import sys; sys.path.insert(0, "services/api/src"); from a2e.evalreport import check_scenarios, write_readme; log=Path("docs/eval/latest.txt").read_text(); write_readme(Path("README.md"), log); failed=check_scenarios(log, Path("scenarios")); print("\n".join(failed)); sys.exit(1 if failed else 0)'
	@echo "wrote README results from docs/eval/latest.txt"

# Closed-loop trials against PX4 SIH in Docker. About an hour on four cores.
# Writes the raw rows and summary that `make eval` reads.
# End-of-line bench against the loopback emulator (no hardware). With a board:
#   $(PY) sim/bench/bench.py --connect /dev/ttyACM0 --serial <serial> --parts <parts.json> --firmware <image>
bench-demo: $(PY)
	$(PY) -m pip install -q "pymavlink>=2.4.41"
	cd sim/bench && for f in good bad-imu bad-param armed lossy no-mag; do \
	  $(abspath $(PY)) bench.py --emulate $$f --serial DEMO-$$f --seconds 5 --parts examples/parts.json \
	    --firmware-sha256 0000000000000000000000000000000000000000000000000000000000000000 \
	    --out out/DEMO-$$f.json || true; done

sitl: $(PY)
	cd sim/sitl && $(abspath $(PY)) gnss_denied.py --faults none,loss,step,drag,multipath --modes gnss_only,fused,gated --seeds 3 --speed 3 --denied 120 --out ../../docs/eval/sitl_gnss.jsonl
	cd sim/sitl && $(abspath $(PY)) track_loop.py --tracker v1 --seeds 5 --speed 1 --duration 90 --out ../../docs/eval/sitl_track.jsonl
	cd sim/sitl && $(abspath $(PY)) track_loop.py --tracker v2 --seeds 5 --speed 1 --duration 90 --out ../../docs/eval/sitl_track.jsonl
	$(PY) sim/sitl/summarize.py

eval-store: $(PY)
	$(PY) -c 'import os,subprocess,sys; from pathlib import Path; sys.path.insert(0,"services/api/src"); from a2e.evalreport import store_metrics; sha=subprocess.check_output(["git","rev-parse","--short","HEAD"],text=True).strip(); dsn=os.environ.get("A2E_EVAL_DATABASE_URL","postgresql://a2e:change-me-db@127.0.0.1:15432/a2e"); n=store_metrics(dsn, Path("docs/eval/latest.txt").read_text(), sha); print(f"stored {n} metrics at {sha}")'

lint: $(PY)
	cd services/api && $(PY) -m ruff check src tests && $(PY) -m mypy src

opa:
	docker run --rm -v "$(CURDIR)/policies:/policies" openpolicyagent/opa:0.70.0 test /policies -v

ui:
	cd services/ui && npm install && npm run build

sbom:
	./scripts/sbom.sh

ci: lint opa test-unit
