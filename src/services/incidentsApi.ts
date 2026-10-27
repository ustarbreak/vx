// ---------------------------------------------------------------------------
// Incident Response API client — talks to the REAL FastAPI incident engine
// (backend/app/routers/incidents.py) through src/services/api.ts.
//
// Production mode (Demo Mode OFF): every call hits /api/incidents/* with the
// JWT session; no mock data is ever used or shown as "live".
// Demo Mode ON: api.ts routes calls into demoStore, which simulates the SAME
// endpoints and response shapes (see services/demoMode.ts, root === 'incidents').
// ---------------------------------------------------------------------------
import { api } from './api';

export const INCIDENT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const INCIDENT_STATUSES = ['open', 'investigating', 'contained', 'resolved', 'closed'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Allowed lifecycle edges — kept in sync with backend check_transition()
 *  (app/services/incidents.py). The UI only offers buttons for legal moves. */
export const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['investigating', 'contained'],
  investigating: ['contained', 'resolved'],
  contained: ['resolved', 'investigating'],
  resolved: ['closed', 'investigating'],
  closed: [],
};

export interface IncidentRow {
  uid: string;                      // stable identifier INC-000123 — never regenerated
  org_id: number | null;
  site_org_id: number | null;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reporter: string | null;
  assignee: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  ticket_uid: string | null;
  affected_assets: string[] | null;
  ioc_related: string[] | null;
  tags: string[] | null;
  category: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  alert_uid?: string | null;        // stable SIEM alert id (preserved relationship)
}

export interface IncidentAlertRef {
  uid: string; severity: string; source: string; resource: string;
  correlated_count: number | null; created_at: string | null;
}
export interface IncidentTicketRef {
  uid: string; status: string; priority: string;
  assignee: string | null; due_resolve_at: string | null;
}
export interface IncidentNote {
  id: number; author: string; content: string; internal: boolean; created_at: string | null;
}
export interface IncidentActivityEntry {
  id: number; actor: string; action: string; detail: string;
  from_value: string | null; to_value: string | null; created_at: string | null;
}
export interface IncidentEvidenceEntry {
  id: number; name: string; kind: string; sha256: string | null;
  ticket_uid: string | null; collected_by: string | null; created_at: string | null;
}
export interface IncidentActionEntry {
  id: number; action_type: string; status: string; detail: string;
  performed_by: string | null; playbook_run_uid: string | null; created_at: string | null;
}
export interface IncidentRunRef {
  uid: string; mode: string; status: string; triggered_by: string;
  started_at: string | null; finished_at: string | null;
}

export interface IncidentDetail extends IncidentRow {
  alert: IncidentAlertRef | null;
  ticket: IncidentTicketRef | null;
  organization: { id: number; name: string } | null;
  site: { id: number; name: string; org_type?: string | null } | null;
  notes: IncidentNote[];
  activity: IncidentActivityEntry[];
  evidence: IncidentEvidenceEntry[];
  actions: IncidentActionEntry[];
  playbook_runs: IncidentRunRef[];
}

export interface IncidentListParams {
  q?: string;
  status?: IncidentStatus | '';
  severity?: IncidentSeverity | '';
  assignee?: string;
  category?: string;
  org_id?: number;
  sort?: 'created_at' | 'updated_at' | 'severity' | 'status' | 'title';
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface IncidentListResult {
  items: IncidentRow[];
  total: number;
  page: number;
  page_size: number;
  status_counts: Record<string, number>;
}

export interface IncidentCreatePayload {
  title: string;
  description?: string;
  severity?: IncidentSeverity;
  category?: string;
  site_org_id?: number | null;
  affected_assets?: string[];
  tags?: string[];
  assignee?: string | null;
  alert_uid?: string | null;
  org_id?: number | null;   // platform admin only
}

function qs(p: IncidentListParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.status) sp.set('status', p.status);
  if (p.severity) sp.set('severity', p.severity);
  if (p.assignee) sp.set('assignee', p.assignee);
  if (p.category) sp.set('category', p.category);
  if (p.org_id != null) sp.set('org_id', String(p.org_id));
  sp.set('sort', p.sort ?? 'created_at');
  sp.set('order', p.order ?? 'desc');
  sp.set('page', String(p.page ?? 1));
  sp.set('page_size', String(p.page_size ?? 25));
  return sp.toString();
}

export const incidentsApi = {
  list: (params: IncidentListParams) =>
    api.get<IncidentListResult>(`/incidents?${qs(params)}`),

  get: (uid: string) => api.get<IncidentDetail>(`/incidents/${uid}`),

  /** Returns {reused, incident}: reused=true means an existing record was
   *  UPDATED instead of creating a duplicate (dedup guarantee). */
  create: (payload: IncidentCreatePayload) =>
    api.post<{ reused: boolean; incident: IncidentRow }>('/incidents', payload),

  update: (uid: string, payload: Partial<IncidentCreatePayload>) =>
    api.patch<IncidentRow>(`/incidents/${uid}`, payload),

  changeStatus: (uid: string, status: IncidentStatus, note = '') =>
    api.put<IncidentRow>(`/incidents/${uid}/status`, { status, note }),

  assign: (uid: string, assignee: string) =>
    api.put<IncidentRow>(`/incidents/${uid}/assign`, { assignee }),

  acknowledge: (uid: string) =>
    api.post<IncidentRow>(`/incidents/${uid}/acknowledge`, {}),

  addNote: (uid: string, content: string, internal = true) =>
    api.post<IncidentNote>(`/incidents/${uid}/notes`, { content, internal }),

  addEvidence: (uid: string, name: string, kind = 'log', detail = '') =>
    api.post<{ id: number }>(`/incidents/${uid}/evidence`, { name, kind, detail }),

  /** Ledger-only: records that a response action happened. It NEVER executes
   *  anything itself (execution belongs to the SOAR / ticketing engines). */
  recordAction: (uid: string, actionType: string, detail = '') =>
    api.post<{ id: number }>(`/incidents/${uid}/actions`, { action_type: actionType, detail }),

  linkTicket: (uid: string, ticketUid: string) =>
    api.post<IncidentRow>(`/incidents/${uid}/link-ticket`, { ticket_uid: ticketUid }),

  createTicket: (uid: string) =>
    api.post<{ reused: boolean; ticket_uid: string }>(`/incidents/${uid}/create-ticket`),

  activity: (uid: string, page = 1, pageSize = 50) =>
    api.get<{ items: IncidentActivityEntry[]; total: number; page: number; page_size: number }>(
      `/incidents/${uid}/activity?page=${page}&page_size=${pageSize}`),
};
