"""Preserve incident evidence reference details.

Revision ID: j2k4l6m8n0p2
Revises: i9j1k3m5n7o9
Create Date: 2026-11-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "j2k4l6m8n0p2"
down_revision: Union[str, None] = "i9j1k3m5n7o9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("incident_evidence", sa.Column("detail", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("incident_evidence", "detail")
