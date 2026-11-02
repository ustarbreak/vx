"""Partner Program — organizations.is_partner flag + partner columns.

Phase 1 of the Partner Portal backend (routers/partners.py): partner identity
lives on the organizations row (end-clients = orgs with parent_org_id == the
partner org). No separate `partners` table — minimal architecture, reuses the
multi-site columns added by b4e77f19c0a2.

Revision ID: i9j1k3m5n7o9
Revises: g5h7j9k1l3m5
Create Date: 2026-11-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'i9j1k3m5n7o9'
down_revision: Union[str, None] = 'g5h7j9k1l3m5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('organizations', sa.Column('is_partner', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('organizations', sa.Column('partner_code', sa.String(length=16), nullable=True))
    op.add_column('organizations', sa.Column('partner_tier_override', sa.String(length=16), nullable=True))
    op.add_column('organizations', sa.Column('support_sla', sa.String(length=200), nullable=True))
    op.create_index('ix_organizations_is_partner', 'organizations', ['is_partner'])


def downgrade() -> None:
    op.drop_index('ix_organizations_is_partner', table_name='organizations')
    op.drop_column('organizations', 'support_sla')
    op.drop_column('organizations', 'partner_tier_override')
    op.drop_column('organizations', 'partner_code')
    op.drop_column('organizations', 'is_partner')
