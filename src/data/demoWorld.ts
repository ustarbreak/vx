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
// org 1 = Damanecash      : Pro pack   -> 12 services + Advanced Ticketing
// org 2 = Valoris System  : Souverain  -> all 17 services + Advanced Ticketing
// org 3 = Vivalis Salaf   : Starter    -> 5 services, NO ticketing
import type { PackId } from './pricingConfig';

/** Legacy v1 tier names kept as display aliases on tenant records; V2 ids are lowercase packs. */
export type PlanTierAlias = 'STARTER' | 'PRO' | 'SOUVERAIN';
export type BillingCycleAlias = 'MONTHLY' | 'ANNUAL';

/** HQ | SUBSIDIARY | AGENCY — multi-site hierarchy (org_type on the real model). */
export type DemoOrgType = 'HQ' | 'SUBSIDIARY' | 'AGENCY';
export interface DemoTenant {
  id: number; name: string; tier: string; ticketing: boolean;
  // Pricing V2 billing (mirror of backend/app/services/pricing_engine.py).
  // `pack` is the V2 PackId; planTier/billingCycle remain legacy display aliases
  // (ANNUAL maps to a 12-month contract in the V2 engine).
  pack: PackId; planTier: PlanTierAlias; billingCycle: BillingCycleAlias;
  contractMonths: 0 | 12 | 24 | 36;
  endpointCount: number; seatLimit: number; seatsUsed: number;
  siemLimitGbDay: number; siemGbDayUsed: number; country: string;
  // Multi-site structure (Phase 4): headquarter / subsidiary / agency
  orgType: DemoOrgType; parentOrgId: number | null; location: string;
}
export const demoTenants: DemoTenant[] = [
  { id: 1, name: 'Damanecash', tier: 'pro', ticketing: true,
    pack: 'pro', planTier: 'PRO', billingCycle: 'MONTHLY', contractMonths: 0,
    endpointCount: 45, seatLimit: 20, seatsUsed: 12,
    siemLimitGbDay: 50, siemGbDayUsed: 31, country: 'ma',
    orgType: 'HQ', parentOrgId: null, location: 'Casablanca (HQ)' },
  { id: 2, name: 'Valoris System', tier: 'enterprise', ticketing: true,
    pack: 'souverain', planTier: 'SOUVERAIN', billingCycle: 'ANNUAL', contractMonths: 12,
    endpointCount: 100, seatLimit: 20, seatsUsed: 15,
    siemLimitGbDay: 50, siemGbDayUsed: 42, country: 'ma',
    orgType: 'HQ', parentOrgId: null, location: 'Rabat (DC)' },
  { id: 3, name: 'Vivalis Salaf', tier: 'sme', ticketing: false,
    pack: 'starter', planTier: 'STARTER', billingCycle: 'MONTHLY', contractMonths: 0,
    endpointCount: 18, seatLimit: 3, seatsUsed: 2,
    siemLimitGbDay: 10, siemGbDayUsed: 4, country: 'ma',
    orgType: 'SUBSIDIARY', parentOrgId: 1, location: 'Marrakech' },
];
// Atlas Cyber Services (partner MSP, y.elamrani@atlas-cyber.ma) — SOUVERAIN wholesale
export const demoPartnerBilling = {
  partnerEmail: 'y.elamrani@atlas-cyber.ma', pack: 'souverain' as PackId,
  planTier: 'SOUVERAIN' as PlanTierAlias, billingCycle: 'ANNUAL' as BillingCycleAlias,
  contractMonths: 12 as const, endpointCount: 320, seatLimit: 0, seatsUsed: 41,
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
  // Client admins referenced by DEMO_ACCOUNTS (login page Quick Demo) and by
  // the backend seeder (Settings → Seed demo tenant). They must exist here so
  // demo-mode login resolves them with role client_admin — otherwise they fall
  // through to resolveDemoUser's generic path or 401 on the real backend, and
  // users "can't access the client admin account".
  { name: 'Damanecash Admin', email: 'admin@damanecash.ma', role: 'client_admin', orgId: 1, skills: 'Administration' },
  { name: 'Damanecash CISO', email: 'ciso@damanecash.ma', role: 'client_admin', orgId: 1, skills: 'Governance / Compliance' },
  { name: 'Valoris SOC Manager', email: 'soc@valorissystem.ma', role: 'client_admin', orgId: 2, skills: 'SOC / Monitoring' },
  { name: 'Vivalis Salaf IT Admin', email: 'it@vivalissalaf.ma', role: 'client_admin', orgId: 3, skills: 'IT Administration' },
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
/** Approximate geolocation attached to a demo alert — mirrors the optional
 *  geo block accepted by POST /api/alerts (GeoPoint) and persisted into
 *  Alert.raw_payload by merge_geo_payload(). lat/lon are city-level
 *  approximations ONLY (never "the attacker's exact location"). */
export interface DemoGeoPoint { lat: number; lon: number; country: string; confidence: number }
export interface DemoAlertSeed {
  uid: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low';
  source: string; hostname: string; orgId: number; minutesAgo: number; correlated: number; description: string;
  /** Optional geographic context for the Worldwide Attack Map (demo fixtures). */
  srcGeo?: DemoGeoPoint; dstGeo?: DemoGeoPoint;
  /** observed = plain telemetry | malicious = classified by a detection engine | confirmed = verified attack. */
  classification?: 'observed' | 'malicious' | 'confirmed';
}
// Demo geo fixtures for the Worldwide Attack Map. Coordinates are city-level
// APPROXIMATIONS (IP-geolocation style) attached to security-relevant seeds
// only — telemetry/monitor alerts stay geo-less so the map's "geo-only"
// filtering behaves exactly like the real backend. These fixtures are used
// strictly inside the Demo Mode branch of demoStore.handle().
const G = {
  moscow:   { lat: 55.75, lon: 37.62, country: 'RU', confidence: 0.7 },
  beijing:  { lat: 39.9, lon: 116.4, country: 'CN', confidence: 0.72 },
  lagos:    { lat: 6.52, lon: 3.38, country: 'NG', confidence: 0.6 },
  amsterdam:{ lat: 52.37, lon: 4.9, country: 'NL', confidence: 0.8 },
  saopaulo: { lat: -23.55, lon: -46.63, country: 'BR', confidence: 0.65 },
  casablanca:{ lat: 33.57, lon: -7.59, country: 'MA', confidence: 0.9 },
  rabat:    { lat: 34.02, lon: -6.84, country: 'MA', confidence: 0.9 },
  marrakech:{ lat: 31.63, lon: -8.0, country: 'MA', confidence: 0.88 },
};
export const demoAlertSeeds: DemoAlertSeed[] = [
  { uid: 'ALR-0001', title: 'Ransomware precursor: vssadmin + mass renames', severity: 'critical', source: 'wazuh', hostname: 'nas-backup-01', orgId: 1, minutesAgo: 46, correlated: 4, description: 'Shadow copy deletion followed by high-entropy renames on \\\\NAS-01\\finance.', dstGeo: G.casablanca, classification: 'malicious' },
  { uid: 'ALR-0002', title: 'Brute-force SSH attempts from 45.132.87.10', severity: 'high', source: 'wazuh', hostname: 'fw-edge-01', orgId: 1, minutesAgo: 91, correlated: 23, description: '23 failed authentications in 60s against sshd on the DMZ gateway.', srcGeo: G.moscow, dstGeo: G.casablanca, classification: 'malicious' },
  { uid: 'ALR-0003', title: 'Unauthorized privilege escalation attempt', severity: 'critical', source: 'suricata', hostname: 'dc-core-sw-01', orgId: 2, minutesAgo: 150, correlated: 1, description: 'TGP-3 payload observed targeting the management VLAN.', srcGeo: G.beijing, dstGeo: G.rabat, classification: 'confirmed' },
  { uid: 'ALR-0004', title: 'CPU sustained above 92% for 15 minutes', severity: 'medium', source: 'monitor', hostname: 'app-node-03', orgId: 1, minutesAgo: 30, correlated: 3, description: 'Load average 12.4 on a 4-vCPU host.' },
  { uid: 'ALR-0005', title: 'Backup job failed with checksum mismatch', severity: 'low', source: 'backup-agent', hostname: 'nas-archive-02', orgId: 3, minutesAgo: 210, correlated: 1, description: 'Nightly snapshot verification failed.' },
  { uid: 'ALR-0006', title: 'Anomalous outbound traffic 4.7 GB (off-hours)', severity: 'high', source: 'network-dlp', hostname: 'FIN-WS-042', orgId: 1, minutesAgo: 120, correlated: 2, description: 'Unusual egress volume to an external IP during non-business hours.', srcGeo: G.casablanca, dstGeo: G.lagos, classification: 'observed' },
  { uid: 'ALR-0007', title: 'CVE-2026-31337 unpatched OpenSSL RCE detected', severity: 'critical', source: 'vuln-scanner', hostname: 'db-primary-01', orgId: 1, minutesAgo: 300, correlated: 1, description: 'Authenticated scan found CVSS 9.8 on the production database.' },
  { uid: 'ALR-0008', title: 'TLS certificate expires in 6 days', severity: 'medium', source: 'monitor', hostname: 'web-prod-02', orgId: 1, minutesAgo: 200, correlated: 1, description: 'portal.damanecash.ma certificate expires soon.' },
  { uid: 'ALR-0009', title: 'Access point ap-conf-01 unreachable', severity: 'high', source: 'nms', hostname: 'ap-conf-01', orgId: 1, minutesAgo: 35, correlated: 5, description: 'ICMP/SNMP timeouts since 08:45 — PoE port suspected.' },
  { uid: 'ALR-0010', title: 'Compromised npm package beaconing detected', severity: 'high', source: 'edr', hostname: 'DEV-SRV-007', orgId: 2, minutesAgo: 65, correlated: 3, description: 'Outbound to known malicious registry mirror from CI runner.', srcGeo: G.rabat, dstGeo: G.amsterdam, classification: 'malicious' },
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

// ---------------------------------------------------------------------------
// CANONICAL SLICES — every remaining dashboard number in the app is derived
// from these records (or served by the backend tables seeded with the exact
// same values). Deterministic only: `demoHash` replaces every Math.random()
// so demo mode and real mode render identical figures.
// ---------------------------------------------------------------------------

/** Deterministic string hash (same algorithm used by DeviceStatistics). */
export function demoHash(str: string, mod: number): number {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % mod;
  return h;
}

/** Stable base metric for a device — identical in demo & real mode. */
export const demoDeviceMetrics = (hostname: string, salt = '') => ({
  cpu: demoHash(hostname + 'cpu' + salt, 61),          // 0..60
  memory: 25 + demoHash(hostname + 'mem' + salt, 56), // 25..80
  disk: 20 + demoHash(hostname + 'dsk' + salt, 61),   // 20..80
});

// ---- Email security alerts (EmailSecurityPage) ------------------------------
// Mail gateways are REAL devices of the demo world (firewalls terminate SMTP).
export interface DemoEmailAlert {
  id: string; type: 'phishing' | 'malware' | 'spam' | 'spoofing';
  severity: 'critical' | 'high' | 'medium' | 'low';
  sender: string; recipient: string; subject: string;
  timestamp: string; status: 'blocked' | 'quarantined' | 'delivered' | 'investigating';
  device: string; ticketCreated: boolean; orgId: number;
}
export const demoEmailAlerts: DemoEmailAlert[] = [
  { id: 'EMAIL-0001', type: 'phishing', severity: 'critical', sender: 'compte@damanecash-verification.ma', recipient: 'finance@damanecash.ma', subject: 'Urgent : vérification du compte requise', timestamp: '2026-10-26T09:30:00Z', status: 'blocked', device: 'fw-edge-01', ticketCreated: true, orgId: 1 },
  { id: 'EMAIL-0002', type: 'malware', severity: 'high', sender: 'facture@valoris-invoicing.net', recipient: 'compta@valorissystem.ma', subject: 'Votre facture #VS-88412 (pièce jointe)', timestamp: '2026-10-26T08:45:00Z', status: 'quarantined', device: 'VLS-FW-EDGE', ticketCreated: false, orgId: 2 },
  { id: 'EMAIL-0003', type: 'spoofing', severity: 'medium', sender: 'dsi@damanecash.ma (display-name forgé)', recipient: 'n.benali@damanecash.ma', subject: 'Virement urgent avant clôture', timestamp: '2026-10-26T07:20:00Z', status: 'investigating', device: 'fw-edge-01', ticketCreated: true, orgId: 1 },
  { id: 'EMAIL-0004', type: 'spam', severity: 'low', sender: 'promo@newsletters-ma.com', recipient: 'all@vivalissalaf.ma', subject: 'Offre spéciale juste pour vous !', timestamp: '2026-10-26T06:10:00Z', status: 'blocked', device: 'VVS-FW-01', ticketCreated: false, orgId: 3 },
];

// ---- Endpoint protection alerts (EndpointProtectionPage) --------------------
// Every device/IP below exists in demoDevices above.
export interface DemoEndpointAlert {
  id: string; type: 'malware' | 'ransomware' | 'exploit' | 'suspicious' | 'fileless';
  severity: 'critical' | 'high' | 'medium' | 'low';
  device: string; deviceIp: string; threat: string;
  action: 'blocked' | 'quarantined' | 'detected' | 'cleaned';
  timestamp: string; ticketCreated: boolean; details: string; orgId: number;
}
export const demoEndpointAlerts: DemoEndpointAlert[] = [
  { id: 'EDR-0001', type: 'ransomware', severity: 'critical', device: 'nas-backup-01', deviceIp: '10.0.9.10', threat: 'LockBit 4.0 (vssadmin + renames)', action: 'blocked', timestamp: '2026-10-26T09:45:00Z', ticketCreated: true, details: 'Shadow-copy deletion blocked, files restored from snapshot. Linked to ALR-0001 / TCK-01001.', orgId: 1 },
  { id: 'EDR-0002', type: 'malware', severity: 'high', device: 'web-prod-02', deviceIp: '10.0.6.12', threat: 'Trojan.GenericKD', action: 'quarantined', timestamp: '2026-10-26T08:30:00Z', ticketCreated: false, details: 'Quarantined in /tmp upload handler. Full scan clean.', orgId: 1 },
  { id: 'EDR-0003', type: 'fileless', severity: 'critical', device: 'FIN-WS-042', deviceIp: '10.0.20.42', threat: 'PowerShell Empire', action: 'blocked', timestamp: '2026-10-26T07:15:00Z', ticketCreated: true, details: 'Fileless attack in memory blocked; correlates with 4.7 GB off-hours egress (ALR-0006 / TCK-01008).', orgId: 1 },
  { id: 'EDR-0004', type: 'exploit', severity: 'high', device: 'db-primary-01', deviceIp: '10.0.8.5', threat: 'CVE-2026-31337 (OpenSSL RCE)', action: 'detected', timestamp: '2026-10-26T06:05:00Z', ticketCreated: true, details: 'Exploit attempt against unpatched OpenSSL. Ticket TCK-01002 open for emergency patch.', orgId: 1 },
  { id: 'EDR-0005', type: 'suspicious', severity: 'medium', device: 'DEV-SRV-007', deviceIp: '10.1.4.7', threat: '@utils/auth-helper@2.4.1 (supply-chain)', action: 'quarantined', timestamp: '2026-10-26T05:50:00Z', ticketCreated: true, details: 'Compromised npm beaconing to malicious registry mirror. ALR-0010 / TCK-01010.', orgId: 2 },
  { id: 'EDR-0006', type: 'malware', severity: 'low', device: 'MKT-WS-018', deviceIp: '10.0.24.18', threat: 'Adware.GenVariant', action: 'cleaned', timestamp: '2026-10-25T22:10:00Z', ticketCreated: false, details: 'Browser extension removed, system rebooted clean.', orgId: 1 },
];

// ---- Network interfaces (NetworkStatisticsPage) -----------------------------
// Derived deterministically from demoDevices (hash of hostname) — never random.
export interface DemoNetInterface {
  id: string; deviceUid: string; hostname: string; ip: string; type: string;
  status: 'online' | 'offline' | 'warning'; ifName: string; speedMbps: number;
  inboundMbps: number; outboundMbps: number; packetsIn: number; packetsOut: number;
  errors: number; location: string; orgId: number;
}
export const demoNetInterfaces: DemoNetInterface[] = demoDevices
  .filter(d => ['firewall', 'switch', 'router', 'ap', 'server'].includes(d.type))
  .map((d, i) => {
    const bw = d.status === 'offline' ? 0 : Math.max(5, Math.round(d.throughputMbps * (0.35 + demoHash(d.hostname, 30) / 100)));
    return {
      id: `NI-${String(i + 1).padStart(3, '0')}`, deviceUid: d.id, hostname: d.hostname, ip: d.ip,
      type: d.type === 'ap' ? 'access-point' : d.type, status: d.status === 'degraded' ? 'warning' as const : d.status,
      ifName: d.type === 'firewall' || d.type === 'router' ? 'eth0' : d.type === 'switch' ? 'port-channel1' : 'ens1f0',
      speedMbps: d.throughputMbps, inboundMbps: bw,
      outboundMbps: d.status === 'offline' ? 0 : Math.max(3, Math.round(bw * (0.4 + demoHash(d.hostname + 'o', 40) / 100))),
      packetsIn: d.status === 'offline' ? 0 : 40_000 + demoHash(d.hostname + 'pi', 220_000),
      packetsOut: d.status === 'offline' ? 0 : 30_000 + demoHash(d.hostname + 'po', 180_000),
      errors: d.status === 'online' ? demoHash(d.hostname + 'e', 3) : d.status === 'degraded' ? 8 + demoHash(d.hostname + 'e', 12) : 0,
      location: d.location, orgId: d.orgId,
    };
  });

// ---- API keys (PlatformClientsPage) — keyed by demo tenant ids 1/2/3 -------
export interface DemoApiKey {
  id: string; orgId: number; key: string; label: string;
  createdAt: string; lastUsed: string; status: 'active' | 'revoked';
}
export const demoApiKeys: DemoApiKey[] = [
  { id: 'AK-0001', orgId: 1, key: 'ic_live_dmnc_8f2a4c6e1b9d3f5a7c0e2b4d', label: 'SIEM webhook (Damanecash)', createdAt: '2026-06-15', lastUsed: '2026-10-26T09:00:00Z', status: 'active' },
  { id: 'AK-0002', orgId: 1, key: 'ic_test_dmnc_1a2b3c4d5e6f7a8b9c0d1e2f', label: 'Intégration portail client', createdAt: '2026-07-02', lastUsed: '2026-10-25T18:00:00Z', status: 'active' },
  { id: 'AK-0003', orgId: 2, key: 'ic_live_vsys_3c5c7c9c1c3e5c7c9c1e3c5c', label: 'Pipeline CI/CD sécurisé', createdAt: '2026-09-20', lastUsed: '2026-10-26T07:40:00Z', status: 'active' },
  { id: 'AK-0004', orgId: 3, key: 'ic_live_vslf_7e9d1f3a5c7e9d1f3a5c7e9d', label: 'Agent backup nas-archive-02', createdAt: '2026-11-01', lastUsed: '2026-10-26T06:30:00Z', status: 'active' },
  { id: 'AK-0005', orgId: 3, key: 'ic_test_vslf_0b2c4d6e8f0a1b2c3d4e5f6a', label: 'Test migration (révoqué)', createdAt: '2026-08-11', lastUsed: '2026-09-30T12:00:00Z', status: 'revoked' },
];

// ---- Licenses (PlatformClientsPage) — one per demo tenant ------------------
export interface DemoLicense {
  id: string; orgId: number; type: string; pack: PackId; seats: number; endpoints: number;
  expiresAt: string; status: 'active' | 'expiring' | 'expired';
}
export const demoLicenses: DemoLicense[] = demoTenants.map(t => ({
  id: `LIC-2026-${String(t.id).padStart(3, '0')}`, orgId: t.id,
  type: `${t.planTier} — ${t.billingCycle === 'ANNUAL' ? 'Annuel' : 'Mensuel'}`,
  pack: t.pack, seats: t.seatLimit, endpoints: t.endpointCount,
  expiresAt: t.billingCycle === 'ANNUAL' ? '2027-06-30' : '2026-12-31',
  status: (t.id === 3 ? 'expiring' : 'active') as DemoLicense['status'],
}));

// ---- Platform audit seed (PlatformAuditPage / admin.audit-platform) --------
export interface DemoPlatformAuditSeed { id: number; action: string; detail: string; actor: string; created_at: string }
export const demoPlatformAudit: DemoPlatformAuditSeed[] = [
  { id: 1, action: 'organization.created', detail: 'Tenant « Vivalis Salaf » rattaché à Damanecash (SUBSIDIARY, plan STARTER)', actor: 'ops@infracentra.io', created_at: '2026-10-11T08:10:00Z' },
  { id: 2, action: 'rule.updated', detail: 'RUL-003 activé : backup failed nas-archive-02 → ticket P3', actor: 'it@vivalissalaf.ma', created_at: '2026-10-11T08:22:00Z' },
  { id: 3, action: 'alert.storm_suppressed', detail: 'fw-edge-01 : 23 tentatives SSH corrélées en 1 alerte ALR-0002', actor: 'system', created_at: '2026-10-26T08:15:00Z' },
  { id: 4, action: 'ticket.escalated', detail: 'TCK-01001 escaladée P1 (précurseur ransomware nas-backup-01)', actor: 'y.elamrani@damanecash.ma', created_at: '2026-10-26T09:05:00Z' },
  { id: 5, action: 'playbook.executed', detail: '« Block attacking IP » exécuté sur 45.132.87.10 (edge blocklist 24h)', actor: 'system', created_at: '2026-10-26T08:20:00Z' },
  { id: 6, action: 'license.viewed', detail: 'Consultation licence LIC-2026-002 (Valoris System, SOUVERAIN annuel)', actor: 'k.chraibi@valorissystem.ma', created_at: '2026-10-25T16:40:00Z' },
];

// ---- Health statuses (PerformanceStatisticsPage) ----------------------------
export interface DemoHealthStatus {
  component: string; status: 'healthy' | 'warning' | 'critical';
  value: number; threshold: number; message: string; orgId: number;
}
const HEALTH_BASE: Record<number, [number, number]> = { 1: [52, 78], 2: [47, 69], 3: [38, 55] }; // [cpu, mem] baselines
export const demoHealthStatuses: DemoHealthStatus[] = demoTenants.flatMap(t => {
  const [cpu, mem] = HEALTH_BASE[t.id] ?? [45, 60];
  const devs = demoDevices.filter(d => d.orgId === t.id);
  const degraded = devs.filter(d => d.status !== 'online').length;
  const offline = devs.filter(d => d.status === 'offline').length;
  const dbHost = devs.find(d => d.type === 'server' && d.hostname.startsWith('db')) ?? devs.find(d => d.type === 'server');
  const fw = devs.find(d => d.type === 'firewall');
  const rows: DemoHealthStatus[] = [
    { component: 'CPU Usage', status: cpu > 75 ? 'warning' : 'healthy', value: cpu, threshold: 80, message: cpu > 75 ? 'High CPU usage detected' : 'Normal operation', orgId: t.id },
    { component: 'Memory Usage', status: mem > 75 ? 'warning' : 'healthy', value: mem, threshold: 75, message: mem > 75 ? 'High memory usage detected' : 'Normal operation', orgId: t.id },
    { component: 'Disk I/O', status: 'healthy', value: 45, threshold: 80, message: 'Normal disk activity', orgId: t.id },
    { component: 'Network Latency', status: fw && fw.status !== 'online' ? 'warning' : 'healthy', value: fw && fw.status !== 'online' ? 58 : 12, threshold: 50, message: fw && fw.status !== 'online' ? 'Edge gateway degraded' : 'Low latency', orgId: t.id },
    { component: 'Database Connections', status: dbHost && dbHost.alerts > 0 ? 'critical' : 'healthy', value: dbHost && dbHost.alerts > 0 ? 95 : 61, threshold: 90, message: dbHost && dbHost.alerts > 0 ? 'Connection pool nearly exhausted' : 'Within acceptable range', orgId: t.id },
    { component: 'API Response Time', status: 'healthy', value: 245, threshold: 500, message: 'Within acceptable range', orgId: t.id },
  ];
  if (offline > 0) rows.push({ component: 'Monitored Devices', status: 'warning', value: offline, threshold: 0, message: `${offline} device(s) unreachable — ${devs.filter(d => d.status === 'offline').map(d => d.hostname).join(', ')}`, orgId: t.id });
  else if (degraded > 0) rows.push({ component: 'Monitored Devices', status: 'warning', value: degraded, threshold: 0, message: `${degraded} device(s) degraded`, orgId: t.id });
  else rows.push({ component: 'Monitored Devices', status: 'healthy', value: 0, threshold: 0, message: 'All monitored devices online', orgId: t.id });
  return rows;
});

// ---- Vulnerabilities (feeds vuln pages, tickets, patches) -------------------
export interface DemoVulnerability {
  id: string; cve: string; cvss: number; severity: 'critical' | 'high' | 'medium' | 'low';
  hostname: string; deviceUid: string; orgId: number; port: number | null;
  status: 'open' | 'patched' | 'mitigated' | 'accepted'; discoveredDaysAgo: number;
  description: string; patchAvailable: boolean; ticketUid?: string;
}
export const demoVulnerabilities: DemoVulnerability[] = [
  { id: 'VLN-0001', cve: 'CVE-2026-31337', cvss: 9.8, severity: 'critical', hostname: 'db-primary-01', deviceUid: 'db-primary-01', orgId: 1, port: 5432, status: 'open', discoveredDaysAgo: 5, description: 'Unauthenticated OpenSSL RCE on the production database listener.', patchAvailable: true, ticketUid: 'TCK-01002' },
  { id: 'VLN-0002', cve: 'CVE-2026-29001', cvss: 7.5, severity: 'high', hostname: 'app-node-03', deviceUid: 'app-node-03', orgId: 1, port: 8080, status: 'open', discoveredDaysAgo: 12, description: 'HTTP/2 stream reset flood (DoS) on embedded Jetty.', patchAvailable: true },
  { id: 'VLN-0003', cve: 'CVE-2025-44011', cvss: 6.5, severity: 'medium', hostname: 'web-prod-02', deviceUid: 'web-prod-02', orgId: 1, port: 443, status: 'mitigated', discoveredDaysAgo: 40, description: 'TLS downgrade via legacy cipher suites; mitigated by config hardening.', patchAvailable: false },
  { id: 'VLN-0004', cve: 'CVE-2026-30512', cvss: 8.1, severity: 'high', hostname: 'DEV-SRV-007', deviceUid: 'DEV-SRV-007', orgId: 2, port: null, status: 'open', discoveredDaysAgo: 2, description: 'Supply-chain backdoor @utils/auth-helper@2.4.1 in CI image.', patchAvailable: true, ticketUid: 'TCK-01010' },
  { id: 'VLN-0005', cve: 'CVE-2026-17730', cvss: 5.3, severity: 'medium', hostname: 'BRU-RT-01', deviceUid: 'BRU-RT-01', orgId: 2, port: 22, status: 'open', discoveredDaysAgo: 21, description: 'Information disclosure via VyOS management API.', patchAvailable: true },
  { id: 'VLN-0006', cve: 'CVE-2024-6387', cvss: 8.1, severity: 'high', hostname: 'nas-archive-02', deviceUid: 'nas-archive-02', orgId: 3, port: 22, status: 'patched', discoveredDaysAgo: 90, description: 'OpenSSH regreSSHion race condition — patched during October window.', patchAvailable: true },
  { id: 'VLN-0007', cve: 'CVE-2026-22222', cvss: 3.7, severity: 'low', hostname: 'VVS-SRV-01', deviceUid: 'VVS-SRV-01', orgId: 3, port: 445, status: 'accepted', discoveredDaysAgo: 120, description: 'SMB signing disabled on isolated storage VLAN — risk accepted.', patchAvailable: false },
];

// ---- Compliance controls (ComplianceReports / health scores) ----------------
export interface DemoComplianceControl {
  id: string; framework: string; control: string; status: 'pass' | 'fail' | 'partial';
  evidence: string; hostname: string | null; orgId: number;
}
const CC = (framework: string, control: string, orgIds: number[], host: string | null, statuses: Record<number, 'pass' | 'fail' | 'partial'>, evidence: string): DemoComplianceControl[] =>
  orgIds.map((orgId, i) => ({ id: `CMP-${framework}-${orgId}-${control.split(' ')[0]}`, framework, control, status: statuses[orgId] ?? 'partial', evidence, hostname: host, orgId }));
const ALL_ORGS = [1, 2, 3];
export const demoComplianceControls: DemoComplianceControl[] = [
  ...CC('ISO27001', 'A.12.4 Log monitoring', ALL_ORGS, 'fw-edge-01', { 1: 'pass', 2: 'pass', 3: 'partial' }, 'SIEM ingestion verified on edge gateways (ALR pipeline active).'),
  ...CC('ISO27001', 'A.18.1 Backup resilience', ALL_ORGS, 'nas-backup-01', { 1: 'pass', 2: 'pass', 3: 'fail' }, 'nas-archive-02 checksum mismatch — see ALR-0005 / TCK-01006.'),
  ...CC('RGPD', 'Art.32 Encryption at rest', ALL_ORGS, 'db-primary-01', { 1: 'pass', 2: 'pass', 3: 'partial' }, 'TDE enabled on HR-DB-001 / db-primary-01; VVS-SRV-01 pending.'),
  ...CC('PCI-DSS', 'Req.6.2 Emergency patches', [1, 2], 'db-primary-01', { 1: 'fail', 2: 'partial' }, 'CVE-2026-31337 still open past SLA — ticket TCK-01002 breached.'),
  ...CC('PCI-DSS', 'Req.11.2 Quarterly scans', ALL_ORGS, null, { 1: 'pass', 2: 'pass', 3: 'pass' }, 'Authenticated vulnerability scans completed Oct 2026 (7 findings tracked).' ),
  ...CC('DNDD', 'Chiffrement des flux', ALL_ORGS, 'vpn-gw-01', { 1: 'pass', 2: 'pass', 3: 'partial' }, 'Site-to-site tunnels AES-256; VVS-FW-01 pending IKEv2 migration.'),
];

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
