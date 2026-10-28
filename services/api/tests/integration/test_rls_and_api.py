"""RLS and the release gate against Postgres and OPA.

Skipped when those services are down, unless A2E_REQUIRE_INTEGRATION=1.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest
from httpx import ASGITransport

from a2e.demo_ids import CARL, FRANK, GWEN, TAIL_N001, TAIL_N002, TAIL_N003, TAIL_S001, UNA

pytestmark = pytest.mark.integration


def _dsn(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )


def _app_dsn() -> str:
    return _dsn(os.environ["A2E_DATABASE_URL"])


def _admin_dsn() -> str:
    return _dsn(os.environ["A2E_MIGRATION_DATABASE_URL"])


@pytest.fixture(scope="module")
def require_services() -> None:
    try:
        with psycopg.connect(_admin_dsn(), connect_timeout=3) as conn:
            conn.execute("SELECT 1")
        with httpx.Client(timeout=2.0) as client:
            client.get(os.environ["A2E_OPA_URL"].rstrip("/") + "/health")
    except Exception as exc:
        if os.environ.get("A2E_REQUIRE_INTEGRATION") == "1":
            pytest.fail(f"integration dependencies are down: {exc}")
        pytest.skip(f"integration dependencies are down: {exc}")


@pytest.fixture
def admin(require_services: None) -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    with psycopg.connect(_admin_dsn()) as conn:
        yield conn


@pytest.fixture
def app_conn(require_services: None) -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    with psycopg.connect(_app_dsn()) as conn:
        yield conn


def _as(conn: psycopg.Connection[tuple[object, ...]], subject: str) -> None:
    conn.execute("SELECT set_config('app.subject', %s, true)", (subject,))


def _tails(conn: psycopg.Connection[tuple[object, ...]], subject: str) -> set[str]:
    _as(conn, str(subject))
    with conn.cursor() as cur:
        cur.execute("SELECT tail_number FROM platforms ORDER BY tail_number")
        return {row[0] for row in cur.fetchall()}


def test_role_is_not_superuser(admin: psycopg.Connection[tuple[object, ...]]) -> None:
    with admin.cursor() as cur:
        cur.execute(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'a2e_app'"
        )
        row = cur.fetchone()
    assert row == (False, False)


def test_extensions(admin: psycopg.Connection[tuple[object, ...]]) -> None:
    with admin.cursor() as cur:
        cur.execute(
            "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'timescaledb', 'pgcrypto')"
        )
        names = {row[0] for row in cur.fetchall()}
    assert names == {"postgis", "timescaledb", "pgcrypto"}


def test_visibility(app_conn: psycopg.Connection[tuple[object, ...]]) -> None:
    gwen = _tails(app_conn, GWEN)
    assert {"N-002", "N-003"} <= gwen
    assert "N-001" not in gwen
    app_conn.rollback()
    owen = "22222222-2222-4222-8222-222222222204"
    owen_tails = _tails(app_conn, owen)
    assert "N-003" in owen_tails
    assert "N-001" not in owen_tails
    assert "N-002" not in owen_tails
    app_conn.rollback()
    una_tails = _tails(app_conn, UNA)
    assert "S-001" in una_tails
    assert "N-001" not in una_tails
    app_conn.rollback()
    assert "N-001" in _tails(app_conn, CARL)
    app_conn.rollback()
    frank = _tails(app_conn, FRANK)
    assert "N-002" in frank
    assert "N-003" in frank
    assert "N-001" not in frank
    assert "S-001" not in frank


def test_secret_row_is_invisible(admin: psycopg.Connection[tuple[object, ...]]) -> None:
    with admin.cursor() as cur:
        cur.execute(
            """
            INSERT INTO platforms (
              id, tenant_id, tail_number, designation, group_size, serial_number,
              classification, caveats
            ) VALUES (
              '99999999-9999-4999-8999-999999999999',
              '11111111-1111-4111-8111-111111111104',
              'N-SEC', 'A2E-G1-QUAD', 'group_1', 'SN-SEC', 'SECRET', '{}'
            )
            """
        )
    admin.commit()
    try:
        with psycopg.connect(_app_dsn()) as conn:
            assert "N-SEC" not in _tails(conn, CARL)
    finally:
        with admin.cursor() as cur:
            cur.execute("DELETE FROM platforms WHERE tail_number = 'N-SEC'")
        admin.commit()


def test_audit_is_append_only(app_conn: psycopg.Connection[tuple[object, ...]]) -> None:
    _as(app_conn, str(CARL))
    with pytest.raises(psycopg.Error):
        app_conn.execute("UPDATE audit_events SET decision = 'deny'")
    app_conn.rollback()


def test_hash_matches_postgres(admin: psycopg.Connection[tuple[object, ...]]) -> None:
    from a2e.chain import GENESIS, chain_hash

    with admin.cursor() as cur:
        cur.execute(
            """
            SELECT encode(
              digest(decode(repeat('0', 64), 'hex') || convert_to('{}', 'UTF8'), 'sha256'),
              'hex'
            )
            """
        )
        row = cur.fetchone()
    assert row is not None
    assert row[0] == chain_hash(GENESIS, "{}")


@pytest.mark.asyncio
async def test_api_release_and_banner(require_services: None) -> None:
    from a2e.main import app

    password = os.environ["A2E_DEV_LOGIN_PASSWORD"]
    transport = ASGITransport(app=app)

    async def login(client: httpx.AsyncClient, username: str) -> None:
        response = await client.post(
            "/v1/session/dev-login",
            json={"username": username, "password": password},
        )
        assert response.status_code == 200, response.text
        assert response.headers["X-A2E-Banner"] == "CUI"

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await login(client, "gwen.analyst")
        listed = await client.get("/v1/platforms")
        assert listed.status_code == 200, listed.text
        tails = {item["tail_number"] for item in listed.json()["items"]}
        assert {"N-002", "N-003"} <= tails
        assert "N-001" not in tails
        assert listed.headers["X-A2E-Banner"].startswith("CUI")
        hidden = await client.post(
            "/v1/exports",
            json={
                "resource_type": "platform",
                "resource_id": str(TAIL_N001),
                "recipient_user_id": str(FRANK),
                "purpose": "should miss",
                "format": "json",
            },
        )
        assert hidden.status_code == 404

        client.cookies.clear()
        await login(client, "carl.commander")
        denied = await client.post(
            "/v1/exports",
            json={
                "resource_type": "platform",
                "resource_id": str(TAIL_N001),
                "recipient_user_id": str(FRANK),
                "purpose": "noforn to a shared consumer",
                "format": "json",
            },
        )
        assert denied.status_code == 403
        allowed = await client.post(
            "/v1/exports",
            json={
                "resource_type": "platform",
                "resource_id": str(TAIL_N002),
                "recipient_user_id": str(FRANK),
                "purpose": "REL TO exercise",
                "format": "json",
            },
        )
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["record"]["tail_number"] == "N-002"
        other = await client.post(
            "/v1/exports",
            json={
                "resource_type": "platform",
                "resource_id": str(TAIL_N002),
                "recipient_user_id": str(FRANK),
                "purpose": "pdf later",
                "format": "pdf",
            },
        )
        assert other.status_code == 400
        assert other.json()["detail"] == "format_unavailable"

        client.cookies.clear()
        await login(client, "una.south")
        south = await client.get("/v1/platforms")
        south_tails = {item["tail_number"] for item in south.json()["items"]}
        assert "S-001" in south_tails
        assert "N-001" not in south_tails
        assert TAIL_N003
        assert TAIL_S001

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        health = await client.get("/health")
        assert health.status_code == 200
        ready = await client.get("/ready")
        assert ready.status_code == 200
        logged = await client.post(
            "/v1/session/dev-login",
            json={"username": "ada.admin", "password": password},
        )
        assert logged.status_code == 200
        org = await client.get("/v1/org")
        assert org.status_code == 200
        assert any(item["code"] == "USAF-DAC-DET77-NORTH" for item in org.json()["items"])
        users = await client.get("/v1/users")
        assert users.status_code == 200
        stations = await client.get("/v1/ground-stations")
        assert stations.status_code == 200
        assert stations.json()["items"]
        me = await client.get("/v1/me")
        assert me.json()["username"] == "ada.admin"
        expires = (datetime.now(UTC) + timedelta(days=30)).isoformat()
        drafted = await client.post(
            "/v1/sharing-agreements",
            json={
                "provider_tenant_id": "11111111-1111-4111-8111-111111111104",
                "consumer_code": "USAF-DAC-DET77-SOUTH",
                "categories": ["fleet"],
                "purpose": "sister team read",
                "expires_at": expires,
            },
        )
        assert drafted.status_code == 201, drafted.text
        agreement_id = drafted.json()["id"]
        self_approve = await client.post(f"/v1/sharing-agreements/{agreement_id}/approve")
        assert self_approve.status_code == 403
        client.cookies.clear()
        commander = await client.post(
            "/v1/session/dev-login",
            json={"username": "carl.commander", "password": password},
        )
        assert commander.status_code == 200
        approved = await client.post(f"/v1/sharing-agreements/{agreement_id}/approve")
        assert approved.status_code == 200, approved.text
        created = await client.post(
            "/v1/platforms",
            json={
                "tenant_id": "11111111-1111-4111-8111-111111111104",
                "tail_number": "N-011",
                "designation": "A2E-G1-QUAD",
                "group_size": "group_1",
                "serial_number": "SN-N-010",
                "classification": "UNCLASSIFIED",
            },
        )
        assert created.status_code == 201, created.text
        platform_id = created.json()["id"]
        payload = await client.post(
            f"/v1/platforms/{platform_id}/payloads",
            json={"kind": "eo", "name": "daylight camera", "classification": "UNCLASSIFIED"},
        )
        assert payload.status_code == 201, payload.text
        weapon = await client.post(
            f"/v1/platforms/{platform_id}/payloads",
            json={"kind": "weapon", "name": "no", "classification": "UNCLASSIFIED"},
        )
        assert weapon.status_code == 422
        custody = await client.post(
            f"/v1/platforms/{platform_id}/custody",
            json={"event_type": "accept", "to_user_id": str(CARL), "location": "Demo Range"},
        )
        assert custody.status_code == 201, custody.text
        client.cookies.clear()
        auditor = await client.post(
            "/v1/session/dev-login",
            json={"username": "audrey.auditor", "password": password},
        )
        assert auditor.status_code == 200
        audit = await client.get("/v1/audit")
        assert audit.status_code == 200
        assert audit.json()["items"]
        logout = await client.post("/v1/session/logout")
        assert logout.status_code == 200
