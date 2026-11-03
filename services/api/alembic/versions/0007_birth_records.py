"""Store per-serial factory birth records."""

from __future__ import annotations

from pathlib import Path

from alembic import op

from a2e.sqlrun import run_file

revision = "0007_birth_records"
down_revision = "0006_eval_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    fairy = bind.connection
    raw = fairy.driver_connection if hasattr(fairy, "driver_connection") else fairy.dbapi_connection
    path = Path(__file__).resolve().parents[2] / "migrations" / "sql" / "0007_birth_records.sql"
    run_file(raw, path)


def downgrade() -> None:
    raise RuntimeError("downgrade is not supported")
