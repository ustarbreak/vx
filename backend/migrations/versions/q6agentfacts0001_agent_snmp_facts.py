"""Persist structured SNMP facts reported by Go infrastructure agents.

Revision ID: q6agentfacts0001
Revises: p5report000001
"""
from alembic import op
import sqlalchemy as sa

revision = "q6agentfacts0001"
down_revision = "p5report000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_discovered_devices",
        sa.Column("snmp_facts", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_discovered_devices", "snmp_facts")
