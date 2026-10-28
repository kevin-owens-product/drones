"""Async Postgres sessions. The subject GUC is transaction-local."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from a2e.settings import Settings


def make_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=10,
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def set_subject(session: AsyncSession, subject: str) -> None:
    await session.execute(
        text("SELECT set_config('app.subject', :subject, true)"),
        {"subject": subject},
    )


async def fetch_all(session: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    result = await session.execute(text(sql), params or {})
    return [dict(row) for row in result.mappings().all()]


async def fetch_one(
    session: AsyncSession, sql: str, params: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    result = await session.execute(text(sql), params or {})
    row = result.mappings().first()
    if row is None:
        return None
    return dict(row)


async def scalar(session: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> Any:
    result = await session.execute(text(sql), params or {})
    return result.scalar_one_or_none()


async def session_scope(factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with factory() as session:
        yield session
