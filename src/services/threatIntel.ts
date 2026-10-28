// Threat Intelligence client.
// Demo Mode ON  -> never called for live data (page keeps using mockThreats).
// Real backend  -> GET /api/threat-intel/threads is proxied by Vite to FastAPI,
//                  which aggregates MISP + AlienVault OTX in real time.
import { isDemoMode as demoIsOn } from './demoMode';

export function isDemoMode(): boolean {
  return demoIsOn();
}

export interface LiveThreat {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  source: string;
  ioc: string;
  iocType: string;
  timestamp: string;
  confidence: number;
  mitreAttack: string[];
  affectedAssets: number;
  status: string;
}

export async function fetchLiveThreats(q?: string): Promise<LiveThreat[]> {
  const token = localStorage.getItem('ic_token');
  const url = `/api/threat-intel/threats${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Threat feed error (${res.status})`);
  const body = await res.json();
  return (body.threats ?? []) as LiveThreat[];
}

// ---------------------------------------------------------------------------
// Indicator-to-evidence matches (GET /api/threat-intel/matches).
// Real mode: IoCs actually attached to THIS tenant's incidents — never
// invented. Demo Mode: same shape served from the demo incident store.
// ---------------------------------------------------------------------------
export interface IndicatorMatch {
  indicator: string;
  incident_uid: string;
  severity: string;
  category: string | null;
  status: string | null;
  assets: string[];
  related_alert_uids: string[];
  observed_at: string | null;
}

export async function fetchIndicatorMatches(): Promise<IndicatorMatch[]> {
  const token = localStorage.getItem('ic_token');
  const res = await fetch('/api/threat-intel/matches', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Indicator matches error (${res.status})`);
  const body = await res.json();
  return (body.matches ?? []) as IndicatorMatch[];
}

// ---------------------------------------------------------------------------
// Feed synchronization status (GET /api/threat-intel/feeds/status).
// Reports only real Integration rows. last_sync reflects the stored row's
// value — there is NO background sync job, so the UI must present it as
// "last recorded update", never as an active synchronization.
// ---------------------------------------------------------------------------
export interface FeedStatusRow {
  id: number;
  status: string;
  endpoint_set: boolean;
  last_sync: string | null;
}
export interface FeedStatus {
  name: string;
  kind: 'instance' | 'public-on-demand';
  configured: boolean;
  statuses?: FeedStatusRow[];
  note?: string;
}
export interface FeedsStatusResponse {
  feeds: FeedStatus[];
  no_feed_data: boolean;
}

export async function fetchFeedsStatus(): Promise<FeedsStatusResponse> {
  const token = localStorage.getItem('ic_token');
  const res = await fetch('/api/threat-intel/feeds/status', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Feed status error (${res.status})`);
  return await res.json() as FeedsStatusResponse;
}

/** Single-IoC enrichment (OTX + MISP live in real mode; simulated fixtures in
 *  Demo Mode — the response `sources`/labels make the difference explicit). */
export async function lookupIoc(ioc: string): Promise<{ ioc: string; count: number; threats: LiveThreat[] }> {
  const token = localStorage.getItem('ic_token');
  const res = await fetch(`/api/threat-intel/lookup/${encodeURIComponent(ioc)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`IoC lookup error (${res.status})`);
  return await res.json();
}
