"""Arm, mode, takeoff, and land. Each one is confirmed and written to the audit log."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.auditlog import append_audit
from a2e.authz import Principal
from a2e.flight.commands import mav_command
from a2e.http import fail, get_session, set_banner, transactional
from a2e.routers.deps import _authz, require_principal

log = structlog.get_logger()
router = APIRouter()


class TrackEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: UUID
    system_id: int = Field(ge=1, le=255)
    event: Literal["lock", "loss", "abort"]
    confirm: bool = False


class FlightCommandIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: UUID
    system_id: int = Field(ge=1, le=255)
    command: Literal["arm", "disarm", "takeoff", "land", "mode"]
    param1: float = 0
    confirm: bool = False


@router.post("/v1/flight/track")
@transactional
async def flight_track(
    body: TrackEventIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    resource = {
        "tenant_id": str(body.tenant_id),
        "classification": "CUI",
        "caveats": [],
        "ntk_programs": [],
        "resource_type": "vehicle",
    }
    denied = await _authz(request, session, principal, "vehicle.track", resource)
    if denied:
        return denied
    if not body.confirm:
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=body.tenant_id,
            action="vehicle.track",
            resource_type="vehicle",
            resource_id=None,
            decision="deny",
            reason_codes=["not_confirmed", body.event],
            classification="CUI",
        )
        return fail(409, "not_confirmed")
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=body.tenant_id,
        action="vehicle.track",
        resource_type="vehicle",
        resource_id=None,
        decision="allow",
        reason_codes=[body.event, str(body.system_id)],
        classification="CUI",
    )
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"event": body.event, "system_id": body.system_id}, status_code=202)


@router.post("/v1/flight/command")
@transactional
async def flight_command(
    body: FlightCommandIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    resource = {
        "tenant_id": str(body.tenant_id),
        "classification": "CUI",
        "caveats": [],
        "ntk_programs": [],
        "resource_type": "vehicle",
    }
    denied = await _authz(request, session, principal, "vehicle.command", resource)
    if denied:
        return denied
    if not body.confirm:
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=body.tenant_id,
            action="vehicle.command",
            resource_type="vehicle",
            resource_id=None,
            decision="deny",
            reason_codes=["not_confirmed", body.command],
            classification="CUI",
        )
        return fail(409, "not_confirmed")
    code, param1 = mav_command(body.command, body.param1)
    gateway = str(request.app.state.settings.gateway_url).rstrip("/")
    if not gateway:
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=body.tenant_id,
            action="vehicle.command",
            resource_type="vehicle",
            resource_id=None,
            decision="deny",
            reason_codes=["gateway_unconfigured", body.command],
            classification="CUI",
        )
        return fail(503, "gateway_unconfigured")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            sent = await client.post(
                gateway + "/command",
                json={"system_id": body.system_id, "command": code, "param1": param1},
            )
            sent.raise_for_status()
    except Exception:
        log.warning("flight_command_failed", command=body.command)
        await append_audit(
            session,
            actor_id=principal.user_id,
            tenant_id=body.tenant_id,
            action="vehicle.command",
            resource_type="vehicle",
            resource_id=None,
            decision="deny",
            reason_codes=["gateway_unavailable", body.command],
            classification="CUI",
        )
        return fail(503, "gateway_unavailable")
    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=body.tenant_id,
        action="vehicle.command",
        resource_type="vehicle",
        resource_id=None,
        decision="allow",
        reason_codes=[body.command, str(body.system_id)],
        classification="CUI",
    )
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"command": body.command, "mav_cmd": code, "param1": param1}, status_code=202)
