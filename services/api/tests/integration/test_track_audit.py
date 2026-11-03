"""A confirmed visual lock, loss, or abort is an audit row."""

from __future__ import annotations

import os

import httpx
import psycopg
import pytest
from httpx import ASGITransport

from a2e.demo_ids import TEAM_NORTH

pytestmark = pytest.mark.integration


def _dsn(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )


@pytest.fixture(scope="module")
def require_services() -> None:
    try:
        with psycopg.connect(_dsn(os.environ["A2E_MIGRATION_DATABASE_URL"]), connect_timeout=3) as conn:
            conn.execute("SELECT 1")
        with httpx.Client(timeout=2.0) as client:
            client.get(os.environ["A2E_OPA_URL"].rstrip("/") + "/health")
    except Exception as exc:
        if os.environ.get("A2E_REQUIRE_INTEGRATION") == "1":
            pytest.fail(f"integration dependencies are down: {exc}")
        pytest.skip(f"integration dependencies are down: {exc}")


@pytest.mark.asyncio(loop_scope="session")
async def test_track_events_are_audited(require_services: None) -> None:
    from a2e.main import app

    password = os.environ["A2E_DEV_LOGIN_PASSWORD"]
    body = {"tenant_id": str(TEAM_NORTH), "system_id": 1, "event": "lock", "confirm": False}
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        analyst = await client.post(
            "/v1/session/dev-login",
            json={"username": "gwen.analyst", "password": password},
        )
        assert analyst.status_code == 200, analyst.text
        denied = await client.post("/v1/flight/track", json={**body, "confirm": True})
        assert denied.status_code == 403, denied.text

        client.cookies.clear()
        commander = await client.post(
            "/v1/session/dev-login",
            json={"username": "carl.commander", "password": password},
        )
        assert commander.status_code == 200, commander.text
        unconfirmed = await client.post("/v1/flight/track", json=body)
        assert unconfirmed.status_code == 409, unconfirmed.text
        assert unconfirmed.json()["detail"] == "not_confirmed"
        locked = await client.post("/v1/flight/track", json={**body, "confirm": True})
        assert locked.status_code == 202, locked.text
        assert locked.json()["event"] == "lock"

    with psycopg.connect(_dsn(os.environ["A2E_MIGRATION_DATABASE_URL"])) as conn:
        row = conn.execute(
            """
            SELECT decision, reason_codes
            FROM audit_events
            WHERE action = 'vehicle.track'
            ORDER BY occurred_at DESC
            LIMIT 2
            """
        ).fetchall()
    assert row[0] == ("allow", ["lock", "1"])
    assert row[1][0] == "deny"
    assert "not_confirmed" in row[1][1]
