// ---------------------------------------------------------------------------
// DEMO MODE — fully client-side simulated backend.
//
// When the visitor picks "Demo Mode" on the login page (localStorage key
// `ic_demo_mode` = '1'), every API call made through src/services/api.ts is
// answered HERE, from an in-memory dataset that mimics the FastAPI backend:
// Advanced Ticketing, Alerts / Notification Rules / Notifications, Playbooks,
// Discovery and Settings. No network request is ever sent, so the demo works
// identically on Kali and Windows even when Docker/Postgres/the API are not
// running — and it can never pollute real data.
//
// Turning Demo Mode OFF instantly restores 100% real-backend behaviour.
// ---------------------------------------------------------------------------

import {
  demoTenants, demoDevices, demoAlertSeeds, demoTicketSeeds, demoPlaybookSeeds, demoTechnicians,
  computeDemoStats, isDemoWorldInstalled, markDemoWorldInstalled, DEMO_WORLD_VERSION,
} from '../data/demoWorld';
import { demoProjects } from '../data/demoProjects';
import { partners, partnerProgramStats } from '../data/partnerWorld';
import { demoRulesSeed, type DemoRule } from '../data/demoWorld';

// ---------------------------------------------------------------------------
// Phase 4 stores — in-memory mirrors of backend/app/routers/tenant_manager.py
// and backend/app/routers/partners_admin.py. Same shapes real vs demo.
// ---------------------------------------------------------------------------
const monitoringRules: DemoRule[] = JSON.parse(JSON.stringify(demoRulesSeed));
/** Service grants overriding the plan entitlements, keyed by tenant id. */
const grantsStore: Record<string, Record<string, { enabled: boolean; override_plan: boolean; granted_by: string; updated_at: string }>> = {};
// goinfra enrollment tokens (demo): secret shown once, kept in memory per org.
const agentTokensStore: Record<string, any[]> = {};
/** Platform-level audit trail for admin actions (grants, rules, partners). */
const platformAudit: { id: number; action: string; detail: string; actor: string; created_at: string }[] = [];
let pAuditSeq = 1;
function pushPlatformAudit(action: string, detail: string) {
  platformAudit.unshift({ id: pAuditSeq++, action, detail, actor: demoSession().email ?? 'ops@infracentra.io', created_at: new Date().toISOString() });
  if (platformAudit.length > 200) platformAudit.pop();
}

// ---------------------------------------------------------------------------
// Project Manager — in-memory store mirroring backend/app/routers/projects.py.
// Scope rules are identical: platform_admin sees/creates 'internal' projects
// (assigned to an organization, never without one); client users see ALL
// projects of their own org ('internal' = with us, 'client' = their own).
// ---------------------------------------------------------------------------
let projectSeq = 300;
let milestoneSeq = 100;
const projectsStore = JSON.parse(JSON.stringify(demoProjects)) as any[];

function demoSession(): { role?: string; orgId?: string | null; email?: string } {
  try { return JSON.parse(localStorage.getItem('ic_demo_session') ?? '{}'); } catch { return {}; }
}
function callerOrgId(): number | null {
  const s = demoSession();
  if (s.role === 'platform_admin') return null;
  const m = /^org-dw-(\d+)$/.exec(String(s.orgId ?? ''));
  if (m) return Number(m[1]);
  // Fallback: resolve the tenant from the logged-in email's Moroccan domain.
  const domOrg: Record<string, number> = { 'damanecash.ma': 1, 'valorissystem.ma': 2, 'vivalissalaf.ma': 3 };
  return domOrg[String(s.email ?? '').split('@')[1]?.toLowerCase()] ?? 1;
}
function serializeProject(p: any) {
  let slaStatus = 'none';
  if (p.sla_hours) {
    const remainingH = p.sla_hours - Math.round(p.time_spent_seconds / 3600);
    slaStatus = p.status === 'completed' ? 'met' : remainingH < 0 ? 'breached' : remainingH < 24 ? 'at_risk' : 'on_track';
  }
  const done = p.milestones.filter((m: any) => m.done).length;
  return { ...p, sla_status: slaStatus, progress_pct: p.milestones.length ? Math.round(100 * done / p.milestones.length) : 0 };
}

export function isDemoMode(): boolean {
  return localStorage.getItem('ic_demo_mode') === '1';
}

export function setDemoMode(on: boolean) {
  localStorage.setItem('ic_demo_mode', on ? '1' : '0');
  if (on && !isDemoWorldInstalled()) installDemoWorld();
  window.dispatchEvent(new Event('demo-mode-changed'));
}

// Auto-materialise the coherent demo world the first time Demo Mode is used,
// so every engine/dashboard is synchronized even before clicking the button.
function installDemoWorld() {
  markDemoWorldInstalled();
}

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

// -- demo tenants ------------------------------------------------------------
interface DemoOrg { id: number; name: string; tier: string; ticketing: boolean }
const orgs: DemoOrg[] = demoTenants.map(t => ({ ...t }));

// Bundle All-in-One billing per tenant, computed with the SHARED pricing engine
// (src/config/pricing.ts) so the UI numbers always match the backend formula.
import { computeInvoice, formatMoney, TIER_LIMITS as TIER_LIMITS_MAP, ANNUAL_MULTIPLIER as ANNUAL_MULT } from '../config/pricing';
function billingForTenant(id: number) {
  const t = demoTenants.find((x) => x.id === id);
  if (!t) return {};
  const inv = computeInvoice({
    planTier: t.planTier, billingCycle: t.billingCycle, endpointCount: t.endpointCount,
    seatsUsed: t.seatsUsed, siemGbDayUsed: t.siemGbDayUsed, country: t.country,
  });
  return {
    plan_tier: t.planTier, billing_cycle: t.billingCycle,
    endpoint_count: t.endpointCount, seat_limit: t.seatLimit, seats_used: t.seatsUsed,
    siem_limit_gb: t.siemLimitGbDay, siem_gb_day_used: t.siemGbDayUsed,
    currency: inv.currency, monthly_invoice_mad: inv.totalMad,
    monthly_invoice_display: `${formatMoney(inv.totalDisplay, inv.currency)} /mois HT`,
  };
}

let ticketSeq = 1000;
let alertSeq = 1;
let notifSeq = 1;
let ruleSeq = 100;

const mkTicket = (t: Partial<any> & { title: string }) => ({
  id: ticketSeq++,
  uid: `TCK-${String(ticketSeq).padStart(5, '0')}`,
  org_id: 1,
  description: '',
  status: 'open',
  priority: 'p3',
  category: 'incident',
  source: 'manual',
  assignee: null,
  reporter: 'demo@infracentra.io',
  tags: [] as string[],
  asset: null,
  vulnerability_ref: null,
  ai_category: null,
  ai_priority: null,
  ai_confidence: null,
  ai_reasoning: [] as string[],
  ai_predicted_root_cause: null,
  duplicate_of: null,
  sla_state: 'on_track',
  breach_prediction: null,
  sla_response_minutes: 30,
  sla_resolution_minutes: 240,
  due_response_at: iso(-20),
  due_resolve_at: iso(-180),
  first_response_at: null,
  resolved_at: null,
  escalation_level: 0,
  alert_id: null,
  created_at: iso(60),
  updated_at: iso(30),
  ...t,
});

// Seed tickets — materialised from the single Demo World dataset so that
// ticket assets, alert resources and monitored devices always agree.
const tickets: any[] = demoTicketSeeds.map(s => mkTicket({
  uid: s.uid,
  title: s.title,
  description: s.description,
  status: s.status, priority: s.priority, category: s.category, source: s.source,
  assignee: s.assignee, tags: s.tags, asset: s.asset, org_id: s.orgId,
  sla_state: s.sla_state, created_at: iso(s.minutesAgo), updated_at: iso(Math.max(0, s.minutesAgo - 15)),
  escalation_level: s.status === 'escalated' ? 2 : 0,
  alert_id: (() => { const a = demoAlertSeeds.findIndex(x => x.uid === s.alertUid); return a >= 0 ? a + 1 : null; })(),
  resolved_at: s.resolvedMinutesAgo !== undefined ? iso(s.resolvedMinutesAgo) : null,
  first_response_at: s.resolvedMinutesAgo !== undefined ? iso(s.minutesAgo - 5) : null,
  ...(s.vulnerability_ref ? { vulnerability_ref: s.vulnerability_ref } : {}),
  ...(s.ai_confidence !== undefined ? {
    ai_category: s.category, ai_priority: s.priority, ai_confidence: s.ai_confidence,
    ai_reasoning: ['Correlated signals from Demo World alert engine'],
  } : {}),
}));
ticketSeq = 1012; // next manual ticket keeps the sequence coherent

const evidenceByUid: Record<string, any[]> = {};
// Project attachments store (demo mirror of the backend ProjectAttachment table).
const projectAttachments: Record<number, any[]> = {};
let attSeq = 1;
/** Byte length of a base64 string without decoding it. */
function atobSize(b64: string): number { return Math.floor(b64.length * 3 / 4); }
/** Deterministic FNV-1a hex "hash" for demo evidence/attachment integrity lines. */
function demoHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8).repeat(4);
}
const auditByUid: Record<string, any[]> = {};
const approvalsByUid: Record<string, any[]> = {};

const pushEvidence = (uid: string, name: string, kind: string, sizeKb: number) => {
  (evidenceByUid[uid] ??= []).push({
    id: Math.floor(Math.random() * 1e6), ticket_uid: uid, kind, name,
    size_kb: sizeKb, sha256: Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('') + '…',
    collected_by: 'demo-collector', immutable: true, created_at: iso(40),
  });
};
const pushAudit = (uid: string, actor: string, action: string, detail: string, minutesAgo: number) => {
  const list = (auditByUid[uid] ??= []);
  const prev = list.length ? list[list.length - 1].entry_hash : 'GENESIS';
  list.push({
    seq: list.length + 1, created_at: iso(minutesAgo), actor, action, detail,
    prev_hash: prev, entry_hash: 'sha256:' + btoa(uid + action + list.length).replace(/=/g, ''),
  });
};

tickets.forEach(t => {
  pushEvidence(t.uid, `${t.asset ?? 'host'}_syslog_last24h.txt`, 'log', 128 + (t.id % 7) * 34);
  pushEvidence(t.uid, 'network_capture.pcap', 'pcap', 512);
  pushAudit(t.uid, 'system', 'created', `Ticket opened via ${t.source}`, 60);
  pushAudit(t.uid, 'ai-engine', 'triage', `AI classified as ${t.ai_category ?? t.category}/${t.ai_priority ?? t.priority}`, 59);
  if (t.assignee) pushAudit(t.uid, 'dispatcher', 'assigned', `Assigned to ${t.assignee}`, 55);
  if (['resolved', 'closed'].includes(t.status)) pushAudit(t.uid, t.assignee ?? 'agent', 'resolved', 'Work completed, evidence attached', 20);
});
approvalsByUid[tickets[0].uid] = [{
  id: 1, ticket_uid: tickets[0].uid, step: 1, approver_role: 'security_lead',
  status: 'pending', note: 'Closure requires lead sign-off for P1 incidents.', decided_by: null, decided_at: null,
}];

// -- alerts / rules / notifications ------------------------------------------
// Alerts are materialised from the Demo World seeds; ticket_uid is resolved by
// matching the alertUid link declared on the ticket seed => perfect sync.
const ticketsByAlertUid: Record<string, string> = {};
demoTicketSeeds.forEach(s => { if (s.alertUid) ticketsByAlertUid[s.alertUid] = s.uid; });

const alerts: any[] = demoAlertSeeds.map((s, i) => ({
  id: i + 1, uid: s.uid, org_id: s.orgId, title: s.title, severity: s.severity, source: s.source,
  resource: s.hostname, correlated_count: s.correlated, storm_suppressed: s.correlated > 10,
  acked_by: null, acked_at: null, ticket_uid: ticketsByAlertUid[s.uid] ?? null,
  created_at: iso(s.minutesAgo), description: s.description,
}));
alertSeq = demoAlertSeeds.length + 1;

const rules: any[] = [
  { id: 1, name: 'P1 auto-escalation', org_id: null, enabled: true, conditions: { severity: ['critical'] }, channels: ['email', 'sms', 'webhook'], recipients: ['soc-leads@infracentra.io'], create_ticket: true, ticket_priority: 'p1', escalate_after_minutes: 15, quiet_hours: null, created_at: iso(9000) },
  { id: 2, name: 'High sev → email on-call', org_id: null, enabled: true, conditions: { severity: ['high'] }, channels: ['email'], recipients: ['oncall@infracentra.io'], create_ticket: true, ticket_priority: 'p2', escalate_after_minutes: 30, quiet_hours: null, created_at: iso(8000) },
  { id: 3, name: 'Vuln scanner digest (daily)', org_id: null, enabled: false, conditions: { source: ['vuln-scanner'] }, channels: ['email'], recipients: ['cto@damanecash.ma'], create_ticket: false, ticket_priority: 'p3', escalate_after_minutes: 0, quiet_hours: { start: '21:00', end: '07:00' }, created_at: iso(7000) },
];

const notifications: any[] = [
  { id: notifSeq++, org_id: 1, alert_id: 1, rule_id: 1, channel: 'email', recipient: 'soc-leads@infracentra.io', subject: '[CRITICAL] Ransomware precursor on NAS-01', body: 'Immediate containment recommended.', severity: 'critical', status: 'sent', attempts: 1, last_error: null, sent_at: iso(45), acked_by: null, acked_at: null, created_at: iso(45) },
  { id: notifSeq++, org_id: 1, alert_id: 1, rule_id: 1, channel: 'sms', recipient: '+33 6 12 34 56 78', subject: 'P1 incident escalated', body: 'TCK-01001 awaiting containment.', severity: 'critical', status: 'sent', attempts: 1, last_error: null, sent_at: iso(45), acked_by: null, acked_at: null, created_at: iso(45) },
  { id: notifSeq++, org_id: 1, alert_id: 2, rule_id: 2, channel: 'email', recipient: 'oncall@infracentra.io', subject: '[HIGH] SSH brute-force fw-edge-01', body: 'Source blocked at edge after acknowledgment.', severity: 'high', status: 'acked', attempts: 1, last_error: null, sent_at: iso(90), acked_by: 'ops@damanecash.ma', acked_at: iso(80), created_at: iso(90) },
  { id: notifSeq++, org_id: 2, alert_id: 3, rule_id: 1, channel: 'webhook', recipient: 'https://hooks.valorissystem.ma/soc', subject: 'Privilege escalation attempt', body: 'Downstream SIEM returned HTTP 503 twice.', severity: 'critical', status: 'dead_letter', attempts: 3, last_error: 'Webhook endpoint unreachable (503)', sent_at: null, acked_by: null, acked_at: null, created_at: iso(150) },
];

// -- playbooks ----------------------------------------------------------------
const playbooks: any[] = demoPlaybookSeeds.map((p, i) => ({
  id: i + 1, ...p, steps: p.steps.map(s => ({ ...s, params: {} })),
}));

// -- discovery / settings -------------------------------------------------------
const snmpCredentials: any[] = [
  { id: 1, name: 'Edge switches v2c', version: '2c', community: 'public-ro', username: null, auth_protocol: null, auth_passphrase: null, priv_protocol: null, priv_passphrase: null, port: 161, org_id: null, created_at: iso(20000) },
];
const scans: any[] = [];
// Discovery inventory mirrors the Demo World devices so MonitoredDevices,
// NetworkPage and Statistics always show the SAME hostnames/IPs/status.
const discoveredDevices: any[] = demoDevices.map((d, i) => ({
  id: i + 1, scan_id: 0, org_id: d.orgId, ip: d.ip, mac: `aa:bb:cc:${String(d.orgId).padStart(2, '0')}:${d.id.slice(-2).replace(/[^0-9a-f]/gi, '0').padStart(2, '0')}:ff`,
  hostname: d.hostname, os_guess: d.os, device_type: d.type, open_ports: [22, 443],
  snmp_match: ['firewall', 'switch', 'router'].includes(d.type), sys_desc: `Demo World managed ${d.type}`,
  imported: true, status: d.status, location: d.location, created_at: iso(10000 - i * 60),
}));
let scanSeq = 1;
let devSeq = discoveredDevices.length + 1;

// One completed baseline scan so the Scans tab is not empty on first visit.
scans.push({ id: scanSeq++, org_id: 1, network_cidr: '10.0.0.0/16', status: 'completed', credential_ids: [1], total_hosts: 254, discovered: demoDevices.filter(d => d.orgId === 1).length, snmp_matched: demoDevices.filter(d => d.orgId === 1 && ['firewall', 'switch', 'router'].includes(d.type)).length, started_at: iso(10000), finished_at: iso(9990), created_by: 'demo@infracentra.io', created_at: iso(10000) });
discoveredDevices.forEach(d => { if (d.orgId === 1) d.scan_id = 1; });

const systemSettings = {
  auto_ticketing: true, sla_escalations: true, email_enabled: true, sms_enabled: true,
  webhook_enabled: true, quiet_hours: false, escalation_email: 'escalations@infracentra.io',
  webhook_url: 'https://hooks.infracentra.io/soc',
};

// -- tiny helpers ---------------------------------------------------------------
const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise(res => setTimeout(() => res(value), ms));

const parseBody = (body?: BodyInit | null): any => {
  try { return body ? JSON.parse(String(body)) : {}; } catch { return {}; }
};

const splitPath = (path: string) => {
  const [p, qs] = path.split('?');
  return { parts: p.replace(/^\/+|\/+$/g, '').split('/'), query: new URLSearchParams(qs ?? '') };
};

const httpErr = (status: number, msg: string) => {
  const e: any = new Error(msg);
  e.demoStatus = status;
  return e;
};

// Simulated AI triage for tickets created in demo mode.
const fakeAi = (title: string, priority: string, category: string) => {
  const t = title.toLowerCase();
  let conf = 0.75;
  let prio = priority;
  const reasoning: string[] = [`Title keywords matched (${category})`];
  if (/ransom|malware|exploit|breach/.test(t)) { prio = 'p1'; conf = 0.95; reasoning.push('Malware/exploitation vocabulary'); }
  else if (/brute|unauthorized|privilege/.test(t)) { prio = 'p2'; conf = 0.87; reasoning.push('Intrusion attempt pattern'); }
  else if (/patch|cve|vulnerab/.test(t)) { reasoning.push('Vulnerability vocabulary'); }
  else { reasoning.push('No strong security signal — kept submitted priority'); }
  return { ai_category: category, ai_priority: prio, ai_confidence: conf, ai_reasoning: reasoning, ai_predicted_root_cause: /cpu|memory|disk/.test(t) ? 'Resource saturation' : null };
};

// ---------------------------------------------------------------------------
// The mock router used by api.ts when Demo Mode is ON.
// ---------------------------------------------------------------------------
export const demoStore = {
  async handle<T>(method: string, path: string, body?: BodyInit | null): Promise<T> {
    const { parts, query } = splitPath(path);
    const root = parts[0];
    const b = parseBody(body);

    // ---- Tickets ----
    if (root === 'tickets') {
      if (method === 'GET' && parts.length === 1) {
        let list = [...tickets].sort((a, z) => z.created_at.localeCompare(a.created_at));
        if (query.get('status')) list = list.filter(t => t.status === query.get('status'));
        if (query.get('priority')) list = list.filter(t => t.priority === query.get('priority'));
        if (query.get('org_id')) list = list.filter(t => String(t.org_id) === query.get('org_id'));
        const q = (query.get('q') ?? '').toLowerCase();
        if (q) list = list.filter(t => t.title.toLowerCase().includes(q) || t.uid.toLowerCase().includes(q));
        return delay(list as any) as unknown as T;
      }
      if (method === 'POST' && parts.length === 1) {
        const ai = fakeAi(b.title ?? '', b.priority ?? 'p3', b.category ?? 'incident');
        const t = mkTicket({ ...b, source: 'portal', reporter: 'demo@infracentra.io', created_at: iso(0), updated_at: iso(0), due_response_at: iso(-30), due_resolve_at: iso(-240), ...ai });
        tickets.unshift(t);
        pushAudit(t.uid, 'demo-user', 'created', 'Created from demo console', 0);
        pushAudit(t.uid, 'ai-engine', 'triage', `AI classified as ${t.ai_category}/${t.ai_priority} (conf ${(t.ai_confidence * 100).toFixed(0)}%)`, 0);
        return delay(t as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'meta' && parts[2] === 'tenants') return delay(orgs as any) as unknown as T;
      if (method === 'GET' && parts[1] === 'ops' && parts[2] === 'workload') {
        const byAssignee: Record<string, number> = {};
        tickets.filter(t => !['resolved', 'closed'].includes(t.status)).forEach(t => { byAssignee[t.assignee ?? 'Unassigned'] = (byAssignee[t.assignee ?? 'Unassigned'] ?? 0) + 1; });
        return delay(Object.entries(byAssignee).map(([assignee, open]) => ({ assignee, open })) as any) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'ops' && parts[2] === 'run-escalations') {
        tickets.forEach(t => { if (t.sla_state === 'breached' && !['resolved', 'closed'].includes(t.status)) { t.escalation_level += 1; pushAudit(t.uid, 'sla-engine', 'escalated', `SLA breached → level ${t.escalation_level}`, 0); } });
        return delay({ escalated: tickets.filter(t => t.escalation_level > 0).length } as any) as unknown as T;
      }
      const uid = parts[1];
      if (!uid) throw httpErr(404, 'Demo: unknown tickets route');
      const tk = tickets.find(t => t.uid === uid);
      if (!tk && ['GET', 'PATCH'].includes(method) && parts.length >= 2 && parts[1] !== 'meta' && parts[1] !== 'ops') throw httpErr(404, `Demo: ticket ${uid} not found`);
      if (method === 'GET' && parts[2] === 'evidence') return delay((evidenceByUid[uid] ?? []) as any) as unknown as T;
      if (method === 'GET' && parts[2] === 'evidence' && parts[4] === 'file') {
        // Demo download of an uploaded attachment: reconstruct the blob from the staged base64.
        const ev = (evidenceByUid[uid] ?? []).find((x: any) => x.id === Number(parts[3]));
        if (!ev || !(ev as any).has_file) throw httpErr(404, 'Demo: attachment not found');
        const bin = atob(String((ev as any)._b64 ?? ''));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: (ev as any).mime_type || 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url; a.download = ev.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return delay({ ok: true } as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'evidence') {
        const isFile = Boolean(b.file_b64);
        const approxBytes = isFile ? Math.floor(String(b.file_b64).length * 3 / 4) : String(b.content ?? '').length;
        const ev = { id: Math.floor(Math.random() * 1e6), ticket_uid: uid, kind: b.kind ?? 'log', name: b.name ?? 'artifact', size_kb: Math.round(approxBytes / 1024) + 1, sha256: 'sha256:' + btoa(String(b.content ?? b.file_b64 ?? '')).slice(0, 24), collected_by: 'demo-user', immutable: true, created_at: iso(0), has_file: isFile, mime_type: b.mime_type ?? null };
        if (isFile) (ev as any)._b64 = String(b.file_b64);
        (evidenceByUid[uid] ??= []).push(ev);
        pushAudit(uid, 'demo-user', 'evidence', `Evidence added: ${ev.name}`, 0);
        return delay(ev as any) as unknown as T;
      }
      if (method === 'GET' && parts[2] === 'audit') return delay([...(auditByUid[uid] ?? [])].reverse() as any) as unknown as T;
      if (method === 'GET' && parts[2] === 'approvals') return delay((approvalsByUid[uid] ?? []) as any) as unknown as T;
      if (method === 'POST' && parts[2] === 'closure-request') {
        const ap = { id: Math.floor(Math.random() * 1e6), ticket_uid: uid, step: (approvalsByUid[uid]?.length ?? 0) + 1, approver_role: 'security_lead', status: 'pending', note: b.note ?? '', decided_by: null, decided_at: null };
        (approvalsByUid[uid] ??= []).push(ap);
        pushAudit(uid, 'demo-user', 'closure_requested', ap.note, 0);
        return delay(ap as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'approvals' && parts[4] === 'decide') {
        const ap = (approvalsByUid[uid] ?? []).find((x: any) => x.id === Number(parts[3]));
        if (!ap) throw httpErr(404, 'Demo: approval step not found');
        ap.status = b.approve ? 'approved' : 'rejected';
        ap.decided_by = 'demo-lead@infracentra.io';
        ap.decided_at = iso(0);
        if (b.approve && tk) { tk.status = 'closed'; tk.resolved_at = tk.resolved_at ?? iso(0); }
        pushAudit(uid, 'demo-lead', ap.status, ap.note ?? '', 0);
        return delay(ap as any) as unknown as T;
      }
      if (method === 'PATCH') {
        Object.assign(tk, b, { updated_at: iso(0) });
        pushAudit(uid, 'demo-user', 'updated', Object.keys(b).join(', '), 0);
        return delay(tk as any) as unknown as T;
      }
    }

    // ---- Alerts / notification rules / notifications ----
    if (root === 'alerts') {
      if (method === 'POST' && parts.length === 1) {
        const a = { id: alertSeq++, uid: `ALR-${String(alertSeq).padStart(4, '0')}`, org_id: b.org_id ?? 1, title: b.title ?? 'Untitled event', description: b.description ?? '', severity: b.severity ?? 'medium', source: b.source ?? 'api', resource: b.resource ?? null, correlated_count: 1, storm_suppressed: false, acked_by: null, acked_at: null, ticket_uid: null, created_at: iso(0) };
        alerts.unshift(a);
        const pipeline: any = { notifications: [] as any[] };
        for (const r of rules.filter(x => x.enabled)) {
          const sevOk = !r.conditions.severity || r.conditions.severity.includes(a.severity);
          const srcOk = !r.conditions.source || r.conditions.source.includes(a.source);
          if (!sevOk || !srcOk) continue;
          for (const ch of r.channels) {
            const n = { id: notifSeq++, org_id: a.org_id, alert_id: a.id, rule_id: r.id, channel: ch, recipient: r.recipients[0] ?? 'ops@infracentra.io', subject: `[${a.severity.toUpperCase()}] ${a.title}`, body: a.description, severity: a.severity, status: 'sent', attempts: 1, last_error: null, sent_at: iso(0), acked_by: null, acked_at: null, created_at: iso(0) };
            notifications.unshift(n);
            pipeline.notifications.push(n);
          }
          if (r.create_ticket) {
            const ai = fakeAi(a.title, r.ticket_priority, 'incident');
            const t = mkTicket({ title: a.title, description: a.description, priority: r.ticket_priority, category: 'incident', source: 'alert_engine', org_id: a.org_id, asset: a.resource, alert_id: a.id, created_at: iso(0), ...ai });
            tickets.unshift(t);
            a.ticket_uid = t.uid;
            pushAudit(t.uid, 'alert-engine', 'created', `Auto-opened from ${a.uid}`, 0);
            pipeline.ticket_created = true;
            pipeline.ticket_uid = t.uid;
          }
        }
        return delay({ alert: a, pipeline } as any) as unknown as T;
      }
      if (method === 'GET' && parts.length === 1) {
        let list = [...alerts].sort((a, z) => z.created_at.localeCompare(a.created_at));
        if (query.get('org_id')) list = list.filter(x => String(x.org_id) === query.get('org_id'));
        return delay(list as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'ack') {
        const a = alerts.find(x => x.id === Number(parts[1]));
        if (a) { a.acked_by = 'demo@infracentra.io'; a.acked_at = iso(0); }
        return delay(a as any) as unknown as T;
      }
    }
    if (root === 'notification-rules') {
      if (method === 'GET') return delay(rules as any) as unknown as T;
      if (method === 'POST') {
        const r = { id: ruleSeq++, created_at: iso(0), ...b };
        rules.push(r);
        return delay(r as any) as unknown as T;
      }
      const id = Number(parts[1]);
      const idx = rules.findIndex(r => r.id === id);
      if (method === 'PATCH' && idx >= 0) { rules[idx] = { ...rules[idx], ...b }; return delay(rules[idx] as any) as unknown as T; }
      if (method === 'DELETE' && idx >= 0) { rules.splice(idx, 1); return delay(undefined as any) as unknown as T; }
    }
    if (root === 'notifications') {
      if (method === 'GET' && parts.length === 1) {
        let list = [...notifications].sort((a, z) => z.created_at.localeCompare(a.created_at));
        if (query.get('status')) list = list.filter(n => n.status === query.get('status'));
        const lim = Number(query.get('limit') ?? 0);
        if (lim > 0) list = list.slice(0, lim);
        // Bell component expects { items: [...] }; other pages expect the raw array.
        return delay(lim > 0 ? ({ items: list } as any) : (list as any)) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'retry-failed') {
        let n = 0;
        notifications.forEach(x => { if (x.status === 'dead_letter') { x.status = 'queued'; x.last_error = null; n++; } });
        return delay({ requeued: n } as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'analytics') {
        const byStatus: Record<string, number> = {};
        notifications.forEach(n => { byStatus[n.status] = (byStatus[n.status] ?? 0) + 1; });
        const byChannel: Record<string, number> = {};
        notifications.forEach(n => { byChannel[n.channel] = (byChannel[n.channel] ?? 0) + 1; });
        return delay({ total: notifications.length, by_status: byStatus, by_channel: byChannel, avg_time_to_ack_minutes: 12, dead_letters: byStatus.dead_letter ?? 0 } as any) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'retry-dead-letters') {
        let n = 0;
        notifications.forEach(x => { if (x.status === 'dead_letter') { x.status = 'queued'; x.attempts += 0; x.last_error = null; n++; } });
        return delay({ requeued: n } as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'ack') {
        const nt = notifications.find(x => x.id === Number(parts[1]));
        if (nt) { nt.status = 'acked'; nt.acked_by = 'demo@infracentra.io'; nt.acked_at = iso(0); }
        return delay(nt as any) as unknown as T;
      }
    }

    // ---- Playbooks ----
    if (root === 'playbooks') {
      if (method === 'GET') return delay(playbooks as any) as unknown as T;
      if (method === 'POST') { const pb = { id: Math.max(...playbooks.map(p => p.id), 0) + 1, ...b }; playbooks.push(pb); return delay(pb as any) as unknown as T; }
      const id = Number(parts[1]);
      const idx = playbooks.findIndex(p => p.id === id);
      if (method === 'PUT' && idx >= 0) { playbooks[idx] = { ...playbooks[idx], ...b, id }; return delay(playbooks[idx] as any) as unknown as T; }
      if (method === 'DELETE' && idx >= 0) { playbooks.splice(idx, 1); return delay(undefined as any) as unknown as T; }
      if (method === 'POST' && parts[2] === 'run') {
        const pb = playbooks[idx];
        const log = (pb?.steps ?? []).map((s, i) => ({ step: i + 1, name: s.name, action: s.action, status: 'success', detail: 'Simulated execution (demo mode)' }));
        return delay({ ok: true, log } as any) as unknown as T;
      }
    }

    // ---- Discovery / SNMP ----
    if (root === 'snmp-credentials') {
      if (method === 'GET') return delay(snmpCredentials as any) as unknown as T;
      if (method === 'POST') { const c = { id: snmpCredentials.length + 1, created_at: iso(0), ...b }; snmpCredentials.push(c); return delay(c as any) as unknown as T; }
      if (method === 'DELETE') { const i = snmpCredentials.findIndex(c => c.id === Number(parts[1])); if (i >= 0) snmpCredentials.splice(i, 1); return delay(undefined as any) as unknown as T; }
    }
    if (root === 'scans') {
      if (method === 'GET' && parts.length === 1) return delay(scans as any) as unknown as T;
      if (method === 'POST' && parts.length === 1) {
        const s = { id: scanSeq++, org_id: b.org_id ?? 1, network_cidr: b.network_cidr ?? '10.0.0.0/24', status: 'completed', credential_ids: b.credential_ids ?? [], total_hosts: 254, discovered: 18, snmp_matched: 6, started_at: iso(1), finished_at: iso(0), created_by: 'demo@infracentra.io', created_at: iso(1) };
        scans.unshift(s);
        for (let i = 1; i <= 8; i++) {
          discoveredDevices.push({ id: devSeq++, scan_id: s.id, org_id: s.org_id, ip: `10.0.0.${i * 7}`, mac: `aa:bb:cc:00:${String(i).padStart(2, '0')}:ff`, hostname: `demo-host-${i}`, os_guess: i % 3 === 0 ? 'Linux 6.x' : 'Windows Server 2022', device_type: i % 2 ? 'server' : 'network', open_ports: [22, 443].slice(0, (i % 2) + 1), snmp_match: i % 2 === 0, sys_desc: 'Demo simulated device', imported: false, created_at: iso(0) });
        }
        return delay(s as any) as unknown as T;
      }
      if (method === 'GET' && parts[2] === 'devices') return delay(discoveredDevices.filter(d => d.scan_id === Number(parts[1])) as any) as unknown as T;
      if (method === 'GET') return delay(scans.find(s => s.id === Number(parts[1])) as any) as unknown as T;
    }
    if (root === 'devices') {
      if (method === 'GET') return delay(discoveredDevices as any) as unknown as T;
      if (method === 'POST' && parts[2] === 'import') { const d = discoveredDevices.find(x => x.id === Number(parts[1])); if (d) d.imported = true; return delay(d as any) as unknown as T; }
    }
    if (root === 'engine-status') return delay({ nmap_available: false, mode: 'demo-simulated' } as any) as unknown as T;

    // ---- Project Manager (mirrors backend routers/projects.py) ----
    if (root === 'projects') {
      const isPlatform = callerOrgId() === null && demoSession().role === 'platform_admin';
      if (method === 'GET' && parts.length === 1) {
        let list = isPlatform
          ? projectsStore.filter(p => p.kind === 'internal')
          : projectsStore.filter(p => p.org_id === callerOrgId());
        if (query.get('kind')) list = list.filter(p => p.kind === query.get('kind'));
        if (query.get('org_id') && isPlatform) list = projectsStore.filter(p => String(p.org_id) === query.get('org_id'));
        return delay(list.map(serializeProject) as any) as unknown as T;
      }
      if (method === 'POST' && parts.length === 1) {
        const org = isPlatform ? Number(b.org_id ?? 0) : callerOrgId()!;
        if (isPlatform && !org) throw httpErr(400, 'Platform admins must assign the project to an organization');
        // Runbook auto-generation: POST /projects/runbooks-from-doc { name, description, doc }
        if (query.get('runbook') || b.doc !== undefined) {
          const steps = String(b.doc ?? b.description ?? '')
            .split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
            .slice(0, 8)
            .map((title: string, i: number) => ({ id: milestoneSeq++, title: title.replace(/^[-*#\d.\s]+/, '').slice(0, 90) || `Step ${i + 1}`, done: false }));
          const rb = {
            id: projectSeq++, org_id: org, name: b.name ?? 'Runbook généré',
            description: b.description ?? 'Runbook auto-créé depuis la documentation IT fournie.',
            kind: isPlatform ? 'internal' : 'client', status: 'planned', priority: 'low',
            manager_email: b.manager_email ?? '', ticket_category: `runbook-${String(b.name ?? 'rb').toLowerCase().replace(/\s+/g, '-')}`,
            sla_hours: Number(b.sla_hours ?? 24), time_spent_seconds: 0, timer_running: false,
            generated_from_doc: true, created_by: demoSession().email ?? 'demo@infracentra.io',
            milestones: steps.length ? steps : [{ id: milestoneSeq++, title: 'Préparation', done: false }, { id: milestoneSeq++, title: 'Exécution', done: false }, { id: milestoneSeq++, title: 'Validation & clôture', done: false }],
          };
          projectsStore.unshift(rb);
          return delay(serializeProject(rb) as any) as unknown as T;
        }
        const p = {
          id: projectSeq++, org_id: org, name: b.name ?? 'Nouveau projet', description: b.description ?? '',
          kind: isPlatform ? 'internal' : (b.kind === 'client' ? 'client' : 'client'),
          status: 'planned', priority: b.priority ?? 'medium', manager_email: b.manager_email ?? '',
          ticket_category: b.ticket_category || String(b.name ?? 'projet').toLowerCase().replace(/\s+/g, '-'),
          sla_hours: Number(b.sla_hours ?? 0), time_spent_seconds: 0, timer_running: false,
          created_by: demoSession().email ?? 'demo@infracentra.io',
          milestones: (b.milestones ?? []).map((t: string) => ({ id: milestoneSeq++, title: t, done: false })),
        };
        projectsStore.unshift(p);
        return delay(serializeProject(p) as any) as unknown as T;
      }
      const pid = Number(parts[1]);
      const pr = projectsStore.find(x => x.id === pid);
      if (!pr) throw httpErr(404, 'Demo: project not found');
      if (!isPlatform && pr.org_id !== callerOrgId()) throw httpErr(403, 'Cross-tenant access denied');
      if (parts[2] === 'timer') {
        const action = parts[3];
        if (action === 'start' || action === 'resume') pr.timer_running = true;
        else if (action === 'pause') { if (pr.timer_running) { pr.time_spent_seconds += 3600; pr.timer_running = false; } }
        else if (action === 'stop') { if (pr.timer_running) pr.time_spent_seconds += 3600; pr.timer_running = false; }
        return delay(serializeProject(pr) as any) as unknown as T;
      }
      if (parts[2] === 'milestones' && method === 'POST') {
        pr.milestones.push({ id: milestoneSeq++, title: query.get('title') ?? b.title ?? 'Jalon', done: false });
        return delay(serializeProject(pr) as any) as unknown as T;
      }
      // PATCH /projects/milestones/{mid} — toggle a milestone (backend parity)
      if (parts[1] === 'milestones' && method === 'PATCH') {
        const mid = Number(parts[2]);
        for (const p0 of projectsStore) {
          const m = p0.milestones.find((x: any) => x.id === mid);
          if (m) {
            if (!isPlatform && p0.org_id !== callerOrgId()) throw httpErr(403, 'Cross-tenant access denied');
            m.done = b.done ?? !m.done;
            return delay({ id: m.id, done: m.done } as any) as unknown as T;
          }
        }
        throw httpErr(404, 'Demo: milestone not found');
      }
      // ---- attachments (mirrors backend routers/projects.py) ----
      if (parts[2] === 'attachments') {
        const store = (projectAttachments[pid] ??= []);
        const attOut = (a: any) => ({ ...a, has_file: !!a.file_b64 });
        if (method === 'GET') return delay(store.map(attOut) as any) as unknown as T;
        if (method === 'POST') {
          const payloadForHash = b.file_b64 || String(b.content ?? '');
          const att = {
            id: attSeq++, project_id: pid, name: b.name ?? 'document', kind: b.kind ?? 'txt',
            content: b.content ?? null, mime_type: b.mime_type ?? null,
            size_kb: Math.max(1, Math.round(((b.file_b64 ? atobSize(b.file_b64) : String(b.content ?? '').length) / 1024))),
            sha256: demoHash(payloadForHash), uploaded_by: demoSession().email ?? 'demo@infracentra.io',
            created_at: new Date().toISOString(), file_b64: b.file_b64 ?? null,
          };
          store.unshift(att);
          return delay(attOut(att) as any) as unknown as T;
        }
        const attId = Number(parts[3]);
        const idx = store.findIndex(a => a.id === attId);
        if (idx === -1) throw httpErr(404, 'Demo: attachment not found');
        if (method === 'DELETE') { store.splice(idx, 1); return delay(undefined as any) as unknown as T; }
        if (method === 'GET' && parts[4] === 'file') return delay({ b64: store[idx].file_b64, mime: store[idx].mime_type } as any) as unknown as T;
      }
      // GET/PUT /projects/{pid}/config — per-project settings (backend parity via PATCH fallback)
      if (parts[2] === 'config') {
        pr.config = pr.config ?? { sla_hours: pr.sla_hours, delay_alert_days: 3, risk_threshold: 70, budget_eur: 0, auto_close_tickets: true, notify_manager: true };
        if (method === 'PUT') { Object.assign(pr.config, b); return delay(pr.config as any) as unknown as T; }
        return delay(pr.config as any) as unknown as T;
      }
      if (method === 'DELETE') {
        const idx = projectsStore.findIndex(x => x.id === pid);
        if (idx >= 0) projectsStore.splice(idx, 1);
        delete projectAttachments[pid];
        return delay(undefined as any) as unknown as T;
      }
      if (method === 'GET') {
        const linked = tickets.filter(t => pr.ticket_category && (t.category === pr.ticket_category || (t.tags ?? []).includes(pr.ticket_category)));
        const openT = linked.filter(t => !['resolved', 'closed'].includes(t.status));
        return delay({ ...serializeProject(pr), tickets: { total: linked.length, open: openT.length, items: linked.slice(0, 50).map(t => ({ uid: t.uid, title: t.title, status: t.status, priority: t.priority })) } } as any) as unknown as T;
      }
      if (method === 'PATCH') { Object.assign(pr, b); return delay(serializeProject(pr) as any) as unknown as T; }
    }

    // ---- Settings ----
    if (root === 'settings') {
      if (parts[1] === 'overview') {
        const st = computeDemoStats();
        return delay({ tenants: orgs.map(o => ({ ...o, status: 'active' })), rule_count: rules.length, global_rule_count: rules.filter(r => !r.org_id).length, user_count: st.technicians, delivery_mode: 'console-only (demo)', demo_world: DEMO_WORLD_VERSION, stats: st } as any) as unknown as T;
      }
      if (parts[1] === 'system') {
        if (method === 'PUT') { Object.assign(systemSettings, b); return delay(systemSettings as any) as unknown as T; }
        return delay(systemSettings as any) as unknown as T;
      }
      if (parts[1] === 'seed-demo-tenant') return delay({ seeded: true, demo: true, message: 'Demo mode already contains sample tenants, tickets, alerts and rules.' } as any) as unknown as T;
      // "Push Demo Dataset" — one-click synchronised preprod-style dataset.
      if (parts[1] === 'push-demo-world' && method === 'POST') {
        markDemoWorldInstalled();
        const st = computeDemoStats();
        return delay({ ok: true, version: DEMO_WORLD_VERSION, engines: ['ticketing', 'notifications', 'playbooks', 'discovery', 'reports', 'partners'], stats: st } as any) as unknown as T;
      }
    }

    // ---- Value Engine (6 money-showing mechanics) — mirrors routers/value.py ----
    // Derived from the SAME demo tickets/alerts arrays so every number on the
    // Overview, ROI report and Proof Pack is synchronized with the rest of the
    // demo world.
    if (root === 'value') {
      const vt = [...tickets];
      const va = [...alerts];
      const resolved = vt.filter(t => ['resolved', 'closed'].includes(t.status));
      const autoClosed = resolved.filter(t => ['alert', 'api', 'discovery'].includes(t.source));
      const aiTriaged = vt.filter(t => t.triaged_at || t.ai_category);
      const acked = va.filter(a => a.acked_at);
      const suppressed = va.filter(a => a.storm_suppressed);
      const minutesSaved = autoClosed.length * 25 + aiTriaged.length * 12 + acked.length * 8 + suppressed.length * 5;
      const hoursSaved = Math.round((minutesSaved / 60) * 10) / 10;
      const laborUsd = Math.round(hoursSaved * 45 * 100) / 100;
      const avgMttr = 47;
      const avoidedH = Math.round(Math.max(240 - avgMttr, 0) * resolved.length / 60 * 10) / 10;
      const downtimeUsd = Math.round(avoidedH * 800 * 100) / 100;
      const totalUsd = Math.round((laborUsd + downtimeUsd) * 100) / 100;
      const critOpen = vt.filter(t => t.priority === 'p1' && !['resolved', 'closed'].includes(t.status)).length;
      const highOpen = vt.filter(t => t.priority === 'p2' && !['resolved', 'closed'].includes(t.status)).length;
      const breaches = vt.filter(t => t.sla_state === 'breached' && !['resolved', 'closed'].includes(t.status)).length;
      const exposure = critOpen * 25000 + highOpen * 8000 + breaches * 3500;
      const cov = Math.min(100, Math.round(acked.length / Math.max(va.length, 1) * 1000) / 10);
      const autoRate = Math.round(autoClosed.length / Math.max(vt.length, 1) * 1000) / 10;
      const triageRate = Math.round(aiTriaged.length / Math.max(vt.length, 1) * 1000) / 10;
      const slaRate = Math.round((vt.length - breaches) / Math.max(vt.length, 1) * 1000) / 10;
      const maturity = Math.round((cov * .2 + autoRate * .3 + triageRate * .2 + slaRate * .3) * 10) / 10;
      const payload: any = {
        period: new Date().toISOString().slice(0, 7),
        receipt: { hash: 'demo-' + (totalUsd | 0).toString(16), hours_saved: hoursSaved, labor_saved_usd: laborUsd,
          downtime_avoided_usd: downtimeUsd, total_usd: totalUsd, tickets_total: vt.length, tickets_resolved: resolved.length,
          auto_closed: autoClosed.length, ai_triaged: aiTriaged.length, alerts_total: va.length, alerts_suppressed: suppressed.length },
        red_line: { avg_mttr_min: avgMttr, baseline_mttr_min: 240, improvement_pct: Math.round((240 - avgMttr) / 240 * 1000) / 10, false_positive_pct: 8.4 },
        risk_cost: { exposure_usd: exposure, critical_open: critOpen, high_open: highOpen, sla_breaches: breaches,
          per_action: { close_p1: 25000, close_p2: 8000, fix_breach: 3500 } },
        maturity: { score: maturity, benchmark_sector_avg: 54, components: { alert_coverage: cov, automation_rate: autoRate, ai_triage_rate: triageRate, sla_compliance: slaRate } },
        generated_at: new Date().toISOString(),
      };
      if (parts[1] === 'receipt') return delay({ period: payload.period, ...payload.receipt, maturity: payload.maturity.score } as any) as unknown as T;
      if (parts[1] === 'proof-pack') return delay(payload as any) as unknown as T;
      return delay(payload as any) as unknown as T;
    }

    // ---- Partner Program (MSP white-label) — mirrors backend routers/partners.py ----
    // Demo data source of truth: src/data/partnerWorld.ts. The partner session
    // is scoped to its own partner id; cross-partner access returns 403 exactly
    // like the real backend would.
    if (root === 'partners') {
      const s = demoSession();
      const callerPartnerId = s.role === 'partner_admin' ? String(s.orgId ?? '') : null;
      const isPlatform = s.role === 'platform_admin';
      if (!isPlatform && !callerPartnerId) throw httpErr(403, 'Partners routes require a partner or platform-admin session');

      if (method === 'GET' && parts.length === 1) {
        // Platform admin sees every partner; a partner only ever sees itself.
        return delay((isPlatform ? partners : partners.filter(p => p.id === callerPartnerId)) as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'stats') {
        if (!isPlatform) throw httpErr(403, 'Program-wide stats are reserved for Infracentra platform admins');
        return delay(partnerProgramStats() as any) as unknown as T;
      }
      const pid = parts[1];
      const partner = partners.find(p => p.id === pid);
      if (!partner) throw httpErr(404, `Demo: partner ${pid} not found`);
      if (callerPartnerId && pid !== callerPartnerId) throw httpErr(403, 'Cross-partner access denied');

      if (method === 'GET' && parts.length === 2) return delay(partner as any) as unknown as T;
      // ---- Platform-admin partner management (mirrors routers/partners_admin.py) ----
      if (method === 'PATCH' && parts.length === 2) {
        if (demoSession().role !== 'platform_admin') throw httpErr(403, 'Réservé aux administrateurs plateforme');
        const allowed = ['company', 'contact_name', 'contact_email', 'tier', 'status', 'support_sla'];
        for (const k of allowed) if (k in b) (partner as any)[k] = b[k];
        pushPlatformAudit('partner.updated', `Partenaire ${partner.company} modifié (${Object.keys(b).join(', ')})`);
        return delay(partner as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'suspend') {
        if (demoSession().role !== 'platform_admin') throw httpErr(403, 'Réservé aux administrateurs plateforme');
        partner.status = partner.status === 'suspended' ? 'active' : 'suspended';
        pushPlatformAudit('partner.status_changed', `Partenaire ${partner.company} → ${partner.status}`);
        return delay({ status: partner.status } as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'migrate') {
        if (demoSession().role !== 'platform_admin') throw httpErr(403, 'Réservé aux administrateurs plateforme');
        const plans = ['Starter', 'Business', 'Scale'] as const;
        const target = String(b.plan ?? '');
        if (!(plans as readonly string[]).includes(target)) throw httpErr(400, `Plan invalide — attendu: ${plans.join('|')}`);
        const quotas: Record<string, { seats: number; devices: number; price: number }> = {
          Starter: { seats: 5, devices: 300, price: 190 }, Business: { seats: 15, devices: 1200, price: 520 }, Scale: { seats: 40, devices: 4000, price: 1180 },
        };
        partner.license.plan = target as any;
        partner.license.client_seats = quotas[target].seats;
        partner.license.device_allowance = quotas[target].devices;
        partner.license.price_month_eur = quotas[target].price;
        pushPlatformAudit('partner.migrated', `Licence ${partner.company} migrée vers ${target} (${quotas[target].price} €/mois)`);
        return delay(partner.license as any) as unknown as T;
      }
      if (method === 'DELETE' && parts.length === 2) {
        if (demoSession().role !== 'platform_admin') throw httpErr(403, 'Réservé aux administrateurs plateforme');
        if (partner.end_clients.length > 0) throw httpErr(409, `Impossible de supprimer : ${partner.end_clients.length} client(s) final(aux) encore rattaché(s). Migrez-les d'abord.`);
        const idx = partners.findIndex(p => p.id === pid);
        partners.splice(idx, 1);
        pushPlatformAudit('partner.deleted', `Partenaire ${partner.company} supprimé du programme`);
        return delay(undefined as any) as unknown as T;
      }
      if (method === 'GET' && parts[2] === 'license') return delay(partner.license as any) as unknown as T;
      if (method === 'GET' && parts[2] === 'branding') return delay(partner.branding as any) as unknown as T;
      if (method === 'PUT' && parts[2] === 'branding') {
        Object.assign(partner.branding, b);
        if (b.dns_status === 'verified' || b.custom_domain) partner.branding.dns_status = partner.branding.dns_status === 'verified' ? 'verified' : 'pending_verification';
        return delay(partner.branding as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'verify-domain') {
        partner.branding.dns_status = partner.branding.custom_domain ? 'verified' : 'not_configured';
        return delay(partner.branding as any) as unknown as T;
      }
      if (parts[2] === 'clients') {
        if (method === 'GET') return delay(partner.end_clients as any) as unknown as T;
        if (method === 'POST') {
          if (partner.license.client_seats_used >= partner.license.client_seats) throw httpErr(402, `License limit reached (${partner.license.client_seats} client seats on plan ${partner.license.plan})`);
          const c = {
            id: `ec-${partner.code.toLowerCase()}-${partner.end_clients.length + 1}`, partner_id: partner.id,
            name: b.name ?? 'Nouveau client', industry: b.industry ?? 'Non spécifié', city: b.city ?? 'Casablanca',
            devices: Number(b.devices ?? 0), users: Number(b.users ?? 0), plan: b.plan ?? 'SME',
            monthly_mrr_eur: Number(b.monthly_mrr_eur ?? 0), status: 'onboarding' as const, since: new Date().toISOString().slice(0, 10),
          };
          partner.end_clients.push(c);
          partner.license.client_seats_used += 1;
          partner.license.devices_used += c.devices;
          return delay(c as any) as unknown as T;
        }
        const cid = parts[3];
        const idx = partner.end_clients.findIndex(x => x.id === cid);
        if (idx < 0) throw httpErr(404, 'Demo: end-client not found');
        if (method === 'PATCH') {
          const before = partner.end_clients[idx].devices;
          Object.assign(partner.end_clients[idx], b);
          partner.license.devices_used += (Number(b.devices ?? before) - before);
          return delay(partner.end_clients[idx] as any) as unknown as T;
        }
        if (method === 'DELETE') {
          partner.license.client_seats_used = Math.max(0, partner.license.client_seats_used - 1);
          partner.license.devices_used -= partner.end_clients[idx].devices;
          partner.end_clients.splice(idx, 1);
          return delay(undefined as any) as unknown as T;
        }
      }
    }

    // ---- Pricing (per-asset Bundle All-in-One) ----
    // GET /pricing/tiers   -> catalogue from the shared engine
    // GET /pricing/invoice -> live invoice of the caller's tenant, billed on
    //                         the real managed-device count (per-asset model).
    if (root === 'pricing') {
      const tierRows = (Object.entries(TIER_LIMITS_MAP) as [string, any][]).map(([t, l]) => ({
        tier: t,
        unit_price_mad_monthly: l.unitPriceMad,
        unit_price_mad_annual: Math.round(l.unitPriceMad * ANNUAL_MULT),
        seat_limit: l.seatLimit, siem_limit_gb_day: l.siemLimitGbDay,
        extra_seat_mad: l.extraSeatMad, siem_overage_mad_per_gb: l.siemOverageMadPerGb,
      }));
      if (method === 'GET' && parts[1] === 'tiers') return delay(tierRows as any) as unknown as T;
      if (method === 'GET' && parts[1] === 'invoice') {
        const s = demoSession();
        const m = /^org-dw-(\d+)$/.exec(String(s.orgId ?? ''));
        const tid = m ? Number(m[1]) : 1;
        const t = demoTenants.find(x => x.id === tid) ?? demoTenants[0];
        const liveAssets = demoDevices.filter(d => d.orgId === tid).length;
        const billable = Math.max(t.endpointCount, liveAssets);
        const seatsUsed = demoTechnicians.filter(x => x.orgId === tid).length || t.seatsUsed;
        const inv = computeInvoice({
          planTier: t.planTier, billingCycle: t.billingCycle, endpointCount: billable,
          seatsUsed, siemGbDayUsed: t.siemGbDayUsed, country: t.country,
        });
        return delay({
          ...inv,
          plan_tier: t.planTier, billing_cycle: t.billingCycle,
          billable_endpoints: billable, live_asset_count: liveAssets,
          unit_price_mad: Math.round((TIER_LIMITS_MAP as any)[t.planTier].unitPriceMad *
            (t.billingCycle === 'ANNUAL' ? ANNUAL_MULT : 1)),
        } as any) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'quote') {
        const inv = computeInvoice({
          planTier: b.plan_tier ?? b.planTier ?? 'PRO',
          billingCycle: b.billing_cycle ?? b.billingCycle ?? 'MONTHLY',
          endpointCount: b.endpoint_count ?? b.endpointCount ?? 0,
          seatsUsed: b.seats_used ?? b.seatsUsed ?? 0,
          siemGbDayUsed: b.siem_gb_day_used ?? b.siemGbDayUsed ?? 0,
          country: b.country ?? 'ma',
        });
        return delay(inv as any) as unknown as T;
      }
    }

    // ---- Organizations (platform admin) ----
    if (root === 'organizations') {
      if (method === 'GET' && parts.length === 1) {
        return delay(orgs.map(o => ({
          id: o.id, name: o.name, tier: o.tier, status: 'active',
          contact_email: `ops@${o.name.toLowerCase().replace(/[^a-z]/g, '')}.example`, contact_phone: null,
          industry: 'Technology', country: 'FR',
          member_count: demoTechnicians.filter(t => t.orgId === o.id).length,
          asset_count: demoDevices.filter(d => d.orgId === o.id).length,
          risk_score: 30 + o.id * 4, compliance_score: 92 - o.id * 3,
          monthly_revenue: [4500, 8900, 1200][o.id - 1] ?? 1200, created_at: iso(40000),
          org_type: (o as any).orgType ?? 'HQ', parent_org_id: (o as any).parentOrgId ?? null,
          plan_tier: (o as any).planTier ?? 'STARTER',
          ...billingForTenant(o.id),
        })) as any) as unknown as T;
      }
      if (method === 'POST') {
        const o = { id: orgs.length + 1, name: b.name ?? 'New Demo Tenant', tier: b.tier ?? 'basic', ticketing: false,
          orgType: b.org_type ?? 'HQ', parentOrgId: b.parent_org_id ?? null, planTier: b.plan_tier ?? 'STARTER' } as any;
        orgs.push(o);
        pushPlatformAudit('organization.created', `Tenant « ${o.name} » créé (${b.org_type ?? 'HQ'}, plan ${b.plan_tier ?? b.tier ?? 'STARTER'})`);
        return delay({ id: o.id, name: o.name, tier: b.tier ?? 'basic', status: 'active',
          contact_email: b.contact_email ?? '', contact_phone: b.contact_phone ?? null, industry: b.industry ?? null, country: b.country ?? null,
          org_type: b.org_type ?? 'HQ', parent_org_id: b.parent_org_id ?? null, plan_tier: b.plan_tier ?? 'STARTER',
          member_count: 0, asset_count: 0, risk_score: 0, compliance_score: 0, monthly_revenue: 0, created_at: iso(0),
          ...billingForTenant(o.id) } as any) as unknown as T;
      }
      if (method === 'GET' && parts.length === 2) {
        const o = orgs.find(x => x.id === Number(parts[1]));
        if (!o) throw httpErr(404, 'Demo: organization not found');
        return delay({ id: o.id, name: o.name, tier: o.tier, status: 'active', contact_email: '', contact_phone: null, industry: null, country: null, member_count: demoTechnicians.filter(t => t.orgId === o.id).length, asset_count: demoDevices.filter(d => d.orgId === o.id).length, risk_score: 0, compliance_score: 0, monthly_revenue: 0, created_at: iso(0), org_type: (o as any).orgType ?? 'HQ', parent_org_id: (o as any).parentOrgId ?? null, plan_tier: (o as any).planTier ?? 'STARTER', ...billingForTenant(o.id) } as any) as unknown as T;
      }
      if (method === 'PATCH') {
        const o = orgs.find(x => x.id === Number(parts[1]));
        if (o && b.status) (o as any).status = b.status;
        pushPlatformAudit('organization.updated', `Tenant #${parts[1]} modifié (${Object.keys(b).join(', ')})`);
        return delay({ id: o?.id ?? Number(parts[1]), name: o?.name ?? 'Demo tenant', tier: b.tier ?? 'enterprise', status: b.status ?? 'active', contact_email: b.contact_email ?? '', contact_phone: null, industry: null, country: null, member_count: 0, asset_count: 0, risk_score: 0, compliance_score: 0, monthly_revenue: 0, created_at: iso(0) } as any) as unknown as T;
      }
    }

    // ---- Tenant Manager avancé (Phase 4) — miroir exact de routers/tenant_manager.py ----
    // GET  /admin/tenants/:orgId/summary          résumé agrégé synchronisé
    // POST /admin/tenants/:orgId/tickets          ticket créé POUR ce client (par la plateforme)
    // *    /admin/tenants/:orgId/rules            CRUD règles de supervision
    // POST /admin/tenants/:orgId/grants           grant service (override plan) + audit entitlement.updated
    // GET  /admin/audit-platform                  journal des actions admin plateforme
    if (root === 'admin' && parts[1] === 'tenants') {
      const s = demoSession();
      if (s.role !== 'platform_admin') throw httpErr(403, 'Tenant Manager réservé aux administrateurs plateforme');
      const orgIdNum = Number(parts[2]);
      const o = orgs.find(x => x.id === orgIdNum) ?? demoTenants.find(x => x.id === orgIdNum);
      if (!o) throw httpErr(404, `Demo: tenant ${parts[2]} introuvable`);
      const sub = parts[3];

      if (method === 'GET' && sub === 'summary') {
        const devices = demoDevices.filter(d => d.orgId === o.id);
        const openTickets = tickets.filter(t => ['open', 'in_progress'].includes(t.status));
        return delay({
          id: o.id, name: o.name, org_type: (o as any).orgType ?? 'HQ', location: (o as any).location ?? 'Casablanca',
          plan_tier: (o as any).planTier ?? 'STARTER', billing_cycle: (o as any).billingCycle ?? 'MONTHLY',
          endpoints: devices.length, members: demoTechnicians.filter(t => t.orgId === o.id).length,
          services_active: ((o as any).ticketing ? 10 : 9), open_incidents: openTickets.length,
          probes: devices.filter(d => d.isProbe).map(d => ({ id: d.id, hostname: d.hostname, ip: d.ip, status: d.status })),
          children: orgs.filter(x => (x as any).parentOrgId === o.id).map(x => ({ id: x.id, name: x.name, org_type: (x as any).orgType })),
        } as any) as unknown as T;
      }

      if (method === 'POST' && sub === 'tickets') {
        const uid = `TCK-${10000 + tickets.length + 1}`;
        const t = {
          id: tickets.length + 1, uid, title: b.title ?? 'Ticket plateforme', description: b.description ?? '',
          priority: b.priority ?? 'P3', status: 'open', source: 'platform-admin', orgId: o.id,
          asset: b.asset ?? null, assignee: b.assignee ?? null, category: b.category ?? 'Demande',
          ai_category: null, ai_priority: null, ai_confidence: 0, sla_state: 'ok', escalation_level: 0,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        tickets.unshift(t as any);
        pushAudit(uid, demoSession().email ?? 'ops@infracentra.io', 'created', `Ticket créé depuis le Tenant Manager pour ${(o as any).name ?? 'le client'}`, 0);
        pushPlatformAudit('ticket.created_for_client', `${uid} (${t.priority}) ouvert pour ${(o as any).name}`);
        try { window.dispatchEvent(new Event('demo-world-pushed')); } catch { /* SSR/tests */ }
        return delay(t as any, 201) as unknown as T;
      }

      if (sub === 'rules') {
        const forOrg = () => monitoringRules.filter(r => r.scope === 'platform' || String((r as any).org_id ?? orgIdNum) === String(orgIdNum));
        if (method === 'GET') return delay(forOrg() as any) as unknown as T;
        if (method === 'POST') {
          const r: DemoRule = {
            id: `RUL-${String(monitoringRules.length + 1).padStart(3, '0')}`,
            name: b.name ?? 'Nouvelle règle', scope: b.scope ?? 'client', target_asset_id: b.target_asset_id ?? null,
            trigger_metric: b.trigger_metric ?? 'cpu', operator: b.operator ?? '>', threshold: b.threshold ?? '85',
            duration_min: Number(b.duration_min ?? 5), action: b.action ?? 'notify', ticket_priority: b.ticket_priority ?? 'P3',
            notify_channels: Array.isArray(b.notify_channels) ? b.notify_channels : ['email'],
            enabled: b.enabled !== false, created_by: demoSession().email ?? 'ops@infracentra.io', created_at: new Date().toISOString(),
          };
          (r as any).org_id = orgIdNum;
          monitoringRules.push(r);
          pushPlatformAudit('rule.created', `Règle « ${r.name} » créée pour ${(o as any).name} (${r.trigger_metric} ${r.operator} ${r.threshold} → ${r.action})`);
          return delay(r as any, 201) as unknown as T;
        }
        const rid = parts[4];
        const idx = monitoringRules.findIndex(r => r.id === rid);
        if (idx < 0) throw httpErr(404, 'Demo: rule not found');
        if (method === 'PATCH') { Object.assign(monitoringRules[idx], b); pushPlatformAudit('rule.updated', `Règle ${rid} modifiée`); return delay(monitoringRules[idx] as any) as unknown as T; }
        if (method === 'DELETE') { const [rm] = monitoringRules.splice(idx, 1); pushPlatformAudit('rule.deleted', `Règle « ${rm.name} » supprimée`); return delay(undefined as any) as unknown as T; }
      }

      if (method === 'POST' && sub === 'grants') {
        const g = (grantsStore[String(orgIdNum)] ??= {});
        g[b.service_id] = { enabled: !!b.enabled, override_plan: !!b.override_plan, granted_by: demoSession().email ?? 'ops@infracentra.io', updated_at: new Date().toISOString() };
        pushPlatformAudit('entitlement.updated', `Service « ${b.service_id} » ${b.enabled ? 'activé' : 'désactivé'}${b.override_plan ? ' (override plan)' : ''} pour ${(o as any).name}`);
        return delay(g[b.service_id] as any) as unknown as T;
      }
      if (method === 'GET' && sub === 'grants') return delay(grantsStore[String(orgIdNum)] ?? {} as any) as unknown as T;
    }

    if (root === 'admin' && parts[1] === 'audit-platform' && method === 'GET') {
      return delay(platformAudit as any) as unknown as T;
    }

    // ---- goinfra Collection Agents (fleet / tokens / discovered devices) ----
    if (root === 'agents' || root === 'agent-tokens') {
      const myOrg = callerOrgId();
      const orgDevices = demoDevices.filter(d => myOrg === null || d.orgId === myOrg);

      // Simulated probe fleet: a subset of the tenant's devices run an agent.
      const probes = orgDevices.slice(0, Math.max(2, Math.ceil(orgDevices.length / 3))).map((d, i) => ({
        id: i + 1, org_id: d.orgId, hostname: d.hostname, agent_version: '1.0.0',
        status: d.status === 'offline' && i % 2 === 1 ? 'offline' : 'online',
        os: d.os?.toLowerCase().includes('win') ? 'windows' : 'linux',
        ip: d.ip, last_seen: iso(d.status === 'offline' ? 45 + i * 10 : 1),
      }));

      if (root === 'agents' && parts[1] === 'probes' && parts.length === 2 && method === 'GET') {
        return delay(probes as any) as unknown as T;
      }
      if (root === 'agents' && parts[1] === 'probes' && parts[3] === 'inventory' && method === 'GET') {
        const p = probes.find(x => x.id === Number(parts[2])) ?? probes[0];
        return delay({
          inventory_id: 1, collected_at: p.last_seen,
          payload: {
            hostname: p.hostname, os: p.os, platform: p.os === 'windows' ? 'Windows Server' : 'Ubuntu 22.04.4 LTS',
            kernel: p.os === 'windows' ? '10.0.20348' : '5.15.0-113-generic', cpu: { model: 'Xeon E-2288G', cores: 8, percent: 23 },
            memory: { total_bytes: 34359738368, used_bytes: 12884901888, percent: 37 },
            disks: [{ mount: p.os === 'windows' ? 'C:' : '/', device: 'sda1', total_bytes: 512110190592, used_bytes: 214748364800, percent: 42 }],
            services: [
              { name: p.os === 'windows' ? 'Spooler' : 'sshd', status: 'running', pid: 1042 },
              { name: p.os === 'windows' ? 'wuauserv' : 'cron', status: 'running', pid: 611 },
              { name: 'docker', status: 'stopped', pid: 0 },
            ],
            patches: [{ id: p.os === 'windows' ? 'KB5037765' : 'linux-image-5.15.0-113', installed_on: iso(60 * 24 * 9) }],
            ips: [p.ip], collected_at: p.last_seen,
          },
        } as any) as unknown as T;
      }
      if (root === 'agents' && parts[1] === 'probes' && parts[3] === 'metrics' && method === 'GET') {
        // 24h of points every 15 min with plausible sine-ish load curves.
        const pts: any[] = [];
        const nowS = Math.floor(Date.now() / 1000);
        for (let k = 96; k >= 0; k--) {
          const wobble = Math.sin(k / 6) * 12;
          pts.push({
            ts: nowS - k * 900, cpu_percent: +(18 + wobble + (k % 7)).toFixed(1),
            mem_used_percent: +(41 + wobble / 3).toFixed(1), disk_worst_percent: 42,
            load1: +(0.6 + wobble / 25).toFixed(2), net_recv_bps: 4_200_000 + wobble * 90_000,
            net_sent_bps: 1_900_000 + wobble * 40_000, temp_max_celsius: null,
          });
        }
        return delay(pts as any) as unknown as T;
      }
      if (root === 'agents' && parts[1] === 'discovered-devices' && method === 'GET') {
        const out = orgDevices.filter(d => ['firewall', 'switch', 'router', 'server'].includes(d.type)).slice(0, 12)
          .map((d, i) => ({
            id: i + 1, probe_id: (i % Math.max(1, probes.length)) + 1, ip: d.ip, mac: `aa:bb:cc:${String(d.orgId).padStart(2, '0')}:${String(i).padStart(2, '0')}:ee`,
            hostname: d.hostname, os_guess: d.os ?? 'unknown', device_type: d.type,
            sys_name: d.hostname.split('.')[0], snmp: ['firewall', 'switch', 'router'].includes(d.type),
            open_ports: [22, 443], last_seen: iso(i + 2),
          }));
        return delay(out as any) as unknown as T;
      }

      // Token CRUD (in-memory store per session)
      if (root === 'agent-tokens') {
        const store = (agentTokensStore[String(myOrg)] ??= []);
        if (method === 'GET') return delay([...store] as any) as unknown as T;
        if (method === 'POST') {
          const secret = 'icag_' + Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');
          const row = {
            id: store.length ? Math.max(...store.map(t => t.id)) + 1 : 1, org_id: myOrg,
            name: b?.name || 'default', prefix: secret.slice(0, 12), revoked: false,
            last_used_at: null, created_at: new Date().toISOString(), token: secret,
          };
          store.unshift(row);
          pushPlatformAudit?.('agent.token.created', `Token agent « ${row.name} » généré`);
          return delay(row as any) as unknown as T;
        }
        if (method === 'DELETE') {
          const tid = Number(parts[1]);
          const idx = store.findIndex(t => t.id === tid);
          if (idx < 0) throw httpErr(404, 'Token not found');
          store[idx].revoked = true;
          return delay(undefined as any) as unknown as T;
        }
      }
    }

    throw httpErr(404, `Demo mode: no simulated handler for ${method} /api${path}`);
  },
};
