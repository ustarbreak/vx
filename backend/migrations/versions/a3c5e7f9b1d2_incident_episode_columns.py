"""Incident episode lifecycle columns (Stage 4).

Backs the incident recurrence / episode design:
  * incidents.recurrence_of_uid — uid of the previous episode in the chain
    (nullable; set when a new episode is opened after a resolved one)
  * incidents.episode_number    — 1-based position within the recurrence chain
  * Indexes on both columns for chain traversal.
  * uq_incident_active_episode  — PARTIAL unique index enforcing at most one
    active (not resolved/closed) episode per (org_id, dedup_key). This is the
    concurrency guard used by services/incidents.py via
        INSERT ... ON CONFLICT (org_id, dedup_key)
        WHERE status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL
        DO NOTHING
    The postgresql_where clause below MUST stay byte-identical to that ON
    CONFLICT target so Postgres can infer the partial index.

Revision ID: a3c5e7f9b1d2
Revises: f1b3d5e7a9c2
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3c5e7f9b1d2'
down_revision: Union[str, None] = 'f1b3d5e7a9c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'incidents',
        sa.Column('recurrence_of_uid', sa.String(), nullable=True),
    )
    op.create_index(
        op.f('ix_incidents_recurrence_of_uid'),
        'incidents', ['recurrence_of_uid'], unique=False,
    )
    op.add_column(
        'incidents',
        sa.Column('episode_number', sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f('ix_incidents_episode_number'),
        'incidents', ['episode_number'], unique=False,
    )
    # Partial unique index: one active episode per (org_id, dedup_key).
    # NOTE: the WHERE clause here must remain byte-identical to the ON
    # CONFLICT target in app/services/incidents.py for index inference.
    op.create_index(
        'uq_incident_active_episode',
        'incidents',
        ['org_id', 'dedup_key'],
        unique=True,
        postgresql_where=sa.text("status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index('uq_incident_active_episode', table_name='incidents')
    op.drop_index(op.f('ix_incidents_episode_number'), table_name='incidents')
    op.drop_column('incidents', 'episode_number')
    op.drop_index(op.f('ix_incidents_recurrence_of_uid'), table_name='incidents')
    op.drop_column('incidents', 'recurrence_of_uid')
