"""Debrief timeline and export."""

from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.authz import Principal
from a2e.db import fetch_all
from a2e.debrief.replay import Cue, build_timeline
from a2e.flight.blackbox import fixture_blackbox
from a2e.flight.blackbox import plot_series as blackbox_series
from a2e.flight.ulg import fixture_ulg, plot_series
from a2e.http import fail, get_session, set_banner, transactional
from a2e.missions.exports import to_csv, to_pdf, to_xapi
from a2e.routers.deps import (
    _deny_or_none,
    require_principal,
)
from a2e.routers.missions import _mission_for_edit, _objective_item

log = structlog.get_logger()
router = APIRouter()

@router.get("/v1/missions/{mission_id}/debrief")
@transactional
async def mission_debrief(
    mission_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Flight log built from the stored objectives, not from text the browser invented."""
    _current, denied = await _mission_for_edit(request, session, principal, mission_id, require_draft=False)
    if denied:
        return denied
    rows = await fetch_all(
        session,
        "SELECT t.id, t.kind, t.geometry, p.tail_number FROM mission_tasks AS t LEFT JOIN platforms AS p ON p.id = t.platform_id WHERE t.mission_id = :id",
        {"id": mission_id},
    )
    items = [_objective_item(row) for row in rows]
    items.sort(
        key=lambda item: (
            int(item["offset_min"]) if str(item["offset_min"]).lstrip("-").isdigit() else 0,
            int(item["order"]) if str(item["order"]).lstrip("-").isdigit() else 0,
        )
    )
    cues = []
    for item in items:
        try:
            minutes = int(item["offset_min"])
        except (TypeError, ValueError):
            continue
        cues.append(
            {
                "time_us": minutes * 60_000_000,
                "kind": item["kind"],
                "label": item["label"],
                "tail": item["tail"],
            }
        )
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"cues": cues})
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
    return JSONResponse(
        {
            "cues": [
                {
                    "time_us": cue.time_us,
                    "kind": cue.kind,
                    "label": str(cue.payload.get("label") or ""),
                    "tail": str(cue.payload.get("tail") or ""),
                }
                for cue in ordered
            ]
        }
    )
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


@router.get("/v1/logs/ulg/series")
@transactional
async def ulg_series(
    request: Request,
    name: str = "six-quad-instance5.ulg",
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "telemetry.read")
    if denied:
        return denied
    path = fixture_ulg(name)
    if path is None:
        return fail(404, "not_found")
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"name": name, **plot_series(path)})


@router.get("/v1/logs/blackbox/series")
@transactional
async def blackbox_log_series(
    request: Request,
    name: str = "sitl.bfl",
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "telemetry.read")
    if denied:
        return denied
    path = fixture_blackbox(name)
    if path is None:
        return fail(404, "not_found")
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"name": name, **blackbox_series(path)})


@router.get("/v1/eval/runs")
@transactional
async def eval_runs(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "telemetry.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT recorded_at, git_sha, metric, value, unit, phase
        FROM eval_runs
        ORDER BY recorded_at DESC, metric
        LIMIT 200
        """,
    )
    set_banner(request, request.app.state.settings.system_high, [])
    items = []
    for row in rows:
        recorded = row["recorded_at"]
        items.append(
            {
                "recorded_at": recorded.isoformat() if hasattr(recorded, "isoformat") else str(recorded),
                "git_sha": str(row["git_sha"]),
                "metric": str(row["metric"]),
                "value": float(row["value"]),
                "unit": str(row["unit"]),
                "phase": str(row["phase"]),
            }
        )
    return JSONResponse({"items": items})
