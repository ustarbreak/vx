from sqlalchemy import Column, BigInteger, Float, Numeric, Index, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON, UniqueConstraint, text
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
    # --- Legacy v1 billing columns (v1 engine deleted; V2 = app.services.pricing_engine + core/pricing_config.json) ---
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
    # --- Pricing v2: free Security Health Check trial -----------------------
    trial = Column(Boolean, default=False)
    trial_expires_at = Column(DateTime(timezone=True), nullable=True)
    grace_until = Column(DateTime(timezone=True), nullable=True)  # read-only window
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


# ---------------------------------------------------------------------------
# Pricing v2 (per-asset packs, Health Check trials, sales quotes, partners)
# Single source of truth for prices: app/core/pricing_config.json (canonical mirror
# of src/data/pricingConfig.ts, checked by tests/config_parity.cjs) + app/services/pricing_engine.py.
# ---------------------------------------------------------------------------

class PricingConfigVersion(Base):
    __tablename__ = "pricing_config_versions"

    id = Column(Integer, primary_key=True)
    version = Column(String(16), unique=True, index=True, nullable=False)
    payload = Column(Text, nullable=False)  # full JSON config, immutable per version
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PricingLead(Base):
    __tablename__ = "pricing_leads"

    id = Column(Integer, primary_key=True)
    company = Column(String(200), nullable=False)
    name = Column(String(120), nullable=False)
    email = Column(String(200), nullable=False, index=True)
    phone = Column(String(40))
    country = Column(String(60))
    lang = Column(String(8), default="fr")
    asset_counts = Column(Text)             # JSON {class: qty} (optional)
    interests = Column(Text)                # JSON [service ids]
    message = Column(Text)
    contact_prefs = Column(Text)            # JSON ["whatsapp","phone","email"]
    consent = Column(Boolean, default=False)  # CNDP / loi 09-08
    status = Column(String(16), default="new", index=True)  # new|contacted|qualified|won|lost
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)  # set on conversion
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class QuoteLink(Base):
    __tablename__ = "quote_links"

    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)  # SHA-256 only
    lead_id = Column(Integer, ForeignKey("pricing_leads.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    prefill = Column(Text)                   # JSON quote inputs
    lock_email = Column(String(200), nullable=True)  # optional client-email lock
    max_extra_discount = Column(String(8), default="0.05")  # role cap recorded at creation
    view_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class QuoteRecord(Base):
    __tablename__ = "quotes"

    id = Column(Integer, primary_key=True)
    number = Column(String(24), unique=True, index=True, nullable=False)  # IC-Q-2026-0001
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    lead_id = Column(Integer, ForeignKey("pricing_leads.id"), nullable=True)
    partner_id = Column(Integer, nullable=True)          # org/partner row when partner-made
    mode = Column(String(8), nullable=False)             # pack | custom
    inputs = Column(Text, nullable=False)                # JSON quote inputs (server-recomputed)
    result = Column(Text, nullable=False)                # JSON engine output snapshot
    extra_discount = Column(String(16), default="0")     # sales override % (capped by role)
    discount_reason = Column(String(300))
    config_version = Column(String(16), nullable=False)
    pdf_hash = Column(String(64))                        # last export hash
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id = Column(Integer, primary_key=True)
    company = Column(String(200), nullable=False)
    name = Column(String(120), nullable=False)
    email = Column(String(200), nullable=False, index=True)
    phone = Column(String(40))
    country = Column(String(60))
    consent = Column(Boolean, default=False)
    email_domain = Column(String(200), index=True)       # one active trial / domain / 90d
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    enrollment_key_hash = Column(String(64))             # collector one-time key (hash only)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)      # +30 days
    grace_until = Column(DateTime(timezone=True))                     # +30 read-only
    purged_at = Column(DateTime(timezone=True))
    status = Column(String(16), default="active", index=True)  # active|read_only|purged|converted
    score = Column(Integer)                                # posture score 0..100
    report_pdf_hash = Column(String(64))
    created_by_partner_id = Column(Integer, nullable=True)  # partner-run => deal auto-created
    units_at_conversion = Column(String(16))
    recommended_pack = Column(String(16))


class PartnerDealRegistration(Base):
    __tablename__ = "partner_deal_registrations"

    id = Column(Integer, primary_key=True)
    partner_org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    prospect_company = Column(String(200), nullable=False)
    prospect_email = Column(String(200))
    expected_units = Column(String(16))                    # billable units estimate
    pack = Column(String(16))                              # starter|pro|souverain|custom
    status = Column(String(16), default="registered", index=True)  # registered|conflict|approved|rejected|expired|won
    conflict_note = Column(String(300))
    approved_at = Column(DateTime(timezone=True))          # start of the 12-month bonus window
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PlanEntitlementV2(Base):
    """v2 entitlements: plan -> service ids (category names only, white-label)."""
    __tablename__ = "plan_entitlements_v2"

    id = Column(Integer, primary_key=True)
    plan = Column(String(16), nullable=False, index=True)   # starter|pro|souverain|custom|trial
    service_id = Column(String(32), nullable=False)
    included = Column(Boolean, default=True)
    min_units = Column(Integer, default=0)
    __table_args__ = (UniqueConstraint("plan", "service_id", name="uq_plan_service_v2"),)


class UpsellEvent(Base):
    __tablename__ = "upsell_events"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    trigger = Column(String(32), nullable=False)   # near_cap|backup_quota|siem_overage|trial_cta|estimator
    message = Column(Text, nullable=False)
    action = Column(String(16), default="shown")   # shown|dismissed|clicked|requested
    dismissed_at = Column(DateTime(timezone=True))  # reappears after 30 days
    created_at = Column(DateTime(timezone=True), server_default=func.now())


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
    # STAGE 3: grouping-window epoch for the ACTIVE group of a fingerprint.
    # One (org_id, dedup_key, window_epoch) may exist at most once — enforced
    # by the partial unique index below (PostgreSQL-compatible; SQLite honors
    # partial indexes too). Folded duplicates are deleted, so their (possibly
    # bumped) epoch never conflicts.
    window_epoch = Column(Integer, default=0, nullable=False)
    # STAGE 3: last activity time for the grouping window. Bumped on every
    # fold; drives documented "fold iff last activity within window" semantics
    # (see correlate()). Nullable so legacy rows fall back to created_at.
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

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
    status = Column(String, default="active", index=True)  # active|acked|resolved (derived from evidence below)
    assignee = Column(String, nullable=True)               # user email — analyst assignment
    acked_by = Column(String, nullable=True)
    acked_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(String, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, default=1, nullable=False)   # optimistic concurrency token
    ticket_uid = Column(String, nullable=True, index=True)  # auto-created ticket
    incident_uid = Column(String, nullable=True, index=True)  # set by the IR pipeline (real link only)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        # STAGE 3 — concurrency-safe grouping backstop. At most ONE ACTIVE
        # group per (tenant, fingerprint, window epoch). The correlate() fold
        # deletes duplicate rows inside a SELECT ... FOR UPDATE critical
        # section; this index is the hard DB-level guarantee that even a race
        # cannot leave two live groups for the same key in the same window.
        #
        # STAGE 3 FIX (G4/G8): the predicate now also EXCLUDES transient
        # pipeline candidates (dedup_key IS NULL until correlate() stamps the
        # survivor path). Without it, the legacy "persist candidate before
        # correlate" contract meant two concurrent identical submissions
        # collided on this index at CANDIDATE INSERT time — before correlation
        # ever ran — raising IntegrityError instead of converging on one group.
        # With it, un-stamped candidates are invisible to the index and only
        # committed GROUP rows participate in uniqueness. Folded duplicates are
        # deleted, so their (possibly bumped) epoch never conflicts.
        Index(
            "uq_alert_group_active",
            "org_id", "dedup_key", "window_epoch",
            unique=True,
            postgresql_where=text("status != 'resolved' AND dedup_key IS NOT NULL"),
            sqlite_where=text("status != 'resolved' AND dedup_key IS NOT NULL"),
        ),
    )


class AlertNote(Base):
    """Append-only investigation note on an alert (analyst-authored)."""
    __tablename__ = "alert_notes"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False, index=True)
    author = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AlertEvent(Base):
    """Immutable lifecycle history for one alert (audit trail of transitions)."""
    __tablename__ = "alert_events"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False, index=True)
    actor = Column(String, nullable=False)      # email or "system"
    action = Column(String, nullable=False)     # created|correlated|acked|assigned|resolved|reopened|notified|delivery_failed
    detail = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EventEvidence(Base):
    """Durable per-EVENT evidence row (Stage 1: event evidence).

    One row is stored for EVERY accepted ingestion event — including duplicates
    that the correlation layer folds into an existing alert. This closes the
    Phase-5 honesty gap where a folded duplicate's unique raw payload and
    metadata were deleted with its alert row.

    Identity notes (deliberate separation, never conflated):
      * `event_uid` identifies THIS accepted ingestion event (transport-level).
      * `source_event_id` is the upstream detector's own ID when it provides
        one; identical payloads do NOT prove two events are the same, so we
        never derive identity from payload content alone.
      * `payload_sha256` is integrity metadata (detects corruption / proves
        byte equality), not an identity key.
      * The alert GROUP identity remains `alerts.dedup_key` — unchanged here.

    Retention: `raw_payload`/`payload_excerpt` are nulled by the expiry job
    after `expires_at`; the row itself survives as an intelligible stub
    (provenance + hash + sizes + `payload_expired` flag) so alert/incident
    history stays explainable after payload deletion.

    Access: payloads are served only through tenant-scoped, write-role-gated
    endpoints (see routers/notifications.py evidence routes).
    """
    __tablename__ = "event_evidence"

    id = Column(Integer, primary_key=True, index=True)
    event_uid = Column(String(36), unique=True, index=True, nullable=False)  # uuid4
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    source_system = Column(String, default="api")   # ingest path: api|agent|discovery|seed...
    source_event_id = Column(String, nullable=True)  # upstream detector's own ID (if any)
    # Grouping provenance ONLY — this stage does not change grouping logic.
    dedup_fingerprint = Column(String, nullable=True, index=True)

    # --- original payload + integrity metadata -----------------------------
    raw_payload = Column(JSON, nullable=True)       # null after retention expiry
    payload_sha256 = Column(String(64), nullable=False)
    payload_bytes = Column(Integer, default=0)      # true serialized size
    truncated = Column(Boolean, default=False)      # inline copy cut to size cap
    payload_excerpt = Column(Text, nullable=True)   # first N bytes when truncated
    payload_expired = Column(Boolean, default=False)

    # --- provenance ---------------------------------------------------------
    provenance = Column(JSON, default=dict)  # {actor, endpoint, request_ip, ...}

    # --- timekeeping --------------------------------------------------------
    source_occurred_at = Column(DateTime(timezone=True), nullable=True)  # if collector says
    received_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # --- processing / policy versions ----------------------------------------
    normalization_version = Column(String, default="v1")
    retention_policy_version = Column(String, default="v1")
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # --- linkage (nullable: survives even if the alert row is folded away) --
    alert_db_id = Column(Integer, nullable=True)     # alerts.id at ingest time
    alert_uid = Column(String, nullable=True, index=True)  # surviving group uid after fold

    # --- ingestion idempotency & recovery (Stage 2: shared pipeline) -------
    # Deliberately SEPARATE from payload_sha256 (integrity only) and from
    # dedup_fingerprint (alert grouping). None of the three prove the others.
    ingest_key = Column(String(128), nullable=True, unique=True, index=True)
    #   sha256(org|source_system|source_event_id) — present ONLY when the
    #   upstream collector supplied a source_event_id; identical payloads
    #   without a source ID are NOT treated as the same event.
    processing_status = Column(String, default="pending")
    #   pending -> processed | failed (permanent failure keeps evidence intact)
    processing_error = Column(Text, nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)


class UidCounter(Base):
    """STAGE 3 — atomic per-(table,prefix) UID sequence.

    Replaces the racy COUNT(rows)+1 allocation for pipeline paths. Claimed
    with INSERT ... ON CONFLICT DO UPDATE ... RETURNING (PostgreSQL and
    SQLite >= 3.24 compatible). Rollbacks may skip numbers; duplicates are
    impossible."""
    __tablename__ = "uid_counters"

    table_name = Column(String(64), primary_key=True)
    prefix = Column(String(16), primary_key=True)
    last_value = Column(Integer, nullable=False, default=0)


class GroupingPolicy(Base):
    """STAGE 3 — documented, versioned grouping policy.

    One row per policy_version. Makes the fingerprint recipe and window
    auditable at runtime instead of living only in code comments. Seeded at
    startup if absent (create_all convention — no Alembic revision needed)."""
    __tablename__ = "grouping_policies"

    id = Column(Integer, primary_key=True, index=True)
    policy_version = Column(String(16), unique=True, nullable=False)  # v1|v2...
    fingerprint_fields = Column(JSON, default=list)   # ordered field list
    window_minutes = Column(Integer, default=60, nullable=False)
    storm_threshold = Column(Integer, default=5, nullable=False)
    notes = Column(Text, default="")
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
    # Planned date for the milestone (Gantt §6G). Nullable on purpose: the
    # timeline renders "no planned date" instead of inventing one.
    planned_at = Column(DateTime(timezone=True), nullable=True)
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
    # --- Infrastructure Map / Auto Discovery completion -------------------
    # Approved site (multi-site org hierarchy: HQ/SUBSIDIARY/AGENCY org id)
    # the scan targets. Null for legacy scans — never inferred.
    site_id = Column(Integer, nullable=True)
    # Explicit operator authorization recorded at launch time (scope consent).
    authorized = Column(Boolean, default=False)
    authorization_note = Column(String, nullable=True)


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
# ---------------------------------------------------------------------------
# goinfra agent — probes, inventories, metrics, agent-reported discovery
# ---------------------------------------------------------------------------

class AgentProbe(Base):
    """One enrolled goinfra agent. Enrollment is idempotent per (org, hostname):
    the same machine re-helloing with the same tenant token gets the same row."""
    __tablename__ = "agent_probes"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    hostname = Column(String, nullable=False)
    agent_version = Column(String, nullable=True)
    os = Column(String, nullable=True)                   # linux|windows|...
    ip = Column(String, nullable=True)                   # primary NIC address
    status = Column(String, default="online")            # online|offline
    last_seen = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (Index("uq_agent_probe_org_host", "org_id", "hostname", unique=True),)


class AgentInventory(Base):
    """Full host snapshot posted by the agent each cycle (raw JSON + summary columns)."""
    __tablename__ = "agent_inventories"

    id = Column(Integer().with_variant(BigInteger, "postgresql"), primary_key=True, autoincrement=True)
    probe_id = Column(Integer, ForeignKey("agent_probes.id"), nullable=False, index=True)
    org_id = Column(Integer, nullable=False, index=True)
    collected_at = Column(DateTime(timezone=True), nullable=True)
    payload = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentMetric(Base):
    """Time-series point of the live metrics stream (one row per sample)."""
    __tablename__ = "agent_metrics"

    ts = Column(BigInteger, primary_key=True)                       # epoch seconds
    probe_id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, nullable=False, index=True)
    cpu_percent = Column(Float, nullable=True)
    mem_used_percent = Column(Float, nullable=True)
    mem_total_bytes = Column(BigInteger, nullable=True)
    disk_worst_percent = Column(Float, nullable=True)
    load1 = Column(Float, nullable=True)
    net_recv_bps = Column(Float, nullable=True)
    net_sent_bps = Column(Float, nullable=True)
    temp_max_celsius = Column(Float, nullable=True)


class AgentToken(Base):
    """Tenant API token issued from Settings → Agents. Only the SHA-256 hash of
    the secret is stored; agents authenticate with `Bearer icag_...`."""
    __tablename__ = "agent_tokens"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    prefix = Column(String(12), nullable=False)          # first chars for display
    created_by = Column(String, nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentDiscoveredDevice(Base):
    """Devices reported by a probe's local network sweep (same lifecycle as
    DiscoveredDevice: review queue -> import)."""
    __tablename__ = "agent_discovered_devices"

    id = Column(Integer().with_variant(BigInteger, "postgresql"), primary_key=True, autoincrement=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    probe_id = Column(Integer, ForeignKey("agent_probes.id"), nullable=False, index=True)
    ip = Column(String, nullable=False, index=True)
    mac = Column(String, nullable=True)
    hostname = Column(String, nullable=True)
    os_guess = Column(String, nullable=True)
    device_type = Column(String, nullable=True)
    open_ports = Column(JSON, default=list)
    sys_name = Column(String, nullable=True)
    sys_desc = Column(String, nullable=True)
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    last_seen = Column(DateTime(timezone=True), nullable=True)
    imported = Column(Boolean, default=False)

    __table_args__ = (Index("uq_agent_disc_org_ip", "org_id", "ip", unique=True),)


class TenantSetting(Base):
    """Free-form per-org settings (discovery defaults, agent policy overrides)."""
    __tablename__ = "tenant_settings"

    org_id = Column(Integer, ForeignKey("organizations.id"), primary_key=True)
    data = Column(JSON, default=dict)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


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


# ============================================================================
# Incident Response — incidents, notes, activity trail, evidence & actions
# (wraps the existing SIEM/alert/ticket engines; never replaces them)
# ============================================================================

class Incident(Base):
    """Security incident record. One incident may aggregate many alerts and
    links to tickets/evidence/response actions. `uid` is stable (INC-000123)
    and deduped via `dedup_key` so alert re-processing updates an existing
    incident instead of creating duplicates."""
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String, unique=True, index=True, nullable=False)   # INC-000123
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    site_org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)  # affected site (multi-site)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    severity = Column(String, default="medium")     # critical|high|medium|low|info
    status = Column(String, default="open", index=True)  # open|investigating|contained|resolved|closed
    assignee = Column(String, nullable=True)        # user email
    reporter = Column(String, nullable=True)
    acknowledged_by = Column(String, nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    affected_assets = Column(JSON, default=list)    # hostnames / IPs (links into device details)
    ioc_related = Column(JSON, default=list)        # threat-intel IOCs
    tags = Column(JSON, default=list)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=True, index=True)
    ticket_uid = Column(String, nullable=True, index=True)          # linked TCK-xxxx
    category = Column(String, default="other")      # malware|phishing|intrusion|data_exfiltration|policy_violation|other
    dedup_key = Column(String, nullable=True, index=True)
    # ---- STAGE 4: incident episodes -------------------------------------
    # Recurrence lineage. An incident that matches a RESOLVED/CLOSED episode's
    # dedup key starts a NEW episode rather than mutating history:
    #   recurrence_of_uid -> uid of the previous episode in the chain
    #   episode_number    -> 1-based position within the chain
    # Historical resolved/closed rows are never auto-reopened or mutated by
    # evidence arrival; only explicit analyst action (existing transition API)
    # may reopen them, which is recorded in IncidentActivity as before.
    recurrence_of_uid = Column(String, nullable=True, index=True)
    episode_number = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # Concurrency backstop: at most one ACTIVE episode per tenant+dedup key.
        # The service layer uses SELECT ... FOR UPDATE + re-check; this partial
        # unique index is the last-resort guard against duplicate active
        # episodes created by racing requests. Resolved/closed episodes do not
        # block new ones — that is exactly what enables recurrence episodes.
        Index(
            "uq_incident_active_episode",
            "org_id", "dedup_key",
            unique=True,
            postgresql_where=text("status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL"),
            sqlite_where=text("status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL"),
        ),
    )



# ============================================================================
# STAGE 5 — Rules-based triage (deterministic scoring, no ML/LLM)
# ============================================================================
class TriagePolicy(Base):
    """Versioned scoring policy. One row per policy_version; changing any
    weight/band means inserting a NEW version (v2, v3...) — old rows are never
    edited so historical evaluations stay reproducible."""
    __tablename__ = "triage_policies"

    id = Column(Integer, primary_key=True, index=True)
    policy_version = Column(String(16), unique=True, nullable=False)   # v1|v2...
    weights = Column(JSON, default=dict)                # declarative point weights
    bands = Column(JSON, default=list)                  # [{min_score, priority}...]
    confidence_weights = Column(JSON, default=dict)     # data-quality axis weights
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TriageEvaluation(Base):
    """Immutable audit history of triage runs. One row per evaluation; the
    full reason-code breakdown is frozen in `breakdown`. Analyst overrides are
    appended into the stored breakdown's `override` field (the score itself is
    never rewritten silently)."""
    __tablename__ = "triage_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    incident_uid = Column(String, nullable=False, index=True)
    policy_version = Column(String(16), nullable=False)
    score = Column(Integer, nullable=False)             # bounded 0..100
    priority = Column(String(4), nullable=False)        # p1|p2|p3|p4 (calculated)
    confidence = Column(Integer, default=0, nullable=False)
    corroboration = Column(Integer, default=0, nullable=False)
    reason_codes = Column(JSON, default=list)
    breakdown = Column(JSON, default=dict)              # full payload incl. override
    evaluator = Column(String, nullable=False)          # analyst email or 'system'
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class OutcomeLabel(Base):
    """STAGE 6A — Structured outcome labels for ML-readiness data collection.

    Append-only, immutable history of analyst-labeled final dispositions per
    incident episode. One row per labeling event; corrections append a NEW row
    with `supersedes_id` pointing at the row they correct — prior rows are
    NEVER edited or deleted, so the full labeling lineage stays auditable.

    * disposition: true_positive|false_positive|benign_duplicate|unknown
      -> was the alert/incident real? (TP/FP/dup ground truth)
    * priority_correctness: correct|too_high|too_low|unknown
      -> was the effective triage priority right? (compared against the
        CURRENT latest TriageEvaluation incl. analyst override, frozen in
        `priority_labeled_at`)
    * rationale/reviewer are optional; reviewer defaults to the authenticated
      actor (`labeled_by`).
    * Reopened incidents: labels remain as historical facts about the episode
      that was closed; reopening does not invalidate or delete them. New
      labels on a reopened episode simply append.

    No scoring path reads this table (production scoring unchanged); it is
    pure data collection for future evaluation/ML readiness reviews.
    """
    __tablename__ = "outcome_labels"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    incident_uid = Column(String, nullable=False, index=True)
    disposition = Column(String, nullable=False)            # true_positive|false_positive|benign_duplicate|unknown
    priority_correctness = Column(String, nullable=False)   # correct|too_high|too_low|unknown
    priority_labeled_at = Column(String, nullable=True)     # p1..p4 effective priority at labeling time
    rationale = Column(Text, nullable=True)                 # optional analyst free text
    reviewer = Column(String, nullable=True)                # optional reviewer identity (defaults to actor)
    labeled_by = Column(String, nullable=False)             # authenticated actor email
    supersedes_id = Column(Integer, nullable=True, index=True)  # correction chain (immutable append)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class IncidentNote(Base):
    """Investigation note attached to an incident (append-only)."""
    __tablename__ = "incident_notes"

    id = Column(Integer, primary_key=True, index=True)
    incident_uid = Column(String, index=True, nullable=False)
    author = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    internal = Column(Boolean, default=True)        # internal vs client-visible
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IncidentActivity(Base):
    """Immutable activity/audit trail per incident (lifecycle transitions,
    assignment, acknowledgment, linked records, playbook runs...)."""
    __tablename__ = "incident_activities"

    id = Column(Integer, primary_key=True, index=True)
    incident_uid = Column(String, index=True, nullable=False)
    actor = Column(String, nullable=False)
    action = Column(String, nullable=False)         # created|status_changed|assigned|acked|note_added|linked|playbook_run ...
    detail = Column(Text, default="")
    from_value = Column(String, nullable=True)      # e.g. previous status
    to_value = Column(String, nullable=True)        # e.g. new status
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IncidentEvidence(Base):
    """Evidence snapshot referencing a TicketEvidence row (or standalone text).
    Never copies blobs: points at the evidence vault by (ticket_uid, ev_id)."""
    __tablename__ = "incident_evidence"

    id = Column(Integer, primary_key=True, index=True)
    incident_uid = Column(String, index=True, nullable=False)
    ticket_uid = Column(String, nullable=True, index=True)
    ticket_evidence_id = Column(Integer, nullable=True)
    kind = Column(String, default="log")
    name = Column(String, nullable=False)
    sha256 = Column(String, nullable=True)          # integrity fingerprint when known
    collected_by = Column(String, default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IncidentAction(Base):
    """Response action taken on an incident (containment, isolation, block…).
    Actions are recorded against the real engines that executed them; this
    table is the ledger, not the executor."""
    __tablename__ = "incident_actions"

    id = Column(Integer, primary_key=True, index=True)
    incident_uid = Column(String, index=True, nullable=False)
    action_type = Column(String, nullable=False)    # escalate|contain|isolate_host|block_ip|notify|create_ticket|run_playbook|resolve
    status = Column(String, default="completed")    # proposed|pending_approval|approved|executing|completed|failed|cancelled
    detail = Column(Text, default="")
    performed_by = Column(String, nullable=False)
    playbook_run_uid = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ============================================================================
# SOAR — persisted playbooks + real execution history
# ============================================================================

class Playbook(Base):
    """SOAR playbook definition, persisted per tenant (org_id NULL => platform
    shared playbook managed by platform admins). Steps are validated against
    the allow-list of safe action types in app.services.soar — there is no
    arbitrary command/shell execution."""
    __tablename__ = "soar_playbooks"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String, unique=True, index=True, nullable=True)    # PBK-000001
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    category = Column(String, default="Incident Response")
    steps = Column(JSON, default=list)      # [{name, action, params}]
    triggers = Column(JSON, default=list)   # [{type: alert|schedule|manual, ...}] descriptive only
    enabled = Column(Boolean, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class DeviceAction(Base):
    """Endpoint action requested from the Infrastructure graph (backup,
    remote access / smart screen, shutdown, isolate).

    Honesty rules:
      * The API platform does NOT execute host commands directly — there is no
        shell channel to arbitrary endpoints by design.
      * `queued`  : durable request recorded for the goinfra agent collector to
                    pick up on its next policy poll (agent-side enforcement).
      * `manual`  : no agent channel exists for this device; a P1 ticket was
                    created so a technician performs the action through their
                    own tooling (RMM / IPMI / switch ACL). ticket_uid links it.
      * `failed`  : the durable record could not be persisted — nothing happened.
    Every transition is audited; the ledger is the source of truth, never the UI.
    """
    __tablename__ = "device_actions"

    id = Column(Integer().with_variant(BigInteger, "postgresql"), primary_key=True, autoincrement=True)
    uid = Column(String, unique=True, index=True, nullable=False)       # DVA-000123
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    device_id = Column(Integer, ForeignKey("discovered_devices.id"), nullable=False, index=True)
    action = Column(String, nullable=False)                              # backup|remote_access|shutdown|isolate
    mode = Column(String, default="execute")                             # simulate|execute
    status = Column(String, default="queued", index=True)                # queued|manual|blocked|failed
    reason = Column(Text, default="")                                    # honest explanation (no-agent, denied…)
    detail = Column(JSON, default=dict)                                  # redacted context (ip, hostname)
    ticket_uid = Column(String, nullable=True, index=True)               # linked TCK when routed to a human
    requested_by = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PlaybookRun(Base):
    """One execution of a playbook. `mode` separates simulation/preview from
    actual execution; terminal status is written ONLY after every step has
    really completed (or failed) — the UI never sees an optimistic success."""
    __tablename__ = "soar_playbook_runs"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String, unique=True, index=True, nullable=False)   # RUN-000123
    playbook_id = Column(Integer, ForeignKey("soar_playbooks.id"), nullable=False, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    incident_uid = Column(String, nullable=True, index=True)        # triggering incident, if any
    mode = Column(String, default="simulate")   # simulate|preview|execute
    status = Column(String, default="queued", index=True)  # queued|running|completed|failed|partial|cancelled
    triggered_by = Column(String, nullable=False)
    idempotency_key = Column(String, nullable=True, index=True)
    cancel_requested = Column(Boolean, default=False)
    total_steps = Column(Integer, default=0)
    completed_steps = Column(Integer, default=0)
    failed_steps = Column(Integer, default=0)
    skipped_steps = Column(Integer, default=0)
    result_log = Column(JSON, default=list)     # redacted step log
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
