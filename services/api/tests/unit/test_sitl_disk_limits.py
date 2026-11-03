"""PX4 SITL must not be able to fill the host disk."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]


def test_every_compose_service_caps_its_log() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    for name, service in compose["services"].items():
        options = service.get("logging", {}).get("options", {})
        assert options.get("max-size") and options.get("max-file"), name


def test_fleet_runs_px4_without_the_shell() -> None:
    fleet = (ROOT / "deploy/sitl/fleet.sh").read_text()
    assert '/bin/px4" -d -i "$i" &' in fleet
    assert "SDLOG_DIRS_MAX" in fleet


def test_sih_harness_caps_its_log() -> None:
    assert '"--log-opt", "max-size=10m"' in (ROOT / "sim/sitl/harness.py").read_text()
