"""Kinematic simulation step and behavior-runtime load."""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.authz import Principal
from a2e.behaviors.manifest import ManifestError
from a2e.http import fail, get_session, transactional
from a2e.routers.deps import (
    _deny_or_none,
    require_principal,
)
from a2e.sim.dynamics import KinematicState, Wind, energy_used, step
from a2e.sim.runtime import FantomRuntime, RuntimeUnavailable, SimRuntime

log = structlog.get_logger()
router = APIRouter()

_SIM = SimRuntime()
_FANTOM = FantomRuntime()
class StepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float
    lon: float
    alt_m: float
    vn: float = 0
    ve: float = 0
    vd: float = 0
    wind_vn: float = 0
    wind_ve: float = 0
    dt: float = 1
@router.post("/v1/sim/step")
@transactional
async def sim_step(
    body: StepIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "sim.run")
    if denied:
        return denied
    state = KinematicState(body.lat, body.lon, body.alt_m, body.vn, body.ve, body.vd)
    nxt = step(state, Wind(body.wind_vn, body.wind_ve), body.dt)
    return JSONResponse(
        {"lat": nxt.lat, "lon": nxt.lon, "alt_m": nxt.alt_m, "energy": energy_used(state, body.dt)}
    )
@router.post("/v1/sim/load")
@transactional
async def sim_load(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "sim.run")
    if denied:
        return denied
    payload = await request.json()
    runtime_name = str(payload.get("runtime", "sim"))
    manifest = payload.get("manifest")
    if not isinstance(manifest, dict):
        return fail(400, "invalid_request")
    runtime = _SIM if runtime_name == "sim" else _FANTOM
    try:
        handle = await runtime.load(manifest)
    except (ManifestError, RuntimeUnavailable) as exc:
        code = "manifest_rejected" if isinstance(exc, ManifestError) else "runtime_unavailable"
        return fail(400 if isinstance(exc, ManifestError) else 503, code)
    live = bool(payload.get("live", False))
    try:
        await runtime.start(handle, str(payload.get("mission_state", "draft")), live=live)
    except (ManifestError, RuntimeUnavailable) as exc:
        return fail(409, "live_start_denied" if isinstance(exc, ManifestError) else "runtime_unavailable")
    status = await runtime.status(handle)
    return JSONResponse(status)
