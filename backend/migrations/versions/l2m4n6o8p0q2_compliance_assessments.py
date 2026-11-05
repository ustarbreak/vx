"""Create tenant-scoped NIST CSF 2.0 control assessment records.

Revision ID: l2m4n6o8p0q2
Revises: k1l3m5n7o9p1
Create Date: 2026-11-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "l2m4n6o8p0q2"
down_revision: Union[str, None] = "k1l3m5n7o9p1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "compliance_assessments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("framework", sa.String(length=80), nullable=False),
        sa.Column("control_id", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="not_assessed"),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("assessed_by", sa.String(length=255), nullable=True),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("org_id", "framework", "control_id", name="uq_compliance_assessment_tenant_control"),
    )
    op.create_index("ix_compliance_assessments_id", "compliance_assessments", ["id"])
    op.create_index("ix_compliance_assessments_org_id", "compliance_assessments", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_compliance_assessments_org_id", table_name="compliance_assessments")
    op.drop_index("ix_compliance_assessments_id", table_name="compliance_assessments")
    op.drop_table("compliance_assessments")
