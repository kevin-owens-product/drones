"""Shared request helpers for the control-plane routers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime
from typing import Any, Literal, NoReturn
from uuid import UUID

import structlog
from fastapi import Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.auditlog import append_audit
from a2e.authn import AuthError
from a2e.authz import Principal, authorize
from a2e.chain import format_utc
from a2e.classification import Marking
from a2e.db import set_subject
from a2e.http import fail, get_session

log = structlog.get_logger()

ClassificationIn = Literal["UNCLASSIFIED", "CUI"]
GroupIn = Literal["group_1", "group_2", "group_3"]
PayloadIn = Literal["eo", "ir", "eo_ir", "sar", "lidar", "comms_relay", "acoustic"]


def _jsonify(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return format_utc(value)
    if isinstance(value, list):
        return [_jsonify(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonify(item) for key, item in value.items()}
    return value
def _row_mark(row: dict[str, Any]) -> Marking:
    return Marking(
        str(row["classification"]),
        tuple(row.get("caveats") or []),
        tuple(row.get("ntk_programs") or []),
    )
def _sign(secret: str, payload: dict[str, str]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    mac = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{mac}"
def _unsign(secret: str, value: str) -> dict[str, str] | None:
    if value.count(".") != 1:
        return None
    body, mac = value.split(".", 1)
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(mac, expected):
        return None
    padded = body + "=" * (-len(body) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return {str(key): str(item) for key, item in data.items()}
async def _limit(request: Request, bucket: str, limit: int) -> JSONResponse | None:
    settings = request.app.state.settings
    if not settings.rate_limit_enabled:
        return None
    redis = request.app.state.redis
    identity = getattr(request.state, "user_id", None)
    if not identity:
        identity = request.client.host if request.client else "unknown"
    key = f"rl:{bucket}:{identity}:{int(time.time()) // 60}"
    try:
        count = int(await redis.incr(key))
        if count == 1:
            await redis.expire(key, 120)
    except Exception:
        log.warning("rate_limit_unavailable")
        return fail(503, "rate_limit_unavailable")
    if count > limit:
        return fail(429, "rate_limited")
    return None
def _cookie(response: JSONResponse | RedirectResponse, token: str, request: Request, max_age: int) -> None:
    settings = request.app.state.settings
    response.set_cookie(
        "a2e_session",
        token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=max_age,
        path="/",
    )
async def require_principal(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> Principal:
    token = None
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        token = header[7:].strip()
    if not token:
        token = request.cookies.get("a2e_session")
    if not token:
        _unauthorized()
    try:
        subject = request.app.state.authenticator.validate(token)
    except AuthError:
        _unauthorized()
    await set_subject(session, subject)
    from a2e.authz import load_principal

    principal = await load_principal(session, subject)
    if principal is None:
        _unauthorized()
    request.state.user_id = str(principal.user_id)
    request.state.principal = principal
    return principal
def _unauthorized() -> NoReturn:
    from fastapi import HTTPException

    raise HTTPException(status_code=401, detail="unauthenticated")
async def _authz(
    request: Request,
    session: AsyncSession,
    principal: Principal,
    action: str,
    resource: dict[str, Any] | None = None,
    recipient: dict[str, Any] | None = None,
) -> JSONResponse | None:
    decision = await authorize(
        session,
        request.app.state.opa,
        principal,
        action,
        resource,
        system_high=request.app.state.settings.system_high,
        recipient=recipient,
    )
    if decision.allow:
        return None
    classification = "UNCLASSIFIED"
    caveats: list[str] = []
    tenant_id = principal.user_id and None
    resource_id = None
    if resource is not None:
        classification = str(resource.get("classification") or "UNCLASSIFIED")
        caveats = [str(item) for item in resource.get("caveats") or []]
        raw_tenant = resource.get("tenant_id")
        tenant_id = UUID(str(raw_tenant)) if raw_tenant else None
        raw_id = resource.get("id")
        resource_id = UUID(str(raw_id)) if raw_id else None
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=tenant_id if isinstance(tenant_id, UUID) else None,
        action=action,
        resource_type=str(resource.get("resource_type") if resource else action),
        resource_id=resource_id,
        decision="deny",
        reason_codes=list(decision.reasons),
        classification=classification,
        caveats=caveats,
        ntk_programs=[str(item) for item in (resource or {}).get("ntk_programs") or []],
    )
    if decision.unavailable:
        return fail(503, "opa_unavailable")
    reason = decision.reasons[0] if decision.reasons else "denied"
    status = 403 if reason != "opa_unavailable" else 503
    return fail(status, reason)
async def _deny_or_none(request: Request, session: AsyncSession, principal: Principal, action: str) -> JSONResponse | None:

    return await _authz(request, session, principal, action)
