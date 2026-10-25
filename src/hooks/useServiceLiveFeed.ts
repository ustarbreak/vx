// Live-data hook shared by every service page (Threats, Compliance, Incidents,
// Analytics, SOAR/playbooks, Network, PSA, ServiceDetail...).
//
//  - Demo Mode ON  -> returns the mock/reference dataset immediately, ZERO
//                     network calls (this is what evaluators see).
//  - Real backend  -> GET /api/services/{id}/live through the Vite proxy. The
//                     FastAPI connector registry fetches genuine records from
//                     that service's open-source engine (Wazuh, TheHive, n8n,
//                     OpenVAS, Pi-hole, OPNsense, Netdata, GLPI, ...).
//  - Engine not configured / unreachable -> source='none'|'unreachable' and we
//                     fall back to the reference dataset with an honest badge.
import { useEffect, useState } from 'react';
import { isDemoMode } from '../services/demoMode';
import { fetchServiceLive, type LiveResult } from '../services/serviceData';

export type FeedStatus = 'demo' | 'idle' | 'loading' | 'live' | 'empty' | 'error';

export interface ServiceFeed<T> {
  rows: T[];              // live records when available, else fallbackRows
  usingLive: boolean;     // true => rows come from the real OSS engine
  status: FeedStatus;
  detail?: string;        // engine name / error reason for badges & tooltips
  reload: () => void;
}

export function useServiceLiveFeed<T = Record<string, unknown>>(
  serviceId: string,
  fallbackRows: T[],
): ServiceFeed<T> {
  const [result, setResult] = useState<LiveResult<T> | null>(null);
  const [status, setStatus] = useState<FeedStatus>('idle');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // THE demo/real separation point — identical contract to threatIntel.ts.
    if (isDemoMode()) {
      setResult(null);
      setStatus('demo');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetchServiceLive<T>(serviceId)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        if (r.source === 'live' && r.records.length > 0) setStatus('live');
        else if (r.source === 'live') setStatus('empty');
        else setStatus('error');
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setResult({ service_id: serviceId, source: 'error', records: [], reason: e.message });
          setStatus('error');
        }
      });
    return () => { cancelled = true; };
  }, [serviceId, nonce]);

  const usingLive = status === 'live';
  return {
    rows: usingLive ? (result?.records as T[]) : fallbackRows,
    usingLive,
    status,
    detail: result?.engine ?? result?.reason,
    reload: () => setNonce((n) => n + 1),
  };
}

/** Small helper so pages can label their feed honestly. */
export function feedBadgeText(status: FeedStatus, count = 0, engine?: string): string {
  switch (status) {
    case 'demo': return 'DEMO DATA — simulated (no backend needed)';
    case 'loading': return 'Fetching live feed from backend…';
    case 'live': return `LIVE FEED — ${count} records from ${engine ?? 'open-source engine'}`;
    case 'empty': return `Connected to ${engine ?? 'engine'} — 0 records right now`;
    case 'error': return 'Live source unreachable — showing reference dataset';
    default: return '';
  }
}
