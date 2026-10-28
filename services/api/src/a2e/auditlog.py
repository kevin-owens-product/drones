"""Append to the hash-chained audit log. Conflicts retry inside a savepoint."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import structlog
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.chain import audit_payload, canonical_json, chain_hash
from a2e.db import scalar
from a2e.demo_ids import SYSTEM

log = structlog.get_logger()


def _is_conflict(exc: DBAPIError) -> bool:
    message = str(exc.orig) if exc.orig is not None else str(exc)
    return "audit_chain_conflict" in message


async def append_audit(
    session: AsyncSession,
    *,
    actor_id: UUID,
    tenant_id: UUID | None,
    action: str,
    resource_type: str,
    resource_id: UUID | None,
    decision: str,
    reason_codes: list[str],
    classification: str = "UNCLASSIFIED",
    caveats: list[str] | None = None,
    ntk_programs: list[str] | None = None,
) -> UUID:
    caveats = caveats or []
    ntk_programs = ntk_programs or []
    for _ in range(5):
        event_id = uuid4()
        occurred_at = datetime.now(timezone.utc)
        prev = await scalar(session, "SELECT last_hash FROM audit_chain_head WHERE id = 1")
        if not isinstance(prev, str):
            raise RuntimeError("audit chain missing")
        body = audit_payload(
            event_id=event_id,
            occurred_at=occurred_at,
            actor_id=actor_id,
            tenant_id=tenant_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            decision=decision,
            reason_codes=reason_codes,
            classification=classification,
            caveats=caveats,
            ntk_programs=ntk_programs,
        )
        canonical = canonical_json(body)
        row_hash = chain_hash(prev, canonical)
        params: dict[str, Any] = {
            "id": event_id,
            "occurred_at": occurred_at,
            "actor_id": actor_id,
            "tenant_id": tenant_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "decision": decision,
            "reason_codes": reason_codes,
            "classification": classification,
            "caveats": caveats,
            "ntk": ntk_programs,
            "canonical": canonical,
            "row_hash": row_hash,
        }
        try:
            async with session.begin_nested():
                await scalar(
                    session,
                    """
                    SELECT append_audit(
                      :id, :occurred_at, :actor_id, :tenant_id, :action, :resource_type,
                      :resource_id, :decision, :reason_codes, CAST(:classification AS clearance_level),
                      :caveats, :ntk, :canonical, :row_hash
                    )
                    """,
                    params,
                )
            log.info(
                "audit_append",
                action=action,
                decision=decision,
                actor_id=str(actor_id),
                tenant_id=None if tenant_id is None else str(tenant_id),
            )
            return event_id
        except DBAPIError as exc:
            if _is_conflict(exc):
                continue
            raise
    raise RuntimeError("audit chain conflict")


async def append_login_failure(
    session: AsyncSession,
    *,
    username: str,
    tenant_id: UUID | None,
) -> UUID:
    """Authentication failures are attributed to the disabled system user."""
    for _ in range(5):
        event_id = uuid4()
        occurred_at = datetime.now(timezone.utc)
        prev = await scalar(session, "SELECT last_hash FROM audit_chain_head WHERE id = 1")
        if not isinstance(prev, str):
            raise RuntimeError("audit chain missing")
        body = audit_payload(
            event_id=event_id,
            occurred_at=occurred_at,
            actor_id=SYSTEM,
            tenant_id=tenant_id,
            action="auth.login_failed",
            resource_type="username",
            resource_id=None,
            decision="deny",
            reason_codes=["invalid_credentials"],
            classification="UNCLASSIFIED",
            caveats=[],
            ntk_programs=[],
        )
        # Keep the attempted username in the canonical resource_type slot's sibling.
        body["resource_type"] = "username:" + username
        canonical = canonical_json(body)
        row_hash = chain_hash(prev, canonical)
        try:
            async with session.begin_nested():
                await scalar(
                    session,
                    """
                    SELECT append_system_audit(
                      :id, :occurred_at, :tenant_id, 'auth.login_failed', :resource_type,
                      NULL, 'deny', ARRAY['invalid_credentials'], :canonical, :row_hash
                    )
                    """,
                    {
                        "id": event_id,
                        "occurred_at": occurred_at,
                        "tenant_id": tenant_id,
                        "resource_type": "username:" + username,
                        "canonical": canonical,
                        "row_hash": row_hash,
                    },
                )
            return event_id
        except DBAPIError as exc:
            if _is_conflict(exc):
                continue
            raise
    raise RuntimeError("audit chain conflict")
