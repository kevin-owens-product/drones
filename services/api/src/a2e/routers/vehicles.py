"""Fleet registry: platforms, payloads, maintenance, and ground stations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.auditlog import append_audit
from a2e.authz import Principal
from a2e.chain import canonical_json, chain_hash, format_utc
from a2e.classification import normalize_caveats
from a2e.db import fetch_all, fetch_one, scalar
from a2e.http import db_error, fail, get_session, set_banner, transactional
from a2e.routers.deps import (
    ClassificationIn,
    GroupIn,
    PayloadIn,
    _authz,
    _jsonify,
    _row_mark,
    require_principal,
)

log = structlog.get_logger()
router = APIRouter()

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
class CustodyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: Literal["accept", "transfer", "release", "inventory"]
    to_user_id: UUID | None = None
    location: str = Field(min_length=1, max_length=160)
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
        SELECT p.id, p.tenant_id, p.tail_number, p.designation, p.group_size::text AS group_size,
               p.serial_number, p.airworthiness::text AS airworthiness, p.home_station,
               p.software_version, p.classification::text AS classification, p.caveats,
               p.ntk_programs, p.portion_mark, t.name AS owner_name
        FROM platforms p
        LEFT JOIN tenants t ON t.id = p.tenant_id
        ORDER BY p.tail_number
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})
@router.get("/v1/maintenance")
@transactional
async def list_maintenance(
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
        SELECT m.id, m.platform_id, p.tail_number, m.summary, m.status, m.opened_at, m.closed_at,
               m.classification::text AS classification, m.caveats, m.portion_mark
        FROM maintenance_events m
        JOIN platforms p ON p.id = m.platform_id
        ORDER BY m.opened_at DESC
        LIMIT 100
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})
@router.get("/v1/payloads")
@transactional
async def list_payloads(
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
        SELECT id, platform_id, kind, name, firmware,
               classification::text AS classification, caveats, portion_mark
        FROM payloads
        ORDER BY name
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
@router.patch("/v1/platforms/{platform_id}")
@transactional
async def patch_platform(
    platform_id: UUID,
    request: Request,
    body: PlatformPatch,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    row = await fetch_one(
        session,
        """
        SELECT id, tenant_id, tail_number, airworthiness::text AS airworthiness,
               classification::text AS classification, caveats, ntk_programs
        FROM platforms WHERE id = :id
        """,
        {"id": platform_id},
    )
    if row is None:
        return fail(404, "not_found")
    row["resource_type"] = "platform"
    denied = await _authz(request, session, principal, "fleet.write", row)
    if denied:
        return denied
    status = body.airworthiness or row["airworthiness"]
    await scalar(
        session,
        """
        UPDATE platforms
        SET airworthiness = CAST(:status AS airworthiness_status)
        WHERE id = :id
        RETURNING id
        """,
        {"status": status, "id": platform_id},
    )
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=row["tenant_id"],
        action="fleet.write",
        resource_type="platform",
        resource_id=platform_id,
        decision="allow",
        reason_codes=[str(status)],
        classification=str(row["classification"]),
        caveats=list(row["caveats"] or []),
        ntk_programs=list(row["ntk_programs"] or []),
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row)])
    return JSONResponse({"banner": banner, "id": str(platform_id), "airworthiness": status})
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
