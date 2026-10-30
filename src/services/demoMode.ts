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
  demoPlatformAudit,
} from '../data/demoWorld';
import { demoProjects } from '../data/demoProjects';
import { partners, partnerProgramStats } from '../data/partnerWorld';
import { demoRulesSeed, type DemoRule } from '../data/demoWorld';
// Demo-only IoC enrichment fixtures for the Threat Intel pages. These are
// EXPLICITLY simulated (never presented as live MISP/OTX data) and mirror the
// normalized shape returned by backend/app/services/threat_intel.py aggregate().
import { mockThreats } from '../data/mockData';

// ---------------------------------------------------------------------------
// Phase 4 stores — in-memory mirrors of backend/app/routers/tenant_manager.py
// and backend/app/routers/partners_admin.py. Same shapes real vs demo.
// ---------------------------------------------------------------------------
const monitoringRules: DemoRule[] = JSON.parse(JSON.stringify(demoRulesSeed));
/** Service grants overriding the plan entitlements, keyed by tenant id. */
const grantsStore: Record<string, Record<string, { enabled: boolean; override_plan: boolean; granted_by: string; updated_at: string }>> = {};
// goinfra enrollment tokens (demo): secret shown once, kept in memory per org.
const agentTokensStore: Record<string, any[]> = {};
/** Platform-level audit trail for admin actions (grants, rules, partners).
 *  Seeded from demoWorld.ts (demoPlatformAudit) so the platform Activity /
 *  audit views are non-empty on first load; newest entries unshifted above. */
const platformAudit: { id: number; action: string; detail: string; actor: string; created_at: string }[] =
  JSON.parse(JSON.stringify(demoPlatformAudit));
let pAuditSeq = demoPlatformAudit.reduce((m, a) => Math.max(m, a.id), 0) + 1;
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

// Bundle All-in-One billing per tenant, computed with the SHARED pricing engine V2
// (src/services/pricingEngine.ts + src/data/pricingConfig.ts) so the UI numbers
// always match the backend formula. v1 (src/config/pricing.ts) is DELETED.
import { quote } from './pricingEngine';
import { PRICING_CONFIG_V2, DEFAULT_PACK_DETAILS, fmtMad, type PackId } from '../data/pricingConfig';

/** Live pack composition edited by the platform admin in the Pack Customizer
 *  (/admin/packs). Seeded from localStorage (key below) so edits survive a
 *  page refresh / dev-server restart, falling back to the shipped defaults;
 *  PUT /pricing/packs/{id}
 *  mutates it and GET /pricing/config returns it as `packDetails` — exactly
 *  like the FastAPI backend (pricing_v2.py _live_config). */
const PACK_STORE_KEY = 'infracentra.packCustomizer.v1';

/** Load the last saved pack composition from localStorage (Demo Mode only). */
function loadStoredPackDetails(): Record<string, any> {
  const fresh = () => JSON.parse(JSON.stringify(DEFAULT_PACK_DETAILS));
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PACK_STORE_KEY) : null;
    if (!raw) return fresh();
    const parsed = JSON.parse(raw);
    // Merge onto defaults so new packs/fields added later never disappear.
    const merged: Record<string, any> = fresh();
    for (const [pid, def] of Object.entries(parsed as Record<string, any>)) {
      if (def && Array.isArray(def.services) && Array.isArray(def.freePicks)) {
        merged[pid] = { ...(merged[pid] ?? {}), ...def, id: pid };
      }
    }
    return merged;
  } catch {
    return fresh();
  }
}

function persistPackDetails(store: Record<string, any>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PACK_STORE_KEY, JSON.stringify(store));
  } catch { /* storage full/unavailable — in-memory state still correct */ }
}

let livePackDetails: Record<string, any> = loadStoredPackDetails();

/** Legacy tier name -> V2 pack id. */
const PACK_FROM_LEGACY: Record<string, PackId> = { STARTER: 'starter', PRO: 'pro', SOUVERAIN: 'souverain' };

/** Demo tenants expose a physical endpoint count; map it to V2 asset classes so
 *  ~80% of the estate is heavy (workstations/servers) and ~20% light (mailboxes). */
function demoAssetsFromEndpoints(n: number) {
  const heavy = Math.round(n * 0.8);
  return [{ class: 'workstation', qty: heavy }, { class: 'mailbox', qty: n - heavy }];
}

function billingForTenant(id: number) {
  const t = demoTenants.find((x) => x.id === id);
  if (!t) return {};
  const pack: PackId = PACK_FROM_LEGACY[t.planTier] ?? 'starter';
  // Contract length mirrors the legacy billing cycle (ANNUAL => 12-month commitment).
  const q = quote({
    mode: 'pack', pack, assets: demoAssetsFromEndpoints(t.endpointCount),
    siemGbDay: t.siemGbDayUsed, retentionDays: PRICING_CONFIG_V2.packs[pack].retentionDays,
    contractMonths: t.billingCycle === 'ANNUAL' ? 12 : 0,
  });
  const monthlyHT = q.totals.monthly_excl_vat_mad;
  return {
    plan_tier: t.planTier, billing_cycle: t.billingCycle,
    endpoint_count: t.endpointCount, seat_limit: t.seatLimit, seats_used: t.seatsUsed,
    siem_limit_gb: t.siemLimitGbDay, siem_gb_day_used: t.siemGbDayUsed,
    currency: PRICING_CONFIG_V2.currency,
    pricing_engine_version: PRICING_CONFIG_V2.version,
    billable_units: q.totals.units,
    monthly_invoice_mad: monthlyHT,
    monthly_invoice_display: `${fmtMad(monthlyHT)} /mois HT`,
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

const alerts: any[] = demoAlertSeeds.map((s, i) => {
  // Geo fixtures mirror the real ingest path (merge_geo_payload): src_geo /
  // dst_geo / classification live inside raw_payload — used ONLY by the demo
  // attack-map handler below. Seeds without geo stay geo-less, exactly like
  // production alerts, so they never appear on the map.
  const raw: Record<string, any> = {};
  if (s.srcGeo) raw.src_geo = { lat: s.srcGeo.lat, lon: s.srcGeo.lon, country: s.srcGeo.country, confidence: s.srcGeo.confidence };
  if (s.dstGeo) raw.dst_geo = { lat: s.dstGeo.lat, lon: s.dstGeo.lon, country: s.dstGeo.country, confidence: s.dstGeo.confidence };
  if (s.classification) raw.classification = s.classification;
  return {
    id: i + 1, uid: s.uid, org_id: s.orgId, title: s.title, severity: s.severity, source: s.source,
    resource: s.hostname, correlated_count: s.correlated, storm_suppressed: s.correlated > 10,
    status: 'active', assignee: null, acked_by: null, acked_at: null,
    resolved_by: null, resolved_at: null, version: 1, incident_uid: null,
    ticket_uid: ticketsByAlertUid[s.uid] ?? null,
    created_at: iso(s.minutesAgo), description: s.description,
    raw_payload: Object.keys(raw).length ? raw : undefined,
  };
});
alertSeq = demoAlertSeeds.length + 1;
// Per-alert immutable lifecycle history + append-only investigation notes
// (mirror backend AlertEvent / AlertNote tables for Phase 5 endpoints).
const alertEvents: any[] = [];
const alertNotes: any[] = [];
let alertNoteSeq = 1;
alerts.forEach(a => alertEvents.push({
  id: a.id, alert_id: a.id, actor: 'system', action: 'created',
  detail: `Ingested from ${a.source}`, created_at: a.created_at,
}));

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

// ===========================================================================
// SOAR v2 mirror (backend/app/routers/soar.py) — used ONLY in Demo Mode.
// Same allow-list, modes and honesty rules as app/services/soar.py: preview
// never runs anything, simulate marks steps 'skipped', execute reports REAL
// outcomes — block_ip/isolate_host honestly FAIL because no firewall/EDR
// connector exists here, exactly like the backend does without connectors.
// ===========================================================================
const SOAR_SAFE_ACTIONS: Record<string, boolean> = {
  wait: false, notify: false, create_ticket: false, add_evidence: false,
  snmp_query: false, snapshot: false, block_ip: true, isolate_host: true,
};
const soarPlaybooks: any[] = demoPlaybookSeeds.map((p, i) => ({
  id: i + 1,
  uid: `PBK-${String(i + 1).padStart(6, '0')}`,
  org_id: null, // platform-shared demo playbooks
  name: p.name, description: p.description ?? '', category: p.category ?? 'Incident Response',
  steps: (p.steps ?? []).map((s: any) => ({ name: s.name, action: s.action, params: {} })),
  triggers: [{ type: 'manual' }], enabled: p.enabled !== false,
  created_by: 'demo@infracentra.io', created_at: iso(9000), updated_at: null,
}));
let soarPbSeq = soarPlaybooks.length + 1;
const soarRuns: any[] = [];
let soarRunSeq = 1;

const soarHasConsequential = (steps: any[]) =>
  (steps ?? []).some((s: any) => SOAR_SAFE_ACTIONS[s.action] === true);

const soarRedact = (v: any): any => {
  const keyRe = /(passphrase|password|secret|token|community|key)/i;
  const kvRe = /((?:passphrase|password|secret|token|community|api[_-]?key)\s*[=:]\s*)(\S+)/gi;
  if (Array.isArray(v)) return v.map(soarRedact);
  if (typeof v === 'string') return v.replace(kvRe, '$1***REDACTED***');
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) out[k] = keyRe.test(k) ? '***REDACTED***' : soarRedact(val);
    return out;
  }
  return v;
};

const soarPbOut = (p: any) => ({
  ...p,
  consequential: soarHasConsequential(p.steps),
  action_summary: [...new Set((p.steps ?? []).map((s: any) => s.action))].sort(),
});

const soarRunOut = (r: any, includeLog = true) => {
  const { idempotency_key, ...rest } = r;   // internal dedup token never leaks
  if (!includeLog) delete rest.result_log;
  return rest;
};

/** Simulated step outcome — mirrors _run_step() semantics of the real engine. */
const soarStepOutcome = (action: string, params: any, executing: boolean, run: any): [string, string] => {
  if (!executing) return ['skipped', `[simulate] would ${action}: ${JSON.stringify(soarRedact(params ?? {}))}`];
  switch (action) {
    case 'wait': return ['completed', 'Waited (simulated timer)'];
    case 'notify': return ['completed', `Notification queued on channel '${params?.channel ?? 'in_app'}'`];
    case 'create_ticket': {
      const t = mkTicket({ title: `[SOAR] ${params?.title ?? run.uid}`, description: `Created by playbook run ${run.uid}`, priority: params?.priority ?? 'p3', source: 'api', created_at: iso(0), updated_at: iso(0) });
      tickets.unshift(t);
      return ['completed', `Ticket ${t.uid} created via ticketing engine`];
    }
    case 'add_evidence': {
      const inc = incidents.find(x => x.uid === run.incident_uid);
      const tuid = inc?.ticket_uid;
      if (!tuid) return ['failed', 'add_evidence requires an incident linked to a ticket'];
      pushEvidence(tuid, params?.name ?? 'soar-snapshot.txt', 'report', 64);
      return ['completed', `Evidence stored in ticket vault ${tuid}`];
    }
    case 'snapshot': return ['completed', `Snapshot request recorded for target ${JSON.stringify(soarRedact(params?.target ?? ''))}`];
    case 'snmp_query': return ['failed', 'snmp_query requires a discovery credential context; use the Discovery service directly'];
    case 'block_ip':
    case 'isolate_host':
      return ['failed', 'No firewall/EDR connector configured — action was NOT executed (recorded honestly as failure, not success)'];
    default: return ['failed', `Unknown action '${action}'`];
  }
};

/** Execute one SOAR step in the demo mirror — mirrors _run_step() semantics. */
const soarExecSteps = (run: any, steps: any[], executing: boolean): { log: any[]; completed: number; failed: number; skipped: number } => {
  const log: any[] = [];
  let completed = 0, failed = 0, skipped = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const [st, detail] = soarStepOutcome(s.action, s.params, executing, run);
    log.push({ step: i + 1, name: s.name, action: s.action, status: st, detail });
    if (st === 'completed') completed += 1;
    else if (st === 'failed') {
      failed += 1;
      // fail-fast: remaining steps honestly marked skipped (same as backend)
      for (let j = i + 1; j < steps.length; j++) {
        log.push({ step: j + 1, name: steps[j].name, action: steps[j].action,
                   status: 'skipped', detail: 'Skipped after previous step failed' });
        skipped += 1;
      }
      break;
    } else skipped += 1;
  }
  return { log, completed, failed, skipped };
};

const soarFinalStatus = (completed: number, failed: number) =>
  failed ? (completed ? 'partial' : 'failed') : 'completed';

/** Record a real execution against the incident ledger (mirrors router logic). */
const soarLinkIncidentRun = (run: any, pbName: string) => {
  const inc = incidents.find(x => x.uid === run.incident_uid);
  if (!inc) return;
  const map: Record<string, string> = { completed: 'completed', failed: 'failed', partial: 'failed', cancelled: 'cancelled' };
  (incActionsByUid[inc.uid] ??= []).push({
    id: actSeq++, incident_uid: inc.uid, action_type: 'run_playbook',
    status: map[run.status] ?? 'failed',
    detail: `Playbook '${pbName}' run ${run.uid}: ${run.completed_steps}/${run.total_steps} steps completed`,
    performed_by: run.triggered_by, playbook_run_uid: run.uid, created_at: new Date().toISOString(),
  });
  incPushActivity(inc.uid, run.triggered_by, 'playbook_run',
    `Executed playbook '${pbName}' (${run.uid}) → ${run.status}`);
};

// ===========================================================================
// Incident Response mirror (backend/app/routers/incidents.py) — Demo Mode only.
// Same lifecycle state machine, dedup guarantees and immutable activity trail
// as app/services/incidents.py so the UI behaves identically vs the real API.
// ===========================================================================
const INCIDENT_STATUSES_DEMO = ['open', 'investigating', 'contained', 'resolved', 'closed'];
const INC_TRANSITIONS: Record<string, string[]> = {
  open: ['investigating', 'contained'],
  investigating: ['contained', 'resolved'],
  contained: ['resolved', 'investigating'],
  resolved: ['closed', 'investigating'],
  closed: [],
};
let incSeq = 1;
const incActivityByUid: Record<string, any[]> = {};
const incNotesByUid: Record<string, any[]> = {};
const incEvidenceByUid: Record<string, any[]> = {};
const incActionsByUid: Record<string, any[]> = {};
let noteSeq = 1; let evSeq = 1; let actSeq = 1; let aActSeq = 1;

const incPushActivity = (uid: string, actor: string, action: string, detail: string,
                         from_value: string | null = null, to_value: string | null = null) => {
  (incActivityByUid[uid] ??= []).push({
    id: aActSeq++, incident_uid: uid, actor, action, detail,
    from_value, to_value, created_at: new Date().toISOString(),
  });
};

const mkIncident = (t: Partial<any> & { title: string }) => ({
  uid: `INC-${String(incSeq++).padStart(6, '0')}`,
  org_id: callerOrgIdSafe() ?? 1,
  site_org_id: null,
  title: t.title,
  description: '',
  severity: 'medium',
  status: 'open',
  reporter: 'demo@infracentra.io',
  assignee: null,
  acknowledged_by: null,
  acknowledged_at: null,
  ticket_uid: null,
  affected_assets: [] as string[],
  ioc_related: [] as string[],
  tags: [] as string[],
  category: 'other',
  alert_uid: null,
  resolved_at: null,
  closed_at: null,
  created_at: iso(60),
  updated_at: iso(60),
  ...t,
});

// tenant-safe accessor usable before handle() (seeds are materialised eagerly)
function callerOrgIdSafe(): number | null {
  try {
    const s = JSON.parse(localStorage.getItem('ic_demo_session') ?? '{}');
    if (s.role === 'platform_admin') return null;
    const m = /^org-dw-(\d+)$/.exec(String(s.orgId ?? ''));
    return m ? Number(m[1]) : 1;
  } catch { return 1; }
}

const incHasRole = (roles: string[]) => {
  const r = demoSession().role ?? 'client_user';
  return roles.includes(r);
};

/** Row shape served by GET /api/incidents (mirrors _inc_out of the backend). */
const incRowOut = (i: any) => ({ ...i });

/** Detail shape served by GET /api/incidents/{uid} (mirrors get_incident). */
const incDetailOut = (i: any) => {
  const alert = i.alert_uid ? alerts.find(a => a.uid === i.alert_uid) : null;
  const ticket = i.ticket_uid ? tickets.find(t => t.uid === i.ticket_uid) : null;
  const org = orgs.find(o => o.id === i.org_id);
  const site = i.site_org_id ? orgs.find(o => o.id === i.site_org_id) : null;
  return {
    ...i,
    alert: alert ? { uid: alert.uid, severity: alert.severity, source: alert.source,
                     resource: alert.resource, correlated_count: alert.correlated_count ?? null,
                     created_at: alert.created_at } : null,
    ticket: ticket ? { uid: ticket.uid, status: ticket.status, priority: ticket.priority,
                       assignee: ticket.assignee ?? null, due_resolve_at: ticket.due_resolve_at ?? null } : null,
    organization: org ? { id: org.id, name: org.name } : null,
    site: site ? { id: site.id, name: site.name, org_type: (site as any).org_type ?? null } : null,
    notes: (incNotesByUid[i.uid] ?? []).slice().sort((a, z) => a.id - z.id),
    activity: (incActivityByUid[i.uid] ?? []).slice().sort((a, z) => z.id - a.id),
    evidence: (incEvidenceByUid[i.uid] ?? []).slice(),
    actions: (incActionsByUid[i.uid] ?? []).slice(),
    playbook_runs: soarRuns.filter(r => r.incident_uid === i.uid).slice().reverse().slice(0, 10)
      .map(r => ({ uid: r.uid, mode: r.mode, status: r.status, triggered_by: r.triggered_by,
                   started_at: r.started_at, finished_at: r.finished_at })),
  };
};

const incFindOr404 = (uid: string) => {
  const scope = callerOrgIdSafe();
  const inc = incidents.find(x => x.uid === uid && (scope === null || x.org_id === scope));
  if (!inc) throw httpErr(404, `Incident ${uid} not found`);
  return inc;
};

const incTouch = (inc: any) => { inc.updated_at = new Date().toISOString(); };

const incDedupKeyDemo = (org_id: number, title: string, asset?: string | null) =>
  `${org_id}|${String(title).trim().toLowerCase()}|${(asset ?? '').toLowerCase()}`;

const incEnrichFromTicket = (out: any) => {
  if (!out?.ticket_uid) return out;
  const t = tickets.find(x => x.uid === out.ticket_uid);
  if (t) out.ticket = { uid: t.uid, status: t.status, priority: t.priority,
                        assignee: t.assignee ?? null, due_resolve_at: t.due_resolve_at ?? null };
  return out;
};

const incCreateDemo = (b: any) => {
  const scope = callerOrgIdSafe();
  const targetOrg = b.org_id != null && scope === null ? Number(b.org_id) : (scope ?? 1);
  if (b.alert_uid) {
    const al = alerts.find(a => a.uid === b.alert_uid);
    if (!al) throw httpErr(404, 'Alert not found');
    if (scope !== null && al.org_id !== scope) throw httpErr(403, 'Cross-tenant access denied');
    const existing = incidents.find(x => x.alert_uid === al.uid && x.status !== 'closed');
    if (existing) {   // dedup guarantee: update the existing record, never duplicate
      incPushActivity(existing.uid, demoSession().email ?? 'demo@infracentra.io', 'alert_linked',
        `Additional alert ${al.uid} correlated`);
      incTouch(existing);
      return delay({ reused: true, incident: incRowOut(existing) }) as any;
    }
    const inc = mkIncident({ title: b.title || al.title, description: b.description ?? al.description ?? '',
      severity: b.severity ?? al.severity, org_id: al.org_id, alert_uid: al.uid,
      ticket_uid: al.ticket_uid ?? null, affected_assets: al.resource ? [al.resource] : [],
      category: b.category ?? 'other', site_org_id: b.site_org_id ?? null, assignee: b.assignee ?? null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    incidents.push(inc);
    incPushActivity(inc.uid, demoSession().email ?? 'demo@infracentra.io', 'created', `Opened from alert ${al.uid}`);
    return delay({ reused: false, incident: incRowOut(inc) }) as any;
  }
  const key = incDedupKeyDemo(targetOrg, b.title ?? '', b.affected_assets?.[0]);
  const dup = incidents.find(x => x.dedup_key === key && x.status !== 'closed');
  if (dup) {
    const e: any = new Error(`A non-closed incident with the same title/asset already exists (${dup.uid}). Update it instead of creating a duplicate.`);
    e.demoStatus = 409; e.duplicate_uid = dup.uid;
    throw e;
  }
  const inc = mkIncident({ ...b, org_id: targetOrg, dedup_key: key, reporter: demoSession().email ?? 'demo@infracentra.io',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  incidents.push(inc);
  incPushActivity(inc.uid, inc.reporter, 'created', 'Manually opened');
  return delay({ reused: false, incident: incRowOut(inc) }) as any;
};

const incListDemo = (query: URLSearchParams) => {
  const scope = callerOrgIdSafe();
  let list = incidents.filter(i => scope === null || i.org_id === scope);
  const statusF = query.get('status'), sevF = query.get('severity');
  if (statusF) {
    if (!INCIDENT_STATUSES_DEMO.includes(statusF)) throw httpErr(422, `Unknown status '${statusF}'`);
    list = list.filter(i => i.status === statusF);
  }
  if (sevF) {
    if (!['critical', 'high', 'medium', 'low', 'info'].includes(sevF)) throw httpErr(422, `Unknown severity '${sevF}'`);
    list = list.filter(i => i.severity === sevF);
  }
  if (query.get('assignee')) list = list.filter(i => i.assignee === query.get('assignee'));
  if (query.get('category')) list = list.filter(i => i.category === query.get('category'));
  if (query.get('org_id')) list = list.filter(i => String(i.org_id) === query.get('org_id'));
  const q = (query.get('q') ?? '').toLowerCase();
  if (q) list = list.filter(i =>
    String(i.title).toLowerCase().includes(q) || String(i.description ?? '').toLowerCase().includes(q) ||
    String(i.uid).toLowerCase().includes(q) || (i.affected_assets ?? []).some((a: string) => String(a).toLowerCase().includes(q)));
  const sort = query.get('sort') ?? 'created_at';
  const order = query.get('order') ?? 'desc';
  const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const dir = order === 'desc' ? -1 : 1;
  list = [...list].sort((a, z) => {
    let cmp = 0;
    if (sort === 'severity') cmp = (sevRank[a.severity] ?? 4) - (sevRank[z.severity] ?? 4);
    else cmp = String(a[sort] ?? '').localeCompare(String(z[sort] ?? ''));
    if (sort === 'created_at' || sort === 'updated_at') cmp = String(a[sort] ?? '').localeCompare(String(z[sort] ?? ''));
    return cmp * dir || z.uid.localeCompare(a.uid);
  });
  const page = Math.max(1, Number(query.get('page') ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.get('page_size') ?? 25)));
  const statusCounts: Record<string, number> = {};
  INCIDENT_STATUSES_DEMO.forEach(s => { statusCounts[s] = incidents.filter(i => scope === null || i.org_id === scope).filter(i => i.status === s).length; });
  return delay({ items: list.slice((page - 1) * pageSize, page * pageSize).map(incRowOut),
                 total: list.length, page, page_size: pageSize, status_counts: statusCounts }) as any;
};

// Seed incidents derived from the Demo World critical/high alerts so the IR
// board is non-empty and every relationship (alert → incident → ticket) is
// consistent with the same dataset the SIEM/ticket pages show.
const incidents: any[] = [];
demoAlertSeeds
  .filter(a => ['critical', 'high'].includes(a.severity))
  .slice(0, 8)
  .forEach((a, idx) => {
    const tuid = ticketsByAlertUid[a.uid] ?? null;
    const status = idx === 0 ? 'investigating' : idx % 4 === 0 ? 'contained' : idx % 3 === 0 ? 'resolved' : 'open';
    const inc = mkIncident({
      title: a.title, description: a.description ?? '', severity: a.severity,
      status, org_id: a.orgId, alert_uid: a.uid, ticket_uid: tuid,
      affected_assets: a.hostname ? [a.hostname] : [],
      category: /ransom|malware/i.test(a.title) ? 'malware' : /phish/i.test(a.title) ? 'phishing' : /brute|privilege|unauthorized/i.test(a.title) ? 'intrusion' : 'other',
      assignee: idx % 3 === 1 ? demoTechnicians.find(t0 => t0.orgId === a.orgId)?.email ?? null : null,
      acknowledged_by: idx % 2 === 0 ? 'demo@infracentra.io' : null,
      acknowledged_at: idx % 2 === 0 ? iso(a.minutesAgo - 1) : null,
      created_at: iso(a.minutesAgo), updated_at: iso(Math.max(0, a.minutesAgo - 5)),
      resolved_at: ['resolved', 'closed'].includes(status) ? iso(Math.max(0, a.minutesAgo - 30)) : null,
    });
    incidents.push(inc);
    incPushActivity(inc.uid, 'alert-engine', 'created', `Auto-opened from SIEM alert ${a.uid}`);
    if (inc.assignee) incPushActivity(inc.uid, 'dispatcher', 'assigned', 'Ownership assigned', null, inc.assignee);
    if (inc.acknowledged_by) incPushActivity(inc.uid, inc.acknowledged_by, 'acked', 'Acknowledged');
    if (status !== 'open') incPushActivity(inc.uid, 'analyst', 'status_changed', `Status moved open → ${status}`, 'open', status);
    (incNotesByUid[inc.uid] ??= []).push({
      id: noteSeq++, incident_uid: inc.uid, author: inc.assignee ?? 'soc-bot',
      content: 'Initial triage: correlated signals reviewed against threat intel; no client-facing impact observed yet.',
      internal: true, created_at: iso(Math.max(0, a.minutesAgo - 2)),
    });
  });
// Backfill the real IR link on demo alerts (mirror of Alert.incident_uid —
// only set when an incident row actually references the alert; never fabricated).
incidents.forEach(inc => {
  const al = alerts.find(x => x.uid === inc.alert_uid);
  if (al) al.incident_uid = inc.uid;
});

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

// -- security analytics mirror (backend/app/services/analytics.py) ----------
// Demo Mode only. Computes the SAME metrics from the in-memory alert/incident
// stores that the FastAPI service computes from SQL rows: identical window
// clamping, severity/category/status distributions, dedup policy (events are
// raw stored Alert rows; detections are Incident rows — never mixed), MTTD/MTTR
// averages in minutes with null for empty samples (never a fake 0), and UTC
// hour/day trend buckets. Shapes match GET /api/analytics/overview exactly.
const ANALYTICS_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const ANALYTICS_CATEGORIES = ['malware', 'phishing', 'intrusion', 'data_exfiltration', 'policy_violation', 'other'];

function demoAnalyticsOverview(query: URLSearchParams): any {
  // clamp_window(): naive treated as UTC, until defaults to now, since to
  // until-24h, inverted swapped, span > 366d clamped.
  let untilMs = query.get('until') ? Date.parse(query.get('until')!) : Date.now();
  if (Number.isNaN(untilMs)) untilMs = Date.now();
  let sinceMs = query.get('since') ? Date.parse(query.get('since')!) : untilMs - 24 * 3600_000;
  if (Number.isNaN(sinceMs)) sinceMs = untilMs - 24 * 3600_000;
  if (sinceMs > untilMs) [sinceMs, untilMs] = [untilMs, sinceMs];
  const maxSpan = 366 * 24 * 3600_000;
  if (untilMs - sinceMs > maxSpan) sinceMs = untilMs - maxSpan;
  const bucket = query.get('bucket') === 'hour' ? 'hour' : 'day';
  const fmtBucket = (isoStr: string) => bucket === 'hour' ? `${isoStr.slice(0, 13)}:00Z` : isoStr.slice(0, 10);

  // Tenant scoping mirrors _scope_org: platform_admin must pass site_org_id,
  // client users are pinned to their own org.
  const scope = callerOrgIdSafe();
  const requested = query.get('site_org_id');
  const orgId = scope === null
    ? (requested ? Number(requested) : NaN)
    : (requested && Number(requested) !== scope ? -1 : scope);
  if (Number.isNaN(orgId)) throw httpErr(400, 'org_id required for platform admins');
  if (orgId === -1) throw httpErr(403, 'Cross-tenant access denied');

  const inWin = (dt?: string | null) => {
    if (!dt) return false;
    const t = Date.parse(dt);
    return !Number.isNaN(t) && t >= sinceMs && t <= untilMs;
  };
  const evAlerts = alerts.filter(a => a.org_id === orgId && inWin(a.created_at));
  const detIncs = incidents.filter(i => i.org_id === orgId && inWin(i.created_at));

  const bySevEv: Record<string, number> = Object.fromEntries(ANALYTICS_SEVERITIES.map(s => [s, 0]));
  let weighted = 0;
  for (const a of evAlerts) {
    bySevEv[ANALYTICS_SEVERITIES.includes(a.severity) ? a.severity : 'info'] += 1;
    weighted += a.correlated_count ?? 1; // correlated duplicates counted once per row, weighted sum reported separately
  }

  const bySevDet: Record<string, number> = Object.fromEntries(ANALYTICS_SEVERITIES.map(s => [s, 0]));
  const byCat: Record<string, number> = Object.fromEntries(ANALYTICS_CATEGORIES.map(c => [c, 0]));
  const byStatus: Record<string, number> = {};
  for (const i of detIncs) {
    bySevDet[ANALYTICS_SEVERITIES.includes(i.severity) ? i.severity : 'info'] += 1;
    byCat[ANALYTICS_CATEGORIES.includes(i.category) ? i.category : 'other'] += 1;
    byStatus[i.status || 'open'] = (byStatus[i.status || 'open'] ?? 0) + 1;
  }

  const avgMinutes = (pairs: [string | null, string | null][]): number | null => {
    const vals = pairs
      .filter(([a, b]) => a && b)
      .map(([a, b]) => (Date.parse(b!) - Date.parse(a!)) / 60_000);
    return vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10 : null;
  };
  const mttr = avgMinutes(detIncs.map(i => [i.created_at, i.resolved_at]));
  const mttd = avgMinutes(detIncs.map(i => [i.created_at, i.acknowledged_at]));

  const evMap: Record<string, number> = {};
  const detMap: Record<string, number> = {};
  for (const a of evAlerts) { const b = fmtBucket(a.created_at); evMap[b] = (evMap[b] ?? 0) + 1; }
  for (const i of detIncs) { const b = fmtBucket(i.created_at); detMap[b] = (detMap[b] ?? 0) + 1; }
  const trendSeries = [...new Set([...Object.keys(evMap), ...Object.keys(detMap)])].sort()
    .map(b => ({ bucket: b, events: evMap[b] ?? 0, detections: detMap[b] ?? 0 }));

  const assetCounts: Record<string, number> = {};
  for (const a of evAlerts) if (a.resource) assetCounts[a.resource] = (assetCounts[a.resource] ?? 0) + 1;
  const limitAssets = Math.min(50, Math.max(1, Number(query.get('limit_assets')) || 10));
  const topAssets = Object.entries(assetCounts)
    .sort((x, z) => z[1] - x[1]).slice(0, limitAssets)
    .map(([resource, n]) => ({ resource, events: n }));

  return {
    org_id: orgId,
    window: { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString(), timezone: 'UTC', bucket },
    generated_at: new Date().toISOString(),
    events: { total: evAlerts.length, by_severity: bySevEv, raw_events_weighted: weighted },
    detections: { total: detIncs.length, by_severity: bySevDet, by_category: byCat, by_status: byStatus, mttd_minutes: mttd, mttr_minutes: mttr },
    trend: trendSeries,
    top_assets: topAssets,
    data_freshness: (evAlerts.length || detIncs.length) ? 'live' : 'empty',
  };
}

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
// AUDIT / USERS / ENTITLEMENTS stores (Demo Mode) — module level, declared
// AFTER every base store (incidents, alerts, tickets, scans, grants, orgs).
// The demoStore object below is defined at the END of this module so these
// consts are initialised before any request can reach handle().
// Shapes mirror backend routers audit.py / users.py / entitlements.py exactly.
// ---------------------------------------------------------------------------
type DemoAuditRow = { id: number; actor_id: number | null; actor_name: string; actor_role: string;
  org_id: number | null; action: string; resource: string; resource_id: string; details: string | null;
  ip_address: string | null; outcome: string; timestamp: string };
let auditSeq = 1;
const auditTrail: DemoAuditRow[] = [];
let auditSeeded = false;
function pushAuditRow(a: Omit<DemoAuditRow, 'id'>) { auditTrail.unshift({ id: auditSeq++, ...a }); if (auditTrail.length > 400) auditTrail.pop(); }
function seedAuditTrail() {
  if (auditSeeded) return;
  auditSeeded = true;
  const DEMO_IP = '203.0.113.10'; // TEST-NET-3 — documentation range, never a real client IP
  const actorFor = (email: string): { id: number | null; name: string; role: string } => {
    const ti = demoTechnicians.findIndex(x => x.email === email);
    if (ti >= 0) { const t = demoTechnicians[ti]; return { id: 100 + ti + 1, name: t.name, role: t.role === 'client_admin' ? 'client_admin' : 'client_user' }; }
    if (email === 'ops@infracentra.io') return { id: 1, name: 'Nadia Okafor', role: 'platform_admin' };
    if (email === 'finance@infracentra.io') return { id: 2, name: 'Raj Patel', role: 'platform_admin' };
    if (email === 'system') return { id: null, name: 'System', role: 'platform_admin' };
    return { id: null, name: email, role: 'client_user' };
  };
  for (const p of platformAudit) {
    const ac = actorFor(p.actor);
    pushAuditRow({ actor_id: ac.id, actor_name: ac.name, actor_role: ac.role, org_id: null,
      action: p.action, resource: 'Platform', resource_id: String(p.id), details: p.detail,
      ip_address: DEMO_IP, outcome: 'success', timestamp: p.created_at });
  }
  for (const inc of incidents) {
    const ac = inc.assignee ? actorFor(inc.assignee) : { id: null, name: 'alert-engine', role: 'system' };
    pushAuditRow({ actor_id: ac.id, actor_name: ac.name ?? 'alert-engine', actor_role: ac.role, org_id: inc.org_id,
      action: 'incident.created', resource: 'Incident', resource_id: inc.uid,
      details: `Incident « ${inc.title} » (${inc.severity}) opened from correlated SIEM evidence`, ip_address: null,
      outcome: 'success', timestamp: inc.created_at ?? iso(60) });
    if (inc.status !== 'open') {
      pushAuditRow({ actor_id: ac.id, actor_name: ac.name ?? 'analyst', actor_role: ac.role, org_id: inc.org_id,
        action: 'incident.updated', resource: 'Incident', resource_id: inc.uid,
        details: `Status moved open → ${inc.status}`, ip_address: null, outcome: 'success', timestamp: inc.updated_at ?? inc.created_at });
    }
  }
  for (const a of alerts.slice(0, 12)) {
    pushAuditRow({ actor_id: null, actor_name: `${a.source ?? 'siem'}-engine`, actor_role: 'system', org_id: a.org_id ?? a.orgId ?? null,
      action: 'alert.generated', resource: 'Alert', resource_id: a.uid ?? String(a.id),
      details: a.title ?? 'Correlation rule produced a new alert', ip_address: null, outcome: 'success', timestamp: a.timestamp ?? a.created_at ?? iso(30) });
  }
  for (const t of tickets.slice(0, 10)) {
    const ac = t.assignee ? actorFor(t.assignee) : { id: null, name: 'service-desk', role: 'system' };
    pushAuditRow({ actor_id: ac.id, actor_name: ac.name ?? 'service-desk', actor_role: ac.role, org_id: t.org_id ?? t.orgId ?? null,
      action: 'ticket.created', resource: 'Ticket', resource_id: t.uid, details: `Ticket « ${t.title} » (${t.priority}) created from ${t.source ?? 'portal'}`,
      ip_address: DEMO_IP, outcome: 'success', timestamp: t.created_at });
  }
  for (const sc of scans) {
    pushAuditRow({ actor_id: 1, actor_name: sc.created_by ?? 'ops@infracentra.io', actor_role: 'platform_admin', org_id: sc.org_id,
      action: 'discovery.completed', resource: 'DiscoveryScan', resource_id: String(sc.id),
      details: `Scan ${sc.network_cidr} finished (${sc.status}) — ${sc.discovered}/${sc.total_hosts} hosts responded`,
      ip_address: null, outcome: sc.status === 'failed' || sc.status === 'completed_with_warnings' ? 'failure' : 'success',
      timestamp: sc.finished_at ?? sc.started_at ?? iso(500) });
  }
  for (const [orgId, g] of Object.entries(grantsStore)) {
    for (const [svc, rec] of Object.entries(g as Record<string, any>)) {
      pushAuditRow({ actor_id: 1, actor_name: rec.granted_by ?? 'ops@infracentra.io', actor_role: 'platform_admin', org_id: Number(orgId),
        action: 'entitlement.updated', resource: 'Entitlement', resource_id: svc,
        details: `Service « ${svc} » ${rec.enabled ? 'granted' : 'revoked'}${rec.override_plan ? ' (plan override)' : ''}`,
        ip_address: DEMO_IP, outcome: 'success', timestamp: rec.updated_at ?? iso(100) });
    }
  }
  auditTrail.sort((x, z) => String(z.timestamp).localeCompare(String(x.timestamp)));
}

// Users directory — derived from the SAME technicians roster AuthContext uses
// in demo sessions (ids stable across reloads), plus two platform accounts.
type DemoUserRow = { id: number; email: string; name: string; role: string; org_id: number | null;
  status: string; mfa_enabled: boolean; last_login: string | null; created_at: string };
const usersDirectory: DemoUserRow[] = [
  { id: 1, email: 'ops@infracentra.io', name: 'Nadia Okafor', role: 'platform_admin', org_id: null, status: 'active', mfa_enabled: true, last_login: iso(0.7), created_at: iso(400000) },
  { id: 2, email: 'finance@infracentra.io', name: 'Raj Patel', role: 'platform_admin', org_id: null, status: 'active', mfa_enabled: true, last_login: iso(5), created_at: iso(380000) },
  ...demoTechnicians.map((t, i) => ({
    id: 100 + i + 1, email: t.email, name: t.name,
    role: t.role === 'client_admin' ? 'client_admin' : 'client_user',
    org_id: t.orgId, status: 'active', mfa_enabled: t.role !== 'service-desk',
    last_login: iso((i + 1) * 3), created_at: iso(200000 - i * 1000),
  })),
];

// Entitlements — composed from tenant plan limits + live grants (grantsStore),
// exactly like the backend composes entitlement rows from provisioning.
type DemoEntitlementRow = { id: number; org_id: number; service_id: string; enabled: boolean; seat_count: number;
  activated_at: string | null; deactivated_at: string | null; notes: string | null; created_at: string; updated_at: string | null };
const PLAN_SERVICES: Record<string, string[]> = {
  STARTER: ['asset-discovery', 'monitored-devices', 'notifications', 'security-analytics'],
  PRO: ['asset-discovery', 'monitored-devices', 'notifications', 'security-analytics', 'threat-intelligence', 'alerts', 'incident-response', 'soar-automation', 'my-services', 'projects', 'compliance-reporting', 'advanced-ticketing'],
  SOUVERAIN: ['asset-discovery', 'monitored-devices', 'notifications', 'security-analytics', 'threat-intelligence', 'alerts', 'incident-response', 'soar-automation', 'my-services', 'projects', 'compliance-reporting', 'advanced-ticketing', 'patch-management', 'backup-dr', 'vulnerability-scanning', 'dns-filtering'],
};
const entitlementsTable: DemoEntitlementRow[] = (() => {
  const rows: DemoEntitlementRow[] = []; let eid = 1;
  for (const o of orgs) {
    const plan = String((o as any).planTier ?? 'STARTER').toUpperCase();
    const granted = grantsStore[String(o.id)] ?? {};
    const services = new Set([...(PLAN_SERVICES[plan] ?? PLAN_SERVICES.STARTER), ...Object.keys(granted)]);
    for (const svc of services) {
      const g = (granted as Record<string, any>)[svc];
      const enabled = g ? !!g.enabled : (PLAN_SERVICES[plan] ?? []).includes(svc);
      rows.push({ id: eid++, org_id: o.id, service_id: svc, enabled,
        seat_count: enabled ? ((o as any).seatLimit ?? 20) : 0,
        activated_at: enabled ? iso(100000 - eid) : null, deactivated_at: !enabled && g ? iso(100) : null,
        notes: g?.override_plan ? 'Granted by platform admin (plan override)' : null,
        created_at: iso(100000), updated_at: g?.updated_at ?? null });
    }
  }
  return rows;
})();

// ---------------------------------------------------------------------------
// Service dependency graph helpers (mirror of backend app/services/service_graph.py)
// ---------------------------------------------------------------------------
const DEMO_SVC_LABELS: Record<string, string> = {
  'threat-intel': 'Threat Intelligence', compliance: 'Compliance Mapper',
  'incident-response': 'Incident Response', analytics: 'Security Analytics',
  soar: 'SOAR Automation', 'vuln-scanning': 'Vulnerability Scanning',
  'patch-management': 'Patch Management', 'backup-dr': 'Backup & Disaster Recovery',
  'endpoint-protection': 'Endpoint Protection (EDR/XDR)', 'email-security': 'Email Security',
  'cloud-security': 'Cloud Security Posture (CSPM)', 'network-monitoring': 'Network Monitoring (NMS)',
  'dns-filtering': 'DNS Filtering', 'firewall-mgmt': 'Firewall Management',
  'vpn-gateway': 'Managed VPN Gateway', 'sd-wan': 'SD-WAN',
  'asset-discovery': 'Asset Discovery', 'advanced-ticketing': 'Advanced Ticketing',
};
const DEMO_SVC_CATEGORY: Record<string, string> = {
  'threat-intel': 'security', compliance: 'security', 'incident-response': 'security',
  analytics: 'security', soar: 'security',
  'vuln-scanning': 'psa', 'patch-management': 'psa', 'backup-dr': 'psa',
  'endpoint-protection': 'psa', 'email-security': 'psa', 'cloud-security': 'psa',
  'network-monitoring': 'networking', 'dns-filtering': 'networking',
  'firewall-mgmt': 'networking', 'vpn-gateway': 'networking', 'sd-wan': 'networking',
  'asset-discovery': 'networking', 'advanced-ticketing': 'psa',
};

function buildDemoServiceGraph(rows: DemoEntitlementRow[], orgId: number) {
  const org = orgs.find(o => o.id === orgId);
  const nodesMap: Record<string, any> = {};
  for (const e of rows) {
    nodesMap[e.service_id] = {
      id: e.service_id,
      label: DEMO_SVC_LABELS[e.service_id] ?? e.service_id,
      category: DEMO_SVC_CATEGORY[e.service_id] ?? 'other',
      status: e.enabled ? 'enabled' : 'disabled',
      seat_count: e.seat_count ?? 0,
      in_plan: true,
      override: !!e.notes?.toLowerCase().includes('override'),
      grant_enabled: null, activated_at: e.activated_at,
    };
  }
  const present = new Set(Object.keys(nodesMap));
  const edges: any[] = []; const missing: any[] = [];
  for (const rule of SERVICE_DEPENDENCY_RULES) {
    for (const up of rule.requires) {
      if (!present.has(rule.service)) continue;
      if (present.has(up)) {
        edges.push({ from: up, to: rule.service, kind: 'declared', provisioned: true,
          upstream_status: nodesMap[up].status, rationale: rule.rationale });
      } else {
        missing.push({ from: up, to: rule.service, kind: 'declared', provisioned: false,
          upstream_label: DEMO_SVC_LABELS[up] ?? up, rationale: rule.rationale });
      }
    }
  }
  const downstreamIndex: Record<string, string[]> = {};
  for (const e of edges) (downstreamIndex[e.from] ||= []).push(e.to);
  return {
    org: { id: orgId, name: org?.name ?? '', plan: String((org as any)?.planTier ?? 'STARTER').toLowerCase(), trial: false },
    nodes: Object.values(nodesMap), edges, missing_dependencies: missing,
    downstream_index: downstreamIndex,
    counts: { services_total: Object.keys(nodesMap).length,
      services_enabled: Object.values(nodesMap).filter(n => n.status === 'enabled').length,
      edges_shown: edges.length, missing_dependencies: missing.length },
    disclaimer: "Vue déclarative basée sur les lignes d'entitlements persistées — aucune télémétrie temps réel ; la présence d'un entitlement n'affirme jamais une santé opérationnelle.",
  };
}

function buildDemoServiceChain(serviceId: string, present: Set<string>) {
  const walkUp = (sid: string, visited: Set<string>): any[] => {
    const chain: any[] = [];
    for (const r of SERVICE_DEPENDENCY_RULES) {
      if (r.service === sid) for (const req of r.requires) {
        if (visited.has(req)) continue;
        visited.add(req);
        const sub = present.has(req) ? walkUp(req, visited) : [];
        chain.push({ requires: req, rationale: r.rationale, provisioned: present.has(req),
          depth: 1 + Math.max(0, ...sub.map(s => s.depth)), sub_chain: sub });
      }
    }
    return chain;
  };
  const walkDown = (sid: string, visited: Set<string>): any[] => {
    const out: any[] = [];
    for (const r of SERVICE_DEPENDENCY_RULES) {
      if (r.requires.includes(sid) && !visited.has(r.service)) {
        visited.add(r.service);
        out.push({ impacts: r.service, rationale: r.rationale, provisioned: present.has(r.service),
          sub_chain: walkDown(r.service, visited) });
      }
    }
    return out;
  };
  const ups = walkUp(serviceId, new Set());
  const missing = [...new Set(ups.filter(u => !u.provisioned).map(u => u.requires))].sort();
  return {
    service_id: serviceId, entitled: present.has(serviceId),
    direct_requires: SERVICE_DEPENDENCY_RULES.filter(r => r.service === serviceId)
      .flatMap(r => r.requires.map(req => ({ requires: req, rationale: r.rationale, provisioned: present.has(req) }))),
    upstream_chain: ups, downstream_impact: walkDown(serviceId, new Set()),
    unprovisioned_requirements: missing,
  };
}

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
      // Phase 5 mirror of backend/app/routers/notifications.py — identical
      // filtering/sorting/pagination, transition matrix, version conflicts and
      // per-row honest bulk results. Demo Mode only; production hits FastAPI.
      const DEMO_ALERT_WRITE = ['platform_admin', 'client_admin', 'analyst', 'technician'];
      const demoAlertWriteGuard = () => {
        const role = demoSession().role ?? 'client_admin';
        if (!DEMO_ALERT_WRITE.includes(role)) throw httpErr(403, `Role '${role}' cannot modify alerts`);
      };
      const ALERT_ALLOWED_TO: Record<string, string[]> = { active: ['acked', 'resolved'], acked: ['resolved', 'active'], resolved: ['active'] };
      const demoAlertEvent = (a: any, action: string, detail: string) => alertEvents.push({
        id: alertEvents.length + 1, alert_id: a.id, actor: demoSession().email ?? 'demo@infracentra.io',
        action, detail, created_at: new Date().toISOString(),
      });
      const demoTransitionAlert = (a: any, opts: { status?: string; assignee?: string | null; expected_version?: number; note?: string }) => {
        if (opts.expected_version != null && a.version !== opts.expected_version) {
          throw Object.assign(new Error('Alert was modified by someone else; reload and retry.'), { demoStatus: 409, current_version: a.version });
        }
        let changed = false;
        if (opts.status && opts.status !== a.status) {
          if (!(ALERT_ALLOWED_TO[a.status] ?? []).includes(opts.status)) throw httpErr(422, `Illegal transition ${a.status} -> ${opts.status}`);
          a.status = opts.status;
          if (opts.status === 'acked') { a.acked_by = demoSession().email ?? 'demo@infracentra.io'; a.acked_at = new Date().toISOString(); }
          else if (opts.status === 'resolved') { a.resolved_by = a.acked_by ?? demoSession().email ?? 'demo@infracentra.io'; a.resolved_at = new Date().toISOString(); }
          else { a.resolved_at = null; a.resolved_by = null; }
          demoAlertEvent(a, opts.status === 'acked' ? 'acked' : opts.status === 'resolved' ? 'resolved' : 'reopened', `Status ${opts.status}`);
          changed = true;
        }
        if (opts.assignee !== undefined && opts.assignee !== (a.assignee || null)) {
          a.assignee = opts.assignee;
          demoAlertEvent(a, 'assigned', `Assignee: ${opts.assignee || '(unassigned)'}`);
          changed = true;
        }
        if (opts.note) {
          alertNotes.unshift({ id: alertNoteSeq++, alert_id: a.id, author: demoSession().email ?? 'demo@infracentra.io', body: opts.note, created_at: new Date().toISOString() });
          demoAlertEvent(a, 'noted', 'Investigation note added');
          changed = true;
        }
        if (changed) a.version = (a.version || 1) + 1;
        return changed;
      };
      const demoAlertFilter = (query: URLSearchParams) => {
        const org = callerOrgId();
        let list = [...alerts];
        if (org != null) list = list.filter(x => x.org_id === org);
        else if (query.get('org_id')) list = list.filter(x => String(x.org_id) === query.get('org_id'));
        const csv = (k: string) => query.get(k)?.split(',').map(s => s.trim()).filter(Boolean);
        for (const [k, f] of [['severity', 'severity'], ['status', 'status'], ['source', 'source']] as const) {
          const vals = csv(k);
          if (vals?.length) list = list.filter(x => vals.includes(String(x[f])));
        }
        const asg = query.get('assignee');
        if (asg === '__unassigned__') list = list.filter(x => !x.assignee);
        else if (asg) list = list.filter(x => x.assignee === asg);
        const q = query.get('q');
        if (q) { const lq = q.toLowerCase(); list = list.filter(x => [x.title, x.description, x.resource, x.uid].some(v => String(v ?? '').toLowerCase().includes(lq))); }
        const since = query.get('since'), until = query.get('until');
        if (since) list = list.filter(x => x.created_at >= since);
        if (until) list = list.filter(x => x.created_at <= until);
        return list;
      };
      const demoAlertSort = (list: any[], query: URLSearchParams) => {
        const sort = query.get('sort') ?? 'created_at';
        const order = query.get('order') ?? 'desc';
        const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        const cmp = (x: any, z: any) => {
          if (sort === 'severity') return (sevRank[x.severity] ?? 4) - (sevRank[z.severity] ?? 4);
          const a = String(x[sort] ?? ''), b0 = String(z[sort] ?? '');
          return a < b0 ? -1 : a > b0 ? 1 : 0;
        };
        const dir = order === 'asc' ? 1 : -1;
        return list.sort((x, z) => (cmp(x, z) * dir) || (x.created_at < z.created_at ? 1 : -1));
      };
      if (method === 'POST' && parts.length === 1) {
        const a = { id: alertSeq++, uid: `ALR-${String(alertSeq).padStart(4, '0')}`, org_id: b.org_id ?? 1, title: b.title ?? 'Untitled event', description: b.description ?? '', severity: b.severity ?? 'medium', source: b.source ?? 'api', resource: b.resource ?? null, correlated_count: 1, storm_suppressed: false, status: 'active', assignee: null, acked_by: null, acked_at: null, resolved_by: null, resolved_at: null, version: 1, incident_uid: null, ticket_uid: null, created_at: iso(0), raw_payload: b.raw_payload ?? undefined };
        alerts.unshift(a);
        demoAlertEvent(a, 'created', `Ingested from ${a.source}`);
        const pipeline: any = { notifications: [] as any[] };
        for (const r of rules.filter(x => x.enabled)) {
          const sevOk = !r.conditions.severity || r.conditions.severity.includes(a.severity);
          const srcOk = !r.conditions.source || r.conditions.source.includes(a.source);
          if (!sevOk || !srcOk) continue;
          for (const ch of r.channels) {
            const n = { id: notifSeq++, org_id: a.org_id, alert_id: a.id, alert_uid: a.uid, rule_id: r.id, channel: ch, recipient: r.recipients[0] ?? 'ops@infracentra.io', subject: `[${a.severity.toUpperCase()}] ${a.title}`, body: a.description, severity: a.severity, status: 'sent', attempts: 1, last_error: null, sent_at: iso(0), acked_by: null, acked_at: null, created_at: iso(0) };
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
      if (method === 'GET' && parts.length === 1 && query.get('page_size')) {
        const page = Math.max(1, Number(query.get('page') ?? 1));
        const pageSize = Math.min(200, Math.max(1, Number(query.get('page_size') ?? 25)));
        const all = demoAlertSort(demoAlertFilter(query), query);
        const total = all.length;
        return delay({ items: all.slice((page - 1) * pageSize, page * pageSize), total, page, page_size: pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) } as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'summary') {
        const list = demoAlertFilter(query);
        const by_severity: Record<string, number> = {}, by_status: Record<string, number> = {};
        list.forEach(x => { by_severity[x.severity] = (by_severity[x.severity] ?? 0) + 1; by_status[x.status] = (by_status[x.status] ?? 0) + 1; });
        return delay({ total: list.length, by_severity, by_status, unassigned_active: list.filter(x => x.status === 'active' && !x.assignee).length } as any) as unknown as T;
      }
      if (method === 'GET' && parts.length === 1) {
        let list = [...alerts].sort((a, z) => z.created_at.localeCompare(a.created_at));
        if (query.get('org_id')) list = list.filter(x => String(x.org_id) === query.get('org_id'));
        return delay(list as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'bulk') {
        demoAlertWriteGuard();
        const targetStatus: Record<string, string> = { ack: 'acked', resolve: 'resolved', reopen: 'active' };
        if (b.action === 'assign' && !b.assignee) throw httpErr(422, 'assignee required for action=assign');
        const org = callerOrgId();
        const results: any[] = [];
        for (const aid of (b.ids ?? []).slice(0, 200)) {
          const a = alerts.find(x => x.id === aid);
          if (!a || (org != null && a.org_id !== org)) { results.push({ id: aid, ok: false, reason: 'not_found_or_cross_tenant' }); continue; }
          try {
            const changed = demoTransitionAlert(a, { status: targetStatus[b.action], assignee: b.action === 'assign' ? b.assignee : undefined });
            results.push({ id: aid, ok: true, changed });
          } catch (e: any) { results.push({ id: aid, ok: false, reason: e.message }); }
        }
        return delay({ results, applied: results.filter(r => r.ok && r.changed).length } as any) as unknown as T;
      }
      if ((method === 'GET' || method === 'PATCH') && parts.length === 2) {
        const org = callerOrgId();
        const a = alerts.find(x => x.id === Number(parts[1]));
        if (!a || (org != null && a.org_id !== org)) throw httpErr(a ? 403 : 404, a ? 'Cross-tenant access denied' : 'Alert not found');
        if (method === 'PATCH') {
          demoAlertWriteGuard();
          const patch = { ...b };
          if (patch.clear_assignee) { patch.assignee = null; delete patch.clear_assignee; }
          const changed = demoTransitionAlert(a, patch);
          void changed;
          return delay(a as any) as unknown as T;
        }
        const detail: any = { ...a };
        detail.related_incidents = a.incident_uid
          ? incidents.filter(i => i.uid === a.incident_uid).map(i => ({ uid: i.uid, title: i.title, severity: i.severity, status: i.status })) : [];
        detail.related_tickets = a.ticket_uid
          ? tickets.filter(t => t.uid === a.ticket_uid).map(t => ({ uid: t.uid, title: t.title, status: t.status, priority: t.priority })) : [];
        detail.notes = alertNotes.filter(n => n.alert_id === a.id);
        detail.events = alertEvents.filter(e => e.alert_id === a.id).sort((x, z) => z.created_at.localeCompare(x.created_at));
        return delay(detail as any) as unknown as T;
      }
      if (parts.length === 3 && parts[2] === 'notes') {
        const org = callerOrgId();
        const a = alerts.find(x => x.id === Number(parts[1]));
        if (!a || (org != null && a.org_id !== org)) throw httpErr(a ? 403 : 404, a ? 'Cross-tenant access denied' : 'Alert not found');
        if (method === 'POST') {
          demoAlertWriteGuard();
          const note = { id: alertNoteSeq++, alert_id: a.id, author: demoSession().email ?? 'demo@infracentra.io', body: String(b.body ?? '').trim(), created_at: new Date().toISOString() };
          alertNotes.unshift(note);
          demoAlertEvent(a, 'noted', 'Investigation note added');
          a.version = (a.version || 1) + 1;
          return delay(note as any) as unknown as T;
        }
        return delay(alertNotes.filter(n => n.alert_id === a.id) as any) as unknown as T;
      }
      if (method === 'GET' && parts.length === 3 && parts[2] === 'events') {
        const a = alerts.find(x => x.id === Number(parts[1]));
        if (!a) throw httpErr(404, 'Alert not found');
        return delay(alertEvents.filter(e => e.alert_id === a.id).sort((x, z) => z.created_at.localeCompare(x.created_at)) as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'ack') {
        demoAlertWriteGuard();
        const a = alerts.find(x => x.id === Number(parts[1]));
        if (!a) throw httpErr(404, 'Alert not found');
        if (a.status === 'acked') return delay({ ok: true, changed: false, alert: a } as any) as unknown as T;
        const changed = demoTransitionAlert(a, { status: 'acked' });
        return delay({ ok: true, changed, alert: a } as any) as unknown as T;
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
        // Phase 5 mirror of GET /api/notifications: tenant scoping + csv
        // status/channel filters + q/alert_uid search, identical to FastAPI.
        const org = callerOrgId();
        let list = [...notifications].sort((a, z) => z.created_at.localeCompare(a.created_at));
        if (org != null) list = list.filter(n => n.org_id === org);
        else if (query.get('org_id')) list = list.filter(n => String(n.org_id) === query.get('org_id'));
        const csvHas = (k: string, v: string) => (query.get(k) ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(v);
        if (query.get('status')) list = list.filter(n => (query.get('status') ?? '').split(',').map(s => s.trim()).includes(String(n.status)));
        if (query.get('channel')) list = list.filter(n => (query.get('channel') ?? '').split(',').map(s => s.trim()).includes(String(n.channel)));
        void csvHas;
        const q = query.get('q');
        if (q) { const lq = q.toLowerCase(); list = list.filter(n => [n.subject, n.recipient].some(v => String(v ?? '').toLowerCase().includes(lq))); }
        const au = query.get('alert_uid');
        if (au) {
          const arow = alerts.find(x => x.uid === au);
          list = list.filter(n => n.alert_id === (arow?.id ?? -1));   // honest empty for unknown uid
        }
        const lim = Number(query.get('limit') ?? 0);
        const pg = Number(query.get('page') ?? 1);
        if (lim > 0) list = list.slice((pg - 1) * lim, (pg - 1) * lim + lim);
        // Bell component expects { items: [...] }; other pages expect the raw array.
        return delay(lim > 0 ? ({ items: list } as any) : (list as any)) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'retry-failed') {
        let n = 0;
        notifications.forEach(x => { if (x.status === 'dead_letter') { x.status = 'queued'; x.last_error = null; n++; } });
        return delay({ requeued: n } as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'analytics') {
        const orgA = callerOrgId();
        const scoped = orgA == null ? notifications : notifications.filter(n => n.org_id === orgA);
        const byStatus: Record<string, number> = {};
        scoped.forEach(n => { byStatus[n.status] = (byStatus[n.status] ?? 0) + 1; });
        const byChannel: Record<string, number> = {};
        scoped.forEach(n => { byChannel[n.channel] = (byChannel[n.channel] ?? 0) + 1; });
        return delay({ total: scoped.length, by_status: byStatus, by_channel: byChannel, avg_time_to_ack_minutes: 12, dead_letters: byStatus.dead_letter ?? 0 } as any) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'retry-dead-letters') {
        // Bulk DLQ flush stays platform-admin-only (same rule as the backend).
        if ((demoSession().role ?? '') !== 'platform_admin') throw httpErr(403, 'Platform admins only');
        let n = 0;
        notifications.forEach(x => { if (x.status === 'dead_letter') { x.status = 'sent'; x.attempts += 1; x.last_error = null; x.sent_at = iso(0); n++; } });
        return delay({ retried: n } as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'retry') {
        // Single dead-letter retry — backend-confirmed outcome only; anything
        // that is not dead_letter -> 409, exactly like POST /{id}/retry.
        const role = demoSession().role ?? 'client_admin';
        if (!['platform_admin', 'client_admin', 'analyst', 'technician'].includes(role)) throw httpErr(403, `Role '${role}' cannot modify alerts`);
        const nt = notifications.find(x => x.id === Number(parts[1]));
        if (!nt) throw httpErr(404, 'Notification not found');
        const orgR = callerOrgId();
        if (orgR != null && nt.org_id !== orgR) throw httpErr(403, 'Cross-tenant access denied');
        if (nt.status !== 'dead_letter') throw httpErr(409, `Only dead-letter notifications can be retried (status=${nt.status})`);
        nt.attempts = 1;
        nt.status = 'sent';           // simulated transport confirms delivery
        nt.last_error = null;
        nt.sent_at = iso(0);
        return delay({ id: nt.id, status: nt.status, attempts: nt.attempts, last_error: nt.last_error, sent_at: nt.sent_at } as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'ack') {
        const nt = notifications.find(x => x.id === Number(parts[1]));
        if (nt) {
          // Honesty rule from the backend: ack only flips rows the transport
          // actually delivered; queued/dead_letter keep their delivery status.
          if (nt.status === 'sent') nt.status = 'acked';
          nt.acked_by = demoSession().email ?? 'demo@infracentra.io';
          nt.acked_at = iso(0);
        }
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

    // ---- Incident Response (mirrors backend routers/incidents.py) ----
    if (root === 'incidents') {
      const uid = parts[1];
      if (method === 'GET' && !uid) return incListDemo(query) as unknown as T;
      if (method === 'POST' && !uid) {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Only administrators can open incidents');
        return incCreateDemo(b) as unknown as T;
      }
      if (!uid) throw httpErr(404, 'Demo: unknown incidents route');
      if (method === 'GET' && parts.length === 2) return delay(incDetailOut(incFindOr404(uid))) as unknown as T;
      if (method === 'PUT' && parts[2] === 'status') {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
        const inc = incFindOr404(uid);
        const next = b.status;
        if (!INCIDENT_STATUSES_DEMO.includes(next)) throw httpErr(422, `Unknown status '${next}'`);
        if (inc.status === next) return delay(incRowOut(inc)) as unknown as T;   // idempotent no-op
        if (!(INC_TRANSITIONS[inc.status] ?? []).includes(next)) {
          const e: any = new Error(`Illegal transition ${inc.status} → ${next}`);
          e.demoStatus = 409; e.current = inc.status; e.allowed = INC_TRANSITIONS[inc.status] ?? [];
          throw e;
        }
        const prev = inc.status;
        inc.status = next;
        if (next === 'resolved') inc.resolved_at = new Date().toISOString();
        if (next === 'closed') inc.closed_at = new Date().toISOString();
        incTouch(inc);
        incPushActivity(uid, demoSession().email ?? 'demo@infracentra.io', 'status_changed',
          b.note ? `Status moved ${prev} → ${next}: ${b.note}` : `Status moved ${prev} → ${next}`, prev, next);
        return delay(incRowOut(inc)) as unknown as T;
      }
      if (method === 'PUT' && parts[2] === 'assign') {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
        const inc = incFindOr404(uid);
        const prev = inc.assignee; const next = b.assignee ?? null;
        if (prev !== next) {
          inc.assignee = next; incTouch(inc);
          incPushActivity(uid, demoSession().email ?? 'demo@infracentra.io', 'assigned',
            next ? 'Ownership assigned' : 'Ownership cleared', prev, next);
        }
        return delay(incRowOut(inc)) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'acknowledge') {
        const inc = incFindOr404(uid);
        const who = demoSession().email ?? 'demo@infracentra.io';
        if (!inc.acknowledged_by) {
          inc.acknowledged_by = who; inc.acknowledged_at = new Date().toISOString(); incTouch(inc);
          incPushActivity(uid, who, 'acked', 'Acknowledged');
        }
        return delay(incRowOut(inc)) as unknown as T;
      }
      if (method === 'PATCH' && parts.length === 2) {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
        const inc = incFindOr404(uid);
        let changed = false;
        for (const f of ['title', 'description', 'severity', 'category', 'site_org_id', 'assignee'] as const) {
          if (b[f] !== undefined && (inc as any)[f] !== b[f]) {
            incPushActivity(uid, demoSession().email ?? 'demo@infracentra.io', 'updated',
              `Field '${f}' updated`, String((inc as any)[f] ?? ''), String(b[f] ?? ''));
            (inc as any)[f] = b[f]; changed = true;
          }
        }
        if (b.affected_assets !== undefined) { inc.affected_assets = b.affected_assets; changed = true; }
        if (b.tags !== undefined) { inc.tags = b.tags; changed = true; }
        if (changed) incTouch(inc);
        return delay(incRowOut(inc)) as unknown as T;   // idempotent no-op when nothing changed
      }
      if (method === 'POST' && parts[2] === 'notes') {
        const inc = incFindOr404(uid);
        const n = { id: noteSeq++, incident_uid: uid, author: demoSession().email ?? 'demo@infracentra.io',
                    content: String(b.content ?? ''), internal: b.internal !== false, created_at: new Date().toISOString() };
        (incNotesByUid[uid] ??= []).push(n);
        incPushActivity(uid, n.author, 'note_added', 'Investigation note added');
        incTouch(inc);
        return delay(n) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'evidence') {
        const inc = incFindOr404(uid);
        const e2 = { id: evSeq++, incident_uid: uid, name: String(b.name ?? 'artifact'), kind: b.kind ?? 'log',
                     sha256: null, ticket_uid: inc.ticket_uid ?? null,
                     collected_by: demoSession().email ?? 'demo@infracentra.io', created_at: new Date().toISOString() };
        (incEvidenceByUid[uid] ??= []).push(e2);
        incPushActivity(uid, e2.collected_by!, 'evidence_added', `Evidence '${e2.name}' attached`);
        incTouch(inc);
        return delay({ id: e2.id }) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'actions') {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
        const inc = incFindOr404(uid);
        const who = demoSession().email ?? 'demo@infracentra.io';
        const a2 = { id: actSeq++, incident_uid: uid, action_type: String(b.action_type ?? ''), status: 'completed',
                     detail: String(b.detail ?? ''), performed_by: who, playbook_run_uid: null, created_at: new Date().toISOString() };
        (incActionsByUid[uid] ??= []).push(a2);
        incPushActivity(uid, who, 'action_recorded', `Response action recorded: ${a2.action_type}`);
        incTouch(inc);
        return delay({ id: a2.id, action_type: a2.action_type, status: a2.status, detail: a2.detail,
                       performed_by: a2.performed_by, playbook_run_uid: null, created_at: a2.created_at }) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'link-ticket') {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
        const inc = incFindOr404(uid);
        const tk = tickets.find(t => t.uid === b.ticket_uid);
        if (!tk) throw httpErr(404, 'Ticket not found');
        if (inc.ticket_uid !== tk.uid) {
          const prev = inc.ticket_uid;
          inc.ticket_uid = tk.uid; incTouch(inc);
          incPushActivity(uid, demoSession().email ?? 'demo@infracentra.io', 'ticket_linked',
            `Linked to ticket ${tk.uid}`, prev, tk.uid);
        }
        return delay(incRowOut(inc)) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'create-ticket') {
        if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
        const inc = incFindOr404(uid);
        if (inc.ticket_uid) return delay({ reused: true, ticket_uid: inc.ticket_uid }) as unknown as T;
        const ai = fakeAi(inc.title, inc.severity === 'critical' || inc.severity === 'high' ? 'p1' : 'p2', 'incident');
        const t = mkTicket({ title: `[IR] ${inc.title}`, description: `Opened from incident ${inc.uid}`,
          priority: ai.ai_priority, source: 'api', org_id: inc.org_id, ...ai });
        tickets.unshift(t);
        inc.ticket_uid = t.uid; incTouch(inc);
        incPushActivity(uid, demoSession().email ?? 'demo@infracentra.io', 'ticket_created', `Ticket ${t.uid} opened from incident`);
        return delay({ reused: false, ticket_uid: t.uid }) as unknown as T;
      }
      if (method === 'GET' && parts[2] === 'activity') {
        incFindOr404(uid);
        const all = (incActivityByUid[uid] ?? []).slice().sort((a, z) => z.id - a.id);
        const page = Math.max(1, Number(query.get('page') ?? 1));
        const pageSize = Math.min(200, Math.max(1, Number(query.get('page_size') ?? 50)));
        return delay({ items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length,
                       page, page_size: pageSize }) as unknown as T;
      }
    }

    // ---- SOAR v2 (mirrors backend routers/soar.py) ----
    if (root === 'soar') {
      const sub = parts[1];
      if (sub === 'playbooks') {
        const idNum = Number(parts[2]);
        const pb = soarPlaybooks.find(p => p.id === idNum);
        if (method === 'GET' && !parts[2]) {
          const scope = callerOrgIdSafe();
          const list = soarPlaybooks.filter(p => p.org_id === null || scope === null || p.org_id === scope);
          const page = Math.max(1, Number(query.get('page') ?? 1));
          const pageSize = Math.min(200, Math.max(1, Number(query.get('page_size') ?? 50)));
          return delay({ items: list.map(soarPbOut), total: list.length, page, page_size: pageSize }) as unknown as T;
        }
        if (method === 'POST' && !parts[2]) {
          if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
          const bad = (b.steps ?? []).filter((s: any) => !(s.action in SOAR_SAFE_ACTIONS));
          if (bad.length) throw httpErr(422, `Disallowed action(s): ${bad.map((s: any) => s.action).join(', ')}`);
          const np = { id: soarPbSeq++, uid: `PBK-${String(soarPbSeq - 1).padStart(6, '0')}`,
            org_id: callerOrgIdSafe(), name: b.name, description: b.description ?? '',
            category: b.category ?? 'Incident Response', steps: (b.steps ?? []).map((s: any) => ({ name: s.name, action: s.action, params: s.params ?? {} })),
            triggers: b.triggers ?? [{ type: 'manual' }], enabled: b.enabled !== false,
            created_by: demoSession().email ?? 'demo@infracentra.io', created_at: new Date().toISOString(), updated_at: null };
          soarPlaybooks.push(np);
          return delay(soarPbOut(np)) as unknown as T;
        }
        if (!pb) throw httpErr(404, 'Playbook not found');
        if (method === 'GET' && parts.length === 3) {
          const recent = soarRuns.filter(r => r.playbook_id === pb.id).slice(-10).reverse();
          const stats: Record<string, number> = { completed: 0, failed: 0, partial: 0, cancelled: 0, running: 0, queued: 0 };
          recent.forEach(r => { stats[r.status] = (stats[r.status] ?? 0) + 1; });
          return delay({ ...soarPbOut(pb), recent_runs: recent.map(r => soarRunOut(r, false)), run_stats: stats }) as unknown as T;
        }
        if (method === 'GET' && parts[3] === 'preview') {
          const plan = (pb.steps ?? []).map((s: any, i: number) => ({
            step: i + 1, name: s.name, action: s.action, params: soarRedact(s.params ?? {}),
            consequential: SOAR_SAFE_ACTIONS[s.action] === true, requires_confirmation: SOAR_SAFE_ACTIONS[s.action] === true }));
          return delay({ playbook_id: pb.id, mode: 'preview', executed: false,
                         requires_confirmation: soarHasConsequential(pb.steps ?? []), plan }) as unknown as T;
        }
        if (method === 'POST' && parts[3] === 'run') {
          const mode = b.mode;
          if (!['simulate', 'preview', 'execute'].includes(mode)) throw httpErr(422, 'mode must be simulate|preview|execute');
          if (mode === 'preview') {
            const plan = (pb.steps ?? []).map((s: any, i: number) => ({
              step: i + 1, name: s.name, action: s.action, params: soarRedact(s.params ?? {}),
              consequential: SOAR_SAFE_ACTIONS[s.action] === true, requires_confirmation: SOAR_SAFE_ACTIONS[s.action] === true }));
            return delay({ playbook_id: pb.id, mode: 'preview', executed: false,
                           requires_confirmation: soarHasConsequential(pb.steps ?? []), plan }) as unknown as T;
          }
          if (!pb.enabled) throw httpErr(409, 'Playbook is disabled');
          if ((demoSession().role ?? 'client_user') === 'client_user' && mode === 'execute') {
            throw httpErr(403, 'Standard users may not execute playbooks; ask an administrator');
          }
          const executing = mode === 'execute';
          if (executing && soarHasConsequential(pb.steps ?? []) && !b.confirm) {
            const e: any = new Error('This playbook contains consequential actions. Resend with confirm=true to proceed.');
            e.demoStatus = 409; e.requires_confirmation = true;
            throw e;
          }
          if (b.idempotency_key) {
            const prev = soarRuns.find(r => r.playbook_id === pb.id && r.idempotency_key === b.idempotency_key);
            if (prev) return delay({ replayed: true, run: soarRunOut(prev) }) as unknown as T;
          }
          if (b.incident_uid) {
            try { incFindOr404(String(b.incident_uid)); } catch { throw httpErr(404, 'Incident not found'); }
          }
          const run = { id: soarRunSeq++, uid: `RUN-${String(soarRunSeq - 1).padStart(6, '0')}`,
            playbook_id: pb.id, org_id: pb.org_id ?? callerOrgIdSafe() ?? 1, incident_uid: b.incident_uid ?? null,
            mode, status: 'running', triggered_by: demoSession().email ?? 'demo@infracentra.io',
            cancel_requested: false, idempotency_key: b.idempotency_key ?? null,
            total_steps: (pb.steps ?? []).length, completed_steps: 0, failed_steps: 0, skipped_steps: 0,
            result_log: [], error: null, started_at: new Date().toISOString(), finished_at: null, created_at: new Date().toISOString() };
          soarRuns.push(run);
          const res = soarExecSteps(run, pb.steps ?? [], executing);
          run.result_log = res.log; run.completed_steps = res.completed;
          run.failed_steps = res.failed; run.skipped_steps = res.skipped;
          run.status = soarFinalStatus(res.completed, res.failed);
          run.finished_at = new Date().toISOString();
          if (run.status === 'failed') run.error = res.log.find((e2: any) => e2.status === 'failed')?.detail ?? 'step failure';
          if (executing && run.incident_uid) soarLinkIncidentRun(run, pb.name);
          return delay({ replayed: false, run: soarRunOut(run) }) as unknown as T;
        }
        if (method === 'PUT' && parts.length === 3) {
          if (!incHasRole(['platform_admin', 'client_admin'])) throw httpErr(403, 'Insufficient role');
          const bad = (b.steps ?? []).filter((s: any) => !(s.action in SOAR_SAFE_ACTIONS));
          if (bad.length) throw httpErr(422, `Disallowed action(s): ${bad.map((s: any) => s.action).join(', ')}`);
          Object.assign(pb, { name: b.name ?? pb.name, description: b.description ?? pb.description,
            category: b.category ?? pb.category, enabled: b.enabled ?? pb.enabled,
            steps: b.steps ? b.steps.map((s: any) => ({ name: s.name, action: s.action, params: s.params ?? {} })) : pb.steps,
            triggers: b.triggers ?? pb.triggers, updated_at: new Date().toISOString() });
          return delay(soarPbOut(pb)) as unknown as T;
        }
        if (method === 'DELETE' && parts.length === 3) {
          if (!incHasRole(['platform_admin'])) throw httpErr(403, 'Insufficient role');
          const idx = soarPlaybooks.indexOf(pb);
          if (idx >= 0) soarPlaybooks.splice(idx, 1);
          return delay(undefined as any) as unknown as T;
        }
      }
      if (sub === 'runs') {
        if (method === 'GET' && !parts[2]) {
          const scope = callerOrgIdSafe();
          let list = soarRuns.filter(r => scope === null || r.org_id === scope || r.org_id == null);
          if (query.get('playbook_id')) list = list.filter(r => String(r.playbook_id) === query.get('playbook_id'));
          if (query.get('incident_uid')) list = list.filter(r => r.incident_uid === query.get('incident_uid'));
          if (query.get('status')) list = list.filter(r => r.status === query.get('status'));
          if (query.get('mode')) list = list.filter(r => r.mode === query.get('mode'));
          list = list.slice().reverse();
          const page = Math.max(1, Number(query.get('page') ?? 1));
          const pageSize = Math.min(200, Math.max(1, Number(query.get('page_size') ?? 25)));
          return delay({ items: list.slice((page - 1) * pageSize, page * pageSize).map(r => soarRunOut(r, false)),
                         total: list.length, page, page_size: pageSize }) as unknown as T;
        }
        const run = soarRuns.find(r => r.uid === parts[2]);
        if (!run) throw httpErr(404, 'Run not found');
        if (method === 'GET') return delay(soarRunOut(run)) as unknown as T;
        if (method === 'POST' && parts[3] === 'cancel') {
          if (!['queued', 'running'].includes(run.status)) throw httpErr(409, `Run already terminal (${run.status})`);
          run.cancel_requested = true; run.status = 'cancelled'; run.finished_at = new Date().toISOString();
          return delay(soarRunOut(run)) as unknown as T;
        }
        if (method === 'POST' && parts[3] === 'retry') {
          if (run.status === 'running' || run.status === 'queued') throw httpErr(409, 'Run still in progress');
          const pb2 = soarPlaybooks.find(p => p.id === run.playbook_id);
          if (!pb2) throw httpErr(409, 'Playbook no longer exists');
          if (run.mode === 'execute' && soarHasConsequential(pb2.steps ?? []) && !b.confirm) {
            const e: any = new Error('Retry re-executes consequential actions. Resend with confirm=true.');
            e.demoStatus = 409; e.requires_confirmation = true;
            throw e;
          }
          if (b.idempotency_key) {
            const prev = soarRuns.find(r => r.playbook_id === pb2.id && r.idempotency_key === b.idempotency_key);
            if (prev) return delay({ replayed: true, run: soarRunOut(prev) }) as unknown as T;
          }
          const nrun: any = { id: soarRunSeq++, uid: `RUN-${String(soarRunSeq - 1).padStart(6, '0')}`,
            playbook_id: pb2.id, org_id: run.org_id, incident_uid: run.incident_uid,
            mode: run.mode, status: 'running', triggered_by: demoSession().email ?? 'demo@infracentra.io',
            cancel_requested: false, idempotency_key: b.idempotency_key ?? null,
            total_steps: (pb2.steps ?? []).length, completed_steps: 0, failed_steps: 0, skipped_steps: 0,
            result_log: [], error: null, retry_of: run.uid, started_at: new Date().toISOString(),
            finished_at: null, created_at: new Date().toISOString() };
          soarRuns.push(nrun);
          const res = soarExecSteps(nrun, pb2.steps ?? [], nrun.mode === 'execute');
          nrun.result_log = res.log; nrun.completed_steps = res.completed;
          nrun.failed_steps = res.failed; nrun.skipped_steps = res.skipped;
          nrun.status = soarFinalStatus(res.completed, res.failed);
          nrun.finished_at = new Date().toISOString();
          if (nrun.status === 'failed') nrun.error = res.log.find((e2: any) => e2.status === 'failed')?.detail ?? 'step failure';
          if (nrun.mode === 'execute' && nrun.incident_uid) soarLinkIncidentRun(nrun, pb2.name);
          return delay({ replayed: false, run: soarRunOut(nrun) }) as unknown as T;
        }
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
          discoveredDevices.push({ id: devSeq++, scan_id: s.id, org_id: s.org_id, ip: `10.0.0.${i * 7}`, mac: `aa:bb:cc:00:${String(i).padStart(2, '0')}:ff`, hostname: `demo-host-${i}`, os_guess: i % 3 === 0 ? 'Linux 6.x' : 'Windows Server 2022', device_type: i % 2 ? 'server' : 'network', open_ports: [22, 443].slice(0, (i % 2) + 1), snmp_match: i % 2 === 0, sys_desc: 'Demo simulated device', imported: false, verified: i % 2 === 0, source: 'discovery' as const, last_seen: iso(0), created_at: iso(0) });
        }
        return delay(s as any) as unknown as T;
      }
      if (method === 'POST' && parts[2] === 'cancel') {
        const sc = scans.find(x => x.id === Number(parts[1]));
        if (!sc) throw new Error('Scan not found');
        if (!['queued', 'running'].includes(sc.status)) throw new Error(`Scan already ${sc.status} — nothing to cancel`);
        sc.status = 'cancelled'; sc.finished_at = iso(0);
        return delay({ ...sc } as any) as unknown as T;
      }
      if (method === 'GET' && parts[2] === 'devices') return delay(discoveredDevices.filter(d => d.scan_id === Number(parts[1])) as any) as unknown as T;
      if (method === 'GET') return delay(scans.find(s => s.id === Number(parts[1])) as any) as unknown as T;
    }
    if (root === 'devices') {
      if (method === 'GET' && parts.length === 2) {
        // Device detail — mirrors backend GET /discovery/devices/{id}.
        // Live status attaches ONLY from the matching demo probe/collector row;
        // unmonitored hosts honestly report monitoring_unavailable.
        const d = discoveredDevices.find(x => x.id === Number(parts[1]));
        if (!d) throw new Error('Device not found');
        // Monitoring match ONLY against the simulated probe fleet (same rule as
        // GET /agents/probes: first ⌈n/3⌉ tenant devices run an agent).
        const orgDev = demoDevices.filter(x => x.orgId === d.org_id);
        const fleetSize = Math.max(2, Math.ceil(orgDev.length / 3));
        const hostnames = new Set(orgDev.slice(0, fleetSize).map(x => x.hostname));
        const dd = demoDevices.find(x => x.hostname === d.hostname && x.orgId === d.org_id);
        const inFleet = !!dd && hostnames.has(dd.hostname);
        const probe = inFleet && dd ? {
          status: dd.status === 'offline' ? 'offline' : 'online',
          last_seen: iso(dd.lastSeenMin || 1), os: dd.os,
        } : null;
        const openInc = alerts.filter(a => a.org_id === d.org_id && !a.acked_by &&
          ((d.hostname && (a.resource || '').toLowerCase().includes(String(d.hostname).toLowerCase())) ||
           (d.ip && (a.resource || '').includes(d.ip)))).length;
        return delay({
          id: d.id, monitored: !!probe, monitor_source: probe ? 'probe' : null,
          status: probe ? probe.status : 'monitoring_unavailable',
          last_seen: probe ? probe.last_seen : null,
          os: probe ? (probe.os || d.os_guess) : d.os_guess,
          hostname: d.hostname, ip: d.ip, mac: d.mac, device_type: d.device_type,
          snmp_match: !!d.snmp_match, open_ports: d.open_ports || [],
          location: d.location ?? null, related_incidents: openInc, org_id: d.org_id,
        } as any) as unknown as T;
      }
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
        // Backend parity (routers/projects.py add_milestone): accepts either a
        // ?title= query or a MilestoneIn body { title, done, planned_at }.
        const m = {
          id: milestoneSeq++,
          title: query.get('title') ?? b.title ?? 'Jalon',
          done: false,
          planned_at: b.planned_at ?? null,
        };
        pr.milestones.push(m);
        return delay({ ...m } as any) as unknown as T;
      }
      // PATCH /projects/milestones/{mid} — toggle done / set planned date
      // (backend parity: explicit null in model_fields_set clears the date).
      if (parts[1] === 'milestones' && method === 'PATCH') {
        const mid = Number(parts[2]);
        for (const p0 of projectsStore) {
          const m = p0.milestones.find((x: any) => x.id === mid);
          if (m) {
            if (!isPlatform && p0.org_id !== callerOrgId()) throw httpErr(403, 'Cross-tenant access denied');
            if (b.done !== undefined) m.done = !!b.done; else if (query.get('done') !== null) m.done = query.get('done') === 'true'; else m.done = !m.done;
            if (b && Object.prototype.hasOwnProperty.call(b, 'planned_at')) m.planned_at = b.planned_at ?? null;
            if (b.title) m.title = b.title;
            return delay({ id: m.id, title: m.title, done: m.done, planned_at: m.planned_at ?? null } as any) as unknown as T;
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

    // ---- Worldwide Attack Map — mirrors routers/security_map.py ----------
    // DEMO-ONLY branch: this code runs exclusively when isDemoMode() is true
    // (api.ts routes every call through demoStore.handle in that case). In
    // production the same URL hits the real FastAPI endpoint instead, so demo
    // fixtures can never leak into the live product. Filtering rules are the
    // ones of the backend router: geo-only events, severity/event_type/country
    // filters, tenant scoping via callerOrgId(), honest empty state.
    if (root === 'security' && parts[1] === 'attack-map') {
      const org = callerOrgId();
      let list = org == null ? [...alerts] : alerts.filter(a => a.org_id === org);
      const startT = query.get('start_time'), endT = query.get('end_time');
      if (startT) list = list.filter(a => a.created_at >= startT);
      if (endT) list = list.filter(a => a.created_at < endT);
      const sevSet = query.get('severity')?.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      const typeSet = query.get('event_type')?.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      const srcC = query.get('source_country')?.toLowerCase();
      const dstC = query.get('destination_country')?.toLowerCase();
      const lastIngestion = list.length ? list.map(a => a.created_at).sort()[list.length - 1] : null;
      const events: any[] = [];
      for (const a of list) {
        const raw = (a.raw_payload ?? {}) as Record<string, any>;
        const src = raw.src_geo ?? null, dst = raw.dst_geo ?? null;
        if (!src && !dst) continue; // geo-only — same honesty rule as the backend
        if (sevSet?.length && !sevSet.includes(String(a.severity).toLowerCase())) continue;
        if (typeSet?.length && !typeSet.includes(String(a.source).toLowerCase())) continue;
        if (srcC && !(src && String(src.country).toLowerCase() === srcC)) continue;
        if (dstC && !(dst && String(dst.country).toLowerCase() === dstC)) continue;
        const confs = [src?.confidence, dst?.confidence].filter((x: any) => typeof x === 'number');
        const cls = ['observed', 'malicious', 'confirmed'].includes(raw.classification)
          ? raw.classification : 'observed'; // unverified telemetry is never an "attack"
        events.push({
          id: a.id, uid: a.uid, timestamp: a.created_at, event_type: a.source, title: a.title,
          severity: String(a.severity).toLowerCase(), classification: cls,
          src: src ? { lat: src.lat, lon: src.lon, country: src.country } : null,
          dst: dst ? { lat: dst.lat, lon: dst.lon, country: dst.country } : null,
          confidence: confs.length ? Math.min(...confs) : null,
          count: Math.max(1, a.correlated_count ?? 1), resource: a.resource,
        });
      }
      return delay({
        events, total_events: events.reduce((n, e) => n + e.count, 0),
        last_ingestion_at: lastIngestion, generated_at: new Date().toISOString(),
        note: "DEMO MODE fixtures — approximate geolocation; 'observed' events are telemetry, not confirmed attacks.",
      } as any) as unknown as T;
    }

    // ---- Organizational Infrastructure Topology — mirrors routers/org_topology.py ----
    // DEMO-ONLY branch (isDemoMode() gates every call into demoStore.handle()).
    // Built from the SAME demo world as everything else: demoTenants supplies
    // the registered org hierarchy (orgType/parentOrgId/location), the probe
    // fleet mirrors the /agents/probes simulation, and open-alert counts reuse
    // the alerts array. Honesty rules identical to the backend: sites appear
    // only when they exist as tenant records; an org with zero probes is
    // "monitoring_unavailable", never "healthy"; device-to-device network
    // links are NEVER drawn (network_topology_available stays false).
    if (root === 'org-topology') {
      const myOrg = callerOrgId();
      const rootT = demoTenants.find(t => t.id === (myOrg ?? 1)) ?? demoTenants[0];
      const children = demoTenants.filter(t => t.parentOrgId === rootT.id);
      const orgs = [rootT, ...children];
      const hqConfigured = orgs.some(t => t.orgType === 'HQ');
      const openByOrg: Record<number, number> = {};
      for (const a of alerts) {
        const raw = (a.raw_payload ?? {}) as Record<string, any>;
        if (raw.resolved || (a.ticket_uid && ['info', 'low'].includes(a.severity))) continue;
        openByOrg[a.org_id] = (openByOrg[a.org_id] ?? 0) + 1;
      }
      const nodes: any[] = [];
      const edges: any[] = [];
      nodes.push({
        id: `org:${rootT.id}`, kind: rootT.orgType === 'HQ' ? 'hq' : 'organization',
        name: rootT.name, parent: null, org_ref: rootT.id, site_status: 'active',
        org_type: rootT.orgType, country: rootT.country.toUpperCase(),
        asset_count: demoDevices.filter(d => d.orgId === rootT.id).length,
        related_incidents: openByOrg[rootT.id] ?? 0,
      });
      for (const c of children) {
        nodes.push({
          id: `org:${c.id}`, kind: c.orgType === 'HQ' ? 'hq' : 'site',
          name: `${c.name} — ${c.location}`, parent: `org:${rootT.id}`, org_ref: c.id,
          site_status: 'active', org_type: c.orgType, country: c.country.toUpperCase(),
          asset_count: demoDevices.filter(d => d.orgId === c.id).length,
          related_incidents: openByOrg[c.id] ?? 0,
        });
        edges.push({ source: `org:${rootT.id}`, target: `org:${c.id}`, type: 'organizational' });
      }
      for (const o of orgs) {
        const plist = demoDevices.filter(d => d.orgId === o.id && d.isProbe);
        if (!plist.length) {
          nodes.push({ id: `monitoring:${o.id}`, kind: 'probe',
            name: 'Monitoring unavailable at this site', parent: `org:${o.id}`,
            org_ref: o.id, health: 'monitoring_unavailable', related_incidents: 0 });
          edges.push({ source: `org:${o.id}`, target: `monitoring:${o.id}`, type: 'organizational' });
          continue;
        }
        for (const d of plist) {
          const offline = d.status === 'offline';
          nodes.push({ id: `probe:${d.id}`, kind: 'probe', name: d.hostname,
            parent: `org:${o.id}`, org_ref: o.id,
            health: offline ? 'offline' : d.status === 'degraded' ? 'stale' : 'healthy',
            last_seen: iso(offline ? 45 : d.lastSeenMin || 1), agent_version: '1.0.0',
            os: d.os?.toLowerCase().includes('win') ? 'windows' : 'linux', ip: d.ip });
          edges.push({ source: `org:${o.id}`, target: `probe:${d.id}`, type: 'organizational' });
        }
      }
      const degraded = nodes.filter(n => n.health === 'offline' || n.health === 'stale').length;
      const noteParts = [
        'DEMO MODE fixtures — nodes come from the demo tenant registry and probe fleet only.',
        hqConfigured ? '' : 'Headquarters is not configured for this organization.',
        degraded ? `${degraded} collector(s) offline or stale — see health badges.` : '',
        'Device-to-device network topology is unavailable: only organizational ownership links are drawn.',
      ].filter(Boolean);
      return delay({
        nodes, edges, root_org_id: rootT.id, hq_configured: hqConfigured,
        network_topology_available: false, note: noteParts.join(' '),
        generated_at: new Date().toISOString(),
      } as any) as unknown as T;
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

    // ---- Pricing V2 (per-asset packs) — mirrors routers/pricing_v2.py ----
    // GET  /pricing/config   -> bundled V2 config (public)
    // GET  /pricing/invoice  -> live invoice of the caller's tenant via pricingEngine.quote()
    // POST /pricing/quote    -> pack or custom quote from the request body
    if (root === 'pricing') {
      if (method === 'GET' && parts[1] === 'config') {
        return delay({ ...PRICING_CONFIG_V2, packDetails: livePackDetails } as any) as unknown as T;
      }
      // ---- Pack Customizer (/admin/packs) — mirrors pricing_v2.py ----
      if (parts[1] === 'packs' && method === 'GET') {
        const eff: Record<string, any> = {};
        for (const [pid, d] of Object.entries(livePackDetails)) {
          const base = DEFAULT_PACK_DETAILS[pid];
          const added = (base ? [...d.services, ...d.freePicks].filter(x => !(base.services.includes(x) || base.freePicks.includes(x))) : [...d.services, ...d.freePicks]);
          const removed = (base ? [...base.services, ...base.freePicks].filter(x => !(d.services.includes(x) || d.freePicks.includes(x))) : []);
          eff[pid] = { id: pid, configured: JSON.stringify(d) !== JSON.stringify(base), services: d.services, free_picks: d.freePicks, added, removed };
        }
        return delay({ version: PRICING_CONFIG_V2.version, packs: livePackDetails, effective: eff } as any) as unknown as T;
      }
      if (parts[1] === 'packs' && parts[2] && method === 'PUT') {
        const pid = parts[2];
        const def = b as any;
        if (!Array.isArray(def.services) || !Array.isArray(def.freePicks)) {
          return Promise.reject(new Error('Pack invalide : services et freePicks requis.')) as unknown as T;
        }
        const prev = livePackDetails[pid] ?? DEFAULT_PACK_DETAILS[pid];
        livePackDetails = { ...livePackDetails, [pid]: { ...(prev ?? {} as any), ...def, id: pid } };
        persistPackDetails(livePackDetails);
        pushPlatformAudit('pricing.pack.updated', `pack « ${pid} » : ${def.services.length + def.freePicks.length} services (${def.services.length} payants, ${def.freePicks.length} inclus)`);
        return delay({ ok: true, pack: livePackDetails[pid] } as any) as unknown as T;
      }
      if (parts[1] === 'packs' && parts[2] === 'reset' && method === 'POST') {
        livePackDetails = JSON.parse(JSON.stringify(DEFAULT_PACK_DETAILS));
        persistPackDetails(livePackDetails);
        pushPlatformAudit('pricing.packs.reset', 'composition des packs restaurée aux valeurs par défaut');
        return delay({ ok: true, version: PRICING_CONFIG_V2.version } as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'invoice') {
        const s = demoSession();
        const m = /^org-dw-(\d+)$/.exec(String(s.orgId ?? ''));
        const tid = m ? Number(m[1]) : 1;
        const t = demoTenants.find(x => x.id === tid) ?? demoTenants[0];
        const liveAssets = demoDevices.filter(d => d.orgId === tid).length;
        const billable = Math.max(t.endpointCount, liveAssets);
        const pack: PackId = PACK_FROM_LEGACY[t.planTier] ?? 'starter';
        const q = quote({
          mode: 'pack', pack, assets: demoAssetsFromEndpoints(billable),
          siemGbDay: t.siemGbDayUsed, retentionDays: PRICING_CONFIG_V2.packs[pack].retentionDays,
          contractMonths: t.billingCycle === 'ANNUAL' ? 12 : 0,
        });
        return delay({
          ...q,
          plan_tier: t.planTier, billing_cycle: t.billingCycle,
          billable_endpoints: billable, live_asset_count: liveAssets,
          unit_price_mad: q.totals.price_per_unit_mad,
        } as any) as unknown as T;
      }
      // POST /pricing/leads -> simulated sales/demo lead capture (mirrors
      // pricing_v2.py create_lead: honeypot swallowed, consent required).
      if (method === 'POST' && parts[1] === 'leads') {
        if (b.website) return delay({ ok: true } as any) as unknown as T;   // bot trap
        if (!b.consent) return Promise.reject(new Error('Le consentement (loi 09-08 / CNDP) est requis.')) as unknown as T;
        pushPlatformAudit('pricing.lead.created', `lead démo from ${String(b.email ?? '?')} (${String(b.kind ?? 'sales')})`);
        return delay({
          ok: true, id: Math.floor(Math.random() * 9000) + 1000,
          message: 'Un conseiller commercial vous enverra un calculateur personnel ou réalisera le calcul avec vous.',
        } as any) as unknown as T;
      }
      if (method === 'POST' && parts[1] === 'quote') {
        // Accept BOTH the V2 QuoteInputs shape and the legacy v1 body shape.
        const legacyPack: PackId | undefined = b.pack ?? PACK_FROM_LEGACY[String(b.plan_tier ?? b.planTier ?? '')];
        const legacyUnits = Array.isArray(b.assets) ? undefined
          : [{ class: 'workstation', qty: Math.round((b.endpoint_count ?? b.endpointCount ?? 0) * 0.8) },
             { class: 'mailbox', qty: Math.round((b.endpoint_count ?? b.endpointCount ?? 0) * 0.2) }];
        const inputs: any = {
          mode: b.mode ?? (legacyPack ? 'pack' : 'custom'),
          pack: legacyPack,
          assets: b.assets ?? legacyUnits,
          siemGbDay: b.siemGbDay ?? b.siem_gb_day_used ?? b.siemGbDayUsed ?? 0,
          retentionDays: b.retentionDays ?? PRICING_CONFIG_V2.packs[legacyPack ?? 'pro'].retentionDays,
          backupVolumeGb: b.backupVolumeGb ?? b.backup_volume_gb,
          contractMonths: b.contractMonths ?? ((b.billing_cycle ?? b.billingCycle) === 'ANNUAL' ? 12 : 0),
          support247: b.support247,
          customServices: b.customServices ?? b.custom_services,
          freePicks: b.freePicks ?? b.free_picks,
          partnerTier: b.partnerTier ?? b.partner_tier,
          dealRegisteredAt: b.dealRegisteredAt ?? b.deal_registered_at,
        };
        return delay(quote(inputs) as any) as unknown as T;
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

    // ---- Audit log (mirrors GET /api/audit/logs + /logs/my-org) ------------
    if (root === 'audit' && (parts[1] === 'logs' || parts[1] === 'actors' || parts[1] === 'resources')) {
      seedAuditTrail();
      const s = demoSession();
      const isPlatform = s.role === 'platform_admin';
      // Backend audit.py: /logs requires platform_admin; clients use /logs/my-org.
      if (parts[1] === 'logs' && parts[2] !== 'my-org' && !isPlatform) {
        throw httpErr(403, 'Plateforme uniquement — les clients consultent /audit/logs/my-org');
      }
      let list = [...auditTrail];
      if (!isPlatform || parts[2] === 'my-org') {
        const myOrg = callerOrgIdSafe();
        list = list.filter(r => myOrg === null ? true : r.org_id === myOrg);
      } else if (query.get('org_id')) {
        list = list.filter(r => String(r.org_id) === query.get('org_id'));
      }
      if (parts[1] === 'actors') return delay([...new Set(list.map(r => r.actor_name))] as any) as unknown as T;
      if (parts[1] === 'resources') return delay([...new Set(list.map(r => r.resource))] as any) as unknown as T;
      const roleF = query.get('actor_role'); if (roleF) list = list.filter(r => r.actor_role === roleF);
      const outF = query.get('outcome'); if (outF) list = list.filter(r => r.outcome === outF);
      const resF = query.get('resource'); if (resF) list = list.filter(r => r.resource.toLowerCase() === resF.toLowerCase());
      const actF = query.get('action'); if (actF) list = list.filter(r => r.action.toLowerCase().includes(actF.toLowerCase()));
      const qf = (query.get('q') ?? '').toLowerCase();
      if (qf) list = list.filter(r => `${r.actor_name} ${r.action} ${r.resource} ${r.resource_id} ${r.details ?? ''}`.toLowerCase().includes(qf));
      const since = query.get('since'); if (since) list = list.filter(r => r.timestamp >= since);
      const until = query.get('until'); if (until) list = list.filter(r => r.timestamp <= until);
      const skip = Math.max(0, Number(query.get('skip') ?? 0));
      const limit = Math.min(500, Math.max(1, Number(query.get('limit') ?? 100)));
      return delay(list.slice(skip, skip + limit) as any) as unknown as T;
    }

    // ---- Users directory (mirrors GET /api/users/ — users.py scoping) -------
    if (root === 'users' && method === 'GET') {
      const s = demoSession();
      let list = usersDirectory;
      if (s.role !== 'platform_admin') {
        const myOrg = callerOrgIdSafe();
        list = list.filter(u => myOrg === null ? true : u.org_id === myOrg);
      } else if (query.get('org_id')) {
        list = list.filter(u => String(u.org_id) === query.get('org_id'));
      }
      const skip = Math.max(0, Number(query.get('skip') ?? 0));
      const limit = Math.min(500, Math.max(1, Number(query.get('limit') ?? 100)));
      return delay(list.slice(skip, skip + limit) as any) as unknown as T;
    }

    // ---- Entitlements (mirrors GET /api/entitlements/ — entitlements.py) ----
    if (root === 'entitlements' && method === 'GET') {
      const s = demoSession();
      let list = entitlementsTable;
      if (parts[1] === 'check' && parts[2]) {
        const svc = decodeURIComponent(parts[2]);
        const row = list.find(e => e.service_id === svc);
        return delay({ entitled: !!row?.enabled, service_id: svc } as any) as unknown as T;
      }
      if (parts[1] === 'graph' || parts[1] === 'chain') {
        // Mirror of backend app/services/service_graph.py + routers/entitlements.py.
        const orgRows = list.filter(e => (s.role !== 'platform_admin' ? true : query.get('org_id') ? e.org_id === Number(query.get('org_id')) : true));
        const targetOrgId = s.role !== 'platform_admin'
          ? callerOrgIdSafe() ?? 1
          : (query.get('org_id') ? Number(query.get('org_id')) : (callerOrgIdSafe() ?? orgRows[0]?.org_id ?? 1));
        const scoped = list.filter(e => e.org_id === targetOrgId);
        const enabledSet = new Set(scoped.filter(e => e.enabled).map(e => e.service_id));
        void enabledSet;
        const present = new Set(scoped.map(e => e.service_id));
        const _unusedLabels: Record<string, string> = {
          'threat-intel': 'Threat Intelligence', compliance: 'Compliance Mapper',
          'incident-response': 'Incident Response', analytics: 'Security Analytics',
          soar: 'SOAR Automation', 'vuln-scanning': 'Vulnerability Scanning',
          'patch-management': 'Patch Management', 'backup-dr': 'Backup & Disaster Recovery',
          'endpoint-protection': 'Endpoint Protection (EDR/XDR)', 'email-security': 'Email Security',
          'cloud-security': 'Cloud Security Posture (CSPM)', 'network-monitoring': 'Network Monitoring (NMS)',
          'dns-filtering': 'DNS Filtering', 'firewall-mgmt': 'Firewall Management',
          'vpn-gateway': 'Managed VPN Gateway', 'sd-wan': 'SD-WAN',
          'asset-discovery': 'Asset Discovery', 'advanced-ticketing': 'Advanced Ticketing',
        };

        if (parts[1] === 'graph') {
          const g = buildDemoServiceGraph(scoped, targetOrgId);
          return delay(g as any) as unknown as T;
        }
        const svcId = decodeURIComponent(parts[2] ?? '');
        const ch = buildDemoServiceChain(svcId, present);
        return delay(ch as any) as unknown as T;
      }
      if (s.role !== 'platform_admin') {
        const myOrg = callerOrgIdSafe();
        list = list.filter(e => myOrg === null ? true : e.org_id === myOrg);
      } else if (parts[1] && /^\d+$/.test(parts[1])) {
        list = list.filter(e => String(e.org_id) === parts[1]);
      } else if (query.get('org_id')) {
        list = list.filter(e => String(e.org_id) === query.get('org_id'));
      }
      return delay(list as any) as unknown as T;
    }

    // ---- Security Analytics (mirrors GET /api/analytics/overview) ----------

    if (root === 'analytics' && parts[1] === 'overview' && method === 'GET') {
      return delay(demoAnalyticsOverview(query) as any) as unknown as T;
    }

    // ---- Threat Intelligence (mirrors backend/app/routers/threat_intel.py) --
    // Same response shapes as the FastAPI endpoints, computed from the demo's
    // OWN incident/alert stores. Nothing is fabricated: matches only include
    // IoCs actually attached to demo incidents; the feed panel honestly
    // reports "no MISP instance configured" (there is no Integration store in
    // Demo Mode); lookup results are labelled simulated fixtures.
    if (root === 'threat-intel') {
      const scopeT = callerOrgIdSafe();
      if (method === 'GET' && parts[1] === 'matches') {
        const out: any[] = [];
        for (const inc of incidents) {
          if (scopeT !== null && inc.org_id !== scopeT) continue;
          for (const ioc of (inc.ioc_related ?? [])) {
            if (!ioc) continue;
            const asset = (inc.affected_assets ?? [])[0] ?? null;
            const relAlerts = alerts
              .filter(a => (scopeT === null || a.org_id === inc.org_id) && a.resource === asset)
              .slice(0, 5).map(a => a.uid);
            out.push({
              indicator: String(ioc), incident_uid: inc.uid, severity: inc.severity,
              category: inc.category, status: inc.status,
              assets: (inc.affected_assets ?? []).slice(0, 10),
              related_alert_uids: relAlerts, observed_at: inc.created_at ?? null,
            });
          }
        }
        out.sort((x, z) => String(z.observed_at ?? '').localeCompare(String(x.observed_at ?? '')));
        return delay({ matches: out.slice(0, 200), count: out.length } as any) as unknown as T;
      }
      if (method === 'GET' && parts[1] === 'feeds' && parts[2] === 'status') {
        // No background sync job exists (in demo OR real mode): last_sync is
        // never claimed here. MISP has no Integration rows in the demo world.
        return delay({
          feeds: [
            { name: 'MISP', kind: 'instance', configured: false, statuses: [] },
            { name: 'AlienVault OTX', kind: 'public-on-demand', configured: true,
              note: 'Demo Mode: external lookups are NOT performed; enrichment uses local simulated fixtures.' },
          ],
          no_feed_data: false,
        } as any) as unknown as T;
      }
      if (method === 'GET' && (parts[1] === 'threats' || parts[1] === 'lookup')) {
        const qRaw = parts[1] === 'lookup' ? decodeURIComponent(parts[2] ?? '') : (query.get('q') ?? '');
        const q = qRaw.toLowerCase();
        // Enrichment pool: static fixtures + every IoC linked to this tenant's
        // incidents (so drill-down always resolves real evidence links).
        const pool: any[] = (mockThreats as any[]).map(t => ({ ...t, source: `${t.source ?? 'feed'} (simulated)` }));
        const seenIocs = new Set(pool.map(p => String(p.ioc).toLowerCase()));
        for (const inc of incidents) {
          if (scopeT !== null && inc.org_id !== scopeT) continue;
          for (const ioc of (inc.ioc_related ?? [])) {
            if (!ioc || seenIocs.has(String(ioc).toLowerCase())) continue;
            seenIocs.add(String(ioc).toLowerCase());
            pool.unshift({
              id: `INC-${inc.uid}`, type: 'indicator-link', severity: inc.severity,
              title: `IoC observed in ${inc.title}`, description: `Indicator recorded on incident ${inc.uid} (${inc.status}).`,
              source: 'internal', ioc: String(ioc), iocType: 'other', timestamp: inc.created_at,
              confidence: 100, mitreAttack: [], affectedAssets: (inc.affected_assets ?? []).length, status: inc.status,
            });
          }
        }
        let list = pool;
        if (q) list = pool.filter(t => String(t.ioc).toLowerCase().includes(q) || String(t.title).toLowerCase().includes(q));
        const limitN = Math.min(200, Math.max(1, Number(query.get('limit')) || 50));
        list = list.slice(0, limitN);
        if (parts[1] === 'lookup') return delay({ ioc: qRaw, count: list.length, threats: list } as any) as unknown as T;
        return delay({ query: qRaw || null, count: list.length, sources: ['Simulated fixtures'], threats: list } as any) as unknown as T;
      }
    }


    // ---- Dashboard widget layout (Demo Mode mirror of /api/dashboard/layout) ----
    // Persisted in localStorage under the same keys the widget system uses, so
    // Demo Mode customizations survive reloads without a backend.
    if (root === 'dashboard' && parts[1] === 'layout' && parts[2]) {
      const pageKey = decodeURIComponent(parts[2]);
      // Same key shape as widgetStorageKey() in DashboardWidget.tsx (session id/email scope).
      const lsKey = `ic-widget-layout:${pageKey}:${demoSession().email ?? demoSession().orgId ?? 'anon'}`;
      const readLs = (): any[] => {
        try {
          const raw = localStorage.getItem(lsKey);
          const parsed = raw ? JSON.parse(raw) : null;
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      };
      if (method === 'GET') {
        const layout = readLs();
        if (!layout.length) throw httpErr(404, 'No saved layout for this page yet');
        return delay({ page_key: pageKey, layout, updated_at: iso(0) } as any) as unknown as T;
      }
      if (method === 'PUT') {
        const layout = Array.isArray(b?.layout) ? b.layout : [];
        try { localStorage.setItem(lsKey, JSON.stringify(layout)); } catch { /* ignore */ }
        return delay({ page_key: pageKey, layout, updated_at: iso(0) } as any) as unknown as T;
      }
      if (method === 'DELETE') {
        try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
        return undefined as unknown as T;
      }
    }

    throw httpErr(404, `Demo mode: no simulated handler for ${method} /api${path}`);
  },
};
