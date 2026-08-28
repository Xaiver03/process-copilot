"""add operator role to decision records

Revision ID: 0002_operator_role
Revises: 0001_initial
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_operator_role"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("decision_records")}
    if "operator_role" not in columns:
        op.add_column(
            "decision_records",
            sa.Column("operator_role", sa.String(length=16), nullable=False, server_default="unknown"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("decision_records")}
    if "operator_role" in columns:
        op.drop_column("decision_records", "operator_role")
