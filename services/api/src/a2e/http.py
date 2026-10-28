"""Request helpers: session commit, banners, and safe errors."""

from __future__ import annotations

import functools
import inspect
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.classification import Marking, banner_text

SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; frame-ancestors 'none'; base-uri 'self'"
    ),
}


def get_session(request: Request) -> AsyncSession:
    session: AsyncSession | None = getattr(request.state, "session", None)
    if session is None:
        raise RuntimeError("database session is not bound")
    return session


def set_banner(request: Request, system_high: str, rows: list[Marking]) -> str:
    text = banner_text(system_high, rows)
    request.state.banner = text
    return text


def fail(status: int, code: str) -> JSONResponse:
    return JSONResponse({"detail": code}, status_code=status)


def transactional(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
    signature = inspect.signature(fn)

    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        session = kwargs["session"]
        try:
            result = await fn(*args, **kwargs)
        except Exception:
            await session.rollback()
            raise
        await session.commit()
        return result

    wrapper.__signature__ = signature  # type: ignore[attr-defined]
    return wrapper


def db_error(exc: DBAPIError) -> JSONResponse | None:
    message = str(exc.orig) if exc.orig is not None else str(exc)
    mapping = (
        ("unknown caveat", 400, "caveat_not_understood"),
        ("row-level security", 403, "denied"),
        ("two_person_required", 403, "two_person_required"),
        ("sharing_term", 400, "sharing_term"),
        ("sharing_terms_immutable", 409, "sharing_terms_immutable"),
        ("illegal_sharing_transition", 409, "illegal_sharing_transition"),
        ("role_denied", 403, "role_denied"),
        ("clearance_insufficient", 403, "clearance_insufficient"),
        ("citizenship_invalid", 400, "citizenship_invalid"),
        ("above_system_high", 403, "above_system_high"),
        ("tenant_change_forbidden", 409, "tenant_change_forbidden"),
        ("payload tenant mismatch", 400, "tenant_mismatch"),
    )
    for needle, status, code in mapping:
        if needle in message:
            return fail(status, code)
    return None
