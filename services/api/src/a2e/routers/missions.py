"""Mission packages, objectives, readiness, and state transitions."""

from __future__ import annotations

import json
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.auditlog import append_audit
from a2e.authz import Principal
from a2e.classification import Marking
from a2e.db import fetch_all, scalar
from a2e.http import db_error, fail, get_session, set_banner, transactional
from a2e.missions.workflow import WorkflowError, transition
from a2e.routers.deps import (
    _authz,
    _deny_or_none,
    require_principal,
)

log = structlog.get_logger()
router = APIRouter()

class MissionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: UUID
    name: str = Field(min_length=1, max_length=120)
    summary: str = ""
class MissionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    summary: str = ""
    planned_start: str | None = None
    planned_end: str | None = None
class ObjectiveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    label: str = Field(default="", max_length=80)
    tail: str = Field(default="", max_length=16)
    lat: float
    lon: float
    alt_m: float = 120
    offset_min: int = Field(default=0, ge=0, le=20000)
    duration_min: int = Field(default=30, ge=1, le=2000)
class KeepOutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    lat: float
    lon: float
    radius_km: float = Field(gt=0, le=500)
    floor_m: float = 0
    ceiling_m: float = 3000
class PackageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objectives: list[ObjectiveIn] = Field(default_factory=list, max_length=40)
    keepouts: list[KeepOutIn] = Field(default_factory=list, max_length=12)
class ObjectivesIn(PackageIn):
    pass
_OBJECTIVE_KINDS = frozenset({"transit", "search", "sensor_custody", "loiter", "rtb"})
class TransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
@router.post("/v1/missions")
@transactional
async def create_mission(
    body: MissionIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:

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
def _circles(polygon: Any) -> list[dict[str, Any]]:
    if isinstance(polygon, str):
        polygon = json.loads(polygon)
    if not isinstance(polygon, dict):
        return []
    circles = polygon.get("circles")
    if isinstance(circles, list):
        return [item for item in circles if isinstance(item, dict) and item.get("lat") is not None]
    if polygon.get("lat") is not None:
        return [polygon]
    return []
def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    return 2 * radius * asin(sqrt(a))
async def _package_report(session: AsyncSession, mission_id: UUID) -> list[dict[str, Any]]:
    """Go / no-go checks for a package. A missing tail blocks launch."""
    mission_rows = await fetch_all(
        session,
        """
        SELECT state, planned_start, requested_by, approved_by
        FROM missions WHERE id = :id
        """,
        {"id": mission_id},
    )
    tasks = await fetch_all(
        session,
        """
        SELECT t.kind, t.platform_id, t.geometry,
               p.tail_number AS registered_tail,
               p.airworthiness::text AS airworthiness
        FROM mission_tasks AS t
        LEFT JOIN platforms AS p ON p.id = t.platform_id
        WHERE t.mission_id = :id
        """,
        {"id": mission_id},
    )
    checks: list[dict[str, Any]] = []
    mission = mission_rows[0] if mission_rows else {}
    checks.append({
        "code": "h_hour_set",
        "pass": mission.get("planned_start") is not None,
        "detail": "Launch time is set." if mission.get("planned_start") else "Set an H-hour before launch.",
        "blocks_launch": True,
    })
    checks.append({
        "code": "has_objectives",
        "pass": len(tasks) > 0,
        "detail": f"{len(tasks)} objectives." if tasks else "The package has no objectives.",
        "blocks_launch": True,
    })
    by_tail: dict[str, list[dict[str, Any]]] = {}
    for task in tasks:
        geometry = task.get("geometry") or {}
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        if not isinstance(geometry, dict):
            geometry = {}
        tail = str(geometry.get("tail") or task.get("registered_tail") or "").strip().upper()
        by_tail.setdefault(tail or "(unnamed)", []).append(task)
    if not by_tail:
        checks.append({
            "code": "tail_missing",
            "pass": False,
            "detail": "No aircraft are assigned.",
            "blocks_launch": True,
        })
    for tail, legs in sorted(by_tail.items()):
        kinds = {str(leg["kind"]) for leg in legs}
        registered = all(leg.get("platform_id") for leg in legs)
        statuses = {str(leg.get("airworthiness") or "") for leg in legs}
        airworthy = registered and statuses == {"airworthy"}
        checks.append({
            "code": "tail_not_registered" if not registered else "tail_not_airworthy",
            "pass": airworthy,
            "detail": (
                f"{tail} is airworthy."
                if airworthy
                else f"{tail} is not a registered airworthy aircraft."
            ),
            "blocks_launch": True,
        })
        complete = "transit" in kinds and "rtb" in kinds
        checks.append({
            "code": "package_incomplete",
            "pass": complete,
            "detail": f"{tail} has a launch and a recovery." if complete else f"{tail} needs a launch and a recovery.",
            "blocks_launch": True,
        })
        checks.append({
            "code": "link_loss",
            "pass": "rtb" in kinds,
            "detail": (
                f"Lost link on {tail}: recover to its return point."
                if "rtb" in kinds
                else f"{tail} has no lost-link recovery."
            ),
            "blocks_launch": True,
        })
    windows: list[tuple[str, float, float, float, int, int]] = []
    for tail, legs in by_tail.items():
        for leg in legs:
            geometry = leg.get("geometry") or {}
            if isinstance(geometry, str):
                geometry = json.loads(geometry)
            if not isinstance(geometry, dict) or geometry.get("lat") is None:
                continue
            start = int(geometry.get("offset_min") or 0)
            duration = int(geometry.get("duration_min") or 30)
            windows.append((
                tail,
                float(geometry["lat"]),
                float(geometry["lon"]),
                float(geometry.get("alt_m") or 0),
                start,
                start + duration,
            ))
    conflict: str | None = None
    for index, left in enumerate(windows):
        for right in windows[index + 1 :]:
            if left[0] == right[0]:
                continue
            same_time = left[4] < right[5] and right[4] < left[5]
            if not same_time or abs(left[3] - right[3]) >= 120:
                continue
            if _km(left[1], left[2], right[1], right[2]) < 8:
                conflict = f"{left[0]} and {right[0]} are inside 8 km at the same time and within 120 m of altitude."
                break
        if conflict:
            break
    checks.append({
        "code": "deconfliction",
        "pass": conflict is None,
        "detail": conflict or "Aircraft are separated by time, distance, or altitude.",
        "blocks_launch": True,
    })
    volumes = await fetch_all(
        session,
        "SELECT name, floor_m, ceiling_m, polygon FROM restricted_volumes WHERE mission_id = :id",
        {"id": mission_id},
    )
    breach: str | None = None
    for volume in volumes:
        for circle in _circles(volume.get("polygon")):
            name = str(circle.get("name") or volume["name"])
            floor_raw = circle.get("floor_m")
            if floor_raw is None:
                floor_raw = volume["floor_m"]
            ceiling_raw = circle.get("ceiling_m")
            if ceiling_raw is None:
                ceiling_raw = volume["ceiling_m"]
            floor = float(floor_raw)
            ceiling = float(ceiling_raw)
            lat_raw = circle.get("lat")
            lon_raw = circle.get("lon")
            if lat_raw is None or lon_raw is None:
                continue
            for tail, lat, lon, alt, _start, _end in windows:
                inside = _km(lat, lon, float(lat_raw), float(lon_raw)) <= float(circle.get("radius_km") or 0)
                if inside and floor <= alt <= ceiling:
                    breach = f"{tail} enters keep-out {name}."
                    break
            if breach:
                break
        if breach:
            break
    checks.append({
        "code": "keep_out",
        "pass": breach is None,
        "detail": breach or "No objective sits inside a keep-out.",
        "blocks_launch": True,
    })
    approved = str(mission.get("state") or "") == "approved"
    different = mission.get("approved_by") not in (None, mission.get("requested_by"))
    checks.append({
        "code": "not_approved",
        "pass": approved and different,
        "detail": "A different person has approved the package." if approved and different else "The package is not approved for launch.",
        "blocks_launch": True,
    })
    return checks
@router.get("/v1/missions/{mission_id}/readiness")
@transactional
async def mission_readiness(
    mission_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    _current, denied = await _mission_for_edit(request, session, principal, mission_id, require_draft=False)
    if denied:
        return denied
    checks = await _package_report(session, mission_id)
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"go": all(bool(item["pass"]) for item in checks), "checks": checks})
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
    if nxt == "active":
        report = await _package_report(session, mission_id)
        failed = next((item for item in report if not item["pass"] and item["blocks_launch"]), None)
        if failed:
            return fail(409, str(failed["code"]))
    await scalar(
        session,
        """
        UPDATE missions
        SET state = :state, approved_by = COALESCE(:approved_by, approved_by), updated_at = now()
        WHERE id = :id
        RETURNING id
        """,
        {"state": nxt, "approved_by": approved_by, "id": mission_id},
    )

    await append_audit(
        session,
        actor_id=principal.user_id,
        tenant_id=current["tenant_id"],
        action=body.action,
        resource_type="mission",
        resource_id=mission_id,
        decision="allow",
        reason_codes=[],
        classification=str(current["classification"]),
        caveats=list(current["caveats"] or []),
        ntk_programs=list(current["ntk_programs"] or []),
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
        SELECT id, name, summary, state, tenant_id, classification::text AS classification,
               caveats, ntk_programs, portion_mark
        FROM missions ORDER BY created_at
        """,
    )
    markings = [
        Marking(str(row["classification"]), tuple(row["caveats"] or []), tuple(row["ntk_programs"] or []))
        for row in rows
    ]
    set_banner(request, request.app.state.settings.system_high, markings)
    items = []
    for row in rows:
        items.append({key: str(value) if value is not None and not isinstance(value, list) else value for key, value in row.items() if key not in {"caveats", "ntk_programs"}})
    return JSONResponse({"items": items})
_PLAN_RANK = {"active": 0, "approved": 1, "review": 2}
@router.get("/v1/operations/board")
@transactional
async def operations_board(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Tails named on a mission that is in review, approved, or active."""
    denied = await _deny_or_none(request, session, principal, "mission.read")
    if denied:
        return denied
    rows = await fetch_all(
        session,
        """
        SELECT COALESCE(NULLIF(t.geometry->>'tail', ''), p.tail_number) AS tail,
               m.id AS mission_id, m.name, m.state::text AS state
        FROM mission_tasks t
        JOIN missions m ON m.id = t.mission_id
        LEFT JOIN platforms p ON p.id = t.platform_id
        WHERE m.state IN ('active', 'approved', 'review')
        """,
    )
    best: dict[str, tuple[int, dict[str, str]]] = {}
    for row in rows:
        tail = str(row["tail"] or "").strip()
        if tail == "":
            continue
        rank = _PLAN_RANK.get(str(row["state"]), 9)
        current = best.get(tail)
        if current is not None and rank >= current[0]:
            continue
        best[tail] = (
            rank,
            {
                "tail_number": tail,
                "mission_id": str(row["mission_id"]),
                "mission_name": str(row["name"]),
                "state": str(row["state"]),
            },
        )
    items = [entry[1] for entry in best.values()]
    items.sort(key=lambda item: item["tail_number"])
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"items": items})
@router.patch("/v1/missions/{mission_id}")
@transactional
async def update_mission(
    mission_id: UUID,
    body: MissionPatch,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    rows = await fetch_all(
        session,
        """
        SELECT id, tenant_id, state, classification::text AS classification, caveats, ntk_programs
        FROM missions WHERE id = :id
        """,
        {"id": mission_id},
    )
    if not rows:
        return fail(404, "not_found")
    current = rows[0]
    if str(current["state"]) != "draft":
        return fail(409, "not_draft")

    denied = await _authz(
        request,
        session,
        principal,
        "mission.draft",
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
    updated = await scalar(
        session,
        """
        UPDATE missions
        SET name = :name, summary = :summary,
            planned_start = CAST(:planned_start AS timestamptz),
            planned_end = CAST(:planned_end AS timestamptz),
            updated_at = now()
        WHERE id = :id AND state = 'draft'
        RETURNING id
        """,
        {
            "id": mission_id,
            "name": body.name,
            "summary": body.summary,
            "planned_start": body.planned_start,
            "planned_end": body.planned_end,
        },
    )
    if updated is None:
        return fail(404, "not_found")
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"id": str(mission_id), "name": body.name, "summary": body.summary, "state": "draft"})
def _objective_item(row: dict[str, Any]) -> dict[str, Any]:
    geometry = row.get("geometry") or {}
    if isinstance(geometry, str):
        geometry = json.loads(geometry)
    if not isinstance(geometry, dict):
        geometry = {}
    return {
        "id": str(row["id"]),
        "kind": str(row["kind"]),
        "label": str(geometry.get("label") or ""),
        "tail": str(geometry.get("tail") or row.get("tail_number") or ""),
        "lat": geometry.get("lat"),
        "lon": geometry.get("lon"),
        "alt_m": geometry.get("alt_m") if geometry.get("alt_m") is not None else 0,
        "offset_min": geometry.get("offset_min") if geometry.get("offset_min") is not None else 0,
        "duration_min": geometry.get("duration_min") if geometry.get("duration_min") is not None else 30,
        "order": geometry.get("order") if geometry.get("order") is not None else 0,
    }
async def _mission_for_edit(
    request: Request,
    session: AsyncSession,
    principal: Principal,
    mission_id: UUID,
    *,
    require_draft: bool,
) -> tuple[dict[str, Any] | None, JSONResponse | None]:

    rows = await fetch_all(
        session,
        """
        SELECT id, tenant_id, state, classification::text AS classification, caveats, ntk_programs
        FROM missions WHERE id = :id
        """,
        {"id": mission_id},
    )
    if not rows:
        return None, fail(404, "not_found")
    current = rows[0]
    if require_draft and str(current["state"]) != "draft":
        return None, fail(409, "not_draft")
    action = "mission.draft" if require_draft else "mission.read"
    denied = await _authz(
        request,
        session,
        principal,
        action,
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
        return None, denied
    return current, None
@router.get("/v1/missions/{mission_id}/objectives")
@transactional
async def list_objectives(
    mission_id: UUID,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    current, denied = await _mission_for_edit(request, session, principal, mission_id, require_draft=False)
    if denied:
        return denied
    assert current is not None
    rows = await fetch_all(
        session,
        """
        SELECT t.id, t.kind, t.geometry, p.tail_number
        FROM mission_tasks AS t
        LEFT JOIN platforms AS p ON p.id = t.platform_id
        WHERE t.mission_id = :id
        """,
        {"id": mission_id},
    )
    items = [_objective_item(row) for row in rows]
    items.sort(key=lambda item: (int(item["offset_min"]) if str(item["offset_min"]).lstrip("-").isdigit() else 0, int(item["order"]) if str(item["order"]).lstrip("-").isdigit() else 0))
    window = await fetch_all(
        session,
        "SELECT planned_start, planned_end FROM missions WHERE id = :id",
        {"id": mission_id},
    )
    start = window[0]["planned_start"] if window else None
    end = window[0]["planned_end"] if window else None
    volumes = await fetch_all(
        session,
        "SELECT id, name, floor_m, ceiling_m, polygon FROM restricted_volumes WHERE mission_id = :id",
        {"id": mission_id},
    )
    keepouts = []
    for volume in volumes:
        for circle in _circles(volume.get("polygon")):
            keepouts.append(
                {
                    "id": str(volume["id"]),
                    "name": str(circle.get("name") or volume["name"]),
                    "lat": circle.get("lat"),
                    "lon": circle.get("lon"),
                    "radius_km": circle.get("radius_km"),
                    "floor_m": circle.get("floor_m") if circle.get("floor_m") is not None else volume["floor_m"],
                    "ceiling_m": circle.get("ceiling_m") if circle.get("ceiling_m") is not None else volume["ceiling_m"],
                }
            )
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse(
        {
            "planned_start": start.isoformat() if isinstance(start, datetime) else None,
            "planned_end": end.isoformat() if isinstance(end, datetime) else None,
            "items": items,
            "keepouts": keepouts,
        }
    )
@router.put("/v1/missions/{mission_id}/objectives")
@transactional
async def replace_objectives(
    mission_id: UUID,
    body: ObjectivesIn,
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    current, denied = await _mission_for_edit(request, session, principal, mission_id, require_draft=True)
    if denied:
        return denied
    assert current is not None
    for item in body.objectives:
        if item.kind not in _OBJECTIVE_KINDS:
            return fail(422, "bad_objective")
        if not -90 <= item.lat <= 90 or not -180 <= item.lon <= 180:
            return fail(422, "bad_objective")
    for volume in body.keepouts:
        if not -90 <= volume.lat <= 90 or not -180 <= volume.lon <= 180 or volume.floor_m > volume.ceiling_m:
            return fail(422, "bad_keepout")
    await fetch_all(
        session,
        "DELETE FROM mission_tasks WHERE mission_id = :id RETURNING id",
        {"id": mission_id},
    )
    for index, item in enumerate(body.objectives, start=1):
        geometry = json.dumps(
            {
                "order": index,
                "label": item.label.strip(),
                "tail": item.tail.strip().upper(),
                "lat": item.lat,
                "lon": item.lon,
                "alt_m": item.alt_m,
                "offset_min": item.offset_min,
                "duration_min": item.duration_min,
            }
        )
        platform_id = await scalar(
            session,
            """
            SELECT id FROM platforms
            WHERE tenant_id = :tenant AND tail_number = :tail
            """,
            {"tenant": current["tenant_id"], "tail": item.tail.strip().upper()},
        )
        await scalar(
            session,
            """
            INSERT INTO mission_tasks (
              id, mission_id, tenant_id, platform_id, kind, geometry, classification, caveats
            )
            VALUES (
              :id, :mission, :tenant, :platform, :kind, CAST(:geometry AS jsonb), 'UNCLASSIFIED', '{}'
            )
            RETURNING id
            """,
            {
                "id": uuid4(),
                "mission": mission_id,
                "tenant": current["tenant_id"],
                "platform": platform_id,
                "kind": item.kind,
                "geometry": geometry,
            },
        )
    existing = await fetch_all(
        session,
        "SELECT id FROM restricted_volumes WHERE mission_id = :id ORDER BY id",
        {"id": mission_id},
    )
    polygon = json.dumps(
        {
            "circles": [
                {
                    "name": volume.name.strip(),
                    "lat": volume.lat,
                    "lon": volume.lon,
                    "radius_km": volume.radius_km,
                    "floor_m": volume.floor_m,
                    "ceiling_m": volume.ceiling_m,
                }
                for volume in body.keepouts
            ]
        }
    )
    if existing:
        await scalar(
            session,
            """
            UPDATE restricted_volumes
            SET name = 'Keep-outs', floor_m = 0, ceiling_m = 20000, polygon = CAST(:polygon AS jsonb)
            WHERE id = :id
            RETURNING id
            """,
            {"id": existing[0]["id"], "polygon": polygon},
        )
    elif body.keepouts:
        await scalar(
            session,
            """
            INSERT INTO restricted_volumes (
              id, tenant_id, mission_id, name, floor_m, ceiling_m, polygon, classification, caveats
            )
            VALUES (
              :id, :tenant, :mission, 'Keep-outs', 0, 20000, CAST(:polygon AS jsonb), 'UNCLASSIFIED', '{}'
            )
            RETURNING id
            """,
            {
                "id": uuid4(),
                "tenant": current["tenant_id"],
                "mission": mission_id,
                "polygon": polygon,
            },
        )
    set_banner(request, request.app.state.settings.system_high, [])
    return JSONResponse({"count": len(body.objectives), "keepouts": len(body.keepouts)})
