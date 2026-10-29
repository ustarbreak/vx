"""STAGE 5 — Rules-based triage: Alembic revision for scoring tables.

Creates triage_policies (versioned deterministic scoring policy) and
triage_evaluations (immutable audit history of evaluations). No data is
migrated; the v1 policy row is seeded idempotently at startup by
app.services.seed.ensure_triage_policy (same convention as Stage 3's
GroupingPolicy seed, which also had no revision).

Revision ID: b7d2f4a1c8e3
Revises: a3c5e7f9b1d2
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7d2f4a1c8e3'
down_revision: Union[str, None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'triage_policies',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('policy_version', sa.String(length=16), nullable=False),
        sa.Column('weights', sa.JSON(), nullable=True),
        sa.Column('bands', sa.JSON(), nullable=True),
        sa.Column('confidence_weights', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=True),
        sa.UniqueConstraint('policy_version', name='uq_triage_policy_version'),
    )
    op.create_index('ix_triage_policies_policy_version', 'triage_policies',
                    ['policy_version'])

    op.create_table(
        'triage_evaluations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'),
                  nullable=False),
        sa.Column('incident_uid', sa.String(), nullable=False),
        sa.Column('policy_version', sa.String(length=16), nullable=False),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('priority', sa.String(length=4), nullable=False),
        sa.Column('confidence', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('corroboration', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('reason_codes', sa.JSON(), nullable=True),
        sa.Column('breakdown', sa.JSON(), nullable=True),
        sa.Column('evaluator', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=True),
    )
    op.create_index('ix_triage_evaluations_org_id', 'triage_evaluations',
                    ['org_id'])
    op.create_index('ix_triage_evaluations_incident_uid', 'triage_evaluations',
                    ['incident_uid'])
    op.create_index('ix_triage_evaluations_created_at', 'triage_evaluations',
                    ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_triage_evaluations_created_at',
                  table_name='triage_evaluations')
    op.drop_index('ix_triage_evaluations_incident_uid',
                  table_name='triage_evaluations')
    op.drop_index('ix_triage_evaluations_org_id',
                  table_name='triage_evaluations')
    op.drop_table('triage_evaluations')
    op.drop_index('ix_triage_policies_policy_version',
                  table_name='triage_policies')
    op.drop_table('triage_policies')
