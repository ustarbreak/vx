// ---------------------------------------------------------------------------
// Partner Portal — Phase 2 (Daily operations) + Phase 3 (Onboarding &
// commercial) API client. Mirrors backend/app/routers/partners_ops.py and
// partners_commercial.py EXACTLY (same paths, same shapes). Demo Mode answers
// the same routes from partnerWorld/ops data (see demoMode.ts), so switching
// modes changes nothing in UI code. Real mode never falls back to mocks:
// errors surface as ApiError with explicit states handled by the pages
// (loading / empty / error / not configured).
// ---------------------------------------------------------------------------
import { api } from './api';

export type QueueKind = 'alert' | 'ticket' | 'incident';
export type SlaState = 'breached' | 'at_risk' | 'ok' | 'none';

export interface QueueItem {
  kind: QueueKind;
  uid: string;
  org_id: number;
  client_name: string;
  title: string;
  severity: string;         // critical|high|medium|low|info or p1..p4 for tickets
  status: string;
  assignee: string | null;
  source: string | null;
  resource: string | null;
  created_at: string | null;
  sla_state: SlaState;
  sla_due_at: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  counts: { alerts_open: number; tickets_open: number; incidents_open: number; sla_breached: number; total: number };
  clients: { id: number; name: string }[];
}

export interface HandoverNote {
  id: string; shift: string; content: string; author: string; created_at: string;
}

export interface ClientHealth {
  client_org_id: number; name: string; status: string;
  open_alerts: { critical: number; high: number; other: number };
  open_incidents: number; open_tickets: number; overdue_tickets: number;
  sla_state: 'breached' | 'at_risk' | 'ok';
  agents_total: number; agents_online: number;
  risk_score: number; risk_level: 'critical' | 'high' | 'medium' | 'low';
}

export interface ImpersonationResult {
  token: string; client_org_id: number; client_name: string; expires_at: string; minutes: number;
}

export interface GoldenTemplate {
  id: string; name: string; updated_at?: string;
  monitoring_rules: any[]; notification_rules: any[]; playbooks: any[];
}

export interface OnboardingResult {
  client_org_id: number; pack: string;
  pack_summary: { price_mad: number; min_units: number; siem_retention_days: number; backup_quota_gb_per_unit: number; support: string };
  agent_installer: string; enrollment_token: string;
  invite: { sent: boolean; email: string | null }; integrations: string[]; next_steps: string[];
}

export interface OffboardingExport {
  client_org_id: number; name: string;
  export: { organization: Record<string, any>; settings_keys: string[]; counts: Record<string, number> };
  options: { action: string; effect: string }[];
}

export interface DealRow {
  id: number; prospect_company: string; prospect_email: string | null;
  expected_units: string; pack: string | null; status: string;
  state: 'registered' | 'approved' | 'rejected' | 'conflict' | 'won' | 'expired';
  conflict_note: string | null; bonus_window_open: boolean; bonus_points: number;
  approved_at: string | null; bonus_window_ends: string | null; created_at: string | null;
  client_name?: string | null;
}

export interface QuoteSummary {
  id: number; number: string; mode: string; pack: string | null; units: number;
  wholesale_monthly_excl_vat_mad: number; config_version: string; created_at: string | null;
}

export interface MarginInfo {
  retail_per_unit_mad: number; retail_monthly_mad: number; wholesale_monthly_mad: number;
  gross_margin_mad: number; margin_pct: number;
}

export interface QuoteCreateResult {
  id: number; number: string; partner_tier: string; managed_units: number;
  deal_bonus_applied: boolean; quote: any; margin: MarginInfo | null;
}

export interface StatementLine {
  key: string; label: string; qty: number; unit_mad?: number; amount_mad: number;
}

export interface BillingStatement {
  partner_org_id: number; month: string; tier: string;
  statement: {
    client_org_id: number; name: string; pack: string | null; units: number;
    lines: StatementLine[]; monthly_excl_vat_mad: number;
    tier_discount_pct: number; tier_discount_mad: number; wholesale_mad: number; tier: string;
  };
}

export interface WholesaleInvoice {
  partner_org_id: number; month: string; tier: string; currency: string;
  clients: Array<{ client_org_id: number; name: string; pack: string | null; units: number;
    monthly_excl_vat_mad: number; tier_discount_pct: number; tier_discount_mad: number; wholesale_mad: number }>;
  retail_total_mad: number; wholesale_total_mad: number; vat_mad: number; total_incl_vat_mad: number;
}

export interface BillingAnalytics {
  partner_org_id: number; tier: string; managed_units: number;
  active_clients: number; churned_clients: number;
  retail_mrr_mad: number; wholesale_mrr_mad: number; margin_mrr_mad: number;
  margin_pct: number; tier_discount_pct: number;
}

export const partnerOpsApi = {
  // ---- Phase 2 ----
  queue: (pid: string, f: { client?: number; kind?: string; severity?: string; status?: string; sla?: string; q?: string } = {}) => {
    const qs = Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get<QueueResponse>(`/partners/${pid}/queue${qs ? `?${qs}` : ''}`);
  },
  assign: (pid: string, d: { kind: QueueKind; item_uid: string; assignee_email: string }) =>
    api.post<{ ok: boolean }>(`/partners/${pid}/queue/assign`, d),
  handovers: (pid: string) => api.get<HandoverNote[]>(`/partners/${pid}/handovers`),
  addHandover: (pid: string, d: { shift: string; content: string }) =>
    api.post<HandoverNote>(`/partners/${pid}/handovers`, d),
  health: (pid: string) => api.get<{ clients: ClientHealth[]; generated_at: string }>(`/partners/${pid}/health`),
  openConsole: (pid: string, d: { client_org_id: number; minutes?: number; reason: string }) =>
    api.post<ImpersonationResult>(`/partners/${pid}/impersonations`, d),
  closeConsole: (pid: string) => api.del<{ revoked: number }>(`/partners/${pid}/impersonations`),
  templates: (pid: string) => api.get<GoldenTemplate[]>(`/partners/${pid}/templates`),
  putTemplate: (pid: string, tid: string, d: { name: string; monitoring_rules: any[]; notification_rules: any[]; playbooks: any[] }) =>
    api.put<GoldenTemplate>(`/partners/${pid}/templates/${tid}`, d),
  applyTemplate: (pid: string, tid: string, target_client_ids: number[]) =>
    api.post<{ applied: Record<string, number> }>(`/partners/${pid}/templates/${tid}/apply`, { target_client_ids }),
  // ---- Phase 3 ----
  startOnboarding: (pid: string, cid: number, d: { pack: 'starter' | 'pro' | 'souverain'; contract_months?: number; admin_email?: string | null; integrations?: string[] }) =>
    api.post<OnboardingResult>(`/partners/${pid}/clients/${cid}/onboarding`, d),
  offboardingExport: (pid: string, cid: number) =>
    api.get<OffboardingExport>(`/partners/${pid}/clients/${cid}/offboarding`),
  offboardingDisable: (pid: string, cid: number) =>
    api.post<{ client_org_id: number; status: string }>(`/partners/${pid}/clients/${cid}/offboarding/disable`),
  offboardingDelete: (pid: string, cid: number) =>
    api.del<{ deleted: number }>(`/partners/${pid}/clients/${cid}/offboarding`),
  deals: (pid: string) => api.get<{ deals: DealRow[] }>(`/partners/${pid}/deals`),
  createDeal: (pid: string, d: { prospect_company: string; prospect_email?: string | null; expected_units: number; pack?: string | null }) =>
    api.post<DealRow>(`/partners/${pid}/deals`, d),
  approveDeal: (pid: string, did: number, note?: string) =>
    api.post<DealRow>(`/partners/${pid}/deals/${did}/approve`, { note: note ?? null }),
  rejectDeal: (pid: string, did: number, note?: string) =>
    api.post<DealRow>(`/partners/${pid}/deals/${did}/reject`, { note: note ?? null }),
  quotes: (pid: string) => api.get<{ quotes: QuoteSummary[] }>(`/partners/${pid}/quotes`),
  createQuote: (pid: string, d: Record<string, unknown>) =>
    api.post<QuoteCreateResult>(`/partners/${pid}/quotes`, d),
  billingStatement: (pid: string, client_org_id: number, month: string) =>
    api.get<BillingStatement>(`/partners/${pid}/billing/statement?client_org_id=${client_org_id}&month=${month}`),
  billingInvoice: (pid: string, month: string) =>
    api.get<WholesaleInvoice>(`/partners/${pid}/billing/invoice?month=${month}`),
  billingAnalytics: (pid: string) => api.get<BillingAnalytics>(`/partners/${pid}/billing/analytics`),
};
