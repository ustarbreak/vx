// Real backend API client. All ticketing / notification / discovery / settings
// pages talk to the FastAPI backend through this module — no mock data —
// EXCEPT when Demo Mode is ON (see demoMode.ts), in which case every call is
// served from an in-memory dataset so evaluators can browse realistic data
// without a running backend.
import { isDemoMode, demoStore } from './demoMode';

const TOKEN_KEY = 'ic_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Friendly, cross-platform message when the real backend is not reachable
// (e.g. nothing listening on :8000, or you launched Vite's *preview* server
// which has no /api proxy). Windows note: we always target 127.0.0.1 — using
// "localhost" can resolve to ::1 and fail when uvicorn binds IPv4 only.
export const BACKEND_DOWN_MSG =
  'Backend unreachable — nothing is listening on http://127.0.0.1:8000. ' +
  'Start it with `docker compose -f docker-compose.prebuilt.yml up -d` (or `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` in backend/), ' +
  'serve the app with `npm run dev` (NOT `vite preview`, which cannot proxy /api), ' +
  'or switch Demo Mode ON at login to explore with simulated data.';

async function realRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    // fetch() itself failed (ECONNREFUSED / network) — surface a clear hint.
    throw new ApiError(0, BACKEND_DOWN_MSG);
  }
  if (res.status === 204) return undefined as unknown as T;
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail =
      (body && (body.detail?.msg ?? body.detail)) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body as T;
}

// `request` is hoisted, so `api` may safely reference it before its definition.
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Download a binary endpoint as a real file (CSV proof-pack, attachments…).
 *  Works in both modes: Demo Mode answers through the simulated backend,
 *  real mode hits /api directly with the JWT header. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  if (isDemoMode()) {
    // The demo interceptor returns JSON payloads; callers build the blob from them.
    throw new ApiError(0, 'DEMO_LOCAL');
  }
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Trigger a browser download from an in-memory string (used by the Value
 *  Engine proof pack in Demo Mode, where no server generates the file). */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['\ufeff' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// Request router — THE single demo/real separation point.
// Demo Mode ON  → served entirely from the in-memory dataset (demoStore):
//                 no network call is made, so a missing backend can never
//                 break the demo experience (Kali or Windows).
// Demo Mode OFF → real FastAPI backend through the Vite dev proxy.
// ---------------------------------------------------------------------------
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isDemoMode()) {
    // Demo errors carry `demoStatus`; rethrow as ApiError so pages can react
    // to 403/409/422 exactly like they would against the real backend.
    try {
      return await demoStore.handle<T>(options.method ?? 'GET', path, options.body);
    } catch (e: any) {
      if (e && typeof e.demoStatus === 'number') throw new ApiError(e.demoStatus, e.message);
      throw e;
    }
  }
  return realRequest<T>(path, options);
}

// ---------------------------------------------------------------------------
// Organizations (tenants) — real backend CRUD, platform_admin only
// ---------------------------------------------------------------------------
export interface BackendOrganization {
  id: number;
  name: string;
  tier: string;
  status: string;
  contact_email: string;
  contact_phone?: string | null;
  industry?: string | null;
  country?: string | null;
  member_count: number;
  asset_count: number;
  risk_score: number;
  compliance_score: number;
  monthly_revenue: number;
  created_at: string;
  // Bundle All-in-One billing (optional — present once the pricing migration ran)
  plan_tier?: 'STARTER' | 'PRO' | 'SOUVERAIN';
  endpoint_count?: number;
  seat_limit?: number;
  siem_limit_gb?: number;
  billing_cycle?: 'MONTHLY' | 'ANNUAL';
  currency?: 'MAD' | 'EUR' | 'USD';
  monthly_invoice_display?: string;
  // Multi-site hierarchy (Phase 4) — mirror of organizations.org_type / parent_org_id
  org_type?: 'HQ' | 'SUBSIDIARY' | 'AGENCY';
  parent_org_id?: number | null;
}

export interface OrganizationCreatePayload {
  name: string;
  tier: string;
  contact_email: string;
  contact_phone?: string;
  industry?: string;
  country?: string;
  // Phase 4 — structure de l'organisation + plan Bundle au moment du provisionnement
  org_type?: 'HQ' | 'SUBSIDIARY' | 'AGENCY';
  parent_org_id?: number | null;
  plan_tier?: 'STARTER' | 'PRO' | 'SOUVERAIN';
}

// ---------------------------------------------------------------------------
// Tenant Manager avancé (Phase 4) — miroir exact de backend/app/routers/tenant_manager.py
// Demo Mode: answered by demoMode.ts stores seeded from demoRulesSeed.
// ---------------------------------------------------------------------------
export interface TenantSummary {
  id: number; name: string; org_type: 'HQ' | 'SUBSIDIARY' | 'AGENCY'; location: string;
  plan_tier: 'STARTER' | 'PRO' | 'SOUVERAIN'; billing_cycle: 'MONTHLY' | 'ANNUAL';
  endpoints: number; members: number; services_active: number; open_incidents: number;
  probes: { id: string; hostname: string; ip: string; status: string }[];
  children: { id: number; name: string; org_type: string }[];
}
export interface MonitoringRuleOut {
  id: string; name: string; scope: 'asset' | 'client' | 'platform'; target_asset_id: string | null;
  trigger_metric: string; operator: string; threshold: string; duration_min: number;
  action: 'create_ticket' | 'notify' | 'suppress_alert' | 'none'; ticket_priority: string;
  notify_channels: string[]; enabled: boolean; created_by: string; created_at: string;
}
export interface ServiceGrantOut { enabled: boolean; override_plan: boolean; granted_by: string; updated_at: string }

export const tenantManagerApi = {
  summary: (orgId: number | string) => api.get<TenantSummary>(`/admin/tenants/${orgId}/summary`),
  createTicketForClient: (orgId: number | string, data: { title: string; priority: string; description?: string; assignee?: string }) =>
    api.post<any>(`/admin/tenants/${orgId}/tickets`, data),
  listRules: (orgId: number | string) => api.get<MonitoringRuleOut[]>(`/admin/tenants/${orgId}/rules`),
  createRule: (orgId: number | string, data: Partial<MonitoringRuleOut> & { name: string; trigger_metric: string; operator: string; threshold: string; action: string }) =>
    api.post<MonitoringRuleOut>(`/admin/tenants/${orgId}/rules`, data),
  patchRule: (orgId: number | string, ruleId: string, data: Partial<MonitoringRuleOut>) =>
    api.patch<MonitoringRuleOut>(`/admin/tenants/${orgId}/rules/${ruleId}`, data),
  deleteRule: (orgId: number | string, ruleId: string) => api.del<void>(`/admin/tenants/${orgId}/rules/${ruleId}`),
  setGrant: (orgId: number | string, data: { service_id: string; enabled: boolean; override_plan?: boolean }) =>
    api.post<ServiceGrantOut>(`/admin/tenants/${orgId}/grants`, data),
  grants: (orgId: number | string) => api.get<Record<string, ServiceGrantOut>>(`/admin/tenants/${orgId}/grants`),
  platformAudit: () => api.get<{ id: number; action: string; detail: string; actor: string; created_at: string }[]>('/admin/audit-platform'),
};

// ---------------------------------------------------------------------------
// Audit Log (mirrors backend/app/routers/audit.py — GET /api/audit/logs[/*])
// Response shape = AuditLogResponse (app/schemas.py): actor_id, actor_name,
// actor_role, org_id, action, resource, resource_id, details, ip_address,
// outcome, timestamp, id. Demo Mode answers the same paths from demoStore.
// ---------------------------------------------------------------------------
export interface BackendAuditLog {
  id: number;
  actor_id: number | null;
  actor_name: string;
  actor_role: string;
  org_id: number | null;
  action: string;
  resource: string;
  resource_id: string;
  details: string | null;
  ip_address: string | null;
  outcome: string;            // success | failure | blocked
  timestamp: string;
}

export const auditApi = {
  /** Platform-wide trail — platform_admin only (backend returns 403 otherwise). */
  logs: (params?: { skip?: number; limit?: number; org_id?: number; actor_role?: string; outcome?: string }) => {
    const qs = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && String(v) !== '') qs.set(k, String(v)); });
    const s = qs.toString();
    return api.get<BackendAuditLog[]>(`/audit/logs${s ? `?${s}` : ''}`);
  },
  /** Tenant-scoped trail for non-platform roles (GET /api/audit/logs/my-org). */
  myOrgLogs: (params?: { skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && String(v) !== '') qs.set(k, String(v)); });
    const s = qs.toString();
    return api.get<BackendAuditLog[]>(`/audit/logs/my-org${s ? `?${s}` : ''}`);
  },
};

// ---------------------------------------------------------------------------
// Entitlements (mirrors backend/app/routers/entitlements.py)
// GET /api/entitlements/ → List[EntitlementResponse]; auth is server-side:
// platform_admin sees all (optional ?org_id=), client roles see their own org.
// ---------------------------------------------------------------------------
export interface BackendEntitlement {
  id: number;
  org_id: number;
  service_id: string;
  enabled: boolean;
  seat_count: number;
  activated_at: string | null;
  deactivated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export const entitlementsApi = {
  list: (orgId?: number) =>
    api.get<BackendEntitlement[]>(`/entitlements/${orgId ? `?org_id=${orgId}` : ''}`),
  check: (serviceId: string) =>
    api.get<{ entitled: boolean; service_id: string }>(`/entitlements/check/${serviceId}`),
  /** Backend-computed dependency graph (nodes = persisted entitlement rows). */
  graph: (orgId?: number) =>
    api.get<ServiceGraph>(`/entitlements/graph${orgId ? `?org_id=${orgId}` : ''}`),
  /** Full link-chain for one service: transitive upstream + downstream impact. */
  chain: (serviceId: string) =>
    api.get<ServiceChain>(`/entitlements/chain/${encodeURIComponent(serviceId)}`),
};

export interface ServiceGraphNode {
  id: string; label: string; category: string; status: 'enabled' | 'disabled';
  seat_count: number; in_plan: boolean; override: boolean;
  grant_enabled: boolean | null; activated_at: string | null;
}
export interface ServiceGraphEdge {
  from: string; to: string; kind: string; provisioned: boolean;
  upstream_status?: string; upstream_label?: string; rationale: string;
}
export interface ServiceGraph {
  org: { id: number; name: string; plan: string; trial: boolean };
  nodes: ServiceGraphNode[];
  edges: ServiceGraphEdge[];
  missing_dependencies: ServiceGraphEdge[];
  downstream_index: Record<string, string[]>;
  counts: { services_total: number; services_enabled: number; edges_shown: number; missing_dependencies: number };
  disclaimer: string;
}
export interface ServiceChainNode {
  requires?: string; impacts?: string; rationale: string;
  provisioned: boolean; depth?: number; sub_chain: any[];
}
export interface ServiceChain {
  service_id: string; entitled: boolean;
  direct_requires: { requires: string; rationale: string; provisioned: boolean }[];
  upstream_chain: ServiceChainNode[];
  downstream_impact: ServiceChainNode[];
  unprovisioned_requirements: string[];
}

// ---------------------------------------------------------------------------
// Users directory (mirrors backend/app/routers/users.py — GET /api/users/)
// Response shape = UserResponse. Server enforces tenant scoping: client
// roles always receive their own organization's users only.
// ---------------------------------------------------------------------------
export interface BackendUserRow {
  id: number;
  email: string;
  name: string;
  role: string;               // platform_admin | client_admin | client_user
  org_id: number | null;
  status: string;             // active | disabled
  mfa_enabled: boolean;
  last_login: string | null;
  created_at: string;
}

export const usersDirectoryApi = {
  list: (params?: { org_id?: number; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && String(v) !== '') qs.set(k, String(v)); });
    const s = qs.toString();
    return api.get<BackendUserRow[]>(`/users/${s ? `?${s}` : ''}`);
  },
};

export const organizationsApi = {
  list: () => api.get<BackendOrganization[]>('/organizations/'),
  get: (id: number) => api.get<BackendOrganization>(`/organizations/${id}`),
  create: (data: OrganizationCreatePayload) =>
    api.post<BackendOrganization>('/organizations/', data),
  update: (id: number, data: Partial<OrganizationCreatePayload> & { status?: string }) =>
    api.patch<BackendOrganization>(`/organizations/${id}`, data),
};

// ---------------------------------------------------------------------------
// Partner Program — platform-admin management actions
// (mirrors backend routers/partners_admin.py; demo handled in demoMode.ts)
// ---------------------------------------------------------------------------
export const partnersAdminApi = {
  update: (id: string, data: Record<string, unknown>) => api.patch<any>(`/partners/${id}`, data),
  suspend: (id: string) => api.post<{ status: string }>(`/partners/${id}/suspend`),
  migrate: (id: string, plan: 'Starter' | 'Business' | 'Scale') => api.post<any>(`/partners/${id}/migrate`, { plan }),
  remove: (id: string) => api.del<void>(`/partners/${id}`),
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface BackendUser {
  id: number;
  email: string;
  name: string;
  role: string; // platform_admin | client_admin | client_user
  org_id: number | null;
  status: string;
}

export async function backendLogin(email: string, password: string): Promise<BackendUser> {
  const tok = await api.post<{ access_token: string; user?: BackendUser }>('/auth/login', { email, password });
  setToken(tok.access_token);
  // Newer backends return the user object with the token — use it directly.
  if (tok.user) return tok.user;
  try {
    return await api.get<BackendUser>('/auth/me');
  } catch {
    clearToken();
    throw new ApiError(401, 'Session token rejected by backend');
  }
}

// ---------------------------------------------------------------------------
// Advanced Ticketing
// ---------------------------------------------------------------------------
export interface AdvTicket {
  id: number;
  uid: string;
  org_id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category: string;
  source: string;
  assignee?: string | null;
  reporter?: string | null;
  tags: string[];
  asset?: string | null;
  vulnerability_ref?: string | null;
  ai_category?: string | null;
  ai_priority?: string | null;
  ai_confidence?: number | null;
  ai_reasoning: string[];
  ai_predicted_root_cause?: string | null;
  duplicate_of?: string | null;
  sla_state?: string | null;
  breach_prediction?: Record<string, any> | null;
  sla_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
  due_response_at?: string | null;
  due_resolve_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  escalation_level: number;
  alert_id?: number | null;
  created_at: string;
  updated_at?: string | null;
}

export interface TicketEvidence {
  id: number;
  ticket_uid: string;
  kind: string;
  name: string;
  size_kb: number;
  sha256: string;
  collected_by: string;
  immutable: boolean;
  created_at: string;
}

export interface AuditEntry {
  seq: number;
  created_at: string;
  actor: string;
  action: string;
  detail?: string;
  prev_hash: string;
  entry_hash: string;
}

export interface Approval {
  id: number;
  ticket_uid: string;
  step: number;
  approver_role: string;
  status: string;
  note?: string;
  decided_by?: string | null;
  decided_at?: string | null;
}

export interface TenantRef {
  id: number;
  name: string;
}

export const ticketsApi = {
  list: (params: { org_id?: number; status?: string; priority?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && qs.set(k, String(v)));
    const s = qs.toString();
    return api.get<AdvTicket[]>(`/tickets${s ? `?${s}` : ''}`);
  },
  create: (data: {
    title: string;
    description?: string;
    priority: string;
    category: string;
    org_id?: number;
    assignee?: string;
    tags?: string[];
    asset?: string;
    vulnerability_ref?: string;
  }) => api.post<AdvTicket>('/tickets', data),
  tenants: () => api.get<TenantRef[]>('/tickets/meta/tenants'),
  update: (uid: string, data: Record<string, any>) => api.patch<AdvTicket>(`/tickets/${uid}`, data),
  evidence: (uid: string) => api.get<TicketEvidence[]>(`/tickets/${uid}/evidence`),
  addEvidence: (uid: string, data: { name: string; kind: string; content: string; file_b64?: string; mime_type?: string }) =>
    api.post<TicketEvidence>(`/tickets/${uid}/evidence`, data),
  downloadEvidence: async (uid: string, evidenceId: number, name: string) => {
    try {
      await downloadFile(`/tickets/${uid}/evidence/${evidenceId}/file`, name);
    } catch (ex: any) {
      // Demo Mode has no binary server route: replay the download through the simulated backend.
      if (isDemoMode()) await api.get<any>(`/tickets/${uid}/evidence/${evidenceId}/file`);
      else throw ex;
    }
  },
  audit: (uid: string) => api.get<AuditEntry[]>(`/tickets/${uid}/audit`),
  approvals: (uid: string) => api.get<Approval[]>(`/tickets/${uid}/approvals`),
  closureRequest: (uid: string, note: string) =>
    api.post<Approval>(`/tickets/${uid}/closure-request`, { note }),
  decide: (uid: string, approvalId: number, approve: boolean, note = '') =>
    api.post<Approval>(`/tickets/${uid}/approvals/${approvalId}/decide`, { approve, note }),
  workload: () => api.get<any[]>('/tickets/ops/workload'),
  runEscalations: () => api.post<any>('/tickets/ops/run-escalations'),
};

// ---------------------------------------------------------------------------
// Notification & Event Intelligence
// ---------------------------------------------------------------------------
export interface AlertRow {
  id: number;
  uid: string;
  org_id: number;
  title: string;
  description?: string;
  severity: string;
  source: string;
  resource?: string | null;
  correlated_count: number;
  storm_suppressed: boolean;
  status: string;                 // active | acked | resolved (persisted lifecycle state)
  assignee?: string | null;
  acked_by?: string | null;
  acked_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  version: number;                // optimistic-concurrency token (409 on stale writes)
  ticket_uid?: string | null;
  incident_uid?: string | null;   // real IR link only — never fabricated
  created_at: string;
}

// ---- Phase 5 alert-management types (mirror backend/app/schemas.py) --------
export interface AlertSummary {
  total: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  unassigned_active: number;
}

export interface AlertPage {
  items: AlertRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AlertNoteRow {
  id: number;
  alert_id: number;
  author: string;
  body: string;
  created_at: string;
}

export interface AlertEventRow {
  id: number;
  alert_id: number;
  actor: string;
  action: string;
  detail: string;
  created_at: string;
}

export interface AlertDetail extends AlertRow {
  related_incidents: { uid: string; title: string; severity: string; status: string }[];
  related_tickets: { uid: string; title: string; status: string; priority: string }[];
  notes: AlertNoteRow[];
  events: AlertEventRow[];
}

export interface AlertUpdateIn {
  status?: 'active' | 'acked' | 'resolved';
  assignee?: string | null;
  clear_assignee?: boolean;
  expected_version?: number;
  note?: string;
}

export interface BulkAlertResult {
  results: { id: number; ok: boolean; changed?: boolean; reason?: string }[];
  applied: number;
}

export interface NotificationRetryResult {
  id: number;
  status: string;
  attempts: number;
  last_error?: string | null;
  sent_at?: string | null;
}

export interface AlertListParams {
  q?: string;
  severity?: string;      // csv
  status?: string;        // csv
  source?: string;        // csv
  assignee?: string;      // email or '__unassigned__'
  org_id?: number;
  since?: string;         // ISO
  until?: string;         // ISO
  sort?: 'created_at' | 'severity' | 'status' | 'title' | 'source';
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

function alertQs(p?: AlertListParams): string {
  if (!p) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export interface NotifRule {
  id?: number;
  name: string;
  org_id?: number | null;
  enabled: boolean;
  conditions: Record<string, any>;
  channels: string[];
  recipients: string[];
  create_ticket: boolean;
  ticket_priority: string;
  escalate_after_minutes: number;
  quiet_hours?: Record<string, any> | null;
  created_at?: string;
}

export interface NotificationRow {
  id: number;
  org_id: number;
  alert_id?: number | null;
  alert_uid?: string | null;      // resolved server-side for drill-down links
  rule_id?: number | null;
  channel: string;
  recipient: string;
  subject: string;
  body?: string;
  severity: string;
  status: string;
  attempts: number;
  last_error?: string | null;
  sent_at?: string | null;
  acked_by?: string | null;
  acked_at?: string | null;
  created_at: string;
}

export const alertsApi = {
  ingest: (data: {
    title: string;
    description?: string;
    severity: string;
    source: string;
    resource?: string;
    org_id?: number;
    raw_payload?: Record<string, any>;
  }) =>
    api.post<{ alert: AlertRow; pipeline: { notifications: any[]; ticket_created?: boolean; ticket_uid?: string | null } }>('/alerts', data),
  /** Server-side search/filter/sort/pagination over persisted alerts. */
  page: (p?: AlertListParams) => api.get<AlertPage>(`/alerts${alertQs(p)}`),
  /** Flat list helper for widgets/banners (first 100 rows, newest first). */
  list: async (org_id?: number): Promise<AlertRow[]> =>
    (await api.get<AlertPage>(`/alerts${alertQs({ org_id, page_size: 100 })}`)).items,
  /** Severity/status totals over the FULL filtered set (independent of page). */
  summary: (p?: AlertListParams) => api.get<AlertSummary>(`/alerts/summary${alertQs(p)}`),
  detail: (id: number) => api.get<AlertDetail>(`/alerts/${id}`),
  /** Validated transition / assignment / atomic note. 409 on stale expected_version. */
  update: (id: number, patch: AlertUpdateIn) => api.patch<AlertRow>(`/alerts/${id}`, patch),
  ack: (id: number) => api.post(`/alerts/${id}/ack`),
  bulk: (ids: number[], action: 'ack' | 'resolve' | 'reopen' | 'assign', assignee?: string) =>
    api.post<BulkAlertResult>('/alerts/bulk', { ids, action, assignee }),
  notes: (id: number) => api.get<AlertNoteRow[]>(`/alerts/${id}/notes`),
  addNote: (id: number, body: string) => api.post<AlertNoteRow>(`/alerts/${id}/notes`, { body }),
  events: (id: number) => api.get<AlertEventRow[]>(`/alerts/${id}/events`),
  rules: () => api.get<NotifRule[]>('/notification-rules'),
  createRule: (rule: Omit<NotifRule, 'id' | 'created_at'>) =>
    api.post<NotifRule>('/notification-rules', rule),
  updateRule: (id: number, patch: Partial<NotifRule>) =>
    api.patch<NotifRule>(`/notification-rules/${id}`, patch),
  deleteRule: (id: number) => api.del(`/notification-rules/${id}`),
  notifications: (p?: { status?: string; channel?: string; q?: string; alert_uid?: string; limit?: number; page?: number }) =>
    api.get<NotificationRow[]>(`/notifications${alertQs(p as any)}`),
  ackNotification: (id: number) => api.post(`/notifications/${id}/ack`),
  /** Single dead-letter retry — response carries the backend-confirmed outcome. */
  retryNotification: (id: number) => api.post<NotificationRetryResult>(`/notifications/${id}/retry`),
  retryDeadLetters: () => api.post<any>('/notifications/retry-dead-letters'),
  analytics: () => api.get<Record<string, any>>('/notifications/analytics'),
};

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------
export interface PlaybookStep {
  name: string;
  action: string;
  params: Record<string, any>;
}
export interface Playbook {
  id: number;
  name: string;
  description: string;
  category: string;
  steps: PlaybookStep[];
  enabled: boolean;
}
export interface PlaybookRunLog {
  ok: boolean;
  log: { step: number; name: string; action: string; status: string; detail: string }[];
}

export const playbooksApi = {
  list: () => api.get<Playbook[]>('/playbooks'),
  save: (pb: Omit<Playbook, 'id'> & { id?: number }) =>
    pb.id ? api.put<Playbook>(`/playbooks/${pb.id}`, pb) : api.post<Playbook>('/playbooks', pb),
  remove: (id: number) => api.del(`/playbooks/${id}`),
  run: (id: number) => api.post<PlaybookRunLog>(`/playbooks/${id}/run`),
};

// ---------------------------------------------------------------------------
// Discovery / SNMP
// ---------------------------------------------------------------------------
export interface SnmpCredential {
  id?: number;
  name: string;
  version: string;
  community?: string | null;
  username?: string | null;
  auth_protocol?: string | null;
  auth_passphrase?: string | null;
  priv_protocol?: string | null;
  priv_passphrase?: string | null;
  port: number;
  org_id?: number | null;
  created_at?: string;
}

export interface ScanRow {
  id: number;
  org_id: number;
  network_cidr: string;
  status: string;              // queued | running | completed | failed | cancelled
  credential_ids: number[];
  total_hosts: number;
  discovered: number;
  snmp_matched: number;
  started_at?: string | null;
  finished_at?: string | null;
  created_by: string;
  created_at: string;
}

export interface DiscoveredDevice {
  id: number;
  scan_id: number;
  org_id: number;
  ip: string;
  mac?: string | null;
  hostname?: string | null;
  os_guess?: string | null;
  device_type?: string | null;
  open_ports: number[];
  snmp_match: boolean;
  sys_desc?: string | null;
  imported: boolean;
  verified?: boolean | null;   // SNMP-verified identity (server-derived)
  source?: 'discovery' | 'manual'; // provenance — never inferred client-side
  last_seen?: string | null;   // real observation timestamp, null = unknown
  created_at: string;
}

// Optional live-monitoring enrichment for a discovered device. The backend
// attaches these ONLY when the host matches an actual probe / collector row —
// they are never inferred. Absent fields mean "not monitored", not "down".
export interface DeviceDetailInfo {
  monitored: boolean;
  monitor_source: 'probe' | 'collector' | null;
  status: string | null;            // online | offline | degraded | stale | unknown
  last_seen: string | null;         // real timestamp from the matching record
  os: string | null;
  hostname: string | null;
  ip: string;
  mac: string | null;
  device_type: string | null;
  snmp_match: boolean;
  open_ports: number[];
  location: string | null;          // site label when registered; null = unconfigured
  related_incidents: number | null; // open alerts referencing this resource/IP
}

export const discoveryApi = {
  credentials: () => api.get<SnmpCredential[]>('/snmp-credentials'),
  createCredential: (c: Omit<SnmpCredential, 'id' | 'created_at'>) =>
    api.post<SnmpCredential>('/snmp-credentials', c),
  deleteCredential: (id: number) => api.del(`/snmp-credentials/${id}`),
  scans: () => api.get<ScanRow[]>('/scans'),
  startScan: (network_cidr: string, credential_ids: number[], org_id?: number) =>
    api.post<ScanRow>('/scans', { network_cidr, credential_ids, org_id }),
  cancelScan: (id: number) => api.post<ScanRow>(`/scans/${id}/cancel`),
  scanStatus: (id: number) => api.get<ScanRow>(`/scans/${id}`),
  scanDevices: (id: number) => api.get<DiscoveredDevice[]>(`/scans/${id}/devices`),
  devices: () => api.get<DiscoveredDevice[]>('/devices'),
  deviceDetail: (id: number) => api.get<DeviceDetailInfo>(`/devices/${id}`),
  importDevice: (id: number) => api.post(`/devices/${id}/import`),
  engineStatus: () => api.get<{ nmap_available: boolean; mode: string }>('/engine-status'),
  /** Response actions on a monitored device. Mirrors backend POST
   *  /discovery/devices/{id}/actions/{action}. The call records & queues the
   *  command for the enrolled collector — `executed:false` in the response is
   *  honest: enforcement happens agent-side on its next policy poll. */
  deviceAction: (id: number, action: DeviceActionKind, reason?: string) =>
    api.post<DeviceActionResult>(`/discovery/devices/${id}/actions/${action}`, { reason }),
};

export type DeviceActionKind = 'kill' | 'isolate' | 'unisolate' | 'remote_screen';
export interface DeviceActionResult {
  ok: boolean;
  action: string;
  device_id: number;
  hostname: string | null;
  ip: string | null;
  delivery: 'queued_for_probe' | 'no_collector';
  executed: boolean;
  note: string;
}

// ---------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------
export interface SettingsOverview {
  tenants: { id: number; name: string; tier: string; status: string }[];
  rule_count: number;
  global_rule_count: number;
  user_count: number;
  delivery_mode: string;
}

export interface SystemSettings {
  auto_ticketing: boolean;
  sla_escalations: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  webhook_enabled: boolean;
  quiet_hours: boolean;
  escalation_email: string;
  webhook_url: string;
}

export interface DemoAccountRequest {
  email: string;
  password: string;
  org_name: string;
  service_ids: string[] | null; // null => all 16 services + Advanced Ticketing
  trial_days: number;           // default 30
}

export const settingsApi = {
  overview: () => api.get<SettingsOverview>('/settings/overview'),
  get: () => api.get<SystemSettings>('/settings/system'),
  update: (patch: Partial<SystemSettings>) =>
    api.put<SystemSettings>('/settings/system', patch),
  seedDemoTenant: (orgName = 'Damanecash') =>
    api.post<any>(`/settings/seed-demo-tenant?org_name=${encodeURIComponent(orgName)}`),
  // Real creation in the database of a demo/trial account for a real user,
  // with configurable service entitlements and a trial window (default 30d).
  createDemoAccount: (req: DemoAccountRequest) =>
    api.post<any>('/settings/seed-demo-tenant', req as any),
};

// ---------------------------------------------------------------------------
// Pack Customizer API — mirrors backend routers/pricing_v2.py
//   GET   /pricing/config          → live versioned config (packDetails when set)
//   GET   /pricing/packs           → effective pack composition + diff vs default
//   PUT   /pricing/packs/{id}      → platform admin edits one pack (steps wizard)
//   POST  /pricing/packs/reset     → restore the bundled DEFAULT_PACK_DETAILS
// Served locally in Demo Mode by demoMode.ts (same shapes).
// ---------------------------------------------------------------------------
import type { PricingConfigV2, PackCustomizerDef } from '../data/pricingConfig';

export interface PackEffectiveInfo {
  id: string;
  configured: boolean;          // false => still the shipped default
  services: string[]; free_picks: string[];
  added: string[]; removed: string[];   // diff vs DEFAULT_PACK_DETAILS
}

export const pricingPacksApi = {
  config: () => api.get<PricingConfigV2>('/pricing/config'),
  packs: () => api.get<{ version: string; packs: Record<string, PackCustomizerDef>; effective: Record<string, PackEffectiveInfo> }>('/pricing/packs'),
  savePack: (id: string, def: PackCustomizerDef) => api.put<any>(`/pricing/packs/${id}`, def),
  resetPacks: () => api.post<any>('/pricing/packs/reset'),
};

// ---------------------------------------------------------------------------
// Demo mode — pushes realistic sample ALERTS through the REAL ingest pipeline
// (/api/alerts). The backend then does everything for real: correlation,
// rule matching, notification dispatch and automatic ticket creation. No mock
// data is injected into the UI; this only simulates an upstream feed.
// ---------------------------------------------------------------------------
const SAMPLE_EVENTS = [
  { title: 'Brute-force SSH attempts from 45.132.87.10', severity: 'high', source: 'wazuh', resource: 'fw-edge-01', description: '23 failed authentications in 60s against sshd on DMZ gateway.' },
  { title: 'TLS certificate expires in 6 days', severity: 'medium', source: 'monitor', resource: 'web-prod-02', description: 'Certificate for portal.acme-corp.com reaches expiry on Friday.' },
  { title: 'Critical vulnerability CVE-2026-31337 detected', severity: 'critical', source: 'vuln-scanner', resource: 'db-primary-01', description: 'Unpatched OpenSSL remote-code-execution flaw found during authenticated scan.' },
  { title: 'CPU sustained above 92% for 15 minutes', severity: 'medium', source: 'monitor', resource: 'app-node-03', description: 'Load average 12.4 on 4 vCPU host; suspected runaway worker process.' },
  { title: 'Unauthorized privilege escalation attempt', severity: 'critical', source: 'suricata', resource: 'dc-core-sw-01', description: 'TGP-3 payload observed targeting management VLAN from user workstation.' },
  { title: 'Backup job failed with checksum mismatch', severity: 'low', source: 'backup-agent', resource: 'nas-backup-01', description: 'Nightly snapshot verification failed on volume /vault/archive.' },
];

export async function pushDemoEvents(orgId?: number): Promise<{ alerts: number; tickets: string[] }> {
  const createdTickets: string[] = [];
  let alerts = 0;
  for (const ev of SAMPLE_EVENTS) {
    try {
      const res = await alertsApi.ingest({ ...ev, org_id: orgId });
      alerts += 1;
      const uid = res.pipeline?.ticket_uid;
      if (uid) createdTickets.push(uid);
    } catch { /* tenant may not exist yet — keep going */ }
  }
  return { alerts, tickets: createdTickets };
}

// ---------------------------------------------------------------------------
// Project Manager — real backend /api/projects, Demo Mode served by demoStore.
// Two structures on purpose (see backend routers/projects.py):
//   kind 'internal' → OUR delivery projects with a client (platform side);
//   kind 'client'   → the client's own projects (his side, incl. his clients).
// ---------------------------------------------------------------------------
export interface ProjectMilestone { id: number; title: string; done: boolean; planned_at?: string | null }
export interface Project {
  id: number; org_id: number; name: string; description: string;
  kind: 'internal' | 'client'; status: string; priority: string;
  manager_email: string; ticket_category: string;
  time_spent_seconds: number; timer_running: boolean;
  sla_hours: number; sla_status: string; due_at?: string | null;
  created_by: string; created_at?: string;
  milestones?: ProjectMilestone[]; progress_pct?: number;
}
export interface ProjectDetail extends Project {
  milestones: ProjectMilestone[]; progress_pct: number;
  tickets: { total: number; open: number; items: { uid: string; title: string; status: string; priority: string }[] };
}
/** Project attachment — file (image / PDF / config / txt) or pasted text note. */
export interface ProjectAttachment {
  id: number; project_id: number; name: string; kind: string;
  content?: string | null; mime_type?: string | null; size_kb: number;
  sha256: string; uploaded_by: string; created_at?: string; has_file: boolean;
}
/** Read a browser File as base64 (without the data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
export const projectsApi = {
  list: (orgId?: number) => api.get<Project[]>(`/projects/${orgId ? `?org_id=${orgId}` : ''}`),
  get: (id: number) => api.get<ProjectDetail>(`/projects/${id}`),
  create: (data: Partial<Project> & { name: string; org_id?: number; milestones?: string[] }) =>
    api.post<Project>('/projects/', data),
  update: (id: number, data: Partial<Project>) => api.patch<Project>(`/projects/${id}`, data),
  remove: (id: number) => api.del<void>(`/projects/${id}`),
  /** Project configuration (SLA, risk threshold, budget, auto-close, notifications). */
  config: (id: number, patch?: Record<string, any>) =>
    patch ? api.put<any>(`/projects/${id}/config`, patch) : api.get<any>(`/projects/${id}/config`),
  timer: (id: number, action: 'start' | 'pause' | 'resume' | 'stop') =>
    api.post<Project>(`/projects/${id}/timer/${action}`),
  addMilestone: (id: number, title: string, plannedAt?: string | null) =>
    plannedAt !== undefined
      ? api.post<ProjectMilestone>(`/projects/${id}/milestones`, { title, planned_at: plannedAt })
      : api.post<ProjectMilestone>(`/projects/${id}/milestones?title=${encodeURIComponent(title)}`),
  toggleMilestone: (mid: number, done: boolean) =>
    api.patch<{ id: number; done: boolean }>('/projects/milestones/' + mid, { done }),
  /** Set (or clear with null) a milestone's planned date — Gantt §6G editor. */
  setMilestonePlanned: (mid: number, plannedAt: string | null) =>
    api.patch<{ id: number; title: string; done: boolean; planned_at: string | null }>(
      '/projects/milestones/' + mid, { planned_at: plannedAt }),
  attachments: (id: number) => api.get<ProjectAttachment[]>(`/projects/${id}/attachments`),
  addAttachment: (id: number, data: { name: string; kind: string; content?: string; file_b64?: string; mime_type?: string }) =>
    api.post<ProjectAttachment>(`/projects/${id}/attachments`, data),
  removeAttachment: (id: number, attId: number) =>
    api.del<void>(`/projects/${id}/attachments/${attId}`),
  /** Download a project attachment. Works in both modes (demo replays the
   *  simulated backend which returns {b64, mime} and builds the blob locally). */
  downloadAttachment: async (id: number, attId: number, name: string) => {
    if (isDemoMode()) {
      const r = await api.get<{ b64: string; mime: string }>(`/projects/${id}/attachments/${attId}/file`);
      const bin = atob(r.b64 ?? '');
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return;
    }
    await downloadFile(`/projects/${id}/attachments/${attId}/file`, name);
  },
};

// ---------------------------------------------------------------------------
// Value Engine — the 6 "show the money" mechanics (receipt, red line, risk
// cost, before/after, maturity, proof pack). Real backend: /api/value.
// Demo mode: computed from the SAME demo tickets/alerts → always synchronized.
// ---------------------------------------------------------------------------
export interface ValuePayload {
  period: string;
  receipt: {
    hash: string; hours_saved: number; labor_saved_usd: number;
    downtime_avoided_usd: number; total_usd: number; tickets_total: number;
    tickets_resolved: number; auto_closed: number; ai_triaged: number;
    alerts_total: number; alerts_suppressed: number;
  };
  red_line: { avg_mttr_min: number; baseline_mttr_min: number; improvement_pct: number; false_positive_pct: number };
  risk_cost: { exposure_usd: number; critical_open: number; high_open: number; sla_breaches: number;
               per_action: { close_p1: number; close_p2: number; fix_breach: number } };
  maturity: { score: number; benchmark_sector_avg: number;
              components: { alert_coverage: number; automation_rate: number; ai_triage_rate: number; sla_compliance: number } };
  generated_at: string;
}

export const valueApi = {
  get: (period?: string, orgId?: number) => {
    const qs = new URLSearchParams();
    if (period) qs.set('period', period);
    if (orgId) qs.set('org_id', String(orgId));
    return api.get<ValuePayload>(`/value?${qs.toString()}`);
  },
  receipt: (period?: string, orgId?: number) => {
    const qs = new URLSearchParams();
    if (period) qs.set('period', period);
    if (orgId) qs.set('org_id', String(orgId));
    return api.get<ValuePayload['receipt'] & { period: string; maturity: number }>(`/value/receipt?${qs.toString()}`);
  },
  /** Mechanic 6 — exportable "Proof Pack" CSV. Real mode downloads the server
   *  file; Demo Mode builds the identical CSV client-side from the payload so
   *  the numbers always match what the screen shows. */
  proofPackCsv: async (v: ValuePayload): Promise<void> => {
    const filename = `infracentra-proof-pack-${v.period}.csv`;
    try {
      await downloadFile(`/value/proof-pack?format=csv`, filename);
    } catch (e: any) {
      if (e?.message !== 'DEMO_LOCAL') throw e;
      const rows: string[][] = [
        ['Infracentra — Proof Pack', v.period], [],
        ['VALUE RECEIPT'],
        ['Hours saved', String(v.receipt.hours_saved)],
        ['Labor saved (USD)', String(v.receipt.labor_saved_usd)],
        ['Downtime avoided (USD)', String(v.receipt.downtime_avoided_usd)],
        ['TOTAL VALUE (USD)', String(v.receipt.total_usd)],
        ['Tickets resolved / total', `${v.receipt.tickets_resolved} / ${v.receipt.tickets_total}`],
        ['Auto-closed by playbooks', String(v.receipt.auto_closed)],
        ['AI-triaged tickets', String(v.receipt.ai_triaged)],
        ['Alerts suppressed', String(v.receipt.alerts_suppressed)],
        ['Receipt hash', v.receipt.hash], [],
        ['RED LINE (before → after)'],
        ['MTTR baseline (min)', String(v.red_line.baseline_mttr_min)],
        ['MTTR now (min)', String(v.red_line.avg_mttr_min)],
        ['Improvement (%)', String(v.red_line.improvement_pct)],
        ['False positives (%)', String(v.red_line.false_positive_pct)], [],
        ['RISK COST (open exposure)'],
        ['Exposure (USD)', String(v.risk_cost.exposure_usd)],
        ['Critical open', String(v.risk_cost.critical_open)],
        ['High open', String(v.risk_cost.high_open)],
        ['SLA breaches', String(v.risk_cost.sla_breaches)],
        ['Value per P1 closed (USD)', String(v.risk_cost.per_action.close_p1)], [],
        ['MATURITY'],
        ['Score', String(v.maturity.score)],
        ['Sector benchmark', String(v.maturity.benchmark_sector_avg)],
        ['Alert coverage', String(v.maturity.components.alert_coverage)],
        ['Automation rate', String(v.maturity.components.automation_rate)],
        ['AI triage rate', String(v.maturity.components.ai_triage_rate)],
        ['SLA compliance', String(v.maturity.components.sla_compliance)],
      ];
      downloadText(filename, rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'));
    }
  },
};

// ---------------------------------------------------------------------------
// goinfra agents — probe fleet, enrollment tokens, inventory & metrics.
// Mirrors backend/app/routers/agent.py:
//   /api/agents/*    → JWT-authenticated reads (this module)
//   /api/agent/*     → probe API (icag_ token, never called from the browser)
//   /api/agent-tokens → token CRUD
// Demo Mode is intentionally NOT wired here (no fake probes): in demo the
// page shows an empty-state pointing at Demo Mode OFF + a running backend.
// ---------------------------------------------------------------------------
export interface AgentProbeOut {
  id: number;
  org_id: number;
  hostname: string;
  agent_version: string;
  status: 'online' | 'offline' | string;
  os: string;      // 'linux' | 'windows'
  ip: string;      // primary NIC as seen by the backend
  last_seen: string | null;
}
export interface AgentTokenOut {
  id: number;
  org_id: number;
  name: string;
  prefix: string;          // first chars of the secret, for identification
  revoked: boolean;
  last_used_at: string | null;
  created_at: string;
  token?: string;          // present ONLY in the create response (shown once)
  note?: string;
}
export interface AgentInventoryOut {
  inventory_id: number;
  collected_at: string;
  payload: {
    hostname?: string;
    os?: string;
    platform?: string;
    kernel?: string;
    cpu?: { model?: string; cores?: number; percent?: number };
    memory?: { total_bytes?: number; used_bytes?: number; percent?: number };
    disks?: { mount?: string; device?: string; total_bytes?: number; used_bytes?: number; percent?: number }[];
    services?: { name?: string; status?: string; pid?: number }[];
    patches?: { id?: string; installed_on?: string }[];
    ips?: string[];
    collected_at?: string;
  };
}
export interface AgentMetricPoint {
  ts: number;              // unix seconds
  cpu_percent: number | null;
  mem_used_percent: number | null;
  disk_worst_percent: number | null;
  load1: number | null;
  net_recv_bps: number | null;
  net_sent_bps: number | null;
  temp_max_celsius: number | null;
}
export interface AgentDiscoveredDeviceOut {
  id: number;
  probe_id: number;
  ip: string;
  mac: string | null;
  hostname: string | null;
  os_guess: string;
  device_type: string;
  sys_name: string | null;
  snmp: boolean;
  open_ports: number[];
  last_seen: string | null;
}

export const agentApi = {
  listProbes: () => api.get<AgentProbeOut[]>('/agents/probes'),
  latestInventory: (probeId: number) =>
    api.get<AgentInventoryOut>(`/agents/probes/${probeId}/inventory/latest`),
  metrics: (probeId: number, hours = 24) =>
    api.get<AgentMetricPoint[]>(`/agents/probes/${probeId}/metrics?hours=${hours}`),
  discoveredDevices: () => api.get<AgentDiscoveredDeviceOut[]>('/agents/discovered-devices'),
  listTokens: () => api.get<AgentTokenOut[]>('/agent-tokens'),
  createToken: (name: string) => api.post<AgentTokenOut>('/agent-tokens', { name }),
  revokeToken: (id: number) => api.del<void>(`/agent-tokens/${id}`),
  /** Re-generate the install one-liners for an existing token. The secret is
   *  NOT recoverable (only its hash is stored) — this mints a fresh token
   *  carrying the same label, so admins can always produce working commands. */
  regenerateToken: (name: string) =>
    api.post<AgentTokenOut>('/agent-tokens', { name: name || 'default' }),
};

/** Build the exact copy-paste install commands for one enrollment token. */
export function agentInstallCommands(token: string, serverUrl?: string): { linux: string; windows: string } {
  const server = serverUrl ?? window.location.origin;
  return {
    linux:
      `curl -fsSL ${server}/downloads/goinfra/install.sh | sudo sh -s -- ` +
      `--server ${server} --token ${token}`,
    windows:
      `powershell -ExecutionPolicy Bypass -Command "` +
      `Invoke-WebRequest '${server}/downloads/goinfra/install.ps1' -OutFile $env:TEMP\\install.ps1; ` +
      `$env:GOINFRA_SERVER='${server}'; $env:GOINFRA_TOKEN='${token}'; ` +
      `& $env:TEMP\\install.ps1"`,
  };
}

// ---------------------------------------------------------------------------
// Worldwide Attack Map — mirrors backend/app/routers/security_map.py:
//   GET /api/security/attack-map (tenant-scoped, JWT-authenticated)
// Only events that actually carry geographic context in Alert.raw_payload are
// returned; production mode NEVER receives demo fixtures (the demo branch of
// demoStore.handle() is the sole place demoAlertSeeds geo data is served).
// Geolocation is approximate — classification separates observed telemetry
// from malicious-classified and confirmed attacks.
// ---------------------------------------------------------------------------
export interface MapPoint {
  lat: number | null;
  lon: number | null;
  country: string | null; // ISO-ish country code, approximate only
}
export type AttackClassification = 'observed' | 'malicious' | 'confirmed';
export interface AttackMapEvent {
  id: number;
  uid: string;
  timestamp: string;
  event_type: string;       // alert source (wazuh, suricata, siem, api…)
  title: string;
  severity: string;         // critical|high|medium|low|info
  classification: AttackClassification;
  src: MapPoint | null;
  dst: MapPoint | null;
  confidence: number | null; // min(src,dst) geolocation confidence, 0..1
  count: number;             // correlated/deduplicated events aggregated here
  resource: string | null;   // affected asset (tenant-scoped)
}
export interface AttackMapPayload {
  events: AttackMapEvent[];
  total_events: number;
  last_ingestion_at: string | null; // newest alert in window (geo or not)
  generated_at: string;
  note: string;
}
export interface AttackMapFilters {
  start_time?: string;  // ISO
  end_time?: string;    // ISO
  severity?: string;    // comma list ok
  event_type?: string;  // comma list of sources
  source_country?: string;
  destination_country?: string;
  site_id?: number;     // platform_admin only
}

export const attackMapApi = {
  get: (filters: AttackMapFilters = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    return api.get<AttackMapPayload>(`/security/attack-map${s ? `?${s}` : ''}`);
  },
};

// ---------------------------------------------------------------------------
// Organizational Infrastructure Topology — mirrors routers/org_topology.py
// (GET /api/org-topology). SEPARATE from the worldwide attack map: this is
// "what does my organization look like and is it healthy?", not attack data.
// Types match the backend Pydantic schema exactly (TopoNode/OrgTopologyPayload).
// ---------------------------------------------------------------------------
export type TopoHealth =
  | 'healthy' | 'degraded' | 'offline' | 'stale'
  | 'monitoring_unavailable' | 'unknown';

export interface TopoNode {
  id: string;                    // "org:<pk>" | "probe:<pk>" | "monitoring:<pk>"
  kind: 'organization' | 'hq' | 'site' | 'probe';
  name: string;
  parent: string | null;         // organizational ownership ONLY (never inferred)
  org_ref: number;               // owning organization id (authorization anchor)
  site_status?: string | null;
  org_type?: string | null;      // HQ | SUBSIDIARY | AGENCY
  country?: string | null;
  asset_count?: number | null;
  health?: TopoHealth | null;    // collector health — real status + timestamps only
  last_seen?: string | null;
  agent_version?: string | null;
  os?: string | null;
  ip?: string | null;            // internal address — tenant-authorized visibility
  related_incidents?: number | null; // open alerts for the owning org
}

export interface TopoEdge { source: string; target: string; type: 'organizational' }

export interface OrgTopologyPayload {
  nodes: TopoNode[];
  edges: TopoEdge[];
  root_org_id: number;
  hq_configured: boolean;
  network_topology_available: boolean; // false until device-link data exists
  note: string;
  generated_at: string;
}

export const orgTopologyApi = {
  get: (opts: { orgId?: number } = {}) =>
    api.get<OrgTopologyPayload>(`/org-topology${opts.orgId ? `?org_id=${opts.orgId}` : ''}`),
};

// ---------------------------------------------------------------------------
// Dashboard widget layout persistence — mirror of backend/app/routers/
// dashboard_layout.py. Per-user, per-page arrangement (order / width /
// collapse) for every customizable page (Overview & Live Proof, network…).
// Demo Mode: answered locally by demoMode.ts through localStorage.
// ---------------------------------------------------------------------------
export interface WidgetLayoutEntryDto {
  id: string;
  colSpan: number;
  collapsed: boolean;
  /** Free pixel height set by edge-resizing (optional — backend accepts it). */
  heightPx?: number | null;
  /** Headerless chrome for bare self-carded widgets (attack map, topology…). */
  hideHeader?: boolean;
}
export interface DashboardLayoutOut {
  page_key: string;
  layout: WidgetLayoutEntryDto[];
  /** Catalogue widget ids the user explicitly added (survives re-login). */
  added_catalog?: string[];
  /** Free-flow visual order of widget ids on the page. */
  order?: string[];
  updated_at?: string | null;
}

export const dashboardLayoutApi = {
  /** 404 when the user never customized this page → caller falls back to defaults. */
  get: (pageKey: string) => api.get<DashboardLayoutOut>(`/dashboard/layout/${pageKey}`),
  put: (pageKey: string, layout: WidgetLayoutEntryDto[], addedCatalog?: string[], order?: string[]) =>
    api.put<DashboardLayoutOut>(`/dashboard/layout/${pageKey}`, { layout, added_catalog: addedCatalog ?? [], order: order ?? [] }),
  del: (pageKey: string) => api.del<void>(`/dashboard/layout/${pageKey}`),
};
