"""add durable read-only control proposal shadow evaluations

Revision ID: 0006_control_proposals
Revises: 0005_ai_runtime_probes
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_control_proposals"
down_revision = "0005_ai_runtime_probes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "control_proposals" in inspector.get_table_names():
        required = {
            "id",
            "event_id",
            "action_draft",
            "source_trace_id",
            "execution_mode",
            "state",
            "checks",
            "requested_by",
            "sent",
            "trace_id",
            "created_at",
        }
        actual = {
            column["name"] for column in inspector.get_columns("control_proposals")
        }
        missing = sorted(required - actual)
        if missing:
            raise RuntimeError(
                "incompatible existing schema: control_proposals is missing columns "
                + ", ".join(missing)
            )
        return

    op.create_table(
        "control_proposals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("action_draft", sa.String(length=2000), nullable=False),
        sa.Column("source_trace_id", sa.String(length=128), nullable=True),
        sa.Column("execution_mode", sa.String(length=16), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("checks", sa.JSON(), nullable=False),
        sa.Column("requested_by", sa.String(length=80), nullable=False),
        sa.Column("sent", sa.Boolean(), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for column in ("event_id", "requested_by", "trace_id", "created_at"):
        op.create_index(
            op.f(f"ix_control_proposals_{column}"),
            "control_proposals",
            [column],
            unique=False,
        )


def downgrade() -> None:
    for column in ("created_at", "trace_id", "requested_by", "event_id"):
        op.drop_index(
            op.f(f"ix_control_proposals_{column}"),
            table_name="control_proposals",
        )
    op.drop_table("control_proposals")
