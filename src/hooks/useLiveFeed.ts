// Wire a client-admin service page to its REAL open-source engine while keeping
// the exact same record structure the page was built around.
//
// Usage inside an existing useEffect (one line per page):
//   const live = await tryLiveFeed<Vulnerability>('vuln-scanning');
//   if (live) { setVulnerabilities(live); setLoading(false); return; }
//   ...existing mock assignment stays untouched below...
//
// Behaviour:
//  - Demo Mode ON  -> returns null instantly, ZERO network calls (mock renders).
//  - Real backend  -> GET /api/services/{id}/live; the FastAPI connector pulls
//    genuine records from the service's OSS engine and normalizers.py maps them
//    onto this platform shape. Returns null when unconfigured/unreachable so the
//    page honestly falls back to the reference dataset.
import { isDemoMode } from '../services/demoMode';
import { fetchServiceLive } from '../services/serviceData';

export async function tryLiveFeed<T>(serviceId: string, limit = 100): Promise<T[] | null> {
  if (isDemoMode()) return null;
  try {
    const res = await fetchServiceLive<T>(serviceId, limit);
    if (res.source === 'live' && Array.isArray(res.records) && res.records.length > 0) {
      return res.records;
    }
    return null;
  } catch {
    return null; // never break the page — fallback badge/mock handles honesty
  }
}

/** Optional: small inline badge you can drop above any table. */
export function liveBadgeClass(source: 'live' | 'fallback'): string {
  return source === 'live'
    ? 'text-[10px] uppercase tracking-wide text-emerald-400 border border-emerald-500/40 rounded px-2 py-0.5'
    : 'text-[10px] uppercase tracking-wide text-fuchsia-400 border border-fuchsia-500/40 rounded px-2 py-0.5';
}
