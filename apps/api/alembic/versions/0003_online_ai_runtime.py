"""add online inference, AI configuration, and audit runtime tables

Revision ID: 0003_online_ai
Revises: 0002_operator_role
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_online_ai"
down_revision = "0002_operator_role"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()

    if "run_inference_state" not in tables:
        op.create_table(
            "run_inference_state",
            sa.Column("run_id", sa.String(length=36), primary_key=True),
            sa.Column("mode", sa.String(length=16), nullable=False),
            sa.Column("model_version", sa.String(length=128), nullable=False),
            sa.Column("worker_id", sa.String(length=128), nullable=True),
            sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
            sa.Column("failure_reason", sa.String(length=1000), nullable=True),
        )
        op.create_index(
            op.f("ix_run_inference_state_heartbeat_at"),
            "run_inference_state",
            ["heartbeat_at"],
            unique=False,
        )

    if "run_stream_messages" not in tables:
        op.create_table(
            "run_stream_messages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.String(length=36), nullable=False),
            sa.Column("event_type", sa.String(length=32), nullable=False),
            sa.Column("sample_index", sa.Integer(), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            op.f("ix_run_stream_messages_created_at"),
            "run_stream_messages",
            ["created_at"],
            unique=False,
        )
        op.create_index(
            "ix_run_stream_messages_run_cursor",
            "run_stream_messages",
            ["run_id", "id"],
            unique=False,
        )

    if "ai_interactions" not in tables:
        op.create_table(
            "ai_interactions",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("event_id", sa.String(length=36), nullable=False),
            sa.Column("operator", sa.String(length=80), nullable=False),
            sa.Column("question", sa.String(length=500), nullable=False),
            sa.Column("answer", sa.String(length=4000), nullable=False),
            sa.Column("evidence_refs", sa.JSON(), nullable=False),
            sa.Column("mode", sa.String(length=24), nullable=False),
            sa.Column("model", sa.String(length=128), nullable=False),
            sa.Column("latency_ms", sa.Integer(), nullable=False),
            sa.Column("trace_id", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        for column in ("event_id", "trace_id", "created_at"):
            op.create_index(
                op.f(f"ix_ai_interactions_{column}"),
                "ai_interactions",
                [column],
                unique=False,
            )

    if "ai_configurations" not in tables:
        op.create_table(
            "ai_configurations",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("provider", sa.String(length=80), nullable=False),
            sa.Column("base_url", sa.String(length=500), nullable=False),
            sa.Column("model", sa.String(length=160), nullable=False),
            sa.Column("api_key_ciphertext", sa.String(length=2000), nullable=True),
            sa.Column("timeout_seconds", sa.Integer(), nullable=False),
            sa.Column("max_tokens", sa.Integer(), nullable=False),
            sa.Column("temperature", sa.Float(), nullable=False),
            sa.Column("prompt_version", sa.String(length=128), nullable=False),
            sa.Column("fallback_mode", sa.String(length=24), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            op.f("ix_ai_configurations_updated_at"),
            "ai_configurations",
            ["updated_at"],
            unique=False,
        )

    if "admin_audit_events" not in tables:
        op.create_table(
            "admin_audit_events",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("actor", sa.String(length=80), nullable=False),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("resource_type", sa.String(length=80), nullable=False),
            sa.Column("resource_id", sa.String(length=128), nullable=False),
            sa.Column("change_summary", sa.JSON(), nullable=False),
            sa.Column("trace_id", sa.String(length=128), nullable=False),
            sa.Column("request_id", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        for column in ("actor", "trace_id", "created_at"):
            op.create_index(
                op.f(f"ix_admin_audit_events_{column}"),
                "admin_audit_events",
                [column],
                unique=False,
            )

    if "audit_events" not in tables:
        op.create_table(
            "audit_events",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("event_id", sa.String(length=36), nullable=False),
            sa.Column("record_id", sa.String(length=36), nullable=False),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("actor", sa.String(length=80), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("trace_id", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            op.f("ix_audit_events_event_id"), "audit_events", ["event_id"], unique=False
        )
        op.create_index(
            op.f("ix_audit_events_record_id"), "audit_events", ["record_id"], unique=False
        )


def downgrade() -> None:
    for table in (
        "audit_events",
        "admin_audit_events",
        "ai_configurations",
        "ai_interactions",
        "run_stream_messages",
        "run_inference_state",
    ):
        if table in _tables():
            op.drop_table(table)
