"""Policy enforcement. SQL and OPA must both allow."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from a2e.db import fetch_all, scalar
from a2e.decisions import Decision, combine
from a2e.settings import Settings

log = structlog.get_logger()

# Actions whose role must cover the resource tenant, not merely exist somewhere.
TENANT_SCOPED = frozenset(
    {
        "fleet.write",
        "custody.append",
        "org.write",
        "sharing.create",
        "sharing.approve",
        "user.provision",
        "mission.draft",
        "mission.review",
        "mission.approve",
        "mission.execute",
        "video.manage",
        "sim.run",
        "behavior.promote",
    }
)

CATEGORY = {
    "fleet.read": "fleet",
    "fleet.write": "fleet",
    "custody.append": "fleet",
    "release.export": "fleet",
    "sharing.read": "fleet",
    "sharing.create": "fleet",
    "sharing.approve": "fleet",
    "mission.read": "mission",
    "mission.draft": "mission",
    "mission.review": "mission",
    "mission.approve": "mission",
    "mission.execute": "mission",
    "video.read": "video",
    "video.manage": "video",
    "telemetry.read": "telemetry",
    "sim.run": "mission",
    "behavior.read": "mission",
    "behavior.promote": "mission",
    "audit.read": "audit",
}


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    subject: str
    username: str
    display_name: str
    citizenship: str
    clearance: str
    ntk_programs: tuple[str, ...]
    roles: tuple[str, ...]


class OpaClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._url = settings.opa_url.rstrip("/") + "/v1/data/a2e/abac/result"
        self._client = client or httpx.AsyncClient(timeout=2.0)
        self._owns = client is None

    async def aclose(self) -> None:
        if self._owns:
            await self._client.aclose()

    async def decide(self, payload: dict[str, Any]) -> tuple[bool | None, list[str]]:
        try:
            response = await self._client.post(self._url, json={"input": payload})
            response.raise_for_status()
            body = response.json()
        except Exception as exc:
            log.warning("opa_unavailable", error=type(exc).__name__)
            return None, ["opa_unavailable"]
        result = body.get("result") if isinstance(body, dict) else None
        if not isinstance(result, dict) or not isinstance(result.get("allow"), bool):
            return None, ["opa_unavailable"]
        raw_reasons = result.get("reasons", [])
        reasons = [str(item) for item in raw_reasons] if isinstance(raw_reasons, list) else ["opa_unavailable"]
        allow = result["allow"]
        if not isinstance(allow, bool):
            return None, ["opa_unavailable"]
        return allow, reasons


async def load_principal(session: AsyncSession, subject: str) -> Principal | None:
    from a2e.db import fetch_one

    row = await fetch_one(
        session,
        """
        SELECT id, username, display_name, citizenship, clearance::text AS clearance, ntk_programs
        FROM users
        WHERE keycloak_sub = :subject AND disabled_at IS NULL
        """,
        {"subject": subject},
    )
    if row is None:
        return None
    roles = await fetch_all(session, "SELECT app_roles_for(NULL) AS role")
    return Principal(
        user_id=row["id"],
        subject=subject,
        username=str(row["username"]),
        display_name=str(row["display_name"]),
        citizenship=str(row["citizenship"]),
        clearance=str(row["clearance"]),
        ntk_programs=tuple(row["ntk_programs"] or []),
        roles=tuple(str(item["role"]) for item in roles),
    )


async def _uuids(session: AsyncSession, sql: str, params: dict[str, Any]) -> list[str]:
    rows = await fetch_all(session, sql, params)
    values: list[str] = []
    for row in rows:
        raw = next(iter(row.values()))
        values.append(str(raw))
    return values


async def authorize(
    session: AsyncSession,
    opa: OpaClient,
    principal: Principal,
    action: str,
    resource: dict[str, Any] | None,
    *,
    system_high: str,
    recipient: dict[str, Any] | None = None,
) -> Decision:
    tenant_raw = None if resource is None else resource.get("tenant_id")
    tenant = str(tenant_raw) if tenant_raw else None
    scoped = action in TENANT_SCOPED and tenant is not None
    sql_allow_raw = await scalar(
        session,
        "SELECT app_action_permitted(:action, CAST(:tenant AS uuid))",
        {"action": action, "tenant": tenant if scoped else None},
    )
    sql_allow = bool(sql_allow_raw)
    category = CATEGORY.get(action, "fleet")
    if action in TENANT_SCOPED:
        accessible = await _uuids(session, "SELECT app_hierarchy_tenant_ids() AS id", {})
        role_rows = await fetch_all(
            session,
            "SELECT app_roles_for(CAST(:tenant AS uuid)) AS role",
            {"tenant": tenant},
        )
        roles = [str(item["role"]) for item in role_rows]
    else:
        accessible = await _uuids(
            session,
            "SELECT app_readable_tenant_ids(:category) AS id",
            {"category": category},
        )
        roles = list(principal.roles)
    opa_input: dict[str, Any] = {
        "action": action,
        "system_high": system_high,
        "subject": {
            "clearance": principal.clearance,
            "citizenship": principal.citizenship,
            "ntk": list(principal.ntk_programs),
            "roles": roles,
            "accessible_tenant_ids": accessible,
        },
    }
    if resource is not None:
        opa_input["resource"] = {
            "tenant_id": tenant,
            "classification": resource.get("classification"),
            "caveats": list(resource.get("caveats") or []),
            "ntk": list(resource.get("ntk_programs") or resource.get("ntk") or []),
        }
    if recipient is not None:
        opa_input["recipient"] = recipient
    opa_allow, opa_reasons = await opa.decide(opa_input)
    decision = combine(sql_allow, opa_allow, opa_reasons)
    log.info(
        "authz",
        action=action,
        allow=decision.allow,
        reasons=list(decision.reasons),
        user_id=str(principal.user_id),
        disagreement=decision.disagreement,
    )
    return decision
