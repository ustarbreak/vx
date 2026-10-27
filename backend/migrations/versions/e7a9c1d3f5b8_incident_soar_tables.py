"""Incident Response & SOAR tables: incidents, notes, activities, evidence,
actions + persisted playbooks and real execution history.

These tables back the two pages that previously had no real persistence:
  * incident list/detail (lifecycle, ownership, dedup, audit trail)
  * SOAR workflows (playbook inventory, runs with step-level states)

They only REFERENCE existing engine records (alerts.id, ticket uid,
organization ids) — no SIEM/detection/alerting data is copied or rebuilt.

Revision ID: e7a9c1d3f5b8
Revises: d2a4e6f8b0c1
Create Date: 2026-10-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e7a9c1d3f5b8'
down_revision: Union[str, None] = 'd2a4e6f8b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'incidents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('uid', sa.String(), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('site_org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('severity', sa.String(), nullable=True, server_default='medium'),
        sa.Column('status', sa.String(), nullable=True, server_default='open'),
        sa.Column('assignee', sa.String(), nullable=True),
        sa.Column('reporter', sa.String(), nullable=True),
        sa.Column('acknowledged_by', sa.String(), nullable=True),
        sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('affected_assets', sa.JSON(), nullable=True),
        sa.Column('ioc_related', sa.JSON(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('alert_id', sa.Integer(), sa.ForeignKey('alerts.id'), nullable=True),
        sa.Column('ticket_uid', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=True, server_default='other'),
        sa.Column('dedup_key', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_incidents_uid', 'incidents', ['uid'], unique=True)
    op.create_index('ix_incidents_org_id', 'incidents', ['org_id'])
    op.create_index('ix_incidents_site_org_id', 'incidents', ['site_org_id'])
    op.create_index('ix_incidents_status', 'incidents', ['status'])
    op.create_index('ix_incidents_alert_id', 'incidents', ['alert_id'])
    op.create_index('ix_incidents_ticket_uid', 'incidents', ['ticket_uid'])
    op.create_index('ix_incidents_dedup_key', 'incidents', ['dedup_key'])
    op.create_index('ix_incidents_created_at', 'incidents', ['created_at'])

    op.create_table(
        'incident_notes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('incident_uid', sa.String(), nullable=False),
        sa.Column('author', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('internal', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_incident_notes_incident_uid', 'incident_notes', ['incident_uid'])

    op.create_table(
        'incident_activities',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('incident_uid', sa.String(), nullable=False),
        sa.Column('actor', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('from_value', sa.String(), nullable=True),
        sa.Column('to_value', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_incident_activities_incident_uid', 'incident_activities', ['incident_uid'])

    op.create_table(
        'incident_evidence',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('incident_uid', sa.String(), nullable=False),
        sa.Column('ticket_uid', sa.String(), nullable=True),
        sa.Column('ticket_evidence_id', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(), nullable=True, server_default='log'),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('sha256', sa.String(), nullable=True),
        sa.Column('collected_by', sa.String(), nullable=True, server_default='system'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_incident_evidence_incident_uid', 'incident_evidence', ['incident_uid'])
    op.create_index('ix_incident_evidence_ticket_uid', 'incident_evidence', ['ticket_uid'])

    op.create_table(
        'incident_actions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('incident_uid', sa.String(), nullable=False),
        sa.Column('action_type', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=True, server_default='completed'),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('performed_by', sa.String(), nullable=False),
        sa.Column('playbook_run_uid', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_incident_actions_incident_uid', 'incident_actions', ['incident_uid'])
    op.create_index('ix_incident_actions_playbook_run_uid', 'incident_actions', ['playbook_run_uid'])

    op.create_table(
        'soar_playbooks',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('uid', sa.String(), nullable=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=True, server_default='Incident Response'),
        sa.Column('steps', sa.JSON(), nullable=True),
        sa.Column('triggers', sa.JSON(), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_soar_playbooks_uid', 'soar_playbooks', ['uid'], unique=True)
    op.create_index('ix_soar_playbooks_org_id', 'soar_playbooks', ['org_id'])

    op.create_table(
        'soar_playbook_runs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('uid', sa.String(), nullable=False),
        sa.Column('playbook_id', sa.Integer(), sa.ForeignKey('soar_playbooks.id'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('incident_uid', sa.String(), nullable=True),
        sa.Column('mode', sa.String(), nullable=True, server_default='simulate'),
        sa.Column('status', sa.String(), nullable=True, server_default='queued'),
        sa.Column('triggered_by', sa.String(), nullable=False),
        sa.Column('idempotency_key', sa.String(), nullable=True),
        sa.Column('cancel_requested', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('total_steps', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('completed_steps', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('failed_steps', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('skipped_steps', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('result_log', sa.JSON(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_soar_playbook_runs_uid', 'soar_playbook_runs', ['uid'], unique=True)
    op.create_index('ix_soar_playbook_runs_playbook_id', 'soar_playbook_runs', ['playbook_id'])
    op.create_index('ix_soar_playbook_runs_org_id', 'soar_playbook_runs', ['org_id'])
    op.create_index('ix_soar_playbook_runs_incident_uid', 'soar_playbook_runs', ['incident_uid'])
    op.create_index('ix_soar_playbook_runs_status', 'soar_playbook_runs', ['status'])
    op.create_index('ix_soar_playbook_runs_idempotency_key', 'soar_playbook_runs', ['idempotency_key'])


def downgrade() -> None:
    for tbl in ('soar_playbook_runs', 'soar_playbooks',
                'incident_actions', 'incident_evidence',
                'incident_activities', 'incident_notes', 'incidents'):
        op.drop_table(tbl)
