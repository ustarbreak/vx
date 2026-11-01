// T4.3 — additive admin page: Platform Onboarding / Service Lifecycle.
// Route: #/admin/onboarding (platform-admin only). Reads the honest
// capabilities list + per-org lifecycle states from the flag-gated platform
// API. When PLATFORM_CATALOG_ENABLED is off the routes 404 and this page
// degrades to an explanatory empty state — zero impact on other pages.
import React, { useEffect, useState } from 'react';
import { useCapabilities, CapabilitiesResponse } from '../../hooks/useCapabilities';
import { api } from '../../services/api';
import { OnboardingChecklist, LifecycleRow } from '../../components/platform/OnboardingChecklist';

interface LifecycleResponse {
  org_id: number;
  services: LifecycleRow[];
}

const PlatformOnboardingPage: React.FC = () => {
  const { caps, loading, error } = useCapabilities();
  const [lifecycle, setLifecycle] = useState<LifecycleRow[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .get<LifecycleResponse>('/platform/lifecycle')
      .then((res) => alive && setLifecycle(res.services ?? []))
      .catch(() => alive && setLifecycle([])); // 404 when flag off — fine
    return () => {
      alive = false;
    };
  }, []);

  const recordFirstSuccess = async (serviceId: string) => {
    try {
      await api.post(`/platform/services/${serviceId}/first-success`, {});
      const res = await api.get<LifecycleResponse>('/platform/lifecycle');
      setLifecycle(res.services ?? []);
    } catch (e) {
      // Honest failure surface; no silent success.
      window.alert(`Could not record first success: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Platform Onboarding</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 0 }}>
        Installers: run <code>deploy/install.sh mvp</code> on the target host (see{' '}
        <code>docs/guides/CONNECTOR-INSTALL.md</code>). This page tracks what is
        installed, connected, and verified — honestly, never optimistically.
      </p>

      {loading && <p style={{ color: '#9ca3af' }}>Loading capabilities…</p>}
      {!loading && error && !caps && (
        <p style={{ color: '#fbbf24', fontSize: 13 }}>
          Platform catalog is disabled on the backend (PLATFORM_CATALOG_ENABLED=false)
          or you lack access ({error}). Existing features are unaffected.
        </p>
      )}
      {!loading && caps && (
        <>
          <OnboardingChecklist
            services={(caps as CapabilitiesResponse).services}
            lifecycle={lifecycle}
          />
          <h2 style={{ fontSize: 16, marginTop: 24 }}>Record first success</h2>
          <p style={{ color: '#9ca3af', fontSize: 12 }}>
            Use after manually verifying an engine (verify.sh green). Advances the
            lifecycle to <em>first_success</em>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {lifecycle
              .filter((r) => r.state !== 'first_success')
              .map((r) => (
                <button
                  key={r.service_id}
                  onClick={() => recordFirstSuccess(r.service_id)}
                  style={{
                    background: '#1e3a5f',
                    color: '#93c5fd',
                    border: '1px solid #3b82f6',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  ✓ {r.service_id}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PlatformOnboardingPage;
