"""Reporting database models (Phase 1 of the Advanced Reporting integration).

All tables carry:
  * tenant_id   -> isolation (from JWT, never from a client parameter)
  * UTC stamps  -> created_at / recorded_at default now() atimezone.utc
  * source      -> origin system label kept internally only (brief §1 rule:
                   third-party tool names never reach client-facing output)
  * def_version -> KPI definition version stored with every computed figure
                   (brief §4 Phase 1 requirement)

Schema is created automatically by init_db() (Base.metadata.create_all);
the SQL migration for PostgreSQL lives in backend/migrations/002_reporting.sql.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, JSON,
)

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ReportingBase(Base):
    """Abstract mixin columns are declared inline per table (SQLAlchemy-core style)."""
    __abstract__ = True


# ------------------------------------------------------------ fact tables --
class RptAsset(ReportingBase):
    __tablename__ = "rpt_assets"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    asset_type = Column(String(32), nullable=False)       # endpoint/server/network/iot/cloud/saas
    name = Column(String(128), nullable=False)
    managed = Column(Boolean, default=False)
    monitored = Column(Boolean, default=False)
    agent_uptime_pct = Column(Float, nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="platform")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptAlert(ReportingBase):
    __tablename__ = "rpt_alerts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    severity = Column(String(16), nullable=False)         # crit/high/med/low
    category = Column(String(48), nullable=True)          # phishing/malware/...
    source_zone = Column(String(48), nullable=True)       # endpoints/servers/...
    rule_name = Column(String(128), nullable=True)
    attack_id = Column(String(16), nullable=True)         # ATT&CK Txxxx
    qualified = Column(Boolean, default=False)            # triaged ?
    false_positive = Column(Boolean, default=False)
    detected_at = Column(DateTime(timezone=True), nullable=True)
    first_event_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="platform")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptIncident(ReportingBase):
    __tablename__ = "rpt_incidents"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    ref = Column(String(32), nullable=False)              # INC-xxxx
    title = Column(String(255), nullable=False)
    severity = Column(String(16), nullable=False)
    status = Column(String(16), nullable=False)           # open/investigating/contained/closed
    category = Column(String(48), nullable=True)
    scope = Column(String(96), nullable=True)             # perimeter expose au client
    description = Column(Text, nullable=True)
    impact = Column(Text, nullable=True)
    detection_method = Column(String(96), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)   # debut reel activite
    detected_at = Column(DateTime(timezone=True), nullable=True)
    contained_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    auto_closed = Column(Boolean, default=False)          # clos sans action humaine
    human_minutes = Column(Float, nullable=True)
    source = Column(String(64), default="platform")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptVulnerability(ReportingBase):
    __tablename__ = "rpt_vulnerabilities"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    cve = Column(String(32), nullable=False)
    severity = Column(String(16), nullable=False)
    cvss = Column(Float, nullable=True)
    assets_affected = Column(Integer, default=1)
    perimeter = Column(String(48), nullable=True)
    exploited_in_wild = Column(Boolean, default=False)
    patch_available = Column(Boolean, default=True)
    found_at = Column(DateTime(timezone=True), nullable=True)
    fixed_at = Column(DateTime(timezone=True), nullable=True)
    sla_due_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="scanner")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptIOC(ReportingBase):
    __tablename__ = "rpt_iocs"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    ioc_type = Column(String(16), nullable=False)         # domain/ip/hash/url
    value = Column(String(255), nullable=False)
    confidence = Column(String(16), nullable=True)        # high/med/low
    feed_label = Column(String(64), nullable=True)        # categorie cliente-visible
    action = Column(String(32), nullable=True)            # blocked/watched
    seen_at = Column(DateTime(timezone=True), nullable=True)
    hits = Column(Integer, default=0)
    source = Column(String(64), default="intel")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptPlaybookRun(ReportingBase):
    __tablename__ = "rpt_playbook_runs"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    playbook = Column(String(128), nullable=False)
    trigger = Column(String(128), nullable=True)
    actions = Column(String(255), nullable=True)
    success = Column(Boolean, default=True)
    duration_s = Column(Float, nullable=True)
    manual_minutes_saved = Column(Float, nullable=True)   # temps manuel estime
    ran_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="soar")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptControl(ReportingBase):
    __tablename__ = "rpt_controls"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    framework = Column(String(24), nullable=False)        # RGPD/HIPAA/PCI-DSS/ISO27001/SOC2/NIS2/NIST
    ref = Column(String(32), nullable=False)              # Art. 33 / 10.4 / A-02 ...
    requirement = Column(String(255), nullable=False)
    control_name = Column(String(255), nullable=True)     # controle Infracentra
    status = Column(String(16), default="partial")        # compliant/partial/non_compliant
    risk = Column(String(16), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    validated_by = Column(String(96), nullable=True)      # validation humaine (Phase 7)
    validated_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="compliance")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptHypothesis(ReportingBase):
    __tablename__ = "rpt_hypotheses"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    ref = Column(String(16), nullable=False)              # H-01
    hypothesis = Column(String(255), nullable=False)
    attack_id = Column(String(16), nullable=True)
    result = Column(String(24), nullable=True)            # confirmed/refuted/inconclusive
    confidence = Column(String(16), nullable=True)
    tested_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="hunting")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


# --------------------------------------------------------- new-source tabs --
class RptTicketFact(ReportingBase):
    __tablename__ = "rpt_ticket_facts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    ref = Column(String(32), nullable=False)
    category = Column(String(48), nullable=True)
    priority = Column(String(16), nullable=True)
    status = Column(String(16), nullable=False)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    sla_breached = Column(Boolean, default=False)
    satisfaction = Column(Float, nullable=True)           # CSAT 1..5
    assignee = Column(String(96), nullable=True)
    source = Column(String(64), default="ticketing")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptPatch(ReportingBase):
    __tablename__ = "rpt_patches"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    name = Column(String(160), nullable=False)
    severity = Column(String(16), nullable=True)
    target_count = Column(Integer, default=0)
    applied_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    window = Column(String(48), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="patch-mgmt")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptBackup(ReportingBase):
    __tablename__ = "rpt_backups"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    system = Column(String(128), nullable=False)
    backup_type = Column(String(24), nullable=True)       # full/diff/incr/db/config
    size_gb = Column(Float, nullable=True)
    status = Column(String(16), nullable=False)           # ok/warn/fail
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    retention_days = Column(Integer, nullable=True)
    source = Column(String(64), default="backup")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptRestoreTest(ReportingBase):
    __tablename__ = "rpt_restore_tests"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    system = Column(String(128), nullable=False)
    rto_min = Column(Float, nullable=True)
    rpo_min = Column(Float, nullable=True)
    result = Column(String(16), nullable=True)            # passed/failed
    tested_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="backup")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptEmailStat(ReportingBase):
    __tablename__ = "rpt_email_stats"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    day = Column(String(10), nullable=False)              # YYYY-MM-DD (UTC)
    total_messages = Column(Integer, default=0)
    spam_blocked = Column(Integer, default=0)
    malware_blocked = Column(Integer, default=0)
    phishing_detected = Column(Integer, default=0)
    dmarc_pass_pct = Column(Float, nullable=True)
    quarantined = Column(Integer, default=0)
    released_fp = Column(Integer, default=0)
    source = Column(String(64), default="email-security")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptNetworkMetric(ReportingBase):
    __tablename__ = "rpt_network_metrics"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    device = Column(String(128), nullable=False)
    metric = Column(String(32), nullable=False)           # latency_ms/jitter_ms/packet_loss_pct/bw_util_pct/uptime_pct
    site = Column(String(64), nullable=True)
    avg_value = Column(Float, nullable=True)
    p95_value = Column(Float, nullable=True)
    peak_value = Column(Float, nullable=True)
    bucket = Column(String(10), nullable=False)           # YYYY-MM-DD or YYYY-MM
    source = Column(String(64), default="monitoring")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptEndpointHealth(ReportingBase):
    __tablename__ = "rpt_endpoint_health"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    total_endpoints = Column(Integer, default=0)
    protected = Column(Integer, default=0)                # AV actif + a jour
    outdated_agent = Column(Integer, default=0)
    quarantined_items = Column(Integer, default=0)
    detections = Column(Integer, default=0)
    disk_encrypted_pct = Column(Float, nullable=True)
    bucket = Column(String(10), nullable=False)
    source = Column(String(64), default="endpoint")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptUBAScore(ReportingBase):
    __tablename__ = "rpt_uba_scores"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    user_ref = Column(String(96), nullable=False)         # identifiant technique anonymise
    score = Column(Integer, default=0)                    # 0..100 deviation
    level = Column(String(16), nullable=True)             # low/medium/high
    factor = Column(String(96), nullable=True)            # facteur principal
    detail = Column(String(160), nullable=True)
    flagged_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="uba")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptAuditEvent(ReportingBase):
    __tablename__ = "rpt_audit_events"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    actor = Column(String(96), nullable=False)
    action = Column(String(48), nullable=False)           # login/create/delete/config_change/...
    object_ref = Column(String(128), nullable=True)
    severity = Column(String(16), default="info")         # info/warn/critical
    ip = Column(String(48), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="platform")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptExportLog(ReportingBase):
    __tablename__ = "rpt_export_logs"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    user_id = Column(String(64), nullable=False)
    report_id = Column(String(32), nullable=False)
    period = Column(String(7), nullable=False)
    fmt = Column(String(8), nullable=False)               # pdf/csv
    sha256 = Column(String(64), nullable=True)            # empreinte du fichier genere
    exported_at = Column(DateTime(timezone=True), default=_utcnow)


class RptConfigChange(ReportingBase):
    __tablename__ = "rpt_config_changelog"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    component = Column(String(64), nullable=False)
    change = Column(String(255), nullable=False)
    actor = Column(String(96), nullable=True)
    changed_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(64), default="platform")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptROIParameter(ReportingBase):
    """Financial assumptions — editable ONLY by platform admins (never client-side)."""
    __tablename__ = "rpt_roi_parameters"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    hourly_cost = Column(Float, default=65.0)             # cout analyste / h
    incident_avg_cost = Column(Float, default=18000.0)    # cout moyen d'un incident
    downtime_cost_hr = Column(Float, default=4500.0)
    insurance_base_pct = Column(Float, default=12.0)      # prime de base %
    insurance_discount_pct = Column(Float, default=18.0)  # remise apportee
    platform_cost_month = Column(Float, default=0.0)      # abonnement client
    updated_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_by = Column(String(96), nullable=True)


class RptRisk(ReportingBase):
    __tablename__ = "rpt_risks"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    ref = Column(String(16), nullable=False)
    title = Column(String(255), nullable=False)
    perimeter = Column(String(48), nullable=True)
    probability = Column(Integer, default=3)              # 1..5
    impact = Column(Integer, default=3)                   # 1..5
    level = Column(String(16), default="medium")          # derived crit/high/med/low
    owner = Column(String(96), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(16), default="open")           # open/mitigated/accepted
    mitigation = Column(String(255), nullable=True)
    source = Column(String(64), default="manual")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptActionItem(ReportingBase):
    __tablename__ = "rpt_action_items"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    ref = Column(String(16), nullable=False)              # A-01
    action = Column(String(255), nullable=False)
    priority = Column(String(8), default="P2")            # P1/P2/P3
    benefit = Column(String(128), nullable=True)
    effort = Column(String(16), nullable=True)            # Faible/Moyen/Eleve
    owner = Column(String(96), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(16), default="planned")        # planned/in_progress/done
    progress_pct = Column(Integer, default=0)
    horizon = Column(String(24), nullable=True)           # immediate/short/medium
    source = Column(String(64), default="manual")
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


class RptMessage(ReportingBase):
    """Key executive messages (human-entered, Phase 7)."""
    __tablename__ = "rpt_messages"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    period = Column(String(7), nullable=False)
    text = Column(Text, nullable=False)
    color = Column(String(4), default="1")                # block color code
    author = Column(String(96), nullable=True)
    recorded_at = Column(DateTime(timezone=True), default=_utcnow)


# ------------------------------------------------------------ aggregates --
class KpiDaily(ReportingBase):
    __tablename__ = "rpt_kpi_daily"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    day = Column(String(10), nullable=False)              # YYYY-MM-DD UTC
    kpi = Column(String(48), nullable=False)
    value = Column(Float, nullable=False)
    unit = Column(String(16), nullable=True)
    def_version = Column(String(16), default="v1")
    source = Column(String(64), default="job:H")
    computed_at = Column(DateTime(timezone=True), default=_utcnow)


class KpiMonthly(ReportingBase):
    __tablename__ = "rpt_kpi_monthly"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    month = Column(String(7), nullable=False)             # YYYY-MM
    kpi = Column(String(48), nullable=False)
    value = Column(Float, nullable=False)
    unit = Column(String(16), nullable=True)
    prev_value = Column(Float, nullable=True)
    def_version = Column(String(16), default="v1")
    frozen = Column(Boolean, default=False)               # job M fige le mois precedent
    source = Column(String(64), default="job:J")
    computed_at = Column(DateTime(timezone=True), default=_utcnow)


class PlatformMetric(ReportingBase):
    __tablename__ = "rpt_platform_metrics"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), index=True, nullable=False)
    bucket = Column(String(10), nullable=False)
    availability_pct = Column(Float, nullable=True)
    ingestion_eps = Column(Float, nullable=True)
    collect_latency_s = Column(Float, nullable=True)
    query_p95_s = Column(Float, nullable=True)
    connectors_total = Column(Integer, nullable=True)
    connectors_up = Column(Integer, nullable=True)
    storage_used_pct = Column(Float, nullable=True)
    compute_used_pct = Column(Float, nullable=True)
    memory_used_pct = Column(Float, nullable=True)
    network_used_pct = Column(Float, nullable=True)
    retention_months = Column(Integer, nullable=True)
    encryption_ok = Column(Boolean, default=True)
    mfa_enforced = Column(Boolean, default=True)
    audit_logged = Column(Boolean, default=True)
    def_version = Column(String(16), default="v1")
    source = Column(String(64), default="job:H")
    computed_at = Column(DateTime(timezone=True), default=_utcnow)
