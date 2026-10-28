"""Runtime configuration. Secrets come from the environment, never from code."""

from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from a2e.classification import BUILD_MAX, CLASSIFICATION_RANK
from a2e.crypto import KEY_BYTES

# Refused in production. Present in .env.example so a laptop boots.
INSECURE_DATA_KEYS = {
    b"\x00" * KEY_BYTES,
    b"0123456789abcdef0123456789abcdef",
}


class SettingsError(ValueError):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="A2E_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "development"
    auth_mode: str = "oidc"
    session_secret: str = Field(min_length=32)
    data_key: str
    dev_login: bool = False
    dev_login_password: str = ""
    rate_limit_enabled: bool = True
    otel_enabled: bool = False
    otel_endpoint: str = "http://otel-collector:4317"
    opa_url: str = "http://opa:8181"
    database_url: str
    migration_database_url: str
    redis_url: str = ""
    oidc_issuer: str = "http://localhost:8080/realms/a2e-dev"
    oidc_internal_issuer: str = "http://keycloak:8080/realms/a2e-dev"
    oidc_jwks_url: str = ""
    oidc_audience: str = "a2e-api"
    oidc_public_client_id: str = "a2e-ui"
    oidc_redirect_uri: str = "http://localhost:8000/v1/session/callback"
    system_high: str = BUILD_MAX
    seed: bool = False
    policy_dir: str = ""
    cookie_secure: bool = False
    test_jwt_private_key_pem: str = ""
    ui_origin: str = "http://localhost:8000"

    @field_validator("env")
    @classmethod
    def _env(cls, value: str) -> str:
        if value not in {"development", "test", "production"}:
            raise ValueError("env must be development, test, or production")
        return value

    @field_validator("auth_mode")
    @classmethod
    def _auth_mode(cls, value: str) -> str:
        if value not in {"oidc", "test"}:
            raise ValueError("auth_mode must be oidc or test")
        return value

    @field_validator("system_high")
    @classmethod
    def _system_high(cls, value: str) -> str:
        if value not in CLASSIFICATION_RANK:
            raise ValueError("unknown system high")
        if CLASSIFICATION_RANK[value] > CLASSIFICATION_RANK[BUILD_MAX]:
            raise ValueError("this build caps system high at CUI")
        return value

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.env == "production":
            if self.auth_mode == "test":
                raise SettingsError("test auth is forbidden in production")
            if self.dev_login:
                raise SettingsError("dev login is forbidden in production")
            if not self.rate_limit_enabled:
                raise SettingsError("rate limit cannot be disabled in production")
            if self.seed:
                raise SettingsError("refusing to seed production")
            if self.data_key_bytes in INSECURE_DATA_KEYS:
                raise SettingsError("refusing the development data key in production")
            if not self.cookie_secure:
                raise SettingsError("cookies must be Secure in production")
        if self.dev_login and len(self.dev_login_password) < 12:
            raise SettingsError("dev login password must be at least 12 characters")
        if self.rate_limit_enabled and not self.redis_url:
            raise SettingsError("A2E_REDIS_URL is required when rate limiting is on")
        return self

    @property
    def data_key_bytes(self) -> bytes:
        try:
            raw = base64.b64decode(self.data_key, validate=True)
        except Exception as exc:
            raise SettingsError("A2E_DATA_KEY must be base64") from exc
        if len(raw) != KEY_BYTES:
            raise SettingsError("A2E_DATA_KEY must decode to 32 bytes")
        return raw

    @property
    def policies(self) -> Path:
        if self.policy_dir:
            return Path(self.policy_dir)
        here = Path(__file__).resolve()
        candidate = here.parents[4] / "policies"
        if candidate.exists():
            return candidate
        return Path("/app/policies")

    @property
    def api_root(self) -> Path:
        candidate = Path(__file__).resolve().parents[2]
        if (candidate / "alembic.ini").exists():
            return candidate
        return Path("/app")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
