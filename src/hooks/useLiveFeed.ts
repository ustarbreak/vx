// Shared live-feed boundary for Client Admin service pages.
//
// Demo Mode returns null so each page can render its explicit demo fixtures.
// Live Mode returns the real records, or [] when the connector is unavailable
// or has no records. An empty array is intentionally truthy: existing callers
// using `if (live) { setRows(live); return; }` will stop before their demo
// fallback and cannot accidentally present fixtures as customer telemetry.
import { isDemoMode } from '../services/demoMode';
import { fetchServiceLive } from '../services/serviceData';

export async function tryLiveFeed<T>(serviceId: string, limit = 100): Promise<T[] | null> {
  if (isDemoMode()) return null;
  try {
    const res = await fetchServiceLive<T>(serviceId, limit);
    if (res.source === 'live' && Array.isArray(res.records)) return res.records;
    return [];
  } catch {
    return [];
  }
}

/** Optional: small inline badge you can drop above any table. */
export function liveBadgeClass(source: 'live' | 'fallback'): string {
  return source === 'live'
    ? 'text-[10px] uppercase tracking-wide text-emerald-400 border border-emerald-500/40 rounded px-2 py-0.5'
    : 'text-[10px] uppercase tracking-wide text-fuchsia-400 border border-fuchsia-500/40 rounded px-2 py-0.5';
}
