"""pricing v2 tables: leads, quote links, quotes, health checks, deals, entitlements, upsell

Revision ID: d2a4e6f8b0c1
Revises: c9f0a1b2c3d4
Create Date: 2026-10-26

Single source of truth for prices stays in app/core/pricing_config.json
(canonical JSON mirror of src/data/pricingConfig.ts);
these tables only store business objects (leads, links, trials, deals, events).
Quote-link and enrollment-key secrets are stored as SHA-256 hashes ONLY.
"""
from typing import Union
import sqlalchemy as sa
from alembic import op

revision = 'd2a4e6f8b0c1'
down_revision = 'c9f0a1b2c3d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # organizations: trial flags for the free Security Health Check
    with op.batch_alter_table('organizations') as batch:
        batch.add_column(sa.Column('trial', sa.Boolean(), nullable=True, server_default=sa.false()))
        batch.add_column(sa.Column('trial_expires_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('grace_until', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'pricing_config_versions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('version', sa.String(16), nullable=False, unique=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_pcv_version', 'pricing_config_versions', ['version'])

    op.create_table(
        'pricing_leads',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('company', sa.String(200), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('email', sa.String(200), nullable=False),
        sa.Column('phone', sa.String(40)),
        sa.Column('country', sa.String(60)),
        sa.Column('lang', sa.String(8), server_default='fr'),
        sa.Column('asset_counts', sa.Text()),
        sa.Column('interests', sa.Text()),
        sa.Column('message', sa.Text()),
        sa.Column('contact_prefs', sa.Text()),
        sa.Column('consent', sa.Boolean(), server_default=sa.false()),
        sa.Column('status', sa.String(16), server_default='new'),
        sa.Column('assigned_to', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_pl_email', 'pricing_leads', ['email'])
    op.create_index('ix_pl_status', 'pricing_leads', ['status'])

    op.create_table(
        'quote_links',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('lead_id', sa.Integer(), sa.ForeignKey('pricing_leads.id'), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('prefill', sa.Text()),
        sa.Column('lock_email', sa.String(200), nullable=True),
        sa.Column('max_extra_discount', sa.String(8), server_default='0.05'),
        sa.Column('view_count', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_ql_hash', 'quote_links', ['token_hash'])

    op.create_table(
        'quotes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('number', sa.String(24), nullable=False, unique=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('lead_id', sa.Integer(), sa.ForeignKey('pricing_leads.id'), nullable=True),
        sa.Column('partner_id', sa.Integer(), nullable=True),
        sa.Column('mode', sa.String(8), nullable=False),
        sa.Column('inputs', sa.Text(), nullable=False),
        sa.Column('result', sa.Text(), nullable=False),
        sa.Column('extra_discount', sa.String(16), server_default='0'),
        sa.Column('discount_reason', sa.String(300)),
        sa.Column('config_version', sa.String(16), nullable=False),
        sa.Column('pdf_hash', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_q_number', 'quotes', ['number'])

    op.create_table(
        'health_checks',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('company', sa.String(200), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('email', sa.String(200), nullable=False),
        sa.Column('phone', sa.String(40)),
        sa.Column('country', sa.String(60)),
        sa.Column('consent', sa.Boolean(), server_default=sa.false()),
        sa.Column('email_domain', sa.String(200), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('enrollment_key_hash', sa.String(64), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('grace_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('purged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(16), server_default='active'),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('report_pdf_hash', sa.String(64), nullable=True),
        sa.Column('created_by_partner_id', sa.Integer(), nullable=True),
        sa.Column('units_at_conversion', sa.String(16), nullable=True),
        sa.Column('recommended_pack', sa.String(16), nullable=True),
    )
    op.create_index('ix_hc_domain', 'health_checks', ['email_domain'])
    op.create_index('ix_hc_status', 'health_checks', ['status'])

    op.create_table(
        'partner_deal_registrations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('partner_org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('prospect_company', sa.String(200), nullable=False),
        sa.Column('prospect_email', sa.String(200)),
        sa.Column('expected_units', sa.String(16)),
        sa.Column('pack', sa.String(16)),
        sa.Column('status', sa.String(16), server_default='registered'),
        sa.Column('conflict_note', sa.String(300)),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_pdr_partner', 'partner_deal_registrations', ['partner_org_id'])
    op.create_index('ix_pdr_status', 'partner_deal_registrations', ['status'])

    op.create_table(
        'plan_entitlements_v2',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('plan', sa.String(16), nullable=False),
        sa.Column('service_id', sa.String(32), nullable=False),
        sa.Column('included', sa.Boolean(), server_default=sa.true()),
        sa.Column('min_units', sa.Integer(), server_default='0'),
        sa.UniqueConstraint('plan', 'service_id', name='uq_plan_service_v2'),
    )
    op.create_index('ix_pev2_plan', 'plan_entitlements_v2', ['plan'])

    op.create_table(
        'upsell_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('trigger', sa.String(32), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('action', sa.String(16), server_default='shown'),
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_ue_org', 'upsell_events', ['org_id'])


def downgrade() -> None:
    for t in ('upsell_events', 'plan_entitlements_v2', 'partner_deal_registrations',
              'health_checks', 'quotes', 'quote_links', 'pricing_leads',
              'pricing_config_versions'):
        op.drop_table(t)
    with op.batch_alter_table('organizations') as batch:
        batch.drop_column('grace_until')
        batch.drop_column('trial_expires_at')
        batch.drop_column('trial')
