// ---------------------------------------------------------------------------
// DEMO WORLD — ONE single coherent dataset for the whole simulated platform.
//
// This module is the SOLE source of truth for every demo number you see on
// screen: devices/assets, alerts, tickets, incidents, technicians, tenants,
// notifications and playbooks all reference the SAME ids and counts here.
// Nothing else may hard-code a device count or an alert total any more.
//
// It NEVER touches the real backend. The "Push Demo Dataset" button (visible
// only while Demo Mode is ON) calls installDemoWorld() which materialises
// this world into the in-memory simulated backend (services/demoMode.ts), so
// the ticketing engine, notification engine, playbooks, discovery and every
// dashboard read exactly the same synchronized data.
// ---------------------------------------------------------------------------

export const DEMO_WORLD_VERSION = '2026.10-1';
const LS_KEY = 'ic_demo_world_installed';

// ---- Tenants ---------------------------------------------------------------
// Moroccan clients (real-world references used for the demo only):
// org 1 = Damanecash      : Pro plan   -> 9 services + Advanced Ticketing
// org 2 = Valoris System  : Enterprise -> all 16 services + Advanced Ticketing
// org 3 = Vivalis Salaf   : SME plan   -> 5 services, NO ticketing
import type { PlanTier, BillingCycle } from '../config/pricing';

/** HQ | SUBSIDIARY | AGENCY — multi-site hierarchy (org_type on the real model). */
export type DemoOrgType = 'HQ' | 'SUBSIDIARY' | 'AGENCY';
export interface DemoTenant {
  id: number; name: string; tier: string; ticketing: boolean;
  // Bundle All-in-One billing (mirror of backend/app/core/pricing.py)
  planTier: PlanTier; billingCycle: BillingCycle;
  endpointCount: number; seatLimit: number; seatsUsed: number;
  siemLimitGbDay: number; siemGbDayUsed: number; country: string;
  // Multi-site structure (Phase 4): headquarter / subsidiary / agency
  orgType: DemoOrgType; parentOrgId: number | null; location: string;
}
export const demoTenants: DemoTenant[] = [
  { id: 1, name: 'Damanecash', tier: 'pro', ticketing: true,
    planTier: 'PRO', billingCycle: 'MONTHLY',
    endpointCount: 45, seatLimit: 20, seatsUsed: 12,
    siemLimitGbDay: 50, siemGbDayUsed: 31, country: 'ma',
    orgType: 'HQ', parentOrgId: null, location: 'Casablanca (HQ)' },
  { id: 2, name: 'Valoris System', tier: 'enterprise', ticketing: true,
    planTier: 'PRO', billingCycle: 'ANNUAL',           // BUNDLE PRO annual -> 396 MAD/endpoint
    endpointCount: 100, seatLimit: 20, seatsUsed: 15,
    siemLimitGbDay: 50, siemGbDayUsed: 42, country: 'ma',
    orgType: 'HQ', parentOrgId: null, location: 'Rabat (DC)' },
  { id: 3, name: 'Vivalis Salaf', tier: 'sme', ticketing: false,
    planTier: 'STARTER', billingCycle: 'MONTHLY',
    endpointCount: 18, seatLimit: 3, seatsUsed: 2,
    siemLimitGbDay: 10, siemGbDayUsed: 4, country: 'ma',
    orgType: 'SUBSIDIARY', parentOrgId: 1, location: 'Marrakech' },
];
// Atlas Cyber Services (partner MSP, y.elamrani@atlas-cyber.ma) — BUNDLE SOUVERAIN
export const demoPartnerBilling = {
  partnerEmail: 'y.elamrani@atlas-cyber.ma', planTier: 'SOUVERAIN' as PlanTier,
  billingCycle: 'ANNUAL' as BillingCycle, endpointCount: 320, seatLimit: 0, seatsUsed: 41,
  siemLimitGbDay: 150, siemGbDayUsed: 96, country: 'ma',
};

// ---- Technicians / users ---------------------------------------------------
export interface DemoTech { name: string; email: string; role: string; orgId: number; skills: string }
export const demoTechnicians: DemoTech[] = [
  { name: 'Y. El Amrani', email: 'y.elamrani@damanecash.ma', role: 'technician', orgId: 1, skills: 'Ransomware / EDR' },
  { name: 'S. Bennani', email: 's.bennani@damanecash.ma', role: 'technician', orgId: 1, skills: 'Patching / Linux' },
  { name: 'N. Benali', email: 'n.benali@damanecash.ma', role: 'service-desk', orgId: 1, skills: 'VPN / SaaS' },
  { name: 'K. Chraibi', email: 'k.chraibi@valorissystem.ma', role: 'technician', orgId: 2, skills: 'Network / SD-WAN' },
  { name: 'A. Fassi', email: 'a.fassi@valorissystem.ma', role: 'analyst', orgId: 2, skills: 'SIEM / Hunting' },
  { name: 'H. Tazi', email: 'h.tazi@vivalissalaf.ma', role: 'technician', orgId: 3, skills: 'Backup / Storage' },
  { name: 'demo@infracentra.io', email: 'demo@infracentra.io', role: 'client_admin', orgId: 1, skills: '—' },
];

// ---- Devices / assets ------------------------------------------------------
// 24 monitored devices spread over the three tenants. These exact hostnames
// are reused by alerts, tickets and patches => cross-page consistency.
export interface DemoDevice {
  id: string; hostname: string; type: string; ip: string; status: 'online' | 'offline' | 'degraded';
  location: string; orgId: number; os: string; lastSeenMin: number; throughputMbps: number; alerts: number;
  /** True on the machine where the INFRAvx collector agent is installed —
   *  auto-discovery & SNMP scans are launched FROM this probe. */
  isProbe?: boolean;
}
const D = (id: string, hostname: string, type: string, ip: string, status: DemoDevice['status'], location: string, orgId: number, os: string, lastSeenMin: number, throughputMbps: number, alerts: number, isProbe = false): DemoDevice =>
  ({ id, hostname, type, ip, status, location, orgId, os, lastSeenMin, throughputMbps, alerts, isProbe });

// ---- Monitoring Rules (platform-admin tenant manager) -----------------------
// One rule per demo tenant by default so the Rules tab is never empty.
export interface DemoRule {
  id: string; name: string; scope: 'asset' | 'client' | 'platform'; target_asset_id: string | null;
  trigger_metric: string; operator: string; threshold: string; duration_min: number;
  action: 'create_ticket' | 'notify' | 'suppress_alert' | 'none'; ticket_priority: string;
  notify_channels: string[]; enabled: boolean; created_by: string; created_at: string;
}
export const demoRulesSeed: DemoRule[] = [
  { id: 'RUL-001', name: 'CPU serveur > 85 % → ticket P2', scope: 'client', target_asset_id: null, trigger_metric: 'cpu', operator: '>', threshold: '85', duration_min: 5, action: 'create_ticket', ticket_priority: 'P2', notify_channels: ['email'], enabled: true, created_by: 'ops@infracentra.io', created_at: '2026-10-02T09:00:00Z' },
  { id: 'RUL-002', name: 'Site offline → notifier le DSI', scope: 'client', target_asset_id: null, trigger_metric: 'status', operator: '==', threshold: 'offline', duration_min: 3, action: 'notify', ticket_priority: 'P3', notify_channels: ['email', 'sms'], enabled: true, created_by: 'ops@infracentra.io', created_at: '2026-10-05T14:30:00Z' },
  { id: 'RUL-003', name: 'Backup failed nas-archive-02 → ticket P3', scope: 'asset', target_asset_id: 'nd-rb-2', trigger_metric: 'event', operator: '==', threshold: 'backup_failed', duration_min: 0, action: 'create_ticket', ticket_priority: 'P3', notify_channels: ['email'], enabled: true, created_by: 'it@vivalissalaf.ma', created_at: '2026-10-11T08:10:00Z' },
];

export const demoDevices: DemoDevice[] = [
  // Damanecash (org 1) — 12 devices, Casablanca HQ + DR site
  D('nd-1', 'fw-edge-01', 'firewall', '10.0.0.1', 'online', 'CAS-HQ-DC1', 1, 'OPNsense 24.7', 0, 840, 1, true), // PROBE: collector agent installed here
  D('nd-2', 'sw-core-01', 'switch', '10.0.1.1', 'online', 'CAS-HQ-DC1', 1, 'iOS 17.6', 0, 2400, 0),
  D('nd-3', 'ap-floor3-02', 'ap', '10.0.5.33', 'degraded', 'CAS-HQ-F3', 1, 'UniFi 8.0', 2, 120, 2),
  D('nd-4', 'rtr-wan-01', 'router', '10.0.0.2', 'online', 'CAS-HQ-DC1', 1, 'IOS-XE 17.9', 0, 950, 0),
  D('nd-5', 'ap-conf-01', 'ap', '10.0.5.40', 'offline', 'CAS-HQ-Conf', 1, 'UniFi 8.0', 35, 0, 1),
  D('nas-backup-01', 'nas-backup-01', 'storage', '10.0.9.10', 'online', 'DR-RBAT-DC2', 1, 'TrueNAS 24.10', 0, 610, 1),
  D('db-primary-01', 'db-primary-01', 'server', '10.0.8.5', 'online', 'CAS-HQ-DC1', 1, 'Ubuntu 22.04', 0, 320, 1),
  D('FIN-WS-042', 'FIN-WS-042', 'endpoint', '10.0.20.42', 'online', 'CAS-HQ-F2', 1, 'Windows 11 23H2', 0, 45, 1),
  D('app-node-03', 'app-node-03', 'server', '10.0.7.13', 'degraded', 'CAS-HQ-DC1', 1, 'RHEL 9', 0, 280, 1),
  D('web-prod-02', 'web-prod-02', 'server', '10.0.6.12', 'online', 'DMZ', 1, 'Debian 12', 0, 190, 1),
  D('HR-DB-001', 'HR-DB-001', 'server', '10.0.8.9', 'online', 'CAS-HQ-DC1', 1, 'RHEL 9', 0, 150, 0),
  D('MKT-WS-018', 'MKT-WS-018', 'endpoint', '10.0.24.18', 'online', 'CAS-HQ-F4', 1, 'macOS 14.2', 1, 30, 0),
  // Valoris System (org 2) — 8 devices, Rabat DC + branches
  D('dc-core-sw-01', 'dc-core-sw-01', 'switch', '10.1.1.1', 'online', 'RB-DC-1', 2, 'NX-OS 10.2', 0, 3100, 1, true), // PROBE
  D('vpn-gw-01', 'vpn-gw-01', 'firewall', '10.1.0.1', 'online', 'RB-DC-1', 2, 'Tailscale subnet', 0, 480, 1),
  D('DEV-SRV-007', 'DEV-SRV-007', 'server', '10.1.4.7', 'online', 'RB-Office', 2, 'Ubuntu 22.04', 0, 210, 1),
  D('CI-CD-Runner-01', 'CI-CD-Runner-01', 'server', '10.1.4.21', 'online', 'RB-DC-1', 2, 'Debian 12', 0, 90, 0),
  D('PKG-REG-001', 'PKG-REG-001', 'server', '10.1.4.30', 'online', 'RB-DC-1', 2, 'Alpine 3.19', 0, 60, 0),
  D('BRU-RT-01', 'BRU-RT-01', 'router', '10.1.0.2', 'degraded', ' Tanger-Branch', 2, 'VyOS 1.4', 4, 220, 1),
  D('LYO-AP-01', 'LYO-AP-01', 'ap', '10.1.5.11', 'online', 'Casa-Branch', 2, 'UniFi 8.0', 0, 140, 0),
  D('GLX-FW-EDGE', 'VLS-FW-EDGE', 'firewall', '10.1.0.9', 'online', 'RB-DC-1', 2, 'pfSense 2.7', 0, 700, 0),
  // Vivalis Salaf (org 3) — 4 devices, Marrakech office
  D('INI-FW-01', 'VVS-FW-01', 'firewall', '10.2.0.1', 'online', 'MQ-Office', 3, 'OPNsense 24.7', 0, 300, 0, true), // PROBE
  D('nas-archive-02', 'nas-archive-02', 'storage', '10.2.9.10', 'degraded', 'MQ-Office', 3, 'OpenMediaVault 7', 3, 80, 1),
  D('VVS-SRV-01', 'VVS-SRV-01', 'server', '10.2.8.5', 'online', 'MQ-Office', 3, 'Windows Server 2022', 0, 110, 0),
  D('VVS-WS-003', 'VVS-WS-003', 'endpoint', '10.2.20.3', 'offline', 'MQ-Office', 3, 'Windows 11', 120, 0, 0),
];

// ---- Alerts ----------------------------------------------------------------
// Every alert references a REAL device from demoDevices above.
export interface DemoAlertSeed {
  uid: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low';
  source: string; hostname: string; orgId: number; minutesAgo: number; correlated: number; description: string;
}
export const demoAlertSeeds: DemoAlertSeed[] = [
  { uid: 'ALR-0001', title: 'Ransomware precursor: vssadmin + mass renames', severity: 'critical', source: 'wazuh', hostname: 'nas-backup-01', orgId: 1, minutesAgo: 46, correlated: 4, description: 'Shadow copy deletion followed by high-entropy renames on \\\\NAS-01\\finance.' },
  { uid: 'ALR-0002', title: 'Brute-force SSH attempts from 45.132.87.10', severity: 'high', source: 'wazuh', hostname: 'fw-edge-01', orgId: 1, minutesAgo: 91, correlated: 23, description: '23 failed authentications in 60s against sshd on the DMZ gateway.' },
  { uid: 'ALR-0003', title: 'Unauthorized privilege escalation attempt', severity: 'critical', source: 'suricata', hostname: 'dc-core-sw-01', orgId: 2, minutesAgo: 150, correlated: 1, description: 'TGP-3 payload observed targeting the management VLAN.' },
  { uid: 'ALR-0004', title: 'CPU sustained above 92% for 15 minutes', severity: 'medium', source: 'monitor', hostname: 'app-node-03', orgId: 1, minutesAgo: 30, correlated: 3, description: 'Load average 12.4 on a 4-vCPU host.' },
  { uid: 'ALR-0005', title: 'Backup job failed with checksum mismatch', severity: 'low', source: 'backup-agent', hostname: 'nas-archive-02', orgId: 3, minutesAgo: 210, correlated: 1, description: 'Nightly snapshot verification failed.' },
  { uid: 'ALR-0006', title: 'Anomalous outbound traffic 4.7 GB (off-hours)', severity: 'high', source: 'network-dlp', hostname: 'FIN-WS-042', orgId: 1, minutesAgo: 120, correlated: 2, description: 'Unusual egress volume to an external IP during non-business hours.' },
  { uid: 'ALR-0007', title: 'CVE-2026-31337 unpatched OpenSSL RCE detected', severity: 'critical', source: 'vuln-scanner', hostname: 'db-primary-01', orgId: 1, minutesAgo: 300, correlated: 1, description: 'Authenticated scan found CVSS 9.8 on the production database.' },
  { uid: 'ALR-0008', title: 'TLS certificate expires in 6 days', severity: 'medium', source: 'monitor', hostname: 'web-prod-02', orgId: 1, minutesAgo: 200, correlated: 1, description: 'portal.damanecash.ma certificate expires soon.' },
  { uid: 'ALR-0009', title: 'Access point ap-conf-01 unreachable', severity: 'high', source: 'nms', hostname: 'ap-conf-01', orgId: 1, minutesAgo: 35, correlated: 5, description: 'ICMP/SNMP timeouts since 08:45 — PoE port suspected.' },
  { uid: 'ALR-0010', title: 'Compromised npm package beaconing detected', severity: 'high', source: 'edr', hostname: 'DEV-SRV-007', orgId: 2, minutesAgo: 65, correlated: 3, description: 'Outbound to known malicious registry mirror from CI runner.' },
  { uid: 'ALR-0011', title: 'SD-WAN tunnel flapping BRU↔PAR', severity: 'medium', source: 'sdwan', hostname: 'BRU-RT-01', orgId: 2, minutesAgo: 80, correlated: 9, description: '9 tunnel state changes in 30 min, packet loss 4.2%.' },
  { uid: 'ALR-0012', title: 'VPN concurrent seats at 96% capacity', severity: 'low', source: 'monitor', hostname: 'vpn-gw-01', orgId: 2, minutesAgo: 25, correlated: 1, description: 'Quarter-close peak approaching license limit.' },
];

// ---- Tickets ---------------------------------------------------------------
// Assets below MUST exist in demoDevices (same hostnames).
export interface DemoTicketSeed {
  uid: string; title: string; description: string; status: string; priority: string; category: string;
  source: string; assignee: string | null; orgId: number; asset: string | null; tags: string[];
  sla_state: string; minutesAgo: number; ai_confidence?: number; alertUid?: string; resolvedMinutesAgo?: number;
  vulnerability_ref?: string;
}
export const demoTicketSeeds: DemoTicketSeed[] = [
  { uid: 'TCK-01001', title: 'Ransomware precursor: mass file renames on NAS', description: 'EDR flagged vssadmin shadow-copy deletion followed by bulk rename on \\\\NAS-01\\finance.', status: 'escalated', priority: 'p1', category: 'incident', source: 'alert_engine', assignee: 'Y. El Amrani', orgId: 1, asset: 'nas-backup-01', tags: ['ransomware', 'edr'], sla_state: 'at_risk', minutesAgo: 45, ai_confidence: 0.97, alertUid: 'ALR-0001' },
  { uid: 'TCK-01002', title: 'Critical CVE-2026-31337 on production database', description: 'Authenticated scan found unpatched OpenSSL RCE on db-primary-01.', status: 'open', priority: 'p1', category: 'vulnerability', source: 'vuln-scanner', assignee: 'S. Bennani', orgId: 1, asset: 'db-primary-01', tags: ['cve', 'patching'], sla_state: 'breached', minutesAgo: 300, ai_confidence: 0.93, vulnerability_ref: 'CVE-2026-31337' },
  { uid: 'TCK-01003', title: 'VPN concentration peak — license upgrade request', description: 'Sales team exceeds concurrent VPN seats during quarter-close.', status: 'pending', priority: 'p3', category: 'service_request', source: 'portal', assignee: 'N. Benali', orgId: 2, asset: 'vpn-gw-01', tags: ['vpn', 'capacity'], sla_state: 'paused', minutesAgo: 1400, ai_confidence: 0.81, alertUid: 'ALR-0012' },
  { uid: 'TCK-01004', title: 'Repeated SSH brute-force from 45.132.87.10', description: '23 failed authentications in 60s against sshd on DMZ gateway.', status: 'triage', priority: 'p2', category: 'incident', source: 'alert_engine', assignee: null, orgId: 1, asset: 'fw-edge-01', tags: ['bruteforce', 'ssh'], sla_state: 'on_track', minutesAgo: 90, ai_confidence: 0.88, alertUid: 'ALR-0002' },
  { uid: 'TCK-01005', title: 'TLS certificate expires in 6 days (portal.damanecash.ma)', description: 'Automated monitor detected imminent expiry on web-prod-02.', status: 'new', priority: 'p2', category: 'change', source: 'monitor', assignee: null, orgId: 1, asset: 'web-prod-02', tags: ['certificate'], sla_state: 'on_track', minutesAgo: 200, alertUid: 'ALR-0008' },
  { uid: 'TCK-01006', title: 'Backup checksum mismatch on /vault/archive', description: 'Nightly snapshot verification failed on nas-archive-02.', status: 'resolved', priority: 'p4', category: 'problem', source: 'backup-agent', assignee: 'S. Bennani', orgId: 3, asset: 'nas-archive-02', tags: ['backup'], sla_state: 'met', minutesAgo: 3000, resolvedMinutesAgo: 2500, alertUid: 'ALR-0005' },
  { uid: 'TCK-01007', title: 'Privilege escalation attempt blocked on core switch', description: 'Suricata correlated TGP-3 payload toward management VLAN.', status: 'open', priority: 'p1', category: 'incident', source: 'alert_engine', assignee: 'K. Chraibi', orgId: 2, asset: 'dc-core-sw-01', tags: ['privesc', 'network'], sla_state: 'at_risk', minutesAgo: 150, ai_confidence: 0.91, alertUid: 'ALR-0003' },
  { uid: 'TCK-01008', title: 'Data exfiltration suspicion from FIN-WS-042', description: 'Network DLP recorded 4.7 GB egress off-hours.', status: 'triage', priority: 'p2', category: 'incident', source: 'alert_engine', assignee: 'A. Fassi', orgId: 1, asset: 'FIN-WS-042', tags: ['dlp', 'exfiltration'], sla_state: 'on_track', minutesAgo: 120, ai_confidence: 0.84, alertUid: 'ALR-0006' },
  { uid: 'TCK-01009', title: 'Wi-Fi coverage complaint — conference room', description: 'Users report dead zone; ap-conf-01 offline since morning.', status: 'open', priority: 'p3', category: 'service_request', source: 'portal', assignee: 'N. Benali', orgId: 1, asset: 'ap-conf-01', tags: ['wifi'], sla_state: 'on_track', minutesAgo: 35, alertUid: 'ALR-0009' },
  { uid: 'TCK-01010', title: 'Quarantine CI artifacts (compromised npm package)', description: 'Backdoor identified in dependency @utils/auth-helper@2.4.1.', status: 'in_progress', priority: 'p1', category: 'incident', source: 'alert_engine', assignee: 'K. Chraibi', orgId: 2, asset: 'DEV-SRV-007', tags: ['supply-chain', 'ci-cd'], sla_state: 'at_risk', minutesAgo: 65, ai_confidence: 0.9, alertUid: 'ALR-0010' },
  { uid: 'TCK-01011', title: 'SD-WAN tunnel instability Tanger branch', description: 'Repeated flap + 4.2% loss on Tanger↔Rabat tunnel.', status: 'open', priority: 'p2', category: 'problem', source: 'monitor', assignee: 'K. Chraibi', orgId: 2, asset: 'BRU-RT-01', tags: ['sdwan'], sla_state: 'on_track', minutesAgo: 80, alertUid: 'ALR-0011' },
  { uid: 'TCK-01012', title: 'Duplicate: SSH brute-force (same source IP)', description: 'Auto-detected duplicate of TCK-01004.', status: 'closed', priority: 'p3', category: 'incident', source: 'alert_engine', assignee: null, orgId: 1, asset: 'fw-edge-01', tags: ['duplicate'], sla_state: 'met', minutesAgo: 3200, resolvedMinutesAgo: 3100 },
];

// ---- Playbooks -------------------------------------------------------------
export const demoPlaybookSeeds = [
  { name: 'Contain compromised host', description: 'Isolate the asset at the switch port, kill active sessions, snapshot memory.', category: 'containment', enabled: true, steps: [{ name: 'Quarantine VLAN move', action: 'firewall.isolate' }, { name: 'Revoke sessions', action: 'identity.revoke_sessions' }, { name: 'Memory capture', action: 'edr.capture_mem' }] },
  { name: 'Block attacking IP', description: 'Add source IP to edge blocklist for 24h and verify drop rate.', category: 'edge_defense', enabled: true, steps: [{ name: 'Edge blocklist add', action: 'firewall.block_ip' }, { name: 'Verify drops', action: 'monitor.check_metric' }] },
  { name: 'Emergency patch rollout', description: 'Push vendor patch to affected CMDB assets and re-scan.', category: 'remediation', enabled: true, steps: [{ name: 'Stage package', action: 'patch.stage' }, { name: 'Rollout ring 0', action: 'patch.deploy' }, { name: 'Re-authenticated scan', action: 'vuln.scan_assets' }] },
  { name: 'Ransomware playbook (IR-Ransomware-001)', description: 'Isolate endpoint, disable account, preserve evidence, open P1 ticket.', category: 'containment', enabled: true, steps: [{ name: 'EDR quarantine', action: 'edr.quarantine' }, { name: 'Disable AD account', action: 'identity.disable' }, { name: 'Evidence snapshot', action: 'forensics.snapshot' }] },
];

// ---- Aggregates ------------------------------------------------------------
export interface DemoWorldStats {
  devicesTotal: number; devicesOnline: number; devicesOffline: number; devicesDegraded: number;
  alertsTotal: number; alertsOpen: number; alertsCritical: number;
  ticketsTotal: number; ticketsOpen: number; ticketsP1: number;
  technicians: number; tenants: number; playbooks: number;
}
export function computeDemoStats(): DemoWorldStats {
  const dev = demoDevices;
  return {
    devicesTotal: dev.length,
    devicesOnline: dev.filter(d => d.status === 'online').length,
    devicesOffline: dev.filter(d => d.status === 'offline').length,
    devicesDegraded: dev.filter(d => d.status === 'degraded').length,
    alertsTotal: demoAlertSeeds.length,
    alertsOpen: demoAlertSeeds.filter(a => a.severity !== 'low').length,
    alertsCritical: demoAlertSeeds.filter(a => a.severity === 'critical').length,
    ticketsTotal: demoTicketSeeds.length,
    ticketsOpen: demoTicketSeeds.filter(t => !['resolved', 'closed'].includes(t.status)).length,
    ticketsP1: demoTicketSeeds.filter(t => t.priority === 'p1').length,
    technicians: demoTechnicians.length,
    tenants: demoTenants.length,
    playbooks: demoPlaybookSeeds.length,
  };
}

// ---- Install flag ----------------------------------------------------------
export function isDemoWorldInstalled(): boolean {
  try { return localStorage.getItem(LS_KEY) === DEMO_WORLD_VERSION; } catch { return false; }
}
export function markDemoWorldInstalled() {
  try { localStorage.setItem(LS_KEY, DEMO_WORLD_VERSION); } catch { /* ignore */ }
}
export function clearDemoWorldFlag() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
