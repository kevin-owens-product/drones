"""Behavior planning routes. Tracking is operator-designated custody, not a weapon."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.authz import Principal
from a2e.behaviors.custody import Custodian, TrackTarget, allocate_custody
from a2e.behaviors.manifest import ManifestError, validate_manifest
from a2e.behaviors.route import Volume, plan_route
from a2e.behaviors.search import Vehicle, plan_search
from a2e.behaviors.video_manager import StreamNeed, allocate_bandwidth
from a2e.behaviors.weather import GribError, avoidance_volumes, parse_grib2
from a2e.db import scalar
from a2e.http import db_error, fail, get_session, set_banner, transactional
from a2e.routers.deps import (
    _authz,
    _deny_or_none,
    require_principal,
)

log = structlog.get_logger()
router = APIRouter()

class SearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    polygon: list[list[float]]
    vehicles: list[dict[str, Any]]
    dropped: list[str] = Field(default_factory=list)
class RouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: list[int]
    goal: list[int]
    volumes: list[dict[str, int]] = Field(default_factory=list)
    mode: str = "time"
class CustodyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicles: list[dict[str, Any]]
    entities: list[dict[str, Any]]
    quality_threshold: float = 0.2
class VideoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    streams: list[dict[str, Any]]
    budget_kbps: int = Field(ge=0)
@router.post("/v1/behaviors/search")
@transactional
async def behavior_search(
    body: SearchIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "sim.run")
    if denied:
        return denied
    polygon = [(float(point[0]), float(point[1])) for point in body.polygon]
    vehicles = [Vehicle(str(item["id"]), float(item.get("lat", 0)), float(item.get("lon", 0))) for item in body.vehicles]
    plan = plan_search(polygon, vehicles, dropped=body.dropped)
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse(
        {
            "cell_count": plan.cell_count,
            "assignments": [
                {"vehicle_id": item.vehicle_id, "cells": [list(cell) for cell in item.cells]}
                for item in plan.assignments
            ],
        }
    )
@router.post("/v1/behaviors/route")
@transactional
async def behavior_route(
    body: RouteIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "sim.run")
    if denied:
        return denied
    volumes = [Volume(**item) for item in body.volumes]
    route = plan_route(tuple(body.start), tuple(body.goal), volumes=volumes, mode=body.mode)  # type: ignore[arg-type]
    return JSONResponse(
        {"feasible": route.feasible, "reason": route.reason, "cost": route.cost, "path": [list(cell) for cell in route.path]}
    )
@router.post("/v1/behaviors/custody")
@transactional
async def behavior_custody(
    body: CustodyIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "sim.run")
    if denied:
        return denied
    vehicles = [
        Custodian(str(item["id"]), float(item.get("lat", 0)), float(item.get("lon", 0)))
        for item in body.vehicles
    ]
    entities = [
        TrackTarget(
            str(item["id"]),
            float(item.get("lat", 0)),
            float(item.get("lon", 0)),
            kind=str(item.get("kind", "target")),
        )
        for item in body.entities
    ]
    plan = allocate_custody(vehicles, entities, quality_threshold=body.quality_threshold)
    return JSONResponse(
        {
            "regime": plan.regime,
            "assignments": [
                {"vehicle_id": item.vehicle_id, "target_id": item.target_id, "quality": item.quality, "mode": item.mode}
                for item in plan.assignments
            ],
            "unassigned": list(plan.unassigned),
        }
    )
@router.post("/v1/behaviors/video")
@transactional
async def behavior_video(
    body: VideoIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "video.manage")
    if denied:
        return denied
    streams = [
        StreamNeed(
            str(item["id"]),
            int(item["bitrate_kbps"]),
            float(item.get("mission_weight", 1)),
            float(item.get("consumer_need", 1)),
        )
        for item in body.streams
    ]
    grants = allocate_bandwidth(streams, body.budget_kbps)
    return JSONResponse({"grants": [item.__dict__ for item in grants]})
@router.post("/v1/behaviors/weather")
@transactional
async def behavior_weather(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "sim.run")
    if denied:
        return denied
    raw = await request.body()
    try:
        fields = parse_grib2(raw)
    except GribError as exc:
        return fail(400, str(exc).split()[0] if str(exc) else "grib_error")
    volumes = []
    for field in fields:
        volumes.extend(
            avoidance_volumes(field, kind="forecast", threshold=1, floor_m=0, ceiling_m=3000)
        )
    return JSONResponse(
        {
            "fields": len(fields),
            "volumes": len(volumes),
            "cells": [
                {
                    "kind": item.kind,
                    "i0": item.i0,
                    "i1": item.i1,
                    "j0": item.j0,
                    "j1": item.j1,
                    "floor_m": item.floor_m,
                    "ceiling_m": item.ceiling_m,
                }
                for item in volumes
            ],
        }
    )
@router.post("/v1/behaviors/packages")
@transactional
async def register_package(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        return fail(400, "invalid_request")
    try:
        validate_manifest(payload)
    except ManifestError as exc:
        return fail(400, str(exc).replace(" ", "_"))
    tenant = payload.get("tenant_id")
    if not isinstance(tenant, str):
        return fail(400, "invalid_request")

    denied = await _authz(
        request,
        session,
        principal,
        "behavior.promote",
        {"tenant_id": tenant, "classification": "CUI", "caveats": [], "ntk_programs": [], "resource_type": "behavior"},
    )
    if denied:
        return denied
    new_id = uuid4()
    try:
        await scalar(
            session,
            """
            INSERT INTO behavior_packages (
              id, tenant_id, name, version, promotion, manifest, digest, classification, caveats
            ) VALUES (
              :id, :tenant, :name, :version, :promotion, CAST(:manifest AS jsonb), :digest, 'CUI', '{}'
            ) RETURNING id
            """,
            {
                "id": new_id,
                "tenant": tenant,
                "name": payload["name"],
                "version": payload["version"],
                "promotion": payload["promotion"],
                "manifest": __import__("json").dumps(payload),
                "digest": __import__("a2e.behaviors.manifest", fromlist=["digest_manifest"]).digest_manifest(payload),
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    return JSONResponse({"id": str(new_id)}, status_code=201)
