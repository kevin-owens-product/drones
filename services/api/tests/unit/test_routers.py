"""The control plane stays split by domain and keeps every existing route."""

from __future__ import annotations

from a2e.main import create_app

REQUIRED = (
    "/v1/platforms",
    "/v1/telemetry/live",
    "/v1/missions",
    "/v1/behaviors/search",
    "/v1/sim/step",
    "/v1/debrief/timeline",
    "/v1/audit",
    "/v1/session/dev-login",
    "/v1/edge/reconcile",
)


def test_domain_routers_keep_the_control_plane() -> None:
    app = create_app()
    paths = set(app.openapi()["paths"])
    missing = [path for path in REQUIRED if path not in paths]
    assert missing == []
    assert len(paths) >= 40
