"""OIDC token validation. The only claim read is `sub`."""

from __future__ import annotations

import time
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import PyJWKClient

from a2e.settings import Settings

TEST_ISSUER = "https://a2e.test/auth"


class AuthError(Exception):
    pass


class Authenticator:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._private: Any = None
        self._public: Any = None
        self._jwks: PyJWKClient | None = None
        if settings.auth_mode == "test":
            self._load_test_key(settings)
        else:
            url = settings.oidc_jwks_url or (
                settings.oidc_internal_issuer.rstrip("/") + "/protocol/openid-connect/certs"
            )
            self._jwks = PyJWKClient(url, cache_keys=True)

    def _load_test_key(self, settings: Settings) -> None:
        pem = settings.test_jwt_private_key_pem.encode()
        if not pem:
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            pem = key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        self._private = serialization.load_pem_private_key(pem, password=None)
        self._public = self._private.public_key()

    def issue_test_token(self, subject: str, ttl_seconds: int = 3600) -> str:
        if self._private is None:
            raise AuthError("test tokens are not available")
        now = int(time.time())
        payload = {
            "sub": subject,
            "iss": TEST_ISSUER,
            "aud": self._settings.oidc_audience,
            "iat": now,
            "exp": now + ttl_seconds,
        }
        token = jwt.encode(payload, self._private, algorithm="RS256")
        if isinstance(token, bytes):
            return token.decode("ascii")
        return token

    def validate(self, token: str) -> str:
        try:
            if self._settings.auth_mode == "test":
                claims = jwt.decode(
                    token,
                    self._public,
                    algorithms=["RS256"],
                    audience=self._settings.oidc_audience,
                    issuer=TEST_ISSUER,
                    options={"require": ["exp", "iat", "sub", "iss", "aud"]},
                )
            else:
                assert self._jwks is not None
                key = self._jwks.get_signing_key_from_jwt(token)
                claims = jwt.decode(
                    token,
                    key.key,
                    algorithms=["RS256", "ES256"],
                    audience=self._settings.oidc_audience,
                    issuer=self._settings.oidc_issuer,
                    options={"require": ["exp", "iat", "sub", "iss", "aud"]},
                )
        except Exception as exc:
            raise AuthError("invalid token") from exc
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise AuthError("invalid token")
        return subject
