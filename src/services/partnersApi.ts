// ---------------------------------------------------------------------------
// Partner Program (MSP) — API client.
// Real backend: /api/partners/* (mirrors routers/partners.py once deployed).
// Demo Mode: answered entirely by demoStore from src/data/partnerWorld.ts.
// Same request/response shapes either way, so switching modes changes nothing
// in the UI code.
// ---------------------------------------------------------------------------
import { api } from './api';
import type { Partner, PartnerEndClient, WhiteLabelConfig, PartnerLicense } from '../data/partnerWorld';

export interface PartnerProgramStats {
  partners_total: number;
  partners_active: number;
  trials: number;
  end_clients: number;
  devices_managed: number;
  wholesale_mrr_eur: number;
  retail_mrr_eur: number;
  channel_margin_pct: number;
  white_labels_live: number;
  dns_pending: number;
}

export const partnersApi = {
  list: () => api.get<Partner[]>('/partners'),
  stats: () => api.get<PartnerProgramStats>('/partners/stats'),
  get: (id: string) => api.get<Partner>(`/partners/${id}`),
  license: (id: string) => api.get<PartnerLicense>(`/partners/${id}/license`),
  branding: (id: string) => api.get<WhiteLabelConfig>(`/partners/${id}/branding`),
  updateBranding: (id: string, data: Partial<WhiteLabelConfig>) =>
    api.put<WhiteLabelConfig>(`/partners/${id}/branding`, data),
  verifyDomain: (id: string) => api.post<WhiteLabelConfig>(`/partners/${id}/verify-domain`),
  clients: (id: string) => api.get<PartnerEndClient[]>(`/partners/${id}/clients`),
  addClient: (id: string, data: Partial<PartnerEndClient>) =>
    api.post<PartnerEndClient>(`/partners/${id}/clients`, data),
  patchClient: (id: string, clientId: string, data: Partial<PartnerEndClient>) =>
    api.patch<PartnerEndClient>(`/partners/${id}/clients/${clientId}`, data),
  removeClient: (id: string, clientId: string) => api.del<void>(`/partners/${id}/clients/${clientId}`),
};
