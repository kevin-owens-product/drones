"""Run a SQL script. psycopg3 will not execute multiple statements itself."""

from __future__ import annotations

from pathlib import Path

from psycopg.pq import ExecStatus


def run_script(connection: object, sql: str) -> None:
    """Execute a full script on a psycopg connection via libpq."""
    pgconn = connection.pgconn  # type: ignore[attr-defined]
    result = pgconn.exec_(sql.encode("utf-8"))
    status = result.status
    if status not in {ExecStatus.COMMAND_OK, ExecStatus.TUPLES_OK}:
        message = bytes(result.error_message).decode("utf-8", errors="replace")
        raise RuntimeError(message.strip() or "sql script failed")


def run_file(connection: object, path: Path) -> None:
    run_script(connection, path.read_text(encoding="utf-8"))
