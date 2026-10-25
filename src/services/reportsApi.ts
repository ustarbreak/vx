// Advanced Reporting portal — client API layer (Phase 1 skeleton).
// Block contract types follow brief §5; data comes from /api/v1/reports/*.
// Demo Mode ON  -> local deterministic generator (no network, works on Kali &
//                  Windows without backend — same seed rule as the server:
//                  sha256(tenant|period|salt)).
// Demo Mode OFF -> real backend endpoints (adapters arrive Phase 2/3; until
//                  then the server honestly returns "Donnée indisponible").
import { isDemoMode } from './demoMode';
import { api, getToken } from './api';
import { PROTO_CHAPTERS, PROTO_OVERVIEW, ProtoGroup } from '../data/reportPrototype';
import { demoTenants } from '../data/demoWorld';

/** Human-readable tenant name for report meta headers. */
function demoTenantName(tenant: string): string {
  const t = demoTenants.find((x) => String(x.id) === String(tenant));
  return t ? t.name : `Tenant ${tenant}`;
}

export type Color = 'o' | 'b' | 'w' | 'h' | '1' | '2' | '3';
export type Block =
  | ['K', Array<[string, string, string, Color]>]
  | ['R', Array<[string, number, Color, string?]>]
  | ['B', string, Array<[string, number, Color, string?]>]
  | ['T', string, string[], Array<Array<string | number>>]
  | ['M', string, Array<[string, Color]>]
  | ['L', string, string[]]
  | ['F', string, Array<[string, number]>]
  | ['G', string, number, Color]
  | ['S', string, number[]]
  | ['D', string, Array<[string, number, Color]>]
  | ['H', string, Array<[string, number]>]
  | ['C', string, Array<[string, string[], Color]>]
  | ['P', string, string[]];

export type Page = [string, string, Block[]];
export interface ReportBody {
  number: number; id: string; title: string; family: string;
  period: string; pages: Page[];
}
export interface Catalogue {
  demo: boolean; total_pages: number;
  families: Array<{ id: string; name: string; reports: Array<{ number: number; id: string; title: string; pages: number }> }>;
  family_names: Record<string, string>;
}
export interface Meta {
  client: string; period: string; version: string; classification: string;
  author: string; last_updated: string; demo: boolean;
}

const FAMILIES: Array<[string, string]> = [
  ['dir', 'Direction & Value'], ['thr', 'Threats & Detection'], ['inc', 'Incidents & Response'],
  ['vul', 'Vulnerabilities & Posture'], ['inf', 'Infrastructure & Resilience'], ['com', 'Compliance & Audit'],
];
const REPORTS: Array<[number, string, string, string, number]> = [
  [1, 'executive', 'Executive Security Dashboard', 'dir', 5],
  [9, 'roi', 'Security ROI Calculator', 'dir', 3],
  [19, 'value', 'Client Value Report', 'dir', 3],
  [2, 'threatintel', 'Threat Intelligence Briefing', 'thr', 3],
  [11, 'hunting', 'Threat Hunting Summary', 'thr', 3],
  [17, 'uba', 'User Behavior Analytics', 'thr', 3],
  [14, 'email', 'Email Security Report', 'thr', 3],
  [3, 'incident', 'Incident Response Report', 'inc', 3],
  [18, 'soar', 'SOAR Automation Report', 'inc', 3],
  [8, 'tickets', 'Ticket Operations Report', 'inc', 3],
  [6, 'vuln', 'Vulnerability Management Report', 'vul', 3],
  [12, 'patch', 'Patch Management Report', 'vul', 3],
  [15, 'cloud', 'Cloud Security Posture', 'vul', 3],
  [5, 'infra', 'Infrastructure Health Report', 'inf', 3],
  [7, 'network', 'Network Performance Analytics', 'inf', 3],
  [13, 'backup', 'Backup & DR Status', 'inf', 3],
  [16, 'endpoint', 'Endpoint Protection Report', 'inf', 3],
  [4, 'compliance', 'Compliance Status Report (NIST/SOC2/ISO)', 'com', 3],
  [20, 'regulatory', 'Regulatory Compliance Report', 'com', 3],
  [10, 'audit', 'Audit Trail Report', 'com', 3],
];

// --- deterministic local generator (mirrors backend/app/services/reporting/demo_data.py) ---
async function seeded(tenant: string, period: string, salt: string): Promise<() => number> {
  const data = new TextEncoder().encode(`${tenant}|${period}|${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const view = new DataView(digest);
  let state = view.getUint32(0) ^ view.getUint32(4);
  return () => { // xorshift32 — stable across reloads and platforms
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function kpi(rnd: () => number, defs: Array<[string, string, boolean]>): Block {
  const rows = defs.map(([label, fmt, good]) => {
    const base = 40 + rnd() * 56;
    const delta = -9 + rnd() * 18;
    const up = delta >= 0;
    const color: Color = (up === good) ? 'o' : 'b';
    const val = fmt.replace('{value}', base.toFixed(fmt.includes('.0f') || fmt.includes('.0f}%') ? 0 : 1));
    return [label, val, `${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}%`, color] as [string, string, string, Color];
  });
  return ['K', rows];
}

function msg(text: string, color: Color): Block { return ['M', 'Note', [[text, color]]]; }

// Per-report page templates using the seeded rnd (same shape as the Python builders).
type Builder = (rnd: () => number) => Page[];
const BUILDERS: Record<string, Builder> = {
  executive: (r) => [
    ['Executive Summary', 'One-page synthesis of security posture.', [
      kpi(r, [['Security Posture Score', '{value}/100', true], ['Critical Incidents', '{value}', false], ['MTTR (hours)', '{value}', false], ['Coverage', '{value}%', true]]),
      ['G', 'Global risk score', Math.round(55 + r() * 30), 'o'],
      ['M', 'Top actions this period', [['Complete agent rollout on remaining endpoints before end of month.', 'w'], ['Review firewall rules exposed to the internet.', 'b'], ['Validate backup restore test schedule.', 'h']]],
    ]],
    ['Detection & Response', 'Funnel from raw events to confirmed incidents.', [
      ['F', 'SOC funnel', [['Events collected', 100], ['Correlated', 38], ['Alerts raised', 12], ['Investigated', 9], ['Confirmed incidents', 3]]],
      ['T', 'Top incident categories', ['Category', 'Count', 'Avg MTTR', 'Trend'], [['Phishing', '7', '3.2 h', '@crit:▲ rising'], ['Malware', '4', '5.1 h', '@high:= stable']]],
    ]],
    ['Posture & Coverage', 'Asset coverage and control status.', [
      ['R', [['Endpoint coverage', 88, 'o'], ['Network visibility', 74, 'w'], ['Cloud accounts monitored', 92, 'o']]],
      ['B', 'Control maturity', [['Detect', 82, 'o'], ['Respond', 67, 'w'], ['Recover', 54, 'b'], ['Govern', 71, '1']]],
    ]],
    ['Action Plan', 'Prioritised remediation roadmap.', [
      ['C', 'Roadmap', [['Now', ['Zero-trust pilot', 'Agent completion'], 'o'], ['Next', ['Detection tuning v2', 'DR drill'], '1'], ['Later', ['Automation marketplace'], '3']]],
      ['P', 'Sign-off', ['Prepared by', 'Infracentra SOC', 'Reviewed by', 'Client CISO']],
    ]],
    ['Download Center', 'All 20 reports grouped by family.', [
      ['T', 'Report catalogue', ['#', 'Report', 'Family', 'Pages'], REPORTS.map(([n, , t, f, p]) => [String(n), t, f, String(p)])],
    ]],
  ],
  incident: (r) => [
    ['Response Performance', 'MTTD / MTTR against targets.', [
      kpi(r, [['Incidents', '{value}', false], ['MTTD (min)', '{value}', false], ['MTTR (h)', '{value}', false], ['SLA met', '{value}%', true]]),
      ['S', 'MTTR trend (12 weeks)', Array.from({ length: 12 }, () => +(2 + r() * 7).toFixed(1))],
    ]],
    ['Incident Ledger', 'Confirmed incidents.', [
      ['T', 'Incidents', ['Ref', 'Title', 'Severity', 'Status'], [['INC-2201', 'Ransomware precursor detected', '@crit:Critical', '@crit:Contained'], ['INC-2198', 'Phishing campaign vs HR', '@high:High', '@low:Closed']]],
    ]],
    ['Lessons Learned', 'Post-incident review.', [msg('Auto-containment cut MTTR by ~35% vs last period.', 'o')]],
  ],
  tickets: (r) => [
    ['Operations', 'Volume and responsiveness.', [
      kpi(r, [['Opened', '{value}', false], ['Resolved', '{value}', true], ['Backlog', '{value}', false], ['CSAT', '{value}/5', true]]),
      ['S', 'Daily volume (30d)', Array.from({ length: 30 }, () => 2 + Math.floor(r() * 23))],
    ]],
    ['SLA', 'First response / resolution compliance.', [
      ['R', [['First response SLA', 94, 'o'], ['Resolution SLA', 87, 'w'], ['Escalations handled', 76, '1']]],
      ['T', 'Breaches', ['Ticket', 'Priority', 'Breach', 'Owner'], [['TKT-1042', '@crit:P1', 'Resolution +6h', 'NOC']]],
    ]],
    ['Quality', 'Tags, satisfaction, reopens.', [
      ['D', 'Categories', [['Access', 30, '1'], ['Hardware', 22, '2'], ['Security', 18, 'b'], ['Network', 30, '3']]],
      ['L', 'Watch items', ["Reopen rate above 8% for 'Access' category"]],
    ]],
  ],
};

// Generic fallback builder for every other report: overview KPIs + ledger + note.
const GENERIC: Record<string, [string, string, Array<[string, string, boolean]>]> = {
  roi: ['Investment Model', 'Costs vs avoided losses.', [['Annual spend', '${value}k', false], ['Avoided loss est.', '${value}k', true], ['Net ROI', '{value}%', true]]],
  value: ['Value Delivered', 'Outcomes visible to the business.', [['Incidents prevented', '{value}', true], ['Downtime avoided (h)', '{value}', true], ['Projects delivered', '{value}', true]]],
  threatintel: ['Threat Landscape', 'IoCs ingested and matched.', [['IoCs ingested', '{value}', true], ['Matches on assets', '{value}', false], ['Blocked at perimeter', '{value}%', true]]],
  hunting: ['Hunting Overview', 'Hypotheses worked this period.', [['Hypotheses opened', '{value}', true], ['Validated findings', '{value}', false], ['Hours invested', '{value}', true]]],
  uba: ['Behavior Baseline', 'Anomaly scoring overview.', [['Users profiled', '{value}', true], ['Anomalies flagged', '{value}', false], ['False positive rate', '{value}%', false]]],
  email: ['Mail Flow Security', 'Message disposition.', [['Messages processed', '{value}k', true], ['Malicious blocked', '{value}', false], ['Quarantined', '{value}', false]]],
  soar: ['Automation Overview', 'Playbook execution stats.', [['Runs', '{value}', true], ['Success rate', '{value}%', true], ['Hours saved', '{value}', true]]],
  vuln: ['Exposure', 'Vulnerability counts by severity.', [['Total open', '{value}', false], ['Critical', '{value}', false], ['Fixed this period', '{value}', true]]],
  patch: ['Patch Compliance', 'Rollout status.', [['Patch rate', '{value}%', true], ['Reboots pending', '{value}', false], ['Failed patches', '{value}', false]]],
  cloud: ['Posture', 'Misconfigurations by provider.', [['Accounts scanned', '{value}', true], ['Findings', '{value}', false], ['Public exposures', '{value}', false]]],
  infra: ['Health', 'Device availability.', [['Devices online', '{value}', true], ['Uptime', '{value}%', true], ['Degraded', '{value}', false]]],
  network: ['Performance', 'Latency / loss / jitter.', [['Avg latency (ms)', '{value}', false], ['Packet loss (%)', '{value}', false], ['Jitter (ms)', '{value}', false]]],
  backup: ['Protection', 'Job success rates.', [['Jobs succeeded', '{value}%', true], ['Datasets protected', '{value}', true], ['Last restore test', '{value}d ago', false]]],
  endpoint: ['Coverage', 'Agent health.', [['Managed endpoints', '{value}', true], ['Healthy agents', '{value}%', true], ['Stale agents', '{value}', false]]],
  compliance: ['Framework Status', 'Control conformity.', [['Applicable controls', '{value}', true], ['Conformant', '{value}%', true], ['Overdue', '{value}', false]]],
  regulatory: ['Obligations', 'GDPR / HIPAA / PCI-DSS mapping.', [['Mapped obligations', '{value}', true], ['On track', '{value}%', true], ['At risk', '{value}', false]]],
  audit: ['Activity', 'Platform audit trail summary.', [['Audited events', '{value}k', true], ['Admin actions', '{value}', false], ['Config changes', '{value}', false]]],
};

function genericPages(key: string, rnd: () => number): Page[] {
  const [t, intro, defs] = GENERIC[key];
  return [
    [t, intro, [kpi(rnd, defs)]],
    ['Detail', 'Breakdown for the period.', [
      ['B', 'Distribution', [['Segment A', 30 + Math.round(rnd() * 40), 'o'], ['Segment B', 20 + Math.round(rnd() * 40), 'w'], ['Segment C', 10 + Math.round(rnd() * 30), 'b']]],
      ['T', 'Items', ['Item', 'Value', 'State'], [['Sample metric', String(Math.round(rnd() * 100)), '@low:OK']]],
    ]],
    ['Notes', 'Recommendations.', [msg('Full narrative sections are generated from live tables once Phase 2 adapters are connected.', '1')]],
  ];
}

// --- prototype port (infracentra-unified-report.html, constant X) ---------
// The 10 HTML chapters are mapped onto the catalogue reports; each chapter
// group becomes one data-driven page and the hard-coded overview section of
// the prototype is normalized into the same block contract. Page counts
// match REPORTS exactly so navigation pills stay consistent.
function protoPages(key: string): Page[] | null {
  const P = (ck: string, i: number): Page => {
    const g = PROTO_CHAPTERS[ck].groups[i];
    return [g[0], g[1], g[2]];
  };
  const OV = (ck: string): Page => {
    const o = PROTO_OVERVIEW[ck];
    return [o[0], o[1], o[2]];
  };
  switch (key) {
    case 'executive': return [OV('summary'), P('summary', 0), P('summary', 1), P('summary', 2), ['Download Center', 'Les 20 rapports regroupés par famille — Ouvrir / PDF / CSV.', [['T', 'Report catalogue', ['#', 'Report', 'Family', 'Pages'], REPORTS.map(([n, , t, f, p]) => [String(n), t, f, String(p)])] as Block]]];
    case 'incident': return [OV('incidents'), P('incidents', 0), P('incidents', 1)];
    case 'compliance': return [P('compliance', 0), P('compliance', 1), OV('roadmap')];
    case 'infra': return [OV('coverage'), P('coverage', 0), P('coverage', 1)];
    case 'vuln': return [OV('vuln'), P('vuln', 0), P('vuln', 1)];
    case 'threatintel': return [P('threat', 0), OV('threat'), ['Plateforme & continuité', 'Capacité, sécurité interne et reprise.', [...PROTO_OVERVIEW['platform'][2], ...PROTO_CHAPTERS['platform'].groups[1][2]]]];
    case 'hunting': return [P('threat', 1), OV('soc'), P('soc', 0)];
    case 'soar': return [OV('soar'), P('soar', 0), P('soar', 1)];
    default: return null;
  }
}

function ts(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

async function localReport(id: string, tenant: string, period: string): Promise<ReportBody> {
  const meta = REPORTS.find((x) => x[1] === id)!;
  const rnd = await seeded(tenant, period, id);
  const proto = protoPages(id);
  const pages = proto ?? (BUILDERS[id] ?? ((r: () => number) => genericPages(id, r)))(rnd);
  return { number: meta[0], id, title: meta[2], family: meta[3], period, pages: pages.map(([t, intro, blocks]) => [t, `${intro} · last updated ${ts()}`, blocks] as Page) };
}

export const reportsApi = {
  async catalogue(tenant: string, period: string): Promise<Catalogue> {
    // Demo Mode OFF => no demo param at all: server answers from REAL data
    // (or "Donnee indisponible"), never env-driven demo content.
    if (!isDemoMode()) return api.get<Catalogue>(`/v1/reports?period=${period}`);
    const families = FAMILIES.map(([fid, fname]) => ({
      id: fid, name: fname,
      reports: REPORTS.filter((x) => x[3] === fid).map(([n, key, title, , p]) => ({ number: n, id: key, title, pages: p })),
    }));
    const names: Record<string, string> = {};
    FAMILIES.forEach(([i, n]) => { names[i] = n; });
    return { demo: true, total_pages: 62, families, family_names: names };
  },

  async report(id: string, tenant: string, period: string): Promise<ReportBody> {
    if (!isDemoMode()) return api.get<ReportBody>(`/v1/reports/${id}?period=${period}`);
    return localReport(id, tenant, period);
  },

  async meta(period: string, tenant = '1'): Promise<Meta> {
    if (!isDemoMode()) return api.get<Meta>(`/v1/meta?period=${period}`);
    return {
      client: demoTenantName(tenant), period, version: '2026.10-p1',
      classification: 'CONFIDENTIAL — Infracentra client report',
      author: 'Infracentra Reporting Engine', last_updated: ts(), demo: true,
    };
  },

  // Server-side CSV download (real mode). Demo mode: build the same rows locally.
  async downloadCsv(id: string, tenant: string, period: string, pageNo?: number): Promise<void> {
    if (!isDemoMode()) {
      const token = getToken();
      const res = await fetch(`/api/v1/reports/${id}/export?format=csv&period=${period}${pageNo ? `&page=${pageNo}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? 'Export failed');
      const blob = await res.blob();
      saveBlob(blob, filenameFor(id, period, pageNo));
      return;
    }
    const body = await localReport(id, tenant, period);
    const pages = pageNo ? [body.pages[pageNo - 1]] : body.pages;
    const rows: string[][] = [['section', 'block_type', 'col1', 'col2', 'col3', 'col4']];
    for (const [title, , blocks] of pages) {
      for (const b of blocks as any[]) {
        switch (b[0]) {
          case 'K': b[1].forEach((x: any) => rows.push([title, 'KPI', x[0], x[1], x[2], x[3]])); break;
          case 'T': rows.push([b[1], 'table_header', ...b[2]]); b[3].forEach((r: any) => rows.push([b[1], 'row', ...r.map(String)])); break;
          case 'R': b[1].forEach((x: any) => rows.push([title, 'R', x[0], String(x[1]), x[2]])); break;
          case 'B': case 'D': b[2].forEach((x: any) => rows.push([b[1], b[0], x[0], String(x[1]), x[2]])); break;
          case 'M': b[2].forEach((x: any) => rows.push([b[1], 'message', x[0], x[1]])); break;
          case 'L': b[2].forEach((x: any) => rows.push([b[1], 'list', x])); break;
          case 'F': b[2].forEach((x: any) => rows.push([b[1], 'funnel', x[0], String(x[1])])); break;
          case 'G': rows.push([b[1], 'gauge', String(b[2]), b[3]]); break;
          case 'S': rows.push([b[1], 'sparkline', b[2].join(',')]); break;
          case 'C': b[2].forEach((c: any) => rows.push([b[1], 'roadmap', c[0], c[1].join('; '), c[2]])); break;
          case 'P': rows.push([b[1], 'signoff', b[2].join(' | ')]); break;
        }
      }
    }
    const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filenameFor(id, period, pageNo));
  },
};

function filenameFor(id: string, period: string, pageNo?: number) {
  const num = REPORTS.find((x) => x[1] === id)?.[0] ?? 0;
  return `report${String(num).padStart(2, '0')}${pageNo ? `_p${pageNo}` : ''}_${period}.csv`;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// QA helper (not used by the UI): fetch the SERVER-side deterministic demo
// dataset (?demo=1) so it can be diffed against localReport(). Lets us verify
// front/back generators stay in sync without touching real data.
export async function serverDemoReport(id: string, tenant: string, period: string): Promise<ReportBody> {
  return api.get<ReportBody>(`/v1/reports/${id}?period=${period}&demo=1`);
}

export const FAMILY_ORDER = FAMILIES;
export const REPORT_CATALOG = REPORTS;
