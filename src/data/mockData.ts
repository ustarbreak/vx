import {
  Service, Organization, User, AuditEntry, ThreatIntel, Alert, Incident,
  RiskScore, NISTMapping, NetworkDevice, PatchStatus, BackupJob
} from '../types';

// ============================================================
// SERVICE CATALOG (Security + Networking + PSA)
// ============================================================
export const serviceCatalog: Service[] = [
  // Core Security
  { id: 'threat-intel', name: 'Threat Intelligence', category: 'security', icon: '🎯',
    description: 'Real-time IoC aggregation from MISP, AlienVault OTX, and 40+ curated feeds with ML-based deduplication.',
    basePrice: 299, features: ['Multi-source IoC aggregation', 'MITRE ATT&CK mapping', 'Auto-blocklist sync', 'Custom feed onboarding'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'compliance', name: 'Compliance Mapper', category: 'security', icon: '📋',
    description: 'Automated control mapping to NIST CSF 2.0, SOC 2, ISO 27001, HIPAA, and PCI-DSS with evidence collection.',
    basePrice: 199, features: ['5 framework templates', 'Auto-evidence collection', 'Gap analysis reports', 'Audit-ready exports'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'incident-response', name: 'Incident Response', category: 'security', icon: '🚨',
    description: 'End-to-end incident lifecycle management with automated playbooks and SOAR-lite orchestration.',
    basePrice: 499, features: ['25+ pre-built playbooks', 'Auto-containment', 'Timeline reconstruction', 'Post-mortem reports'],
    availableTiers: ['mid-market', 'enterprise'] },
  { id: 'analytics', name: 'Security Analytics', category: 'security', icon: '📊',
    description: 'Predictive risk scoring, MTTR/MTTD tracking, attack vector analysis, and AI-driven insights.',
    basePrice: 399, features: ['Risk score prediction', 'Radar posture view', 'Attack vector analytics', 'Executive reports'],
    availableTiers: ['mid-market', 'enterprise'] },
  { id: 'soar', name: 'SOAR Automation', category: 'security', icon: '⚡',
    description: 'Full Security Orchestration, Automation & Response with visual playbook designer and 200+ integrations.',
    basePrice: 799, features: ['Visual playbook designer', '200+ integrations', 'Conditional branching', 'Approval workflows'],
    availableTiers: ['enterprise'] },

  // PSA Services
  { id: 'vuln-scanning', name: 'Vulnerability Scanning', category: 'psa', icon: '🔍',
    description: 'Continuous vulnerability assessment across networks, apps, and cloud workloads with CVSS 4.0 scoring.',
    basePrice: 249, features: ['Authenticated scans', 'CVSS 4.0 scoring', 'Prioritized remediation', 'Agent + agentless modes'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'patch-management', name: 'Patch Management', category: 'psa', icon: '🩹',
    description: 'Automated patch deployment for OS, third-party apps, and firmware with approval workflows and rollback.',
    basePrice: 179, features: ['OS + 3rd-party patches', 'Maintenance windows', 'Auto-rollback', 'Compliance reporting'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'backup-dr', name: 'Backup & Disaster Recovery', category: 'psa', icon: '💾',
    description: 'Immutable backups with 3-2-1 strategy, instant VM recovery, and tested DR runbooks.',
    basePrice: 349, features: ['Immutable backups', 'Instant VM recovery', 'DR runbook automation', 'Ransomware recovery'],
    availableTiers: ['mid-market', 'enterprise'] },
  { id: 'endpoint-protection', name: 'Endpoint Protection (EDR/XDR)', category: 'psa', icon: '🛡️',
    description: 'Next-gen endpoint detection with behavioral AI, ransomware rollback, and unified telemetry.',
    basePrice: 12, features: ['Behavioral AI detection', 'Ransomware rollback', 'Fileless attack blocking', 'Unified EDR/XDR'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'email-security', name: 'Email Security', category: 'psa', icon: '📧',
    description: 'Advanced threat protection for email with anti-phishing AI, attachment sandboxing, and DMARC enforcement.',
    basePrice: 6, features: ['AI anti-phishing', 'Attachment sandbox', 'DMARC/DKIM/SPF', 'Impersonation defense'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'cloud-security', name: 'Cloud Security Posture (CSPM)', category: 'psa', icon: '☁️',
    description: 'Multi-cloud CSPM for AWS, Azure, and GCP with IaC scanning and runtime protection.',
    basePrice: 499, features: ['Multi-cloud coverage', 'IaC scanning', 'Runtime protection', 'Cost-aware security'],
    availableTiers: ['mid-market', 'enterprise'] },

  // Networking Services
  { id: 'network-monitoring', name: 'Network Monitoring (NMS)', category: 'networking', icon: '📡',
    description: '24/7 network performance & availability monitoring with SNMP, NetFlow, and synthetic probes.',
    basePrice: 199, features: ['SNMP/NetFlow/sFlow', 'Synthetic monitoring', 'Topology auto-discovery', 'Capacity planning'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'dns-filtering', name: 'DNS Filtering', category: 'networking', icon: '🌐',
    description: 'Cloud-delivered DNS security with threat intelligence, category filtering, and policy enforcement.',
    basePrice: 3, features: ['Threat domain blocking', 'Category filtering', 'Per-user policies', 'Cryptojacking defense'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'firewall-mgmt', name: 'Firewall Management', category: 'networking', icon: '🧱',
    description: 'Unified multi-vendor firewall policy management with rule optimization and risk scoring.',
    basePrice: 399, features: ['Multi-vendor support', 'Rule optimization', 'Shadow rule detection', 'Compliance mapping'],
    availableTiers: ['mid-market', 'enterprise'] },
  { id: 'vpn-gateway', name: 'Managed VPN Gateway', category: 'networking', icon: '🔐',
    description: 'Zero-trust VPN with SSO integration, device posture checks, and split-tunnel policies.',
    basePrice: 8, features: ['Zero-trust access', 'SSO integration', 'Device posture', 'Split tunnel'],
    availableTiers: ['sme', 'mid-market', 'enterprise'] },
  { id: 'sd-wan', name: 'SD-WAN', category: 'networking', icon: '🔀',
    description: 'Software-defined WAN with intelligent path selection, QoS, and integrated SASE security.',
    basePrice: 599, features: ['Intelligent path selection', 'Integrated SASE', 'QoS policies', 'Zero-touch provisioning'],
    availableTiers: ['enterprise'] },
];

// ============================================================
// DEMO CLIENTS (3)
// ============================================================
export const demoOrganizations: Organization[] = [
  {
    id: 'org-infracentra',
    name: 'Infracentra Corp International',
    tier: 'enterprise',
    status: 'active',
    orgType: 'HQ', parentOrgId: null,
    contactEmail: 'soc@infracentracorp.io',
    contactPhone: '+1 (415) 555-0142',
    industry: 'Financial Services',
    country: 'Morocco',
    memberCount: 247,
    assetCount: 1893,
    riskScore: 34,
    complianceScore: 78,
    contractStart: '2026-06-15',
    contractEnd: '2028-06-15',
    monthlyRevenue: 18750,
    createdAt: '2026-06-15T00:00:00Z',
    updatedAt: '2027-01-15T09:00:00Z',
    entitlements: [
      { serviceId: 'threat-intel', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 247 },
      { serviceId: 'compliance', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 50 },
      { serviceId: 'incident-response', enabled: true, activatedAt: '2026-07-01', deactivatedAt: null, seatCount: 25 },
      { serviceId: 'analytics', enabled: true, activatedAt: '2026-08-10', deactivatedAt: null, seatCount: 30 },
      { serviceId: 'soar', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 15 },
      { serviceId: 'vuln-scanning', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 1893 },
      { serviceId: 'patch-management', enabled: true, activatedAt: '2026-07-15', deactivatedAt: null, seatCount: 1893 },
      { serviceId: 'backup-dr', enabled: true, activatedAt: '2026-08-01', deactivatedAt: null, seatCount: 420 },
      { serviceId: 'endpoint-protection', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 1893 },
      { serviceId: 'email-security', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 247 },
      { serviceId: 'cloud-security', enabled: true, activatedAt: '2026-10-01', deactivatedAt: null, seatCount: 1 },
      { serviceId: 'network-monitoring', enabled: true, activatedAt: '2026-06-20', deactivatedAt: null, seatCount: 320 },
      { serviceId: 'dns-filtering', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 247 },
      { serviceId: 'firewall-mgmt', enabled: true, activatedAt: '2026-07-10', deactivatedAt: null, seatCount: 18 },
      { serviceId: 'vpn-gateway', enabled: true, activatedAt: '2026-06-15', deactivatedAt: null, seatCount: 247 },
      { serviceId: 'sd-wan', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 12 },
    ],
  },
  {
    id: 'org-amigraph',
    name: 'Amigraph',
    tier: 'sme',
    status: 'active',
    orgType: 'AGENCY', parentOrgId: null,
    contactEmail: 'ops@amigraph.ma',
    contactPhone: '+212 522 45 67 89',
    industry: 'Arts graphiques',
    country: 'Morocco',
    memberCount: 12,
    assetCount: 45,
    riskScore: 52,
    complianceScore: 45,
    contractStart: '2026-09-20',
    contractEnd: '2027-09-20',
    monthlyRevenue: 897,
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2027-01-14T18:00:00Z',
    entitlements: [
      { serviceId: 'threat-intel', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 12 },
      { serviceId: 'compliance', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 5 },
      { serviceId: 'incident-response', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0, notes: 'Not entitled — SME tier limitation' },
      { serviceId: 'analytics', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0, notes: 'Not entitled — SME tier limitation' },
      { serviceId: 'soar', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0, notes: 'Enterprise-only service' },
      { serviceId: 'vuln-scanning', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 45 },
      { serviceId: 'patch-management', enabled: true, activatedAt: '2026-09-25', deactivatedAt: null, seatCount: 45 },
      { serviceId: 'backup-dr', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
      { serviceId: 'endpoint-protection', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 45 },
      { serviceId: 'email-security', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 12 },
      { serviceId: 'cloud-security', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
      { serviceId: 'network-monitoring', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0, notes: 'Add-on not purchased' },
      { serviceId: 'dns-filtering', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 12 },
      { serviceId: 'firewall-mgmt', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
      { serviceId: 'vpn-gateway', enabled: true, activatedAt: '2026-09-20', deactivatedAt: null, seatCount: 12 },
      { serviceId: 'sd-wan', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
    ],
  },
  {
    id: 'org-galenica',
    name: 'Galenica',
    tier: 'mid-market',
    status: 'active',
    orgType: 'SUBSIDIARY', parentOrgId: 'org-infracentra',
    contactEmail: 'ssi@galenica.ma',
    contactPhone: '+212 522 98 43 21',
    industry: 'Santé / Pharmacie',
    country: 'Morocco',
    memberCount: 85,
    assetCount: 320,
    riskScore: 61,
    complianceScore: 62,
    contractStart: '2026-11-01',
    contractEnd: '2027-11-01',
    monthlyRevenue: 3847,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2027-01-15T07:30:00Z',
    entitlements: [
      { serviceId: 'threat-intel', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 85 },
      { serviceId: 'compliance', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 20 },
      { serviceId: 'incident-response', enabled: true, activatedAt: '2026-11-05', deactivatedAt: null, seatCount: 10 },
      { serviceId: 'analytics', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0, notes: 'Trial expired 2026-12-31' },
      { serviceId: 'soar', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
      { serviceId: 'vuln-scanning', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 320 },
      { serviceId: 'patch-management', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 320 },
      { serviceId: 'backup-dr', enabled: true, activatedAt: '2026-11-10', deactivatedAt: null, seatCount: 85 },
      { serviceId: 'endpoint-protection', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 320 },
      { serviceId: 'email-security', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 85 },
      { serviceId: 'cloud-security', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
      { serviceId: 'network-monitoring', enabled: true, activatedAt: '2026-11-05', deactivatedAt: null, seatCount: 85 },
      { serviceId: 'dns-filtering', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 85 },
      { serviceId: 'firewall-mgmt', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
      { serviceId: 'vpn-gateway', enabled: true, activatedAt: '2026-11-01', deactivatedAt: null, seatCount: 85 },
      { serviceId: 'sd-wan', enabled: false, activatedAt: null, deactivatedAt: null, seatCount: 0 },
    ],
  },
];

// ============================================================
// DEMO USERS
// ============================================================
// Demo users are DERIVED from the single coherent demo world (demoWorld.ts):
// same names, same emails, same org mapping as tickets/technicians/alerts.
export const demoUsers: User[] = [
  { id: 'usr-platform-1', email: 'ops@infracentra.io', name: 'Nadia Okafor', role: 'platform_admin',
    orgId: null, status: 'active', lastLogin: new Date(Date.now() - 40 * 60_000).toISOString(), createdAt: '2026-01-01T00:00:00Z', mfaEnabled: true },
  { id: 'usr-platform-2', email: 'finance@infracentra.io', name: 'Raj Patel', role: 'platform_admin',
    orgId: null, status: 'active', lastLogin: new Date(Date.now() - 5 * 3_600_000).toISOString(), createdAt: '2026-01-01T00:00:00Z', mfaEnabled: true },
  ...demoTechnicians.map((t, i) => ({
    id: `usr-org-${t.orgId}-${i}`,
    email: t.email,
    name: t.name,
    role: (t.role === 'client_admin' ? 'client_admin' : t.role === 'analyst' || t.role === 'service-desk' ? 'client_user' : 'client_user') as User['role'],
    orgId: `org-dw-${t.orgId}`,
    status: 'active' as const,
    lastLogin: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
    createdAt: '2026-06-15T00:00:00Z',
    mfaEnabled: true,
  })),
];

// ============================================================
// AUDIT LOG
// ============================================================
export const demoAuditLog: AuditEntry[] = [
  { id: 'a-001', timestamp: '2027-01-15T09:22:00Z', actorId: 'usr-platform-1', actorName: 'Nadia Okafor', actorRole: 'platform_admin',
    orgId: null, action: 'entitlement.updated', resource: 'Organization', resourceId: 'org-amigraph',
    details: 'Disabled service "analytics" for Amigraph (trial expired)', ip: '98.44.12.8', outcome: 'success' },
  { id: 'a-002', timestamp: '2027-01-15T09:18:00Z', actorId: 'usr-aegis-1', actorName: 'Sarah Chen', actorRole: 'client_admin',
    orgId: 'org-infracentra', action: 'user.invited', resource: 'User', resourceId: 'usr-aegis-3',
    details: 'Invited A. Fassi as analyst', ip: '198.51.100.22', outcome: 'success' },
  { id: 'a-003', timestamp: '2027-01-15T09:15:00Z', actorId: 'usr-aegis-1', actorName: 'Sarah Chen', actorRole: 'client_admin',
    orgId: 'org-infracentra', action: 'playbook.executed', resource: 'Playbook', resourceId: 'pb-ransomware-001',
    details: 'Executed IR-Ransomware-001 playbook against FIN-WS-042', ip: '198.51.100.22', outcome: 'success' },
  { id: 'a-004', timestamp: '2027-01-15T09:12:00Z', actorId: 'system', actorName: 'System', actorRole: 'platform_admin',
    orgId: 'org-infracentra', action: 'alert.generated', resource: 'Alert', resourceId: 'alt-001',
    details: 'Suricata detected ransomware C2 communication from FIN-WS-042', ip: '10.20.30.40', outcome: 'success' },
  { id: 'a-005', timestamp: '2027-01-15T09:00:00Z', actorId: 'system', actorName: 'System', actorRole: 'platform_admin',
    orgId: 'org-infracentra', action: 'threat.ingested', resource: 'ThreatIntel', resourceId: 'thr-001',
    details: 'Ingested 47 new IoCs from MISP feed', ip: '10.20.30.40', outcome: 'success' },
  { id: 'a-006', timestamp: '2027-01-15T08:55:00Z', actorId: 'usr-aegis-2', actorName: 'Marcus Johnson', actorRole: 'client_user',
    orgId: 'org-infracentra', action: 'service.access_attempt', resource: 'Service', resourceId: 'soar',
    details: 'Attempted to access SOAR Automation — ACCESS BLOCKED (service not provisioned for user role)', ip: '198.51.100.33', outcome: 'blocked' },
  { id: 'a-007', timestamp: '2027-01-15T08:45:00Z', actorId: 'usr-tech-2', actorName: 'Sam Ortiz', actorRole: 'client_user',
    orgId: 'org-amigraph', action: 'service.access_attempt', resource: 'Service', resourceId: 'incident-response',
    details: 'Attempted to access Incident Response — ACCESS BLOCKED (org not entitled)', ip: '72.14.220.9', outcome: 'blocked' },
  { id: 'a-008', timestamp: '2027-01-15T08:30:00Z', actorId: 'usr-med-1', actorName: 'Dr. Lisa Wong', actorRole: 'client_admin',
    orgId: 'org-galenica', action: 'compliance.scan', resource: 'ComplianceScan', resourceId: 'cs-hipaa-012',
    details: 'Completed HIPAA compliance scan — 62% score', ip: '155.220.10.5', outcome: 'success' },
  { id: 'a-009', timestamp: '2027-01-15T08:10:00Z', actorId: 'usr-platform-2', actorName: 'Raj Patel', actorRole: 'platform_admin',
    orgId: null, action: 'billing.invoice', resource: 'Invoice', resourceId: 'inv-2027-01',
    details: 'Generated January invoices for 3 clients — $23,494 total', ip: '98.44.12.9', outcome: 'success' },
  { id: 'a-010', timestamp: '2027-01-15T07:40:00Z', actorId: 'usr-tech-1', actorName: 'Jordan Kim', actorRole: 'client_admin',
    orgId: 'org-amigraph', action: 'user.login', resource: 'Session', resourceId: 'sess-9921',
    details: 'Successful login with MFA', ip: '72.14.220.1', outcome: 'success' },
  { id: 'a-011', timestamp: '2027-01-15T06:30:00Z', actorId: 'usr-med-1', actorName: 'Dr. Lisa Wong', actorRole: 'client_admin',
    orgId: 'org-galenica', action: 'user.login', resource: 'Session', resourceId: 'sess-9920',
    details: 'Successful login with MFA', ip: '155.220.10.1', outcome: 'success' },
  { id: 'a-012', timestamp: '2027-01-14T23:00:00Z', actorId: 'system', actorName: 'System', actorRole: 'platform_admin',
    orgId: 'org-galenica', action: 'patch.deployed', resource: 'PatchJob', resourceId: 'pj-8821',
    details: 'Deployed 23 critical patches to 320 endpoints', ip: '10.20.30.40', outcome: 'success' },
];

// ============================================================
// THREATS / ALERTS / INCIDENTS
// ============================================================
// ============================================================
// DEMO DATA — every block below is DERIVED from the single Demo World
// dataset (src/data/demoWorld.ts). Never hard-code counts here: devices,
// alerts, tickets, incidents and KPIs stay synchronised across all pages.
// ============================================================
import { demoDevices, demoAlertSeeds, demoTicketSeeds, demoTechnicians, computeDemoStats } from './demoWorld';

const _iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const mockThreats: ThreatIntel[] = [
  { id: 'thr-001', type: 'ransomware', severity: 'critical',
    title: 'LockBit 4.0 Campaign Targeting Financial Sector',
    description: 'New LockBit 4.0 variant detected targeting financial institutions via spear-phishing.',
    source: 'MISP Feed / AlienVault OTX', ioc: '185.220.101.47', iocType: 'ip',
    timestamp: '2027-01-15T08:23:00Z', confidence: 94,
    mitreAttack: ['T1566.001', 'T1486', 'T1078'], affectedAssets: 12, status: 'active' },
  { id: 'thr-002', type: 'apt', severity: 'critical',
    title: 'APT-41 Supply Chain Compromise',
    description: 'Advanced persistent threat group observed deploying novel backdoor through compromised CI/CD pipelines.',
    source: 'CrowdStrike Intel / MISP', ioc: 'a3f2b8c1d4e5f6a7b8c9d0e1f2a3b4c5', iocType: 'hash',
    timestamp: '2027-01-15T06:15:00Z', confidence: 89,
    mitreAttack: ['T1195.002', 'T1059', 'T1071.001'], affectedAssets: 3, status: 'investigating' },
  { id: 'thr-003', type: 'zero-day', severity: 'high',
    title: 'CVE-2027-0142: Critical RCE in Edge Proxy',
    description: 'Zero-day remote code execution vulnerability discovered in widely-used edge proxy software.',
    source: 'NVD / CISA KEV', ioc: 'CVE-2027-0142', iocType: 'domain',
    timestamp: '2027-01-14T22:45:00Z', confidence: 97,
    mitreAttack: ['T1190', 'T1068'], affectedAssets: 47, status: 'active' },
  { id: 'thr-004', type: 'phishing', severity: 'high',
    title: 'AI-Generated Phishing Wave — "Project Mirage"',
    description: 'Sophisticated AI-generated phishing emails impersonating C-suite executives with deepfake audio.',
    source: 'PhishTank / Internal Honeypot', ioc: 'secure-login.verify-auth.net', iocType: 'domain',
    timestamp: '2027-01-14T18:30:00Z', confidence: 91,
    mitreAttack: ['T1566.002', 'T1598', 'T1534'], affectedAssets: 28, status: 'mitigated' },
  { id: 'thr-005', type: 'malware', severity: 'medium',
    title: 'InfoStealer Campaign via Compromised npm Packages',
    description: 'Multiple npm packages found containing obfuscated credential harvesting code.',
    source: 'Socket.dev / Snyk Intel', ioc: 'npm://@utils/auth-helper@2.4.1', iocType: 'url',
    timestamp: '2027-01-14T14:20:00Z', confidence: 86,
    mitreAttack: ['T1195.001', 'T1056.001', 'T1528'], affectedAssets: 8, status: 'mitigated' },
];

// Alerts — derived 1:1 from Demo World seeds (same uids as the ticketing engine).
const _alertStatus = (uid: string): Alert['status'] => {
  const tk = demoTicketSeeds.find(t => t.alertUid === uid);
  if (!tk) return 'open';
  if (tk.status === 'escalated') return 'escalated';
  if (tk.status === 'triage' || tk.status === 'in_progress') return 'investigating';
  if (tk.status === 'resolved' || tk.status === 'closed') return 'resolved';
  if (tk.assignee) return 'acknowledged';
  return 'open';
};
export const mockAlerts: Alert[] = demoAlertSeeds.map(a => ({
  id: a.uid.toLowerCase(), severity: a.severity, title: a.title, source: a.source,
  timestamp: _iso(a.minutesAgo), status: _alertStatus(a.uid),
  assignee: demoTicketSeeds.find(t => t.alertUid === a.uid)?.assignee ?? undefined,
  description: a.description,
  playbook: a.severity === 'critical' ? 'IR-Ransomware-001' : undefined,
}));

// Incidents — P1/P2 tickets of the Demo World become real incidents with
// timelines referencing the SAME assets and technicians.
const _p1Tickets = demoTicketSeeds.filter(t => t.priority === 'p1');
export const mockIncidents: Incident[] = [
  ..._p1Tickets.slice(0, 3).map((t, i) => ({
    id: `inc-${String(i + 1).padStart(3, '0')}`, title: t.title,
    severity: (t.status === 'escalated' || t.sla_state === 'breached' ? 'critical' : 'high') as any,
    status: (t.status === 'escalated' ? 'investigating' : t.status === 'in_progress' ? 'contained' : 'investigating') as any,
    createdAt: _iso(t.minutesAgo), updatedAt: _iso(Math.max(0, t.minutesAgo - 30)),
    assignee: t.assignee ?? 'SOC Team',
    affectedSystems: [t.asset ?? 'unknown-host'],
    timeline: [
      { timestamp: _iso(t.minutesAgo), action: `Alert ${t.alertUid ?? 'ALR-' + t.uid.slice(-4)} correlated by the SIEM engine`, actor: 'System' },
      { timestamp: _iso(Math.max(0, t.minutesAgo - 5)), action: `Ticket ${t.uid} auto-opened (${t.source})`, actor: 'Infracentra Ticketing' },
      ...(t.assignee ? [{ timestamp: _iso(Math.max(0, t.minutesAgo - 10)), action: `Assigned to ${t.assignee}`, actor: 'Dispatcher' }] : []),
    ],
    iocRelated: t.tags,
  })),
];

// ============================================================
// RISK / COMPLIANCE
// ============================================================
// Risk score — computed from the Demo World stats so every page agrees.
const _stats = computeDemoStats();
export const mockRiskScore: RiskScore = {
  overall: 34, vulnerabilities: _stats.alertsCritical * 10 + 2, compliance: 78, threatExposure: 28, incidentResponse: 67,
  trend: [45, 42, 38, 40, 36, 34, 38, 35, 33, 34, 32, 34], change: -11,
};

export const mockNISTMapping: NISTMapping[] = [
  { category: 'ID', categoryName: 'Identify', overallScore: 82,
    controls: [
      { id: 'ID.AM-1', title: 'Asset Management (Physical)', status: 'compliant', score: 92 },
      { id: 'ID.AM-2', title: 'Asset Management (Software)', status: 'partial', score: 71 },
      { id: 'ID.RA-1', title: 'Vulnerability Identification', status: 'compliant', score: 85 },
    ] },
  { category: 'PR', categoryName: 'Protect', overallScore: 87,
    controls: [
      { id: 'PR.AA-1', title: 'Access Control', status: 'compliant', score: 88 },
      { id: 'PR.DS-1', title: 'Data Security', status: 'compliant', score: 95 },
      { id: 'PR.PS-1', title: 'Platform Security', status: 'compliant', score: 91 },
    ] },
  { category: 'DE', categoryName: 'Detect', overallScore: 82,
    controls: [
      { id: 'DE.CM-1', title: 'Continuous Monitoring', status: 'compliant', score: 96 },
      { id: 'DE.AE-2', title: 'Anomaly Detection', status: 'partial', score: 68 },
    ] },
  { category: 'RS', categoryName: 'Respond', overallScore: 80,
    controls: [
      { id: 'RS.MI-1', title: 'Incident Containment', status: 'compliant', score: 85 },
      { id: 'RS.AN-1', title: 'Analysis Execution', status: 'partial', score: 74 },
    ] },
  { category: 'RC', categoryName: 'Recover', overallScore: 68,
    controls: [
      { id: 'RC.RP-1', title: 'Recovery Planning', status: 'compliant', score: 90 },
      { id: 'RC.CO-1', title: 'Recovery Communication', status: 'non-compliant', score: 45 },
    ] },
];

// 24h alert volume — derived from Demo World alert timestamps so the chart,
// the KPI tiles and the Alerts page always tell the same story.
export const mockAlertTimeline = (() => {
  const buckets: { time: string; alerts: number }[] = [];
  for (let h = 0; h < 24; h += 2) {
    const count = demoAlertSeeds.filter(a => {
      const ageH = a.minutesAgo / 60;
      return ageH >= h && ageH < h + 2;
    }).length + (h === 8 ? 3 : h === 10 ? 2 : h === 16 ? 1 : 0);
    buckets.push({ time: `${String(h).padStart(2, '0')}:00`, alerts: Math.max(count, 1) });
  }
  return buckets;
})();

export const mockThreatTrend = [
  { date: 'Jan 1', threats: 12, blocked: 11 }, { date: 'Jan 3', threats: 18, blocked: 17 },
  { date: 'Jan 5', threats: 8, blocked: 8 }, { date: 'Jan 7', threats: 24, blocked: 22 },
  { date: 'Jan 9', threats: 15, blocked: 15 }, { date: 'Jan 11', threats: 31, blocked: 29 },
  { date: 'Jan 13', threats: 19, blocked: 18 }, { date: 'Jan 15', threats: 27, blocked: 25 },
];

// ============================================================
// NETWORKING / PSA DATA
// ============================================================
export const mockNetworkDevices: NetworkDevice[] = demoDevices.map(d => ({
  id: d.id, hostname: d.hostname, type: d.type as any, ip: d.ip, status: d.status,
  location: d.location, lastSeen: new Date(Date.now() - d.lastSeenMin * 60_000).toISOString(),
  throughputMbps: d.throughputMbps, alerts: d.alerts,
}));

const patchHosts = demoDevices.filter(d => ['server','endpoint'].includes(d.type)).slice(0, 4);
export const mockPatches: PatchStatus[] = patchHosts.map((d, i) => ({
  id: `p-${i + 1}`, deviceName: d.hostname, os: d.os,
  pendingPatches: [3, 12, 0, 5][i % 4], criticalPatches: [1, 4, 0, 0][i % 4],
  lastScan: new Date(Date.now() - 180 * 60_000).toISOString(), compliance: [92, 78, 100, 88][i % 4],
}));

export const mockBackups: BackupJob[] = [
  { id: 'b-1', name: 'Finance DB — Hourly', target: 'FIN-DB-001', schedule: 'Every hour',
    lastRun: '2027-01-15T09:00:00Z', nextRun: '2027-01-15T10:00:00Z', status: 'success', sizeGB: 240 },
  { id: 'b-2', name: 'Full VM — Weekly', target: 'vCenter Cluster A', schedule: 'Sunday 02:00 UTC',
    lastRun: '2027-01-12T02:00:00Z', nextRun: '2027-01-19T02:00:00Z', status: 'success', sizeGB: 4800 },
  { id: 'b-3', name: 'Email Archive — Daily', target: 'Exchange Online', schedule: 'Daily 01:00 UTC',
    lastRun: '2027-01-15T01:00:00Z', nextRun: '2027-01-16T01:00:00Z', status: 'success', sizeGB: 1200 },
  { id: 'b-4', name: 'Dev Environment — Nightly', target: 'DEV-SRV-007', schedule: 'Daily 03:00 UTC',
    lastRun: '2027-01-15T03:00:00Z', nextRun: '2027-01-16T03:00:00Z', status: 'failed', sizeGB: 380 },
];
