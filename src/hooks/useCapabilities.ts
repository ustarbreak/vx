// T4.3 — additive platform hook (ADAPTED-PLAN.md Phase 4).
// Fetches GET /api/platform/capabilities (honest ga|beta|roadmap|unsupported
// list + which connector providers ship code). Returns null when the backend
// flag PLATFORM_CATALOG_ENABLED is off (route 404) — callers must treat null
// as "platform catalog unavailable" and keep existing UI behavior unchanged.
import { useEffect, useState } from 'react';
import { api } from '../services/api';

export interface CapabilityAction {
  name: string;
  dangerous: boolean;
  status: 'ga' | 'beta' | 'roadmap' | 'unsupported' | string;
}

export interface CapabilityService {
  service: string;
  status: string;
  provider: string;
  connector_code_shipped: string[];
  actions: CapabilityAction[];
}

export interface CapabilitiesResponse {
  org_id: number;
  services: CapabilityService[];
}

export function useCapabilities(orgId?: number): {
  caps: CapabilitiesResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [caps, setCaps] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = orgId != null ? `?org_id=${orgId}` : '';
    api
      .get<CapabilitiesResponse>(`/platform/capabilities${qs}`)
      .then((res) => {
        if (!alive) return;
        setCaps(res);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 404 = catalog flag off; 401/403 = auth. Either way: no crash, null.
        setCaps(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  return { caps, loading, error };
}
