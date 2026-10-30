"""Device endpoint-action ledger: device_actions table.

Backs the Infrastructure graph action buttons (backup / remote access /
shutdown / isolate). Requests are recorded honestly: `queued` when an
enrolled agent can deliver them, `manual` when routed to a technician via
the ticketing engine. Never simulates execution.

Revision ID: h8i0j2k4l6m8
Revises: a3c5e7f9b1d2
Create Date: 2026-10-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'h8i0j2k4l6m8'
down_revision: Union[str, None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'device_actions',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('uid', sa.String(), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('device_id', sa.Integer(), sa.ForeignKey('discovered_devices.id'), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('mode', sa.String(), nullable=False, server_default='execute'),
        sa.Column('status', sa.String(), nullable=False, server_default='queued'),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('detail', sa.JSON(), nullable=True),
        sa.Column('ticket_uid', sa.String(), nullable=True),
        sa.Column('requested_by', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_device_actions_uid', 'device_actions', ['uid'], unique=True)
    op.create_index('ix_device_actions_org_id', 'device_actions', ['org_id'])
    op.create_index('ix_device_actions_device_id', 'device_actions', ['device_id'])
    op.create_index('ix_device_actions_status', 'device_actions', ['status'])
    op.create_index('ix_device_actions_ticket_uid', 'device_actions', ['ticket_uid'])


def downgrade() -> None:
    op.drop_table('device_actions')
