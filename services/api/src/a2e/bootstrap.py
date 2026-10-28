"""Wait for Postgres, migrate, load the role matrix, optionally seed."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg
from psycopg import sql

from a2e.settings import get_settings
from a2e.sqlrun import run_file


def _dsn(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )


def _wait(dsn: str) -> None:
    last = "database did not become ready"
    for _ in range(60):
        try:
            with psycopg.connect(dsn, connect_timeout=3) as conn:
                conn.execute("SELECT 1")
            return
        except Exception as exc:
            last = str(exc)
            time.sleep(1)
    raise SystemExit(last)


def _sync_roles(conn: psycopg.Connection[tuple[object, ...]], policy_dir: Path) -> None:
    matrix = json.loads((policy_dir / "role_matrix" / "data.json").read_text(encoding="utf-8"))
    with conn.cursor() as cur:
        cur.execute("DELETE FROM role_permissions")
        for role, actions in matrix.items():
            for action in actions:
                cur.execute(
                    "INSERT INTO role_permissions (role, action) VALUES (%s::user_role, %s)",
                    (role, action),
                )
    conn.commit()


def _check_policy(conn: psycopg.Connection[tuple[object, ...]], system_high: str) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT system_high::text, max_release::text FROM system_policy WHERE id = 1")
        row = cur.fetchone()
    if row is None or row[0] != system_high or row[1] != system_high:
        raise SystemExit("system_policy does not match A2E_SYSTEM_HIGH")


def main() -> None:
    settings = get_settings()
    dsn = _dsn(settings.migration_database_url)
    _wait(dsn)
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=settings.api_root,
        check=True,
    )
    parsed = urlparse(_dsn(settings.database_url))
    password = unquote(parsed.password or "")
    with psycopg.connect(dsn) as conn:
        conn.execute(sql.SQL("ALTER ROLE a2e_app PASSWORD {}").format(sql.Literal(password)))
        conn.commit()
        _sync_roles(conn, settings.policies)
        if settings.seed:
            run_file(conn, settings.api_root / "seeds" / "dev.sql")
            conn.commit()
        _check_policy(conn, settings.system_high)


if __name__ == "__main__":
    main()
