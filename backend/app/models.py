from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    tier = Column(String, nullable=False)  # sme, mid-market, enterprise
    status = Column(String, default="active")  # active, suspended, pending
    contact_email = Column(String, nullable=False)
    contact_phone = Column(String)
    industry = Column(String)
    country = Column(String)
    member_count = Column(Integer, default=0)
    asset_count = Column(Integer, default=0)
    # --- Bundle All-in-One billing (single source of truth: app.core.pricing) ---
    plan_tier = Column(String(16), nullable=False, default="STARTER", index=True)  # STARTER|PRO|SOUVERAIN
    endpoint_count = Column(Integer, nullable=False, default=0)
    seat_limit = Column(Integer, nullable=False, default=3)      # 0 = unlimited
    siem_limit_gb = Column(Integer, nullable=False, default=10)  # GB/day included
    billing_cycle = Column(String(8), nullable=False, default="MONTHLY")  # MONTHLY|ANNUAL
    # --- Multi-site structure (Phase 4): headquarter / subsidiary / agency ---
    org_type = Column(String(16), nullable=False, default="HQ", index=True)  # HQ|SUBSIDIARY|AGENCY
    parent_org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    risk_score = Column(Integer, default=0)
    compliance_score = Column(Integer, default=0)
    contract_start = Column(DateTime)
    contract_end = Column(DateTime)
    monthly_revenue = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    users = relationship("User", back_populates="organization")
    entitlements = relationship("Entitlement", back_populates="organization")
    audit_logs = relationship("AuditLog", back_populates="organization")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # platform_admin, client_admin, client_user
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    status = Column(String, default="active")
    mfa_enabled = Column(Boolean, default=False)
    last_login = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    organization = relationship("Organization", back_populates="users")


class Entitlement(Base):
    __tablename__ = "entitlements"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    service_id = Column(String, nullable=False)
    enabled = Column(Boolean, default=False)
    seat_count = Column(Integer, default=0)
    activated_at = Column(DateTime(timezone=True))
    deactivated_at = Column(DateTime(timezone=True))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    organization = relationship("Organization", back_populates="entitlements")


class Integration(Base):
    __tablename__ = "integrations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    service_id = Column(String, nullable=False)
    integration_type = Column(String, nullable=False)  # api, webhook, agent, native
    status = Column(String, default="inactive")  # active, inactive, pending
    license_type = Column(String, nullable=False)  # open-source, commercial, freemium
    pricing = Column(String, nullable=False)  # free, paid, custom
    api_key = Column(String)
    api_endpoint = Column(String)
    documentation_url = Column(String)
    last_sync = Column(DateTime(timezone=True))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_name = Column(String, nullable=False)
    actor_role = Column(String, nullable=False)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    action = Column(String, nullable=False)
    resource = Column(String, nullable=False)
    resource_id = Column(String, nullable=False)
    details = Column(Text)
    ip_address = Column(String)
    outcome = Column(String, nullable=False)  # success, failure, blocked
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    organization = relationship("Organization", back_populates="audit_logs")


# ============================================================================
# Advanced Ticketing System (Service A)
# ============================================================================

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String, unique=True, index=True, nullable=False)   # e.g. TCK-000123
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    status = Column(String, default="new")      # new|triage|open|in_progress|pending_vendor|escalated|awaiting_approval|resolved|closed
    priority = Column(String, default="p3")     # p1|p2|p3|p4
    category = Column(String, default="other")  # incident|service_request|problem|change|vulnerability|other
    source = Column(String, default="manual")   # manual|alert|api|email|discovery
    assignee = Column(String, nullable=True)
    reporter = Column(String, nullable=True)
    tags = Column(JSON, default=list)
    asset = Column(String, nullable=True)       # hostname / IP link
    vulnerability_ref = Column(String, nullable=True)  # CVE tracking

    # AI-assisted classification & prioritization
    ai_category = Column(String, nullable=True)
    ai_priority = Column(String, nullable=True)
    ai_confidence = Column(Integer, nullable=True)
    ai_reasoning = Column(JSON, default=list)
    ai_predicted_root_cause = Column(String, nullable=True)
    duplicate_of = Column(String, nullable=True)
    triaged_at = Column(DateTime(timezone=True), nullable=True)

    # SLA
    sla_response_minutes = Column(Integer, nullable=True)
    sla_resolution_minutes = Column(Integer, nullable=True)
    due_response_at = Column(DateTime(timezone=True), nullable=True)
    due_resolve_at = Column(DateTime(timezone=True), nullable=True)
    first_response_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    escalation_level = Column(Integer, default=0)

    # Link to originating alert (automation from Notification Engine)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class TicketEvidence(Base):
    """Evidence vault — immutable-style records attached to tickets.

    Two flavours:
      * text evidence  → `content` holds the pasted text/log/config;
      * file attachment (image / PDF / config / txt…) → `file_blob` holds the
        bytes (base64), `mime_type` the declared type; `content` keeps a small
        preview for text files. The SHA-256 fingerprint covers whichever payload
        was provided, so integrity checks work for both kinds.
    """
    __tablename__ = "ticket_evidence"

    id = Column(Integer, primary_key=True, index=True)
    ticket_uid = Column(String, index=True, nullable=False)
    kind = Column(String, default="log")        # log|screenshot|pcap|hash|report|email|config|pdf|image|file|note
    name = Column(String, nullable=False)
    content = Column(Text, default="")
    file_blob = Column(Text, nullable=True)     # base64 of the uploaded bytes
    mime_type = Column(String(120), nullable=True)
    size_kb = Column(Integer, default=0)
    sha256 = Column(String, nullable=False)     # fingerprint (immutable-style)
    collected_by = Column(String, default="system")
    immutable = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TicketAuditEntry(Base):
    """Hash-chained audit history per ticket (tamper-evident)."""
    __tablename__ = "ticket_audit_entries"

    id = Column(Integer, primary_key=True, index=True)
    ticket_uid = Column(String, index=True, nullable=False)
    seq = Column(Integer, nullable=False)
    actor = Column(String, nullable=False)
    action = Column(String, nullable=False)
    detail = Column(Text, default="")
    prev_hash = Column(String, default="0" * 24)
    entry_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TicketApproval(Base):
    """Approval workflow for evidence-based closure."""
    __tablename__ = "ticket_approvals"

    id = Column(Integer, primary_key=True, index=True)
    ticket_uid = Column(String, index=True, nullable=False)
    step = Column(Integer, default=1)
    approver_role = Column(String, default="client_admin")
    status = Column(String, default="pending")  # pending|approved|rejected
    note = Column(Text, default="")
    decided_by = Column(String, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ============================================================================
# Notification & Event Intelligence Engine (Service B)
# ============================================================================

class Alert(Base):
    """Inbound security/monitoring event. Triggers notification rules and,
    when configured, automatically creates tickets."""
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String, unique=True, index=True, nullable=False)   # ALR-000123
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    severity = Column(String, default="medium")   # critical|high|medium|low|info
    source = Column(String, default="siem")       # siem|wazuh|snmp|syslog|api|nmap|manual
    resource = Column(String, nullable=True)      # affected host/device
    raw_payload = Column(JSON, default=dict)
    dedup_key = Column(String, index=True, nullable=True)
    correlated_count = Column(Integer, default=1)  # alert correlation
    storm_suppressed = Column(Boolean, default=False)
    acked_by = Column(String, nullable=True)
    acked_at = Column(DateTime(timezone=True), nullable=True)
    ticket_uid = Column(String, nullable=True, index=True)  # auto-created ticket
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class NotificationRule(Base):
    """Visual rule builder: match conditions -> actions (notify / auto-ticket)."""
    __tablename__ = "notification_rules"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)  # None = platform-global rule
    name = Column(String, nullable=False)
    enabled = Column(Boolean, default=True)
    conditions = Column(JSON, default=dict)   # {severity:[...],source:[...],contains:"...",max_per_hour:n}
    channels = Column(JSON, default=list)     # ["in_app","email","sms","webhook"]
    recipients = Column(JSON, default=list)
    create_ticket = Column(Boolean, default=False)
    ticket_priority = Column(String, default="p3")
    escalate_after_minutes = Column(Integer, default=0)  # 0 = no escalation
    quiet_hours = Column(JSON, nullable=True)  # {"start":"22:00","end":"07:00"}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=True, index=True)
    rule_id = Column(Integer, ForeignKey("notification_rules.id"), nullable=True)
    channel = Column(String, nullable=False)     # in_app|email|sms|webhook
    recipient = Column(String, default="")
    subject = Column(String, nullable=False)
    body = Column(Text, default="")
    severity = Column(String, default="medium")
    status = Column(String, default="queued")    # queued|sent|failed|dead_letter|suppressed|acked
    attempts = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    acked_by = Column(String, nullable=True)
    acked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ============================================================================
# SNMP Credentials & Network Auto-Discovery
# ============================================================================

class Project(Base):
    """Project Manager: PSA projects (platform side) and client self-managed projects."""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, default="")
    kind = Column(String(20), default="internal")          # internal | client
    status = Column(String(20), default="planned")         # planned|active|on_hold|completed|cancelled
    priority = Column(String(10), default="medium")        # low|medium|high|critical
    manager_email = Column(String(255), default="")
    ticket_category = Column(String(100), default="")      # link to tickets by category
    timer_started_at = Column(DateTime(timezone=True), nullable=True)
    timer_paused_at = Column(DateTime(timezone=True), nullable=True)
    time_spent_seconds = Column(Integer, default=0)
    sla_hours = Column(Integer, default=0)                 # 0 = no SLA
    due_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ProjectMilestone(Base):
    __tablename__ = "project_milestones"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    done = Column(Boolean, default=False)
    order_idx = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProjectAttachment(Base):
    """Documents that describe a project further: scope PDFs, diagrams,
    config files, images, text notes… Same storage model as ticket evidence
    (base64 blob + SHA-256 fingerprint), scoped to the project's tenant."""
    __tablename__ = "project_attachments"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    kind = Column(String(20), default="file")   # file|image|pdf|config|text|note|diagram
    content = Column(Text, default="")          # preview / pasted text
    file_blob = Column(Text, nullable=True)     # base64 bytes when uploaded
    mime_type = Column(String(120), nullable=True)
    size_kb = Column(Integer, default=0)
    sha256 = Column(String, nullable=False)
    uploaded_by = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChannelConfig(Base):
    """Per-tenant customization for each notification channel (email/webhook/sms)."""
    __tablename__ = "channel_configs"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    channel = Column(String(20), nullable=False)           # email | webhook | sms
    enabled = Column(Boolean, default=False)
    config_json = Column(JSONB, default=dict)              # SMTP / webhook / Twilio params
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class UserTotpSecret(Base):
    """Real MFA (TOTP) secrets + backup codes. Used when Demo Mode is OFF."""
    __tablename__ = "user_totp_secrets"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    secret = Column(String(64), nullable=False)            # base32
    confirmed = Column(Boolean, default=False)
    backup_codes = Column(JSONB, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Invitation(Base):
    """Technician / user activation emails (queued until a mail server is configured)."""
    __tablename__ = "invitations"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    email = Column(String(255), nullable=False)
    role = Column(String(50), default="technician")
    token = Column(String(64), nullable=False, unique=True)
    status = Column(String(20), default="pending")         # pending|sent|accepted|failed
    error = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)


class SnmpCredential(Base):
    __tablename__ = "snmp_credentials"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    version = Column(String, default="v2c")            # v1|v2c|v3
    community = Column(String, nullable=True)          # v1/v2c
    username = Column(String, nullable=True)           # v3
    auth_protocol = Column(String, nullable=True)      # MD5|SHA|SHA256
    auth_passphrase = Column(String, nullable=True)
    priv_protocol = Column(String, nullable=True)      # DES|AES128|AES256
    priv_passphrase = Column(String, nullable=True)
    port = Column(Integer, default=161)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class DiscoveryScan(Base):
    __tablename__ = "discovery_scans"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    network_cidr = Column(String, nullable=False)      # e.g. 192.168.1.0/24
    status = Column(String, default="queued")          # queued|running|completed|failed|cancelled
    credential_ids = Column(JSON, default=list)        # snmp credential ids to test
    total_hosts = Column(Integer, default=0)
    discovered = Column(Integer, default=0)
    snmp_matched = Column(Integer, default=0)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String, default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DiscoveredDevice(Base):
    __tablename__ = "discovered_devices"

    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("discovery_scans.id"), nullable=False, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    ip = Column(String, nullable=False)
    mac = Column(String, nullable=True)
    hostname = Column(String, nullable=True)
    os_guess = Column(String, nullable=True)
    device_type = Column(String, nullable=True)        # server|workstation|network|iot|printer|unknown
    open_ports = Column(JSON, default=list)
    snmp_match = Column(Boolean, default=False)
    sys_desc = Column(String, nullable=True)
    imported = Column(Boolean, default=False)
    # Phase 4 — "probe" concept: machine hosting the collector agent. A probe is
    # monitored like any other device but carries a dedicated badge in the UI.
    is_probe = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Phase 4 — Tenant Manager avancé : grants de services + règles de supervision
# (miroir exact des shapes servies par demoMode.ts / tenantManagerApi)
# ---------------------------------------------------------------------------
class TenantServiceGrant(Base):
    """Override d'un service au-delà du plan standard (grant/deny plateforme)."""
    __tablename__ = "tenant_service_grants"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    service_id = Column(String, nullable=False)
    enabled = Column(Boolean, default=True)
    override_plan = Column(Boolean, default=False)   # True = hors périmètre du plan payé
    expires_at = Column(DateTime(timezone=True), nullable=True)
    granted_by = Column(String, nullable=True)       # email de l'admin plateforme
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class MonitoringRule(Base):
    """Règle déclencheur → condition → action (ticket auto / notif / suppress)."""
    __tablename__ = "monitoring_rules"

    id = Column(String, primary_key=True)            # RUL-xxxx
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    scope = Column(String, default="asset")          # asset|client|platform
    target_asset_id = Column(String, nullable=True)
    trigger_metric = Column(String, nullable=False)  # cpu|memory|disk|network|status|alert|event
    operator = Column(String, default=">")           # > < >= <= == !=
    threshold = Column(String, nullable=False)
    duration_min = Column(Integer, default=5)
    action = Column(String, default="create_ticket") # create_ticket|notify|suppress_alert|none
    ticket_priority = Column(String, default="P3")
    notify_channels = Column(JSON, default=list)
    enabled = Column(Boolean, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
