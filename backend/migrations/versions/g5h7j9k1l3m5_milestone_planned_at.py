"""STAGE 6G — Project milestone planned dates (Gantt timeline): Alembic revision.

Adds project_milestones.planned_at (nullable timestamptz). The column is
optional by design: the frontend timeline renders "no planned date" for NULL
rows rather than inventing one.

Revision ID: g5h7j9k1l3m5
Revises: c3d9e1f7a2b4
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'g5h7j9k1l3m5'
down_revision: Union[str, None] = 'c3d9e1f7a2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'project_milestones',
        sa.Column('planned_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('project_milestones', 'planned_at')
