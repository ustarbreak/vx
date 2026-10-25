"""bundle all-in-one pricing columns on organizations

Revision ID: a1b2c3d4e5f6
Revises: None (baseline for billing columns)
Create Date: 2026-10-25

Adds the "Bundle All-in-One" billing fields to `organizations`:
  plan_tier        STARTER | PRO | SOUVERAIN
  endpoint_count   number of managed endpoints (billing unit)
  seat_limit       included technician seats (0 = unlimited / Souverain)
  siem_limit_gb    included SIEM ingestion GB/day
  billing_cycle    MONTHLY | ANNUAL (-12 %)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('organizations', sa.Column('plan_tier', sa.String(length=16), nullable=False,
                                             server_default='STARTER'))
    op.add_column('organizations', sa.Column('endpoint_count', sa.Integer(), nullable=False,
                                             server_default='0'))
    op.add_column('organizations', sa.Column('seat_limit', sa.Integer(), nullable=False,
                                             server_default='3'))
    op.add_column('organizations', sa.Column('siem_limit_gb', sa.Integer(), nullable=False,
                                             server_default='10'))
    op.add_column('organizations', sa.Column('billing_cycle', sa.String(length=8), nullable=False,
                                             server_default='MONTHLY'))
    op.create_index(op.f('ix_organizations_plan_tier'), 'organizations', ['plan_tier'])

    # Backfill existing rows from legacy `tier` values so nothing breaks.
    op.execute("""
        UPDATE organizations SET
          plan_tier = CASE lower(tier)
                        WHEN 'enterprise' THEN 'SOUVERAIN'
                        WHEN 'mid-market' THEN 'PRO'
                        ELSE 'STARTER' END,
          seat_limit = CASE lower(tier)
                        WHEN 'enterprise' THEN 0
                        WHEN 'mid-market' THEN 20
                        ELSE 3 END,
          siem_limit_gb = CASE lower(tier)
                        WHEN 'enterprise' THEN 150
                        WHEN 'mid-market' THEN 50
                        ELSE 10 END
    """)


def downgrade() -> None:
    op.drop_index(op.f('ix_organizations_plan_tier'), table_name='organizations')
    op.drop_column('organizations', 'billing_cycle')
    op.drop_column('organizations', 'siem_limit_gb')
    op.drop_column('organizations', 'seat_limit')
    op.drop_column('organizations', 'endpoint_count')
    op.drop_column('organizations', 'plan_tier')
