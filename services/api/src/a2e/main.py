"""ASGI application. Binds to 0.0.0.0 so a container can receive traffic."""

from __future__ import annotations

import time
from pathlib import Path

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy.exc import DBAPIError
from starlette.middleware.base import BaseHTTPMiddleware

from a2e import __version__
from a2e.authn import Authenticator
from a2e.authz import OpaClient
from a2e.db import make_engine, make_sessionmaker, set_subject
from a2e.http import SECURITY_HEADERS, db_error, fail
from a2e.logging_config import setup_logging
from a2e.phase_routes import router as phase_router
from a2e.routes import router
from a2e.settings import Settings, get_settings

log = structlog.get_logger()
STATIC = Path(__file__).resolve().parent / "static"


class SessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        started = time.perf_counter()
        if request.url.path in {"/health", "/metrics"}:
            response = await call_next(request)
            for key, value in SECURITY_HEADERS.items():
                response.headers.setdefault(key, value)
            return response
        settings: Settings = request.app.state.settings
        factory = request.app.state.sessionmaker
        async with factory() as session:
            request.state.session = session
            request.state.banner = settings.system_high
            await set_subject(session, "")
            try:
                response = await call_next(request)
            except Exception:
                await session.rollback()
                raise
            response.headers["X-A2E-Banner"] = getattr(request.state, "banner", settings.system_high)
            for key, value in SECURITY_HEADERS.items():
                response.headers.setdefault(key, value)
            log.info(
                "request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
                user_id=getattr(request.state, "user_id", None),
            )
            return response


def create_app(settings: Settings | None = None) -> FastAPI:
    setup_logging()
    current = settings or get_settings()
    docs = "/docs" if current.env == "development" else None
    app = FastAPI(
        title="A2E Mission Cloud",
        version=__version__,
        docs_url=docs,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.settings = current
    app.state.engine = make_engine(current)
    app.state.sessionmaker = make_sessionmaker(app.state.engine)
    app.state.authenticator = Authenticator(current)
    app.state.opa = OpaClient(current)
    app.state.redis = None
    if current.rate_limit_enabled:
        from redis.asyncio import Redis

        app.state.redis = Redis.from_url(current.redis_url, decode_responses=True)

    app.add_middleware(SessionMiddleware)
    app.include_router(router)
    app.include_router(phase_router)
    Instrumentator().instrument(app).expose(app, include_in_schema=False)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready(request: Request) -> JSONResponse:
        from a2e.http import get_session

        try:
            session = get_session(request)
            await session.execute(__import__("sqlalchemy").text("SELECT 1"))
        except Exception:
            return fail(503, "not_ready")
        return JSONResponse({"status": "ready"})

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    @app.get("/assets/{path:path}")
    async def assets(path: str) -> FileResponse:
        candidate = (STATIC / "assets" / path).resolve()
        root = (STATIC / "assets").resolve()
        if not str(candidate).startswith(str(root)) or not candidate.is_file():
            return fail(404, "not_found")  # type: ignore[return-value]
        return FileResponse(candidate)

    @app.exception_handler(RequestValidationError)
    async def validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [".".join(str(part) for part in err["loc"]) for err in exc.errors()]
        return JSONResponse({"detail": "invalid_request", "fields": fields}, status_code=422)

    @app.exception_handler(DBAPIError)
    async def database(_: Request, exc: DBAPIError) -> JSONResponse:
        mapped = db_error(exc)
        if mapped is not None:
            return mapped
        log.error("database_error")
        return fail(500, "database_error")

    return app


app = create_app()
