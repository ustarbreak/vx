"""Append-only, idempotent tenant usage metering events."""
from alembic import op
import sqlalchemy as sa

revision = "p4usage000001"
down_revision = "p3vuln000001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("metric", sa.String(32), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("unit", sa.String(24), nullable=False),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("org_id", "idempotency_key", name="uq_usage_event_org_idempotency"),
    )
    op.create_index("ix_usage_event_org_metric_time", "usage_events", ["org_id", "metric", "occurred_at"])


def downgrade():
    op.drop_index("ix_usage_event_org_metric_time", table_name="usage_events")
    op.drop_table("usage_events")
