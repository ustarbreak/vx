// Security Analytics client — single source of truth for /api/analytics/*.
// Real mode  -> FastAPI GET /api/analytics/overview (app/routers/analytics.py).
// Demo Mode  -> demoStore.handle('analytics/overview') mirror (demoMode.ts),
//               same response shapes; explicitly simulated data.
// No frontend-only metric state is kept: pages read this module only.
import { api } from './api';

export interface AnalyticsOverview {
  org_id: number;
  window: { since: string; until: string; timezone: 'UTC'; bucket: 'hour' | 'day' };
  generated_at: string;
  events: {
    total: number;
    by_severity: Record<string, number>;
    raw_events_weighted: number; // sum of correlated_count — never mixed with `total`
  };
  detections: {
    total: number;
    by_severity: Record<string, number>;
    by_category: Record<string, number>;
    by_status: Record<string, number>;
    mttd_minutes: number | null; // null = no sample in window ("no data", never fake 0)
    mttr_minutes: number | null;
  };
  trend: { bucket: string; events: number; detections: number }[];
  top_assets: { resource: string; events: number }[];
  data_freshness: 'live' | 'empty';
}

export interface OverviewParams {
  since?: string;   // UTC ISO
  until?: string;   // UTC ISO
  bucket?: 'hour' | 'day';
  site_org_id?: number; // platform admins only (server-enforced)
  limit_assets?: number;
}

/** Fetch the server-aggregated security overview for one tenant/site window. */
export async function fetchAnalyticsOverview(p: OverviewParams = {}): Promise<AnalyticsOverview> {
  const qs = new URLSearchParams();
  if (p.since) qs.set('since', p.since);            // URLSearchParams encodes '+' → %2B safely
  if (p.until) qs.set('until', p.until);
  if (p.bucket) qs.set('bucket', p.bucket);
  if (p.site_org_id != null) qs.set('site_org_id', String(p.site_org_id));
  if (p.limit_assets != null) qs.set('limit_assets', String(p.limit_assets));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return api.get<AnalyticsOverview>(`/analytics/overview${suffix}`);
}

/** Preset windows offered by the UI. All bounds are computed in UTC so the
 *  chart labels match the backend's UTC buckets exactly. */
export const RANGE_PRESETS = [
  { key: '24h', label: 'Last 24 h', hours: 24, bucket: 'hour' as const },
  { key: '7d', label: 'Last 7 days', hours: 24 * 7, bucket: 'day' as const },
  { key: '30d', label: 'Last 30 days', hours: 24 * 30, bucket: 'day' as const },
  { key: '90d', label: 'Last 90 days', hours: 24 * 90, bucket: 'day' as const },
];

export function windowForPreset(hours: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3600_000);
  return { since: since.toISOString(), until: until.toISOString() };
}

/** Humanize a minutes value coming from the API (null-safe: "No data"). */
export function fmtMinutes(v: number | null | undefined): string {
  if (v == null) return 'No data';
  if (v < 60) return `${Math.round(v)} min`;
  const h = v / 60;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(v / 1440).toFixed(1)} d`;
}
