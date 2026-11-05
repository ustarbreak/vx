"""PA-06 auditable platform subscription lifecycle.

Revision ID: f8a0c2e4g6i8
Revises: d4e6f8a0b2c4
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f8a0c2e4g6i8"
down_revision: Union[str, Sequence[str], None] = "d4e6f8a0b2c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("plan_code", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("billing_interval", sa.String(length=16), nullable=False, server_default="monthly"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="MAD"),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("provider_subscription_id", sa.String(length=160), nullable=True),
        sa.Column("change_reason", sa.String(length=300), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_platform_subscriptions_org_id", "platform_subscriptions", ["org_id"])
    op.create_index("ix_platform_subscriptions_plan_code", "platform_subscriptions", ["plan_code"])
    op.create_index("ix_platform_subscriptions_status", "platform_subscriptions", ["status"])
    op.create_index("ix_platform_subscriptions_is_current", "platform_subscriptions", ["is_current"])
    op.create_index(
        "uq_platform_subscription_current_org",
        "platform_subscriptions",
        ["org_id"],
        unique=True,
        postgresql_where=sa.text("is_current = true"),
        sqlite_where=sa.text("is_current = 1"),
    )


def downgrade() -> None:
    op.drop_index("uq_platform_subscription_current_org", table_name="platform_subscriptions")
    op.drop_index("ix_platform_subscriptions_is_current", table_name="platform_subscriptions")
    op.drop_index("ix_platform_subscriptions_status", table_name="platform_subscriptions")
    op.drop_index("ix_platform_subscriptions_plan_code", table_name="platform_subscriptions")
    op.drop_index("ix_platform_subscriptions_org_id", table_name="platform_subscriptions")
    op.drop_table("platform_subscriptions")
