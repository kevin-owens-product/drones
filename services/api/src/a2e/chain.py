"""Hash-chain canonical form shared by the audit log and custody events."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from uuid import UUID

GENESIS = "0" * 64


def format_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def canonical_json(payload: Mapping[str, object]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def chain_hash(prev_hex: str, canonical: str) -> str:
    digest = hashlib.sha256()
    digest.update(bytes.fromhex(prev_hex))
    digest.update(canonical.encode("utf-8"))
    return digest.hexdigest()


def audit_payload(
    *,
    event_id: UUID,
    occurred_at: datetime,
    actor_id: UUID,
    tenant_id: UUID | None,
    action: str,
    resource_type: str,
    resource_id: UUID | None,
    decision: str,
    reason_codes: list[str],
    classification: str,
    caveats: list[str],
    ntk_programs: list[str],
) -> dict[str, object]:
    return {
        "action": action,
        "actor_id": str(actor_id),
        "caveats": list(caveats),
        "classification": classification,
        "decision": decision,
        "id": str(event_id),
        "ntk_programs": list(ntk_programs),
        "occurred_at": format_utc(occurred_at),
        "reason_codes": list(reason_codes),
        "resource_id": None if resource_id is None else str(resource_id),
        "resource_type": resource_type,
        "tenant_id": None if tenant_id is None else str(tenant_id),
    }
