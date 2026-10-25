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
