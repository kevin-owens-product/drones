"""Walk the audit hash chain. Exit 1 if a link or a canonical body does not match."""

from __future__ import annotations

import sys
from datetime import datetime

import psycopg

from a2e.chain import GENESIS, audit_payload, canonical_json, chain_hash
from a2e.settings import get_settings


def _dsn(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )


def main() -> None:
    settings = get_settings()
    previous = GENESIS
    with psycopg.connect(_dsn(settings.migration_database_url)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, occurred_at, actor_id, tenant_id, action, resource_type, resource_id,
                       decision, reason_codes, classification::text, caveats, ntk_programs,
                       canonical, prev_hash, row_hash
                FROM audit_events
                ORDER BY seq
                """
            )
            rows = cur.fetchall()
    for row in rows:
        (
            event_id,
            occurred_at,
            actor_id,
            tenant_id,
            action,
            resource_type,
            resource_id,
            decision,
            reason_codes,
            classification,
            caveats,
            ntk,
            canonical,
            prev_hash,
            row_hash,
        ) = row
        if prev_hash != previous:
            raise SystemExit(f"chain fork at {event_id}")
        if chain_hash(prev_hash, canonical) != row_hash:
            raise SystemExit(f"hash mismatch at {event_id}")
        if not isinstance(occurred_at, datetime):
            raise SystemExit(f"bad timestamp at {event_id}")
        rebuilt = canonical_json(
            audit_payload(
                event_id=event_id,
                occurred_at=occurred_at,
                actor_id=actor_id,
                tenant_id=tenant_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                decision=decision,
                reason_codes=list(reason_codes),
                classification=classification,
                caveats=list(caveats),
                ntk_programs=list(ntk),
            )
        )
        if rebuilt != canonical:
            raise SystemExit(f"canonical mismatch at {event_id}")
        previous = row_hash
    print(f"audit chain ok ({len(rows)} events)")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
