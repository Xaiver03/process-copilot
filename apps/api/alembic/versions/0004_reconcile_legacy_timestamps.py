"""reconcile timestamp columns missing from legacy ORM-created schemas

Revision ID: 0004_legacy_timestamps
Revises: 0003_online_ai
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0004_legacy_timestamps"
down_revision = "0003_online_ai"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)
    }


def _restore_created_at(table: str) -> None:
    if "created_at" in _columns(table):
        return

    with op.batch_alter_table(table) as batch:
        batch.add_column(sa.Column("created_at", sa.DateTime(), nullable=True))

    op.execute(
        sa.text(f"UPDATE {table} SET created_at = :created_at").bindparams(
            created_at=datetime.now(UTC).replace(tzinfo=None)
        )
    )

    with op.batch_alter_table(table) as batch:
        batch.alter_column(
            "created_at",
            existing_type=sa.DateTime(),
            nullable=False,
        )


def upgrade() -> None:
    for table in ("anomaly_events", "idempotency_records"):
        _restore_created_at(table)


def downgrade() -> None:
    # These columns belong to the 0001 baseline. The migration only repairs old
    # databases that were created directly from an earlier ORM schema.
    pass
