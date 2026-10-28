from __future__ import annotations

import base64

import httpx
import pytest
from pydantic import ValidationError

from a2e.authn import TEST_ISSUER, Authenticator, AuthError
from a2e.authz import OpaClient
from a2e.settings import Settings, get_settings


def _settings(**overrides: object) -> Settings:
    data: dict[str, object] = {
        "env": "test",
        "auth_mode": "test",
        "session_secret": "unit-test-session-secret-32chars",
        "data_key": base64.b64encode(b"u" * 32).decode(),
        "dev_login": True,
        "dev_login_password": "unit-test-password",
        "rate_limit_enabled": False,
        "database_url": "postgresql+asyncpg://a2e_app:pw@localhost/a2e",
        "migration_database_url": "postgresql+psycopg://a2e:pw@localhost/a2e",
        "system_high": "CUI",
        "cookie_secure": False,
        "seed": False,
    }
    data.update(overrides)
    return Settings(**data)  # type: ignore[arg-type]


def test_production_rejects_test_auth() -> None:
    with pytest.raises(ValidationError, match="test auth is forbidden"):
        _settings(env="production", auth_mode="test", cookie_secure=True, dev_login=False)


def test_production_rejects_zero_key_and_open_cookies() -> None:
    with pytest.raises(ValidationError, match="development data key"):
        _settings(
            env="production",
            auth_mode="oidc",
            dev_login=False,
            cookie_secure=True,
            rate_limit_enabled=True,
            redis_url="redis://localhost/0",
            data_key=base64.b64encode(b"\x00" * 32).decode(),
        )


def test_system_high_cannot_exceed_cui() -> None:
    with pytest.raises(ValueError):
        _settings(system_high="SECRET")


def test_test_token_round_trip() -> None:
    settings = _settings()
    auth = Authenticator(settings)
    token = auth.issue_test_token("22222222-2222-4222-8222-222222222202")
    assert auth.validate(token) == "22222222-2222-4222-8222-222222222202"
    with pytest.raises(AuthError):
        auth.validate(token + "x")
    assert TEST_ISSUER.startswith("https://")


@pytest.mark.asyncio
async def test_opa_fail_closed_on_garbage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"result": {}})

    settings = _settings()
    client = OpaClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    allow, reasons = await client.decide({"action": "fleet.read"})
    assert allow is None
    assert reasons == ["opa_unavailable"]
    await client.aclose()


def test_cached_settings_load() -> None:
    get_settings.cache_clear()
    loaded = get_settings()
    assert loaded.env == "test"
    assert loaded.system_high == "CUI"
