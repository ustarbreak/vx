"""Discovery scan authorization & site binding columns.

Backs the Infrastructure Map / Auto Discovery completion:
  * discovery_scans.site_id        — approved site (org hierarchy id) targeted
  * discovery_scans.authorized     — explicit operator scope consent at launch
  * discovery_scans.authorization_note — free-text audit note (ticket ref etc.)

Revision ID: f1b3d5e7a9c2
Revises: e7a9c1d3f5b8
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f1b3d5e7a9c2'
down_revision: Union[str, None] = 'e7a9c1d3f5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('discovery_scans', sa.Column('site_id', sa.Integer(), nullable=True))
    op.add_column('discovery_scans', sa.Column('authorized', sa.Boolean(), nullable=True, server_default=sa.false()))
    op.add_column('discovery_scans', sa.Column('authorization_note', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('discovery_scans', 'authorization_note')
    op.drop_column('discovery_scans', 'authorized')
    op.drop_column('discovery_scans', 'site_id')
