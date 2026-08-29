"""persist language-model runtime verification probes

Revision ID: 0005_ai_runtime_probes
Revises: 0004_legacy_timestamps
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_ai_runtime_probes"
down_revision = "0004_legacy_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_runtime_probes" in inspector.get_table_names():
        required = {
            "id",
            "status",
            "mode",
            "model",
            "latency_ms",
            "reason_code",
            "trace_id",
            "config_version",
            "checked_at",
        }
        actual = {
            column["name"] for column in inspector.get_columns("ai_runtime_probes")
        }
        missing = sorted(required - actual)
        if missing:
            raise RuntimeError(
                "incompatible existing schema: ai_runtime_probes is missing columns "
                + ", ".join(missing)
            )
        return

    op.create_table(
        "ai_runtime_probes",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("mode", sa.String(length=24), nullable=False),
        sa.Column("model", sa.String(length=160), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("reason_code", sa.String(length=128), nullable=True),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        op.f("ix_ai_runtime_probes_trace_id"),
        "ai_runtime_probes",
        ["trace_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ai_runtime_probes_checked_at"),
        "ai_runtime_probes",
        ["checked_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_ai_runtime_probes_checked_at"), table_name="ai_runtime_probes")
    op.drop_index(op.f("ix_ai_runtime_probes_trace_id"), table_name="ai_runtime_probes")
    op.drop_table("ai_runtime_probes")
