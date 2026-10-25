// Generic live-data client for ALL 16 platform services + Advanced Ticketing.
// Mirrors threatIntel.ts: Demo Mode ON => never called; real backend => the
// FastAPI /api/services/* routes pull genuine records from each service's
// open-source engine (Wazuh, TheHive, n8n, OpenVAS, Pi-hole, OPNsense, ...).
import { isDemoMode as demoIsOn } from './demoMode';

export function isDemoMode(): boolean {
  return demoIsOn();
}

export interface ServiceConnectorInfo {
  service_id: string;
  engine: string;
  docs: string;
  endpoints: string[];
}

export interface ServiceStatus {
  service_id: string;
  engine?: string;
  configured: boolean;
  reachable: boolean;
  http_status?: number;
  latency_ms?: number;
  reason?: string;
  url?: string;
}

export interface LiveResult<T = Record<string, unknown>> {
  service_id: string;
  engine?: string;
  source: 'live' | 'none' | 'error' | 'unreachable';
  count?: number;
  records: T[];
  http_status?: number;
  reason?: string;
  url?: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('ic_token');
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Services API error (${res.status}) on ${path}`);
  return res.json() as Promise<T>;
}

/** Catalog of which open-source engine backs each service. */
export const fetchServiceCatalog = () =>
  call<ServiceConnectorInfo[]>('/services/catalog');

/** Cheap health probe of one service's engine. */
export const fetchServiceStatus = (serviceId: string) =>
  call<ServiceStatus>(`/services/${serviceId}/status`);

/** REAL records from one service's engine (empty when not configured). */
export const fetchServiceLive = <T = Record<string, unknown>>(serviceId: string, limit = 50) =>
  call<LiveResult<T>>(`/services/${serviceId}/live?limit=${limit}`);

/** Fan-out sync — used by admin dashboards to show global connector health. */
export const syncAllServices = () =>
  call<{ checked: number; results: ServiceStatus[] }>('/services/sync', { method: 'POST' });
