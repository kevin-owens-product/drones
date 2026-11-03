"""Fleet insights computed from the seeded attrition world.

Every response carries ``source`` saying it is simulated. These endpoints read
no vehicle and command nothing.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.attrition.report import build_report
from a2e.attrition.seed import make_world
from a2e.authz import Principal
from a2e.http import get_session, transactional
from a2e.routers.deps import _deny_or_none, require_principal

router = APIRouter()


@lru_cache(maxsize=1)
def _attrition() -> dict[str, Any]:
    return build_report(make_world())


@router.get("/v1/attrition")
@transactional
async def attrition(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    denied = await _deny_or_none(request, session, principal, "fleet.read")
    if denied:
        return denied
    return JSONResponse(_attrition())
