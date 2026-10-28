"""Routes for telemetry queries, behaviors, missions, video metadata, and edge sync."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

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
from a2e.db import fetch_all, scalar
from a2e.debrief.replay import Cue, build_timeline
from a2e.edge.sync import Operation, reconcile
from a2e.http import db_error, fail, get_session, set_banner, transactional
from a2e.missions.exports import to_csv, to_pdf, to_xapi
from a2e.missions.workflow import WorkflowError, transition
from a2e.routes import require_principal
from a2e.sim.dynamics import KinematicState, Wind, energy_used, step
from a2e.sim.runtime import FantomRuntime, RuntimeUnavailable, SimRuntime
from a2e.video.hls import playlist
from a2e.video.klv import KlvError, parse_uas_datalink

router = APIRouter()
_SIM = SimRuntime()
_FANTOM = FantomRuntime()


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


class MissionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: UUID
    name: str = Field(min_length=1, max_length=120)
    summary: str = ""


class TransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str


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


async def _deny_or_none(request: Request, session: AsyncSession, principal: Principal, action: str) -> JSONResponse | None:
    from a2e.routes import _authz

    return await _authz(request, session, principal, action)


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
    return JSONResponse({"fields": len(fields), "volumes": len(volumes)})


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
    from a2e.routes import _authz

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


@router.post("/v1/missions")
@transactional
async def create_mission(
    body: MissionIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    from a2e.routes import _authz

    denied = await _authz(
        request,
        session,
        principal,
        "mission.draft",
        {
            "tenant_id": str(body.tenant_id),
            "classification": "CUI",
            "caveats": [],
            "ntk_programs": [],
            "resource_type": "mission",
        },
    )
    if denied:
        return denied
    new_id = uuid4()
    try:
        await scalar(
            session,
            """
            INSERT INTO missions (id, tenant_id, name, summary, requested_by, classification, caveats)
            VALUES (:id, :tenant, :name, :summary, :actor, 'CUI', '{}')
            RETURNING id
            """,
            {
                "id": new_id,
                "tenant": body.tenant_id,
                "name": body.name,
                "summary": body.summary,
                "actor": principal.user_id,
            },
        )
    except DBAPIError as exc:
        mapped = db_error(exc)
        if mapped:
            return mapped
        raise
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"id": str(new_id), "state": "draft"}, status_code=201)


@router.post("/v1/missions/{mission_id}/transition")
@transactional
async def mission_transition(
    mission_id: UUID,
    body: TransitionIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    row = await fetch_all(
        session,
        """
        SELECT id, tenant_id, state, requested_by, classification::text AS classification, caveats, ntk_programs
        FROM missions WHERE id = :id
        """,
        {"id": mission_id},
    )
    if not row:
        return fail(404, "not_found")
    current = row[0]
    from a2e.routes import _authz

    denied = await _authz(
        request,
        session,
        principal,
        body.action,
        {
            "id": current["id"],
            "tenant_id": current["tenant_id"],
            "classification": current["classification"],
            "caveats": list(current["caveats"] or []),
            "ntk_programs": list(current["ntk_programs"] or []),
            "resource_type": "mission",
        },
    )
    if denied:
        return denied
    try:
        nxt = transition(
            str(current["state"]),
            body.action,
            actor_id=str(principal.user_id),
            requested_by=str(current["requested_by"]),
        )
    except WorkflowError as exc:
        return fail(409, str(exc))
    approved_by = principal.user_id if nxt == "approved" else None
    await scalar(
        session,
        """
        UPDATE missions
        SET state = :state, approved_by = COALESCE(:approved_by, approved_by), updated_at = now()
        WHERE id = :id
        """,
        {"state": nxt, "approved_by": approved_by, "id": mission_id},
    )
    return JSONResponse({"id": str(mission_id), "state": nxt})


@router.get("/v1/missions")
@transactional
async def list_missions(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "mission.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, name, state, tenant_id, classification::text AS classification, portion_mark
        FROM missions ORDER BY created_at
        """,
    )
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"items": [{key: str(value) if value is not None else None for key, value in row.items()} for row in rows]})


@router.post("/v1/video/klv")
@transactional
async def parse_klv(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "video.read")
    if denied:
        return denied
    raw = await request.body()
    try:
        frame = parse_uas_datalink(raw)
    except KlvError:
        return fail(400, "klv_rejected")
    return JSONResponse(
        {
            "sensor_lat": frame.sensor_lat,
            "sensor_lon": frame.sensor_lon,
            "checksum_ok": frame.checksum_ok,
        }
    )


@router.get("/v1/video/{stream_id}/index.m3u8")
@transactional
async def hls_index(
    stream_id: str,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "video.read")
    if denied:
        return denied
    body = playlist(stream_id, [])
    return JSONResponse({"playlist": body})


@router.post("/v1/debrief/timeline")
@transactional
async def debrief_timeline(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "mission.read")
    if denied:
        return denied
    payload = await request.json()
    cues = [Cue(int(item["time_us"]), str(item["kind"]), dict(item.get("payload") or {})) for item in payload.get("cues", [])]
    ordered = build_timeline(cues)
    return JSONResponse({"cues": [{"time_us": cue.time_us, "kind": cue.kind} for cue in ordered]})


@router.post("/v1/debrief/export")
@transactional
async def debrief_export(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "release.export")
    if denied:
        return denied
    payload = await request.json()
    fmt = str(payload.get("format", "csv"))
    rows = payload.get("rows") or []
    banner = request.app.state.settings.system_high
    set_banner(request, banner, [])
    if fmt == "csv":
        return JSONResponse({"banner": banner, "body": to_csv(rows)})
    if fmt == "xapi":
        return JSONResponse({"banner": banner, "body": to_xapi(principal.username, "debriefed", "mission", banner)})
    if fmt == "pdf":
        blob = to_pdf("Debrief", banner)
        return JSONResponse({"banner": banner, "pdf_base64": __import__("base64").b64encode(blob).decode()})
    return fail(400, "format_unavailable")


@router.post("/v1/edge/reconcile")
@transactional
async def edge_reconcile(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "mission.read")
    if denied:
        return denied
    payload = await request.json()

    def ops(items: list[dict[str, Any]]) -> list[Operation]:
        return [
            Operation(str(item["event_id"]), str(item["kind"]), str(item["record_id"]), str(item.get("node_id", "")), str(item["body_hash"]))
            for item in items
        ]

    result = reconcile(ops(payload.get("local") or []), ops(payload.get("remote") or []))
    return JSONResponse(
        {
            "appended": result.appended,
            "frozen_plans": result.frozen_plans,
            "rejected_custody": result.rejected_custody,
        }
    )
