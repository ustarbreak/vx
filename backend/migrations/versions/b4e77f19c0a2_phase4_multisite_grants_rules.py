"""Phase 4 — Multisite, grants de services et règles de supervision.

Revision ID: b4e77f19c0a2
Revises: a1b2c3d4e5f6
Create Date: 2026-10-25

Ajoute :
  organizations.org_type        HQ | SUBSIDIARY | AGENCY (structure multi-sites)
  organizations.parent_org_id   rattachement filiale -> headquarter
  table tenant_service_grants   override plateforme des services du plan
  table monitoring_rules        règles déclencheur -> condition -> action
Miroir exact des modèles SQLAlchemy app/models.py (TenantServiceGrant,
MonitoringRule) et des shapes servies par demoMode.ts.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b4e77f19c0a2'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Multi-site structure on organizations ---
    op.add_column('organizations', sa.Column('org_type', sa.String(length=16),
                                             nullable=False, server_default='HQ'))
    op.add_column('organizations', sa.Column('parent_org_id', sa.Integer(), nullable=True))
    op.create_index('ix_organizations_org_type', 'organizations', ['org_type'])
    op.create_foreign_key(
        'fk_org_parent', 'organizations', 'organizations',
        ['parent_org_id'], ['id'], ondelete='SET NULL')

    # --- Probe flag on discovered devices (machine hôte de l'agent) ---
    op.add_column('discovered_devices', sa.Column('is_probe', sa.Boolean(),
                                                  nullable=True, server_default=sa.false()))

    # --- Tenant service grants ---
    op.create_table(
        'tenant_service_grants',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('service_id', sa.String(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('override_plan', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('granted_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_tenant_service_grants_org_id', 'tenant_service_grants', ['org_id'])
    op.create_index('ix_tsg_org_service', 'tenant_service_grants', ['org_id', 'service_id'], unique=True)

    # --- Monitoring rules ---
    op.create_table(
        'monitoring_rules',
        sa.Column('id', sa.String(), primary_key=True),          # RUL-xxx
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=True, server_default='asset'),
        sa.Column('target_asset_id', sa.String(), nullable=True),
        sa.Column('trigger_metric', sa.String(), nullable=False),
        sa.Column('operator', sa.String(), nullable=True, server_default='>'),
        sa.Column('threshold', sa.String(), nullable=False),
        sa.Column('duration_min', sa.Integer(), nullable=True, server_default='5'),
        sa.Column('action', sa.String(), nullable=True, server_default='create_ticket'),
        sa.Column('ticket_priority', sa.String(), nullable=True, server_default='P3'),
        sa.Column('notify_channels', sa.JSON(), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_monitoring_rules_org_id', 'monitoring_rules', ['org_id'])


def downgrade() -> None:
    op.drop_index('ix_monitoring_rules_org_id', table_name='monitoring_rules')
    op.drop_table('monitoring_rules')
    op.drop_index('ix_tsg_org_service', table_name='tenant_service_grants')
    op.drop_index('ix_tenant_service_grants_org_id', table_name='tenant_service_grants')
    op.drop_table('tenant_service_grants')
    op.drop_column('discovered_devices', 'is_probe')
    op.drop_constraint('fk_org_parent', 'organizations', type_='foreignkey')
    op.drop_index('ix_organizations_org_type', table_name='organizations')
    op.drop_column('organizations', 'parent_org_id')
    op.drop_column('organizations', 'org_type')
