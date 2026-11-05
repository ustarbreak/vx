"""PA-02 platform permission assignments.

Revision ID: d4e6f8a0b2c4
Revises: c3d9e1f7a2b4
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "d4e6f8a0b2c4"
down_revision: Union[str, None] = "c3d9e1f7a2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column("users", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "platform_permission_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_key", sa.String(length=120), nullable=False),
        sa.Column("effect", sa.String(length=8), nullable=False, server_default="allow"),
        sa.Column("scope_type", sa.String(length=16), nullable=False, server_default="global"),
        sa.Column("scope_id", sa.Integer(), nullable=True),
        sa.Column("granted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("effect IN ('allow','deny')", name="ck_platform_perm_effect"),
        sa.CheckConstraint("scope_type IN ('global','tenant','partner')", name="ck_platform_perm_scope"),
    )
    op.create_index("ix_platform_permission_assignments_user_id", "platform_permission_assignments", ["user_id"])
    op.create_index("ix_platform_perm_user_key", "platform_permission_assignments", ["user_id", "permission_key"])
    op.create_index("ix_platform_perm_scope", "platform_permission_assignments", ["scope_type", "scope_id"])

def downgrade() -> None:
    op.drop_index("ix_platform_perm_scope", table_name="platform_permission_assignments")
    op.drop_index("ix_platform_perm_user_key", table_name="platform_permission_assignments")
    op.drop_index("ix_platform_permission_assignments_user_id", table_name="platform_permission_assignments")
    op.drop_table("platform_permission_assignments")
    op.drop_column("users", "auth_version")
