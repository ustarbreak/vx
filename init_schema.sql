-- ============================================================================
-- INFRACENTRA — Full database schema (matches backend/app/models.py exactly)
-- Run in pgAdmin: select the "infracentra" DB -> Query Tool -> paste -> F5
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- CORE: organizations, users, entitlements, integrations, audit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR NOT NULL UNIQUE,
    tier            VARCHAR NOT NULL,                          -- sme | mid-market | enterprise
    status          VARCHAR DEFAULT 'active',                  -- active | suspended | pending
    contact_email   VARCHAR NOT NULL,
    contact_phone   VARCHAR,
    industry        VARCHAR,
    country         VARCHAR,
    member_count    INTEGER DEFAULT 0,
    asset_count     INTEGER DEFAULT 0,
    risk_score      INTEGER DEFAULT 0,
    compliance_score INTEGER DEFAULT 0,
    contract_start  TIMESTAMP WITH TIME ZONE,
    contract_end    TIMESTAMP WITH TIME ZONE,
    monthly_revenue INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_organizations_name ON organizations (name);

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR NOT NULL UNIQUE,
    hashed_password VARCHAR NOT NULL,
    name            VARCHAR NOT NULL,
    role            VARCHAR NOT NULL,                          -- platform_admin | client_admin | client_user
    org_id          INTEGER REFERENCES organizations (id),
    status          VARCHAR DEFAULT 'active',
    mfa_enabled     BOOLEAN DEFAULT FALSE,
    last_login      TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);

CREATE TABLE IF NOT EXISTS entitlements (
    id              SERIAL PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organizations (id),
    service_id      VARCHAR NOT NULL,
    enabled         BOOLEAN DEFAULT FALSE,
    seat_count      INTEGER DEFAULT 0,
    activated_at    TIMESTAMP WITH TIME ZONE,
    deactivated_at  TIMESTAMP WITH TIME ZONE,
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS integrations (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR NOT NULL,
    service_id        VARCHAR NOT NULL,
    integration_type  VARCHAR NOT NULL,                        -- api | webhook | agent | native
    status            VARCHAR DEFAULT 'inactive',              -- active | inactive | pending
    license_type      VARCHAR NOT NULL,                        -- open-source | commercial | freemium
    pricing           VARCHAR NOT NULL,                        -- free | paid | custom
    api_key           VARCHAR,
    api_endpoint      VARCHAR,
    documentation_url VARCHAR,
    last_sync         TIMESTAMP WITH TIME ZONE,
    notes             TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL PRIMARY KEY,
    actor_id    INTEGER REFERENCES users (id),
    actor_name  VARCHAR NOT NULL,
    actor_role  VARCHAR NOT NULL,
    org_id      INTEGER REFERENCES organizations (id),
    action      VARCHAR NOT NULL,
    resource    VARCHAR NOT NULL,
    resource_id VARCHAR NOT NULL,
    details     TEXT,
    ip_address  VARCHAR,
    outcome     VARCHAR NOT NULL,                              -- success | failure | blocked
    timestamp   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- SERVICE A: Advanced Ticketing System
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id               SERIAL PRIMARY KEY,
    uid              VARCHAR NOT NULL UNIQUE,                  -- ALR-000123
    org_id           INTEGER NOT NULL REFERENCES organizations (id),
    title            VARCHAR NOT NULL,
    description      TEXT DEFAULT '',
    severity         VARCHAR DEFAULT 'medium',                 -- critical|high|medium|low|info
    source           VARCHAR DEFAULT 'siem',                   -- siem|wazuh|snmp|syslog|api|nmap|manual
    resource         VARCHAR,
    raw_payload      JSON DEFAULT '{}'::json,
    dedup_key        VARCHAR,
    correlated_count INTEGER DEFAULT 1,
    storm_suppressed BOOLEAN DEFAULT FALSE,
    acked_by         VARCHAR,
    acked_at         TIMESTAMP WITH TIME ZONE,
    ticket_uid       VARCHAR,                                  -- auto-created ticket link
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_alerts_uid ON alerts (uid);
CREATE INDEX IF NOT EXISTS ix_alerts_org_id ON alerts (org_id);
CREATE INDEX IF NOT EXISTS ix_alerts_dedup_key ON alerts (dedup_key);
CREATE INDEX IF NOT EXISTS ix_alerts_ticket_uid ON alerts (ticket_uid);

CREATE TABLE IF NOT EXISTS tickets (
    id                    SERIAL PRIMARY KEY,
    uid                   VARCHAR NOT NULL UNIQUE,             -- TCK-000123
    org_id                INTEGER NOT NULL REFERENCES organizations (id),
    title                 VARCHAR NOT NULL,
    description           TEXT DEFAULT '',
    status                VARCHAR DEFAULT 'new',               -- new|triage|open|in_progress|pending_vendor|escalated|awaiting_approval|resolved|closed
    priority              VARCHAR DEFAULT 'p3',                -- p1|p2|p3|p4
    category              VARCHAR DEFAULT 'other',             -- incident|service_request|problem|change|vulnerability|other
    source                VARCHAR DEFAULT 'manual',            -- manual|alert|api|email|discovery
    assignee              VARCHAR,
    reporter              VARCHAR,
    tags                  JSON DEFAULT '[]'::json,
    asset                 VARCHAR,
    vulnerability_ref     VARCHAR,                             -- CVE tracking
    ai_category           VARCHAR,
    ai_priority           VARCHAR,
    ai_confidence         INTEGER,
    ai_reasoning          JSON DEFAULT '[]'::json,
    ai_predicted_root_cause VARCHAR,
    duplicate_of          VARCHAR,
    triaged_at            TIMESTAMP WITH TIME ZONE,
    sla_response_minutes  INTEGER,
    sla_resolution_minutes INTEGER,
    due_response_at       TIMESTAMP WITH TIME ZONE,
    due_resolve_at        TIMESTAMP WITH TIME ZONE,
    first_response_at     TIMESTAMP WITH TIME ZONE,
    resolved_at           TIMESTAMP WITH TIME ZONE,
    escalation_level      INTEGER DEFAULT 0,
    alert_id              INTEGER REFERENCES alerts (id),
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tickets_uid ON tickets (uid);
CREATE INDEX IF NOT EXISTS ix_tickets_org_id ON tickets (org_id);
CREATE INDEX IF NOT EXISTS ix_tickets_alert_id ON tickets (alert_id);

CREATE TABLE IF NOT EXISTS ticket_evidence (
    id           SERIAL PRIMARY KEY,
    ticket_uid   VARCHAR NOT NULL,
    kind         VARCHAR DEFAULT 'log',                        -- log|screenshot|pcap|hash|report|email
    name         VARCHAR NOT NULL,
    content      TEXT DEFAULT '',
    size_kb      INTEGER DEFAULT 0,
    sha256       VARCHAR NOT NULL,
    collected_by VARCHAR DEFAULT 'system',
    immutable    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_ticket_evidence_ticket_uid ON ticket_evidence (ticket_uid);

CREATE TABLE IF NOT EXISTS ticket_audit_entries (
    id         SERIAL PRIMARY KEY,
    ticket_uid VARCHAR NOT NULL,
    seq        INTEGER NOT NULL,
    actor      VARCHAR NOT NULL,
    action     VARCHAR NOT NULL,
    detail     TEXT DEFAULT '',
    prev_hash  VARCHAR DEFAULT '000000000000000000000000',
    entry_hash VARCHAR NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_ticket_audit_ticket_uid ON ticket_audit_entries (ticket_uid);

CREATE TABLE IF NOT EXISTS ticket_approvals (
    id            SERIAL PRIMARY KEY,
    ticket_uid    VARCHAR NOT NULL,
    step          INTEGER DEFAULT 1,
    approver_role VARCHAR DEFAULT 'client_admin',
    status        VARCHAR DEFAULT 'pending',                   -- pending|approved|rejected
    note          TEXT DEFAULT '',
    decided_by    VARCHAR,
    decided_at    TIMESTAMP WITH TIME ZONE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_ticket_approvals_ticket_uid ON ticket_approvals (ticket_uid);

-- ----------------------------------------------------------------------------
-- SERVICE B: Notification & Event Intelligence Engine
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_rules (
    id                     SERIAL PRIMARY KEY,
    org_id                 INTEGER REFERENCES organizations (id),  -- NULL = platform-global rule
    name                   VARCHAR NOT NULL,
    enabled                BOOLEAN DEFAULT TRUE,
    conditions             JSON DEFAULT '{}'::json,            -- {severity:[],source:[],contains:"",max_per_hour:n}
    channels               JSON DEFAULT '[]'::json,            -- ["in_app","email","sms","webhook"]
    recipients             JSON DEFAULT '[]'::json,
    create_ticket          BOOLEAN DEFAULT FALSE,
    ticket_priority        VARCHAR DEFAULT 'p3',
    escalate_after_minutes INTEGER DEFAULT 0,
    quiet_hours            JSON,                               -- {"start":"22:00","end":"07:00"}
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at             TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS ix_notification_rules_org_id ON notification_rules (org_id);

CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    org_id     INTEGER NOT NULL REFERENCES organizations (id),
    alert_id   INTEGER REFERENCES alerts (id),
    rule_id    INTEGER REFERENCES notification_rules (id),
    channel    VARCHAR NOT NULL,                               -- in_app|email|sms|webhook
    recipient  VARCHAR DEFAULT '',
    subject    VARCHAR NOT NULL,
    body       TEXT DEFAULT '',
    severity   VARCHAR DEFAULT 'medium',
    status     VARCHAR DEFAULT 'queued',                       -- queued|sent|failed|dead_letter|suppressed|acked
    attempts   INTEGER DEFAULT 0,
    last_error TEXT,
    sent_at    TIMESTAMP WITH TIME ZONE,
    acked_by   VARCHAR,
    acked_at   TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_notifications_org_id ON notifications (org_id);
CREATE INDEX IF NOT EXISTS ix_notifications_alert_id ON notifications (alert_id);

-- ----------------------------------------------------------------------------
-- SNMP Credentials & Network Auto-Discovery
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_credentials (
    id              SERIAL PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organizations (id),
    name            VARCHAR NOT NULL,
    version         VARCHAR DEFAULT 'v2c',                     -- v1|v2c|v3
    community       VARCHAR,                                   -- v1/v2c
    username        VARCHAR,                                   -- v3
    auth_protocol   VARCHAR,                                   -- MD5|SHA|SHA256
    auth_passphrase VARCHAR,
    priv_protocol   VARCHAR,                                   -- DES|AES128|AES256
    priv_passphrase VARCHAR,
    port            INTEGER DEFAULT 161,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS ix_snmp_credentials_org_id ON snmp_credentials (org_id);

CREATE TABLE IF NOT EXISTS discovery_scans (
    id             SERIAL PRIMARY KEY,
    org_id         INTEGER NOT NULL REFERENCES organizations (id),
    network_cidr   VARCHAR NOT NULL,                            -- e.g. 192.168.1.0/24
    status         VARCHAR DEFAULT 'queued',                    -- queued|running|completed|failed|cancelled
    credential_ids JSON DEFAULT '[]'::json,
    total_hosts    INTEGER DEFAULT 0,
    discovered     INTEGER DEFAULT 0,
    snmp_matched   INTEGER DEFAULT 0,
    started_at     TIMESTAMP WITH TIME ZONE,
    finished_at    TIMESTAMP WITH TIME ZONE,
    created_by     VARCHAR DEFAULT 'system',
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_discovery_scans_org_id ON discovery_scans (org_id);

CREATE TABLE IF NOT EXISTS discovered_devices (
    id         SERIAL PRIMARY KEY,
    scan_id    INTEGER NOT NULL REFERENCES discovery_scans (id),
    org_id     INTEGER NOT NULL REFERENCES organizations (id),
    ip         VARCHAR NOT NULL,
    mac        VARCHAR,
    hostname   VARCHAR,
    os_guess   VARCHAR,
    device_type VARCHAR,                                        -- server|workstation|network|iot|printer|unknown
    open_ports JSON DEFAULT '[]'::json,
    snmp_match BOOLEAN DEFAULT FALSE,
    sys_desc   VARCHAR,
    imported   BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_discovered_devices_scan_id ON discovered_devices (scan_id);
CREATE INDEX IF NOT EXISTS ix_discovered_devices_org_id ON discovered_devices (org_id);

COMMIT;

-- Quick verification: should list all 15 tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
