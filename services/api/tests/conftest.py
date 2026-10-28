"""Environment for unit tests. Integration tests opt in with a marker."""

from __future__ import annotations

import base64
import os

os.environ.setdefault("A2E_ENV", "test")
os.environ.setdefault("A2E_AUTH_MODE", "test")
os.environ.setdefault("A2E_SESSION_SECRET", "unit-test-session-secret-32chars")
os.environ.setdefault("A2E_DATA_KEY", base64.b64encode(b"u" * 32).decode())
os.environ.setdefault("A2E_DEV_LOGIN", "1")
os.environ.setdefault("A2E_DEV_LOGIN_PASSWORD", "unit-test-password")
os.environ.setdefault("A2E_RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("A2E_OTEL_ENABLED", "false")
os.environ.setdefault("A2E_SEED", "false")
os.environ.setdefault("A2E_OPA_URL", "http://127.0.0.1:9")
os.environ.setdefault(
    "A2E_DATABASE_URL",
    "postgresql+asyncpg://a2e_app:change-me-app@localhost:5432/a2e",
)
os.environ.setdefault(
    "A2E_MIGRATION_DATABASE_URL",
    "postgresql+psycopg://a2e:change-me-db@localhost:5432/a2e",
)
os.environ.setdefault("A2E_OIDC_ISSUER", "https://a2e.test/auth")
os.environ.setdefault("A2E_OIDC_AUDIENCE", "a2e-api")
os.environ.setdefault("A2E_SYSTEM_HIGH", "CUI")
os.environ.setdefault("A2E_COOKIE_SECURE", "false")
