// Infracentra Type Definitions

export type UserRole = 'platform_admin' | 'client_admin' | 'client_user' | 'partner_admin';
export type ClientTier = 'sme' | 'mid-market' | 'enterprise';
export type ClientStatus = 'active' | 'suspended' | 'pending' | 'churned';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ServiceStatus = 'active' | 'inactive' | 'provisioning' | 'error';

// Service Catalog
export type ServiceId =
  | 'threat-intel'
  | 'compliance'
  | 'incident-response'
  | 'analytics'
  | 'soar'
  | 'network-monitoring'
  | 'vuln-scanning'
  | 'patch-management'
  | 'backup-dr'
  | 'endpoint-protection'
  | 'email-security'
  | 'cloud-security'
  | 'dns-filtering'
  | 'firewall-mgmt'
  | 'vpn-gateway'
  | 'sd-wan';

export interface Service {
  id: ServiceId;
  name: string;
  category: 'security' | 'networking' | 'psa';
  description: string;
  icon: string;
  basePrice: number;
  features: string[];
  availableTiers: ClientTier[];
}

export interface ServiceEntitlement {
  serviceId: ServiceId;
  enabled: boolean;
  activatedAt: string | null;
  deactivatedAt: string | null;
  seatCount: number;
  notes?: string;
}

// Organization / Client
export interface Organization {
  id: string;
  name: string;
  tier: ClientTier;
  status: ClientStatus;
  contactEmail: string;
  contactPhone: string;
  industry: string;
  country: string;
  memberCount: number;
  assetCount: number;
  riskScore: number;
  complianceScore: number;
  entitlements: ServiceEntitlement[];
  contractStart: string;
  contractEnd: string;
  monthlyRevenue: number;
  // Bundle All-in-One billing fields (optional)
  planTier?: "STARTER" | "PRO" | "SOUVERAIN";
  endpointCount?: number;
  seatLimit?: number;
  siemLimitGbDay?: number;
  billingCycle?: "MONTHLY" | "ANNUAL";
  invoiceDisplay?: string;
  // Multi-site structure (Phase 4): headquarter / subsidiary / agency
  orgType?: "HQ" | "SUBSIDIARY" | "AGENCY";
  parentOrgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Users
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgId: string | null;
  avatar?: string;
  status: 'active' | 'disabled';
  lastLogin: string;
  createdAt: string;
  mfaEnabled: boolean;
}

// Audit Log
export interface AuditEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  orgId: string | null;
  action: string;
  resource: string;
  resourceId: string;
  details: string;
  ip: string;
  outcome: 'success' | 'failure' | 'blocked';
}

// Threat Intel
export interface ThreatIntel {
  id: string;
  type: 'malware' | 'phishing' | 'ransomware' | 'apt' | 'ddos' | 'zero-day';
  severity: Severity;
  title: string;
  description: string;
  source: string;
  ioc: string;
  iocType: 'ip' | 'domain' | 'hash' | 'url';
  timestamp: string;
  confidence: number;
  mitreAttack: string[];
  affectedAssets: number;
  status: 'active' | 'mitigated' | 'investigating';
}

// Alerts / Incidents
export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  source: string;
  timestamp: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'escalated' | 'investigating';
  assignee?: string;
  description: string;
  playbook?: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: 'open' | 'investigating' | 'contained' | 'resolved' | 'closed';
  createdAt: string;
  updatedAt: string;
  assignee: string;
  affectedSystems: string[];
  timeline: { timestamp: string; action: string; actor: string }[];
  iocRelated: string[];
}

// Risk / Compliance
export interface RiskScore {
  overall: number;
  vulnerabilities: number;
  compliance: number;
  threatExposure: number;
  incidentResponse: number;
  trend: number[];
  change: number;
}

export interface ComplianceControl {
  id: string;
  framework: string;
  category: string;
  controlId: string;
  title: string;
  description: string;
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-assessed';
  score: number;
  evidence: string[];
  lastAssessed: string;
  nextReview: string;
}

export type NISTCategory = 'ID' | 'PR' | 'DE' | 'RS' | 'RC';

export interface NISTMapping {
  category: NISTCategory;
  categoryName: string;
  controls: { id: string; title: string; status: 'compliant' | 'partial' | 'non-compliant'; score: number }[];
  overallScore: number;
}

// Networking / PSA
export interface NetworkDevice {
  id: string;
  hostname: string;
  type: 'firewall' | 'switch' | 'router' | 'ap' | 'server' | 'endpoint';
  ip: string;
  status: 'online' | 'offline' | 'degraded';
  location: string;
  lastSeen: string;
  throughputMbps: number;
  alerts: number;
}

export interface PatchStatus {
  id: string;
  deviceName: string;
  os: string;
  pendingPatches: number;
  criticalPatches: number;
  lastScan: string;
  compliance: number;
}

export interface BackupJob {
  id: string;
  name: string;
  target: string;
  schedule: string;
  lastRun: string;
  nextRun: string;
  status: 'success' | 'failed' | 'running' | 'scheduled';
  sizeGB: number;
}
