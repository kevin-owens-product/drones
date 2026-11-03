"""Live telemetry and video metadata the operator console reads."""

from __future__ import annotations

import json
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.authz import Principal
from a2e.classification import Marking, marking_reasons
from a2e.db import fetch_all
from a2e.http import fail, get_session, set_banner, transactional
from a2e.routers.deps import (
    _deny_or_none,
    _jsonify,
    _row_mark,
    require_principal,
)
from a2e.video.hls import playlist
from a2e.video.klv import KlvError, parse_uas_datalink

log = structlog.get_logger()
router = APIRouter()

@router.get("/v1/telemetry/live")
@transactional
async def telemetry_live(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "telemetry.read")
    if denied:
        return denied
    redis = request.app.state.redis
    if redis is None:
        set_banner(request, request.app.state.settings.system_high, [])
        return JSONResponse({"items": []})
    raw = await redis.hgetall("telemetry:latest")
    allowed_rows = await fetch_all(session, "SELECT app_readable_tenant_ids('telemetry') AS id")
    allowed = {str(next(iter(row.values()))) for row in allowed_rows}
    registry = await fetch_all(
        session,
        "SELECT tail_number, airworthiness::text AS airworthiness FROM platforms",
    )
    airworthiness = {str(row["tail_number"]): str(row["airworthiness"]) for row in registry}
    items: list[dict[str, Any]] = []
    markings: list[Marking] = []
    withheld = 0
    for blob in raw.values():
        item = json.loads(blob)
        tenant = str(item.get("tenant_id", ""))
        if tenant not in allowed:
            continue
        classification = str(item.get("classification") or "UNCLASSIFIED")
        caveats = [str(value) for value in item.get("caveats") or []]
        ntk = [str(value) for value in item.get("ntk_programs") or []]
        if marking_reasons(
            clearance=principal.clearance,
            citizenship=principal.citizenship,
            ntk=list(principal.ntk_programs),
            classification=classification,
            caveats=caveats,
            row_ntk=ntk,
            system_high=request.app.state.settings.system_high,
        ):
            withheld += 1
            continue
        item["airworthiness"] = airworthiness.get(str(item.get("tail_number") or ""))
        items.append(item)
        markings.append(Marking(classification, tuple(caveats), tuple(ntk)))
    banner = set_banner(request, request.app.state.settings.system_high, markings)
    return JSONResponse({"banner": banner, "items": items, "withheld": withheld})
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
@router.get("/v1/video/streams")
@transactional
async def list_streams(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "video.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT id, name, protocol, path, platform_id,
               classification::text AS classification, caveats, portion_mark
        FROM video_streams
        ORDER BY name
        """,
    )
    banner = set_banner(request, request.app.state.settings.system_high, [_row_mark(row) for row in rows])
    return JSONResponse({"banner": banner, "items": _jsonify(rows)})
