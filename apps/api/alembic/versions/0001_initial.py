"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "replay_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("scenario_id", sa.String(length=128), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("speed", sa.Float(), nullable=False),
        sa.Column("current_sample", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        op.f("ix_replay_runs_scenario_id"), "replay_runs", ["scenario_id"], unique=False
    )

    op.create_table(
        "anomaly_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("sample_index", sa.Integer(), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("anomaly_score", sa.Float(), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_anomaly_events_run_id"), "anomaly_events", ["run_id"], unique=False)

    op.create_table(
        "decision_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("operator_name", sa.String(length=160), nullable=False),
        sa.Column("operator_role", sa.String(length=16), nullable=False, server_default="unknown"),
        sa.Column("note", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
    )
    op.create_index(
        op.f("ix_decision_records_event_id"), "decision_records", ["event_id"], unique=False
    )

    op.create_table(
        "audits",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor", sa.String(length=80), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "operators",
        sa.Column("username", sa.String(length=80), primary_key=True),
        sa.Column("password_hash", sa.String(length=256), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.String(length=320), primary_key=True),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("idempotency_records")
    op.drop_table("operators")
    op.drop_table("audits")
    op.drop_index(op.f("ix_decision_records_event_id"), table_name="decision_records")
    op.drop_table("decision_records")
    op.drop_index(op.f("ix_anomaly_events_run_id"), table_name="anomaly_events")
    op.drop_table("anomaly_events")
    op.drop_index(op.f("ix_replay_runs_scenario_id"), table_name="replay_runs")
    op.drop_table("replay_runs")
