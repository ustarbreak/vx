"""STAGE 6A — Structured outcome labeling: Alembic revision.

Creates outcome_labels (append-only analyst ground-truth history for ML
readiness). No data is migrated and no existing table is modified: prior
triage snapshots (triage_evaluations) and all historical rows are untouched.

Revision ID: c3d9e1f7a2b4
Revises: b7d2f4a1c8e3
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3d9e1f7a2b4'
down_revision: Union[str, None] = 'b7d2f4a1c8e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'outcome_labels',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'),
                  nullable=False),
        sa.Column('incident_uid', sa.String(), nullable=False),
        sa.Column('disposition', sa.String(), nullable=False),
        sa.Column('priority_correctness', sa.String(), nullable=False),
        sa.Column('priority_labeled_at', sa.String(), nullable=True),
        sa.Column('rationale', sa.Text(), nullable=True),
        sa.Column('reviewer', sa.String(), nullable=True),
        sa.Column('labeled_by', sa.String(), nullable=False),
        sa.Column('supersedes_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=True),
    )
    op.create_index('ix_outcome_labels_org_id', 'outcome_labels', ['org_id'])
    op.create_index('ix_outcome_labels_incident_uid', 'outcome_labels',
                    ['incident_uid'])
    op.create_index('ix_outcome_labels_supersedes_id', 'outcome_labels',
                    ['supersedes_id'])
    op.create_index('ix_outcome_labels_created_at', 'outcome_labels',
                    ['created_at'])


def downgrade() -> None:
    # Drop only what Stage 6A added; triage tables/incidents are untouched.
    op.drop_index('ix_outcome_labels_created_at', table_name='outcome_labels')
    op.drop_index('ix_outcome_labels_supersedes_id', table_name='outcome_labels')
    op.drop_index('ix_outcome_labels_incident_uid', table_name='outcome_labels')
    op.drop_index('ix_outcome_labels_org_id', table_name='outcome_labels')
    op.drop_table('outcome_labels')
