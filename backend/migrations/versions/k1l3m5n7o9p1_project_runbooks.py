"""Persist tenant-scoped project runbook checklists.

Revision ID: k1l3m5n7o9p1
Revises: j2k4l6m8n0p2
Create Date: 2026-11-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "k1l3m5n7o9p1"
down_revision: Union[str, None] = "j2k4l6m8n0p2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_runbooks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("phase", sa.String(length=80), nullable=True),
        sa.Column("est_minutes", sa.Integer(), nullable=True),
        sa.Column("steps", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_project_runbooks_id", "project_runbooks", ["id"])
    op.create_index("ix_project_runbooks_org_id", "project_runbooks", ["org_id"])
    op.create_index("ix_project_runbooks_project_id", "project_runbooks", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_runbooks_project_id", table_name="project_runbooks")
    op.drop_index("ix_project_runbooks_org_id", table_name="project_runbooks")
    op.drop_index("ix_project_runbooks_id", table_name="project_runbooks")
    op.drop_table("project_runbooks")
