from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


# User schemas
class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)
    org_id: Optional[int] = None


class UserResponse(UserBase):
    id: int
    org_id: Optional[int]
    status: str
    mfa_enabled: bool
    last_login: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = None
    role: Optional[str] = None


# Organization schemas
class OrganizationBase(BaseModel):
    name: str
    tier: str
    contact_email: EmailStr


class OrganizationCreate(OrganizationBase):
    contact_phone: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    # Multi-site structure (Phase 4) — mirrors demoMode POST /organizations
    org_type: str = "HQ"           # HQ | SUBSIDIARY | AGENCY
    parent_org_id: Optional[int] = None
    plan_tier: Optional[str] = None  # STARTER | PRO | SOUVERAIN


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    tier: Optional[str] = None
    status: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    org_type: Optional[str] = None
    parent_org_id: Optional[int] = None
    member_count: Optional[int] = None
    asset_count: Optional[int] = None
    risk_score: Optional[int] = None
    compliance_score: Optional[int] = None
    contract_start: Optional[datetime] = None
    contract_end: Optional[datetime] = None
    monthly_revenue: Optional[int] = None


class OrganizationResponse(OrganizationBase):
    id: int
    status: str
    contact_phone: Optional[str]
    industry: Optional[str]
    country: Optional[str]
    member_count: int
    asset_count: int
    risk_score: int
    compliance_score: int
    contract_start: Optional[datetime]
    contract_end: Optional[datetime]
    monthly_revenue: int
    org_type: str = "HQ"
    parent_org_id: Optional[int] = None
    plan_tier: Optional[str] = None
    endpoint_count: Optional[int] = 0
    seat_limit: Optional[int] = 3
    siem_limit_gb: Optional[int] = 10
    billing_cycle: Optional[str] = "MONTHLY"
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# Entitlement schemas
class EntitlementBase(BaseModel):
    service_id: str
    enabled: bool = False
    seat_count: int = 0


class EntitlementCreate(EntitlementBase):
    org_id: int
    notes: Optional[str] = None


class EntitlementUpdate(BaseModel):
    enabled: Optional[bool] = None
    seat_count: Optional[int] = None
    notes: Optional[str] = None


class EntitlementResponse(EntitlementBase):
    id: int
    org_id: int
    activated_at: Optional[datetime]
    deactivated_at: Optional[datetime]
    notes: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# Integration schemas
class IntegrationBase(BaseModel):
    name: str
    service_id: str
    integration_type: str
    license_type: str
    pricing: str


class IntegrationCreate(IntegrationBase):
    status: str = "inactive"
    api_key: Optional[str] = None
    api_endpoint: Optional[str] = None
    documentation_url: Optional[str] = None
    notes: Optional[str] = None


class IntegrationUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    api_key: Optional[str] = None
    api_endpoint: Optional[str] = None
    documentation_url: Optional[str] = None
    notes: Optional[str] = None


class IntegrationResponse(IntegrationBase):
    id: int
    status: str
    api_key: Optional[str]
    api_endpoint: Optional[str]
    documentation_url: Optional[str]
    last_sync: Optional[datetime]
    notes: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class IntegrationTestResult(BaseModel):
    success: bool
    message: str
    details: Optional[dict] = None


# Audit Log schemas
class AuditLogCreate(BaseModel):
    actor_id: Optional[int] = None
    actor_name: str
    actor_role: str
    org_id: Optional[int] = None
    action: str
    resource: str
    resource_id: str
    details: Optional[str] = None
    ip_address: Optional[str] = None
    outcome: str


class AuditLogResponse(AuditLogCreate):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Advanced Ticketing schemas
# ============================================================================

class TicketCreate(BaseModel):
    title: str = Field(..., min_length=3)
    description: Optional[str] = ""
    priority: str = "p3"                 # p1|p2|p3|p4
    category: str = "other"              # incident|service_request|problem|change|vulnerability|other
    org_id: Optional[int] = None         # platform admin only; clients default to own org
    assignee: Optional[str] = None
    tags: List[str] = []
    asset: Optional[str] = None
    vulnerability_ref: Optional[str] = None


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    asset: Optional[str] = None
    vulnerability_ref: Optional[str] = None
    note: Optional[str] = None


class EvidenceCreate(BaseModel):
    name: str
    kind: str = "log"          # log|screenshot|pcap|hash|report|email|config|pdf|image|file|note
    content: str = ""
    file_b64: Optional[str] = None      # base64 bytes for uploaded attachments
    mime_type: Optional[str] = None


class AttachmentCreate(BaseModel):
    """Project attachment — describe the project further with a document."""
    name: str
    kind: str = "file"         # file|image|pdf|config|text|note|diagram
    content: str = ""
    file_b64: Optional[str] = None
    mime_type: Optional[str] = None


class ClosureRequest(BaseModel):
    note: str


class ApprovalDecision(BaseModel):
    approve: bool
    note: Optional[str] = ""


class TicketResponse(BaseModel):
    id: int
    uid: str
    org_id: int
    title: str
    description: Optional[str] = ""
    status: str
    priority: str
    category: str
    source: str
    assignee: Optional[str]
    reporter: Optional[str]
    tags: List[str] = []
    asset: Optional[str]
    vulnerability_ref: Optional[str]
    ai_category: Optional[str]
    ai_priority: Optional[str]
    ai_confidence: Optional[int]
    ai_reasoning: List[str] = []
    ai_predicted_root_cause: Optional[str]
    duplicate_of: Optional[str]
    sla_state: Optional[str] = None
    breach_prediction: Optional[dict] = None
    sla_response_minutes: Optional[int]
    sla_resolution_minutes: Optional[int]
    due_response_at: Optional[datetime]
    due_resolve_at: Optional[datetime]
    first_response_at: Optional[datetime]
    resolved_at: Optional[datetime]
    escalation_level: int = 0
    alert_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class EvidenceResponse(BaseModel):
    id: int
    ticket_uid: str
    kind: str
    name: str
    size_kb: int
    sha256: str
    collected_by: str
    immutable: bool
    mime_type: Optional[str] = None
    has_file: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class AttachmentResponse(BaseModel):
    id: int
    project_id: int
    org_id: int
    name: str
    kind: str
    content: str = ""
    mime_type: Optional[str] = None
    size_kb: int
    sha256: str
    uploaded_by: str
    has_file: bool = False
    created_at: datetime


class AuditEntryResponse(BaseModel):
    seq: int
    created_at: datetime
    actor: str
    action: str
    detail: Optional[str] = ""
    prev_hash: str
    entry_hash: str

    class Config:
        from_attributes = True


class ApprovalResponse(BaseModel):
    id: int
    ticket_uid: str
    step: int
    approver_role: str
    status: str
    note: Optional[str] = ""
    decided_by: Optional[str]
    decided_at: Optional[datetime]

    class Config:
        from_attributes = True


# ============================================================================
# Notification & Event Intelligence schemas
# ============================================================================

class AlertIn(BaseModel):
    """Inbound event — this is what real integrations POST to /api/alerts."""
    title: str
    description: Optional[str] = ""
    severity: str = "medium"             # critical|high|medium|low|info
    source: str = "siem"                 # siem|wazuh|snmp|syslog|api|nmap|manual
    resource: Optional[str] = None
    org_id: Optional[int] = None         # required for platform-admin ingest
    raw_payload: dict = {}


class AlertResponse(BaseModel):
    id: int
    uid: str
    org_id: int
    title: str
    description: Optional[str] = ""
    severity: str
    source: str
    resource: Optional[str]
    correlated_count: int = 1
    storm_suppressed: bool = False
    acked_by: Optional[str]
    acked_at: Optional[datetime]
    ticket_uid: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class RuleCreate(BaseModel):
    name: str
    org_id: Optional[int] = None         # None = global (platform) rule
    enabled: bool = True
    conditions: dict = {}                # {severity:[],source:[],contains:"",min_severity:""}
    channels: List[str] = ["in_app"]
    recipients: List[str] = []
    create_ticket: bool = False
    ticket_priority: str = "p3"
    escalate_after_minutes: int = 0
    quiet_hours: Optional[dict] = None


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    conditions: Optional[dict] = None
    channels: Optional[List[str]] = None
    recipients: Optional[List[str]] = None
    create_ticket: Optional[bool] = None
    ticket_priority: Optional[str] = None
    escalate_after_minutes: Optional[int] = None
    quiet_hours: Optional[dict] = None


class RuleResponse(RuleCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationResponse(BaseModel):
    id: int
    org_id: int
    alert_id: Optional[int]
    rule_id: Optional[int]
    channel: str
    recipient: str
    subject: str
    body: Optional[str] = ""
    severity: str
    status: str
    attempts: int
    last_error: Optional[str]
    sent_at: Optional[datetime]
    acked_by: Optional[str]
    acked_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class SimulateAlertBody(AlertIn):
    pass


# ============================================================================
# SNMP credentials & auto-discovery schemas
# ============================================================================

class SnmpCredentialCreate(BaseModel):
    name: str
    version: str = "v2c"                 # v1|v2c|v3
    community: Optional[str] = None
    username: Optional[str] = None       # v3
    auth_protocol: Optional[str] = None
    auth_passphrase: Optional[str] = None
    priv_protocol: Optional[str] = None
    priv_passphrase: Optional[str] = None
    port: int = 161
    org_id: Optional[int] = None         # platform admin only


class SnmpCredentialResponse(SnmpCredentialCreate):
    id: int
    org_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ScanCreate(BaseModel):
    network_cidr: str                    # e.g. 192.168.1.0/24
    credential_ids: List[int] = []
    org_id: Optional[int] = None


class ScanResponse(BaseModel):
    id: int
    org_id: int
    network_cidr: str
    status: str
    credential_ids: List[int] = []
    total_hosts: int
    discovered: int
    snmp_matched: int
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_by: str
    created_at: datetime

    class Config:
        from_attributes = True


class DiscoveredDeviceResponse(BaseModel):
    id: int
    scan_id: int
    org_id: int
    ip: str
    mac: Optional[str]
    hostname: Optional[str]
    os_guess: Optional[str]
    device_type: Optional[str]
    open_ports: List[int] = []
    snmp_match: bool
    sys_desc: Optional[str]
    imported: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Phase 4 — Tenant Manager schemas (miroir exact des shapes démo)
# ---------------------------------------------------------------------------
class TenantSummaryOut(BaseModel):
    id: int
    name: str
    org_type: str = "HQ"
    location: Optional[str] = None
    plan_tier: str = "STARTER"
    billing_cycle: str = "MONTHLY"
    endpoints: int = 0
    members: int = 0
    services_active: int = 0
    open_incidents: int = 0
    probes: List[dict] = []
    children: List[dict] = []


class ClientTicketIn(BaseModel):
    title: str
    priority: str = "P3"          # P1|P2|P3|P4
    description: str = ""
    assignee: Optional[str] = None
    asset: Optional[str] = None
    category: str = "Demande"


class RuleCreateIn(BaseModel):
    name: str
    scope: str = "asset"          # asset|client|platform
    target_asset_id: Optional[str] = None
    trigger_metric: str           # cpu|memory|disk|network|status|alert|event
    operator: str = ">"           # > < >= <= == !=
    threshold: str
    duration_min: int = 5
    action: str = "create_ticket" # create_ticket|notify|suppress_alert|none
    ticket_priority: str = "P3"
    notify_channels: List[str] = []


class RuleUpdateIn(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    threshold: Optional[str] = None
    operator: Optional[str] = None
    duration_min: Optional[int] = None
    action: Optional[str] = None
    ticket_priority: Optional[str] = None
    notify_channels: Optional[List[str]] = None


class RuleOut(BaseModel):
    id: str
    org_id: int
    name: str
    scope: str
    target_asset_id: Optional[str] = None
    trigger_metric: str
    operator: str
    threshold: str
    duration_min: int
    action: str
    ticket_priority: str
    notify_channels: List[str] = []
    enabled: bool
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GrantIn(BaseModel):
    service_id: str
    enabled: bool = True
    override_plan: bool = False


class GrantOut(BaseModel):
    service_id: str
    enabled: bool
    override_plan: bool
    granted_by: Optional[str] = None
    expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PartnerUpdateIn(BaseModel):
    company: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    tier: Optional[str] = None
    status: Optional[str] = None
    support_sla: Optional[str] = None


class PartnerMigrateIn(BaseModel):
    plan: str                     # Starter | Business | Scale
