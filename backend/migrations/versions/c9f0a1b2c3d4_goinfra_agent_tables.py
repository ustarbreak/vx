"""goinfra agent tables: probes, inventories, metrics, tokens, agent discovery

Revision ID: c9f0a1b2c3d4
Revises: b4e77f19c0a2
Create Date: 2026-10-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c9f0a1b2c3d4'
down_revision: Union[str, None] = 'b4e77f19c0a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'agent_probes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('hostname', sa.String(), nullable=False),
        sa.Column('agent_version', sa.String(), nullable=True),
        sa.Column('os', sa.String(), nullable=True),
        sa.Column('ip', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=True, server_default='online'),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_agent_probes_org_id', 'agent_probes', ['org_id'])
    op.create_index('uq_agent_probe_org_host', 'agent_probes', ['org_id', 'hostname'], unique=True)

    op.create_table(
        'agent_inventories',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('probe_id', sa.Integer(), sa.ForeignKey('agent_probes.id'), nullable=False),
        sa.Column('org_id', sa.Integer(), nullable=False),
        sa.Column('collected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_agent_inventories_probe_id', 'agent_inventories', ['probe_id'])
    op.create_index('ix_agent_inventories_org_id', 'agent_inventories', ['org_id'])

    op.create_table(
        'agent_metrics',
        sa.Column('ts', sa.BigInteger(), primary_key=True),
        sa.Column('probe_id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), nullable=False),
        sa.Column('cpu_percent', sa.Float(), nullable=True),
        sa.Column('mem_used_percent', sa.Float(), nullable=True),
        sa.Column('mem_total_bytes', sa.BigInteger(), nullable=True),
        sa.Column('disk_worst_percent', sa.Float(), nullable=True),
        sa.Column('load1', sa.Float(), nullable=True),
        sa.Column('net_recv_bps', sa.Float(), nullable=True),
        sa.Column('net_sent_bps', sa.Float(), nullable=True),
        sa.Column('temp_max_celsius', sa.Float(), nullable=True),
    )
    op.create_index('ix_agent_metrics_probe_id', 'agent_metrics', ['probe_id'])
    op.create_index('ix_agent_metrics_org_id', 'agent_metrics', ['org_id'])

    op.create_table(
        'agent_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('prefix', sa.String(12), nullable=False),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_agent_tokens_org_id', 'agent_tokens', ['org_id'])
    op.create_index('ix_agent_tokens_token_hash', 'agent_tokens', ['token_hash'], unique=True)

    op.create_table(
        'agent_discovered_devices',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('probe_id', sa.Integer(), sa.ForeignKey('agent_probes.id'), nullable=False),
        sa.Column('ip', sa.String(), nullable=False),
        sa.Column('mac', sa.String(), nullable=True),
        sa.Column('hostname', sa.String(), nullable=True),
        sa.Column('os_guess', sa.String(), nullable=True),
        sa.Column('device_type', sa.String(), nullable=True),
        sa.Column('open_ports', sa.JSON(), nullable=True),
        sa.Column('sys_name', sa.String(), nullable=True),
        sa.Column('sys_desc', sa.String(), nullable=True),
        sa.Column('first_seen', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('imported', sa.Boolean(), nullable=True, server_default=sa.false()),
    )
    op.create_index('ix_agent_disc_org_id', 'agent_discovered_devices', ['org_id'])
    op.create_index('ix_agent_disc_probe_id', 'agent_discovered_devices', ['probe_id'])
    op.create_index('ix_agent_disc_ip', 'agent_discovered_devices', ['ip'])
    op.create_index('uq_agent_disc_org_ip', 'agent_discovered_devices', ['org_id', 'ip'], unique=True)

    op.create_table(
        'tenant_settings',
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), primary_key=True),
        sa.Column('data', sa.JSON(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('tenant_settings')
    op.drop_table('agent_discovered_devices')
    op.drop_table('agent_tokens')
    op.drop_table('agent_metrics')
    op.drop_table('agent_inventories')
    op.drop_table('agent_probes')
