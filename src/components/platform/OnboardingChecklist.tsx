// T4.3 — additive component. Onboarding checklist derived from the platform
// catalog capabilities + lifecycle states. Renders nothing harmful when the
// backend flag PLATFORM_CATALOG_ENABLED is off (caps === null): shows an
// honest "catalog disabled" note instead of fake progress.
import React from 'react';
import { CapabilityService } from '../../hooks/useCapabilities';
import { ServiceStatusChip, LifecycleState } from './ServiceStatusChip';

export interface LifecycleRow {
  service_id: string;
  state: LifecycleState;
}

const STEP_LABELS: Array<{ key: string; test: (s: LifecycleState) => boolean }> = [
  { key: 'Engine installed (deploy/install.sh)', test: (s) => s !== 'not_installed' },
  { key: 'Connector connected & probing', test: (s) => s === 'connected' || s === 'first_success' },
  { key: 'First success recorded', test: (s) => s === 'first_success' },
];

export const OnboardingChecklist: React.FC<{
  services: CapabilityService[];
  lifecycle: LifecycleRow[];
}> = ({ services, lifecycle }) => {
  const stateOf = (id: string): LifecycleState =>
    lifecycle.find((r) => r.service_id === id)?.state ?? 'not_installed';

  // Only services that ship connector code OR are native ga need a checklist.
  const actionable = services.filter(
    (s) => s.connector_code_shipped.length > 0 || s.status === 'ga',
  );

  if (actionable.length === 0) {
    return (
      <p style={{ color: '#9ca3af', fontSize: 13 }}>
        Platform catalog unavailable or empty — enable PLATFORM_CATALOG_ENABLED
        on the backend to see onboarding progress. Nothing here blocks existing
        features.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {actionable.map((svc) => {
        const st = stateOf(svc.service);
        return (
          <div
            key={svc.service}
            style={{
              border: '1px solid #374151',
              borderRadius: 8,
              padding: '8px 12px',
              background: '#111827',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 13 }}>{svc.service}</strong>
              <ServiceStatusChip state={st} serviceId={svc.service} />
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, listStyle: 'none' }}>
              {STEP_LABELS.map((step) => {
                const done = step.test(st);
                return (
                  <li key={step.key} style={{ fontSize: 12, color: done ? '#86efac' : '#6b7280' }}>
                    {done ? '☑' : '☐'} {step.key}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
};

export default OnboardingChecklist;
