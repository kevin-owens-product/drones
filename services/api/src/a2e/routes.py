"""Control-plane routes. Weapons employment is not a route on this API."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Literal, NoReturn
from urllib.parse import urlencode
from uuid import UUID, uuid4

import httpx
import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.auditlog import append_audit, append_login_failure
from a2e.authn import AuthError
from a2e.authz import Principal, authorize
from a2e.chain import canonical_json, chain_hash, format_utc
from a2e.classification import Marking, normalize_caveats
from a2e.crypto import open_sealed, seal
from a2e.db import fetch_all, fetch_one, scalar, set_subject
from a2e.http import db_error, fail, get_session, set_banner, transactional

log = structlog.get_logger()
router = APIRouter()

ClassificationIn = Literal["UNCLASSIFIED", "CUI"]
GroupIn = Literal["group_1", "group_2", "group_3"]
PayloadIn = Literal["eo", "ir", "eo_ir", "sar", "lidar", "comms_relay", "acoustic"]


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class PlatformIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: UUID
    tail_number: str = Field(pattern=r"^[A-Z0-9-]{2,16}$")
    designation: str = Field(min_length=1, max_length=64)
    group_size: GroupIn
    serial_number: str = Field(min_length=1, max_length=64)
    airworthiness: Literal["airworthy", "restricted", "grounded", "unknown"] = "unknown"
    home_station: str | None = Field(default=None, max_length=120)
    classification: ClassificationIn = "UNCLASSIFIED"
    caveats: list[str] = Field(default_factory=list)
    ntk_programs: list[str] = Field(default_factory=list)


class PlatformPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    airworthiness: Literal["airworthy", "restricted", "grounded", "unknown"] | None = None
    software_version: str | None = Field(default=None, max_length=64)


class PayloadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: PayloadIn
    name: str = Field(min_length=1, max_length=80)
    firmware: str | None = Field(default=None, max_length=64)
    classification: ClassificationIn = "UNCLASSIFIED"
    caveats: list[str] = Field(default_factory=list)
    ntk_programs: list[str] = Field(default_factory=list)


class StationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: UUID
    name: str = Field(min_length=1, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    alt_m: float = 0
    classification: ClassificationIn = "UNCLASSIFIED"
    caveats: list[str] = Field(default_factory=list)


class SharingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_tenant_id: UUID
    consumer_code: str = Field(min_length=1, max_length=80)
    categories: list[Literal["fleet", "mission", "telemetry", "video"]] = Field(min_length=1)
    purpose: str = Field(min_length=1, max_length=400)
    expires_at: datetime
    allow_noforn: bool = False
    include_descendants: bool = False
    max_classification: ClassificationIn = "CUI"


class ExportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resource_type: Literal["platform"]
    resource_id: UUID
    recipient_user_id: UUID
    purpose: str = Field(min_length=1, max_length=400)
    format: Literal["json", "csv", "pdf", "xapi"]


class UserIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=200)
    display_name: str = Field(min_length=1, max_length=120)
    citizenship: str = Field(pattern=r"^[A-Z]{3}$")
    clearance: ClassificationIn
    ntk_programs: list[str] = Field(default_factory=list)
    keycloak_sub: str = Field(min_length=1, max_length=128)
    tenant_id: UUID
    role: Literal[
        "admin",
        "mission_commander",
        "planner",
        "operator",
        "analyst",
        "maintainer",
        "auditor",
    ]


class TenantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parent_id: UUID
    level: Literal["command", "unit", "team"]
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(pattern=r"^[A-Z0-9-]{2,64}$")
    branch_code: str = Field(pattern=r"^[A-Z0-9-]{2,16}$")


class CustodyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: Literal["accept", "transfer", "release", "inventory"]
    to_user_id: UUID | None = None
    location: str = Field(min_length=1, max_length=160)


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


@router.get("/v1/session/config")
async def session_config(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    request.state.banner = settings.system_high
    return JSONResponse(
        {
            "auth_mode": settings.auth_mode,
            "dev_login": settings.dev_login,
            "system_high": settings.system_high,
            "login_url": "/v1/session/login",
        }
    )


@router.get("/v1/session/login")
async def oidc_login(request: Request) -> RedirectResponse:
    settings = request.app.state.settings
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    state = secrets.token_urlsafe(32)
    blob = _sign(settings.session_secret, {"state": state, "verifier": verifier})
    query = urlencode(
        {
            "client_id": settings.oidc_public_client_id,
            "response_type": "code",
            "scope": "openid",
            "redirect_uri": settings.oidc_redirect_uri,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    target = settings.oidc_issuer.rstrip("/") + "/protocol/openid-connect/auth?" + query
    response = RedirectResponse(target, status_code=302)
    response.set_cookie(
        "a2e_oauth",
        blob,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=300,
        path="/v1/session",
    )
    request.state.banner = settings.system_high
    return response


@router.get("/v1/session/callback", response_model=None)
@transactional
async def oidc_callback(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse | RedirectResponse:
    settings = request.app.state.settings
    limited = await _limit(request, "login", 10)
    if limited:
        return limited
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    saved = _unsign(settings.session_secret, request.cookies.get("a2e_oauth", ""))
    if not code or not state or saved is None or saved.get("state") != state:
        return fail(400, "invalid_oauth_state")
    token_url = settings.oidc_internal_issuer.rstrip("/") + "/protocol/openid-connect/token"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            exchanged = await client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.oidc_redirect_uri,
                    "client_id": settings.oidc_public_client_id,
                    "code_verifier": saved["verifier"],
                },
            )
            exchanged.raise_for_status()
            access = exchanged.json().get("access_token")
    except Exception:
        log.warning("oidc_exchange_failed")
        return fail(401, "unauthenticated")
    if not isinstance(access, str):
        return fail(401, "unauthenticated")
    try:
        subject = request.app.state.authenticator.validate(access)
    except AuthError:
        return fail(401, "unauthenticated")
    await set_subject(session, subject)
    from a2e.authz import load_principal

    principal = await load_principal(session, subject)
    if principal is None:
        await append_login_failure(session, username=subject, tenant_id=None)
        return fail(401, "unauthenticated")
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=None,
        action="auth.login_succeeded",
        resource_type="session",
        resource_id=None,
        decision="allow",
        reason_codes=[],
    )
    response = RedirectResponse("/", status_code=302)
    _cookie(response, access, request, 3600)
    response.delete_cookie("a2e_oauth", path="/v1/session")
    return response


@router.post("/v1/session/dev-login")
@transactional
async def dev_login(
    request: Request,
    body: LoginIn,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    settings = request.app.state.settings
    if not settings.dev_login:
        return fail(404, "not_found")
    limited = await _limit(request, "login", 10)
    if limited:
        return limited
    row = await fetch_one(
        session,
        "SELECT id, keycloak_sub, disabled FROM user_for_login(:username)",
        {"username": body.username},
    )
    password_ok = hmac.compare_digest(body.password, settings.dev_login_password)
    if row is None or bool(row["disabled"]) or not password_ok:
        await append_login_failure(session, username=body.username, tenant_id=None)
        return fail(401, "invalid_credentials")
    subject = str(row["keycloak_sub"])
    await set_subject(session, subject)
    token = request.app.state.authenticator.issue_test_token(subject)
    await append_audit(
        session,
        actor_id=row["id"],
        tenant_id=None,
        action="auth.login_succeeded",
        resource_type="session",
        resource_id=None,
        decision="allow",
        reason_codes=[],
    )
    response = JSONResponse({"status": "ok"})
    _cookie(response, token, request, 3600)
    request.state.banner = settings.system_high
    return response


@router.post("/v1/session/logout")
@transactional
async def logout(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=None,
        action="session.logout",
        resource_type="session",
        resource_id=None,
        decision="allow",
        reason_codes=[],
    )
    response = JSONResponse({"status": "ok"})
    response.delete_cookie("a2e_session", path="/")
    return response


@router.get("/v1/me")
async def me(
    request: Request,
    principal: Principal = Depends(require_principal),
) -> JSONResponse:
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse(
        {
            "id": str(principal.user_id),
            "username": principal.username,
            "display_name": principal.display_name,
            "citizenship": principal.citizenship,
            "clearance": principal.clearance,
            "ntk_programs": list(principal.ntk_programs),
            "roles": list(principal.roles),
        }
    )


@router.get("/v1/platforms")
@transactional
async def list_platforms(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _authz(request, session, principal, "fleet.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, tenant_id, tail_number, designation, group_size::text AS group_size,
               serial_number, airworthiness::text AS airworthiness, home_station,
               software_version, classification::text AS classification, caveats,
               ntk_programs, portion_mark
        FROM platforms
        ORDER BY tail_number
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})


@router.post("/v1/platforms")
@transactional
async def create_platform(
    request: Request,
    body: PlatformIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    caveats = normalize_caveats(body.caveats)
    resource = {
        "id": None,
        "tenant_id": body.tenant_id,
        "classification": body.classification,
        "caveats": caveats,
        "ntk_programs": body.ntk_programs,
        "resource_type": "platform",
    }
    denied = await _authz(request, session, principal, "fleet.write", resource)
    if denied:
        return denied
    new_id = uuid4()
    try:
        await scalar(
            session,
            """
            INSERT INTO platforms (
              id, tenant_id, tail_number, designation, group_size, serial_number,
              airworthiness, home_station, classification, caveats, ntk_programs
            ) VALUES (
              :id, :tenant_id, :tail, :designation, CAST(:group_size AS platform_group),
              :serial, CAST(:airworthiness AS airworthiness_status), :home,
              CAST(:classification AS clearance_level), :caveats, :ntk
            )
            RETURNING id
            """,
            {
                "id": new_id,
                "tenant_id": body.tenant_id,
                "tail": body.tail_number,
                "designation": body.designation,
                "group_size": body.group_size,
                "serial": body.serial_number,
                "airworthiness": body.airworthiness,
                "home": body.home_station,
                "classification": body.classification,
                "caveats": caveats,
                "ntk": body.ntk_programs,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=body.tenant_id,
        action="fleet.write",
        resource_type="platform",
        resource_id=new_id,
        decision="allow",
        reason_codes=[],
        classification=body.classification,
        caveats=caveats,
        ntk_programs=body.ntk_programs,
    )
    request.state.banner = request.app.state.settings.system_high
    return JSONResponse({"id": str(new_id)}, status_code=201)


@router.get("/v1/platforms/{platform_id}")
@transactional
async def get_platform(
    platform_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    row = await fetch_one(
        session,
        """
        SELECT id, tenant_id, tail_number, designation, group_size::text AS group_size,
               serial_number, airworthiness::text AS airworthiness, home_station,
               software_version, classification::text AS classification, caveats,
               ntk_programs, portion_mark
        FROM platforms WHERE id = :id
        """,
        {"id": platform_id},
    )
    if row is None:
        return fail(404, "not_found")
    row["resource_type"] = "platform"
    denied = await _authz(request, session, principal, "fleet.read", row)
    if denied:
        return denied
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row)])
    return JSONResponse({"banner": banner, "item": _jsonify(row)})


@router.post("/v1/exports")
@transactional
async def export_resource(
    request: Request,
    body: ExportIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    row = await fetch_one(
        session,
        """
        SELECT id, tenant_id, tail_number, designation, group_size::text AS group_size,
               serial_number, airworthiness::text AS airworthiness,
               classification::text AS classification, caveats, ntk_programs, portion_mark
        FROM platforms WHERE id = :id
        """,
        {"id": body.resource_id},
    )
    if row is None:
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=None,
            action="release.export",
            resource_type="platform",
            resource_id=body.resource_id,
            decision="deny",
            reason_codes=["not_found"],
        )
        return fail(404, "not_found")
    recipient = await fetch_one(
        session,
        """
        SELECT id, clearance::text AS clearance, citizenship, ntk_programs
        FROM users WHERE id = :id AND disabled_at IS NULL
        """,
        {"id": body.recipient_user_id},
    )
    recipient_input = None
    if recipient is not None:
        recipient_input = {
            "clearance": recipient["clearance"],
            "citizenship": recipient["citizenship"],
            "ntk": list(recipient["ntk_programs"] or []),
        }
    row["resource_type"] = "platform"
    denied = await _authz(request, session, principal, "release.export", row, recipient_input)
    if denied:
        return denied
    allowed = await scalar(
        session,
        """
        SELECT app_release_allowed(
          :tenant, :recipient, 'fleet', CAST(:classification AS clearance_level), :caveats, :ntk
        )
        """,
        {
            "tenant": row["tenant_id"],
            "recipient": body.recipient_user_id,
            "classification": row["classification"],
            "caveats": list(row["caveats"] or []),
            "ntk": list(row["ntk_programs"] or []),
        },
    )
    if not allowed:
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=row["tenant_id"],
            action="release.export",
            resource_type="platform",
            resource_id=row["id"],
            decision="deny",
            reason_codes=["denied"],
            classification=str(row["classification"]),
            caveats=list(row["caveats"] or []),
            ntk_programs=list(row["ntk_programs"] or []),
        )
        return fail(403, "denied")
    if body.format != "json":
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=row["tenant_id"],
            action="release.export",
            resource_type="platform",
            resource_id=row["id"],
            decision="deny",
            reason_codes=["format_unavailable"],
            classification=str(row["classification"]),
            caveats=list(row["caveats"] or []),
            ntk_programs=list(row["ntk_programs"] or []),
        )
        return fail(400, "format_unavailable")
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row)])
    payload = json.dumps(_jsonify(row), sort_keys=True, separators=(",", ":")).encode()
    aad = f"{row['tenant_id']}:{row['id']}".encode()
    nonce, ciphertext = seal(request.app.state.settings.data_key_bytes, payload, aad)
    audit_id = await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=row["tenant_id"],
        action="release.export",
        resource_type="platform",
        resource_id=row["id"],
        decision="allow",
        reason_codes=[],
        classification=str(row["classification"]),
        caveats=list(row["caveats"] or []),
        ntk_programs=list(row["ntk_programs"] or []),
    )
    receipt_id = uuid4()
    await scalar(
        session,
        """
        INSERT INTO export_receipts (
          id, tenant_id, actor_id, recipient_id, resource_type, resource_id, purpose,
          format, banner, nonce, sealed_payload, audit_id, classification, caveats, ntk_programs
        ) VALUES (
          :id, :tenant_id, :actor_id, :recipient_id, 'platform', :resource_id, :purpose,
          'json', :banner, :nonce, :sealed, :audit_id, CAST(:classification AS clearance_level),
          :caveats, :ntk
        )
        RETURNING id
        """,
        {
            "id": receipt_id,
            "tenant_id": row["tenant_id"],
            "actor_id": principal.user_id,
            "recipient_id": body.recipient_user_id,
            "resource_id": row["id"],
            "purpose": body.purpose,
            "banner": banner,
            "nonce": nonce,
            "sealed": ciphertext,
            "audit_id": audit_id,
            "classification": row["classification"],
            "caveats": list(row["caveats"] or []),
            "ntk": list(row["ntk_programs"] or []),
        },
    )
    return JSONResponse(
        {
            "allowed": True,
            "banner": banner,
            "audit_id": str(audit_id),
            "receipt_id": str(receipt_id),
            "record": _jsonify(row),
        }
    )


@router.get("/v1/exports/{receipt_id}")
@transactional
async def read_receipt(
    receipt_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    row = await fetch_one(
        session,
        """
        SELECT id, tenant_id, resource_id, nonce, sealed_payload, banner,
               classification::text AS classification, caveats, ntk_programs
        FROM export_receipts WHERE id = :id
        """,
        {"id": receipt_id},
    )
    if row is None:
        return fail(404, "not_found")
    denied = await _authz(request, session, principal, "audit.read", {
        "id": row["id"],
        "tenant_id": row["tenant_id"],
        "classification": row["classification"],
        "caveats": list(row["caveats"] or []),
        "ntk_programs": list(row["ntk_programs"] or []),
        "resource_type": "export_receipt",
    })
    if denied:
        return denied
    aad = f"{row['tenant_id']}:{row['resource_id']}".encode()
    try:
        raw = open_sealed(
            request.app.state.settings.data_key_bytes,
            bytes(row["nonce"]),
            bytes(row["sealed_payload"]),
            aad,
        )
    except Exception:
        return fail(409, "seal_failed")
    set_banner(request, request.app.state.settings.system_high, [_row_mark(row)])
    return JSONResponse({"banner": request.state.banner, "record": json.loads(raw)})


@router.get("/v1/audit")
@transactional
async def list_audit(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _authz(request, session, principal, "audit.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT seq, id, occurred_at, actor_id, tenant_id, action, resource_type, resource_id,
               decision, reason_codes, classification::text AS classification, caveats,
               ntk_programs, portion_mark, prev_hash, row_hash
        FROM audit_events
        ORDER BY seq
        LIMIT 200
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})


@router.get("/v1/org")
@transactional
async def org(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _authz(request, session, principal, "org.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, parent_id, level::text AS level, name, code, branch_code,
               classification::text AS classification, caveats, portion_mark
        FROM tenants
        ORDER BY code
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})


@router.post("/v1/org/tenants")
@transactional
async def create_tenant(
    request: Request,
    body: TenantIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    resource = {
        "tenant_id": body.parent_id,
        "classification": "CUI",
        "caveats": [],
        "ntk_programs": [],
        "resource_type": "tenant",
    }
    denied = await _authz(request, session, principal, "org.write", resource)
    if denied:
        return denied
    try:
        new_id = await scalar(
            session,
            """
            SELECT create_tenant(
              :parent, CAST(:level AS org_level), :name, :code, :branch
            )
            """,
            {
                "parent": body.parent_id,
                "level": body.level,
                "name": body.name,
                "code": body.code,
                "branch": body.branch_code,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=body.parent_id,
        action="org.write",
        resource_type="tenant",
        resource_id=new_id,
        decision="allow",
        reason_codes=[],
        classification="CUI",
    )
    return JSONResponse({"id": str(new_id)}, status_code=201)


@router.get("/v1/users")
@transactional
async def list_users(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _authz(request, session, principal, "user.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, username, display_name, citizenship, clearance::text AS clearance,
               ntk_programs, classification::text AS classification, caveats, portion_mark,
               disabled_at
        FROM users
        ORDER BY username
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})


@router.post("/v1/users")
@transactional
async def provision(
    request: Request,
    body: UserIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    resource = {
        "tenant_id": body.tenant_id,
        "classification": "CUI",
        "caveats": [],
        "ntk_programs": [],
        "resource_type": "user",
    }
    denied = await _authz(request, session, principal, "user.provision", resource)
    if denied:
        return denied
    try:
        new_id = await scalar(
            session,
            """
            SELECT provision_user(
              :username, :email, :display_name, :citizenship,
              CAST(:clearance AS clearance_level), :ntk, :sub, :tenant, CAST(:role AS user_role)
            )
            """,
            {
                "username": body.username,
                "email": body.email,
                "display_name": body.display_name,
                "citizenship": body.citizenship,
                "clearance": body.clearance,
                "ntk": body.ntk_programs,
                "sub": body.keycloak_sub,
                "tenant": body.tenant_id,
                "role": body.role,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=body.tenant_id,
        action="user.provision",
        resource_type="user",
        resource_id=new_id,
        decision="allow",
        reason_codes=[],
        classification="CUI",
    )
    return JSONResponse({"id": str(new_id)}, status_code=201)


@router.get("/v1/sharing-agreements")
@transactional
async def list_sharing(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _authz(request, session, principal, "sharing.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, provider_tenant_id, consumer_tenant_id, categories, access::text AS access,
               max_classification::text AS max_classification, allow_noforn, include_descendants,
               purpose, status::text AS status, expires_at,
               classification::text AS classification, caveats, portion_mark
        FROM sharing_agreements
        ORDER BY created_at
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})


@router.post("/v1/sharing-agreements")
@transactional
async def create_sharing(
    request: Request,
    body: SharingIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    if "read_write" in body.categories:
        return fail(400, "read_write_disabled")
    resolved = await fetch_one(
        session,
        "SELECT id, name, level::text AS level, branch_code FROM resolve_tenant_code(:code)",
        {"code": body.consumer_code},
    )
    if resolved is None:
        return fail(404, "not_found")
    resource = {
        "tenant_id": body.provider_tenant_id,
        "classification": "CUI",
        "caveats": [],
        "ntk_programs": [],
        "resource_type": "sharing_agreement",
    }
    denied = await _authz(request, session, principal, "sharing.create", resource)
    if denied:
        return denied
    new_id = uuid4()
    try:
        await scalar(
            session,
            """
            INSERT INTO sharing_agreements (
              id, provider_tenant_id, consumer_tenant_id, categories, access, max_classification,
              allow_noforn, include_descendants, purpose, status, requested_by, expires_at,
              classification, caveats
            ) VALUES (
              :id, :provider, :consumer, :categories, 'read',
              CAST(:max_classification AS clearance_level), :allow_noforn, :include_descendants,
              :purpose, 'draft', :requested_by, :expires_at, 'CUI', '{}'
            )
            RETURNING id
            """,
            {
                "id": new_id,
                "provider": body.provider_tenant_id,
                "consumer": resolved["id"],
                "categories": body.categories,
                "max_classification": body.max_classification,
                "allow_noforn": body.allow_noforn,
                "include_descendants": body.include_descendants,
                "purpose": body.purpose,
                "requested_by": principal.user_id,
                "expires_at": body.expires_at,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=body.provider_tenant_id,
        action="sharing.create",
        resource_type="sharing_agreement",
        resource_id=new_id,
        decision="allow",
        reason_codes=[],
        classification="CUI",
    )
    return JSONResponse({"id": str(new_id)}, status_code=201)


@router.post("/v1/sharing-agreements/{agreement_id}/approve")
@transactional
async def approve(
    agreement_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    current = await fetch_one(
        session,
        """
        SELECT id, provider_tenant_id, classification::text AS classification, caveats, ntk_programs
        FROM sharing_agreements WHERE id = :id
        """,
        {"id": agreement_id},
    )
    if current is None:
        return fail(404, "not_found")
    current["resource_type"] = "sharing_agreement"
    current["tenant_id"] = current["provider_tenant_id"]
    denied = await _authz(request, session, principal, "sharing.approve", current)
    if denied:
        return denied
    try:
        await scalar(session, "SELECT approve_sharing(:id)", {"id": agreement_id})
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=current["provider_tenant_id"],
        action="sharing.approve",
        resource_type="sharing_agreement",
        resource_id=agreement_id,
        decision="allow",
        reason_codes=[],
        classification="CUI",
    )
    return JSONResponse({"status": "active"})


@router.post("/v1/sharing-agreements/{agreement_id}/revoke")
@transactional
async def revoke(
    agreement_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    current = await fetch_one(
        session,
        "SELECT id, provider_tenant_id FROM sharing_agreements WHERE id = :id",
        {"id": agreement_id},
    )
    if current is None:
        return fail(404, "not_found")
    resource = {
        "id": agreement_id,
        "tenant_id": current["provider_tenant_id"],
        "classification": "CUI",
        "caveats": [],
        "ntk_programs": [],
        "resource_type": "sharing_agreement",
    }
    denied = await _authz(request, session, principal, "sharing.approve", resource)
    if denied:
        return denied
    try:
        await scalar(session, "SELECT revoke_sharing(:id)", {"id": agreement_id})
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=current["provider_tenant_id"],
        action="sharing.approve",
        resource_type="sharing_agreement",
        resource_id=agreement_id,
        decision="allow",
        reason_codes=["revoked"],
        classification="CUI",
    )
    return JSONResponse({"status": "revoked"})


@router.post("/v1/platforms/{platform_id}/custody")
@transactional
async def custody(
    platform_id: UUID,
    request: Request,
    body: CustodyIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    platform = await fetch_one(
        session,
        """
        SELECT id, tenant_id, classification::text AS classification, caveats, ntk_programs
        FROM platforms WHERE id = :id
        """,
        {"id": platform_id},
    )
    if platform is None:
        return fail(404, "not_found")
    platform["resource_type"] = "custody"
    denied = await _authz(request, session, principal, "custody.append", platform)
    if denied:
        return denied
    event_id = uuid4()
    occurred_at = datetime.now(timezone.utc)
    prev = await scalar(
        session,
        "SELECT last_hash FROM custody_chain_head WHERE platform_id = :id",
        {"id": platform_id},
    )
    prev_hash = prev if isinstance(prev, str) else "0" * 64
    payload = {
        "event_type": body.event_type,
        "from_user_id": None,
        "id": str(event_id),
        "location": body.location,
        "occurred_at": format_utc(occurred_at),
        "platform_id": str(platform_id),
        "to_user_id": None if body.to_user_id is None else str(body.to_user_id),
    }
    canonical = canonical_json(payload)
    row_hash = chain_hash(prev_hash, canonical)
    try:
        await scalar(
            session,
            """
            SELECT append_custody(
              :id, :platform, CAST(:event_type AS custody_event_type), NULL, :to_user,
              :location, :occurred_at, :canonical, :row_hash
            )
            """,
            {
                "id": event_id,
                "platform": platform_id,
                "event_type": body.event_type,
                "to_user": body.to_user_id,
                "location": body.location,
                "occurred_at": occurred_at,
                "canonical": canonical,
                "row_hash": row_hash,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=platform["tenant_id"],
        action="custody.append",
        resource_type="custody",
        resource_id=event_id,
        decision="allow",
        reason_codes=[],
        classification=str(platform["classification"]),
        caveats=list(platform["caveats"] or []),
        ntk_programs=list(platform["ntk_programs"] or []),
    )
    return JSONResponse({"id": str(event_id)}, status_code=201)


@router.post("/v1/platforms/{platform_id}/payloads")
@transactional
async def add_payload(
    platform_id: UUID,
    request: Request,
    body: PayloadBody,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    platform = await fetch_one(
        session,
        "SELECT id, tenant_id FROM platforms WHERE id = :id",
        {"id": platform_id},
    )
    if platform is None:
        return fail(404, "not_found")
    caveats = normalize_caveats(body.caveats)
    resource = {
        "tenant_id": platform["tenant_id"],
        "classification": body.classification,
        "caveats": caveats,
        "ntk_programs": body.ntk_programs,
        "resource_type": "payload",
    }
    denied = await _authz(request, session, principal, "fleet.write", resource)
    if denied:
        return denied
    new_id = uuid4()
    try:
        await scalar(
            session,
            """
            INSERT INTO payloads (
              id, platform_id, tenant_id, kind, name, firmware, classification, caveats, ntk_programs
            ) VALUES (
              :id, :platform, :tenant, CAST(:kind AS payload_kind), :name, :firmware,
              CAST(:classification AS clearance_level), :caveats, :ntk
            )
            RETURNING id
            """,
            {
                "id": new_id,
                "platform": platform_id,
                "tenant": platform["tenant_id"],
                "kind": body.kind,
                "name": body.name,
                "firmware": body.firmware,
                "classification": body.classification,
                "caveats": caveats,
                "ntk": body.ntk_programs,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    return JSONResponse({"id": str(new_id)}, status_code=201)


@router.get("/v1/ground-stations")
@transactional
async def list_stations(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _authz(request, session, principal, "fleet.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, tenant_id, name, lat, lon, alt_m,
               classification::text AS classification, caveats, portion_mark
        FROM ground_stations
        ORDER BY name
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})


@router.post("/v1/ground-stations")
@transactional
async def create_station(
    request: Request,
    body: StationIn,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    caveats = normalize_caveats(body.caveats)
    resource = {
        "tenant_id": body.tenant_id,
        "classification": body.classification,
        "caveats": caveats,
        "ntk_programs": [],
        "resource_type": "ground_station",
    }
    denied = await _authz(request, session, principal, "fleet.write", resource)
    if denied:
        return denied
    new_id = uuid4()
    try:
        await scalar(
            session,
            """
            INSERT INTO ground_stations (
              id, tenant_id, name, lat, lon, alt_m, classification, caveats
            ) VALUES (
              :id, :tenant, :name, :lat, :lon, :alt,
              CAST(:classification AS clearance_level), :caveats
            )
            RETURNING id
            """,
            {
                "id": new_id,
                "tenant": body.tenant_id,
                "name": body.name,
                "lat": body.lat,
                "lon": body.lon,
                "alt": body.alt_m,
                "classification": body.classification,
                "caveats": caveats,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    return JSONResponse({"id": str(new_id)}, status_code=201)
