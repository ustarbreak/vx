// T4.3 — additive component. Small honest status chip for a service's
// onboarding lifecycle state (not_installed → installed → connected →
// first_success). Pure presentational; no data fetching of its own so it can
// be reused inside ServiceLifecyclePage or any table row.
import React from 'react';

export type LifecycleState =
  | 'not_installed'
  | 'installed'
  | 'connected'
  | 'first_success'
  | string;

const STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  not_installed: { bg: '#374151', fg: '#d1d5db', label: 'Not installed' },
  installed: { bg: '#1e3a5f', fg: '#93c5fd', label: 'Installed' },
  connected: { bg: '#78350f', fg: '#fcd34d', label: 'Connected' },
  first_success: { bg: '#14532d', fg: '#86efac', label: 'First success ✓' },
};

export const ServiceStatusChip: React.FC<{
  state: LifecycleState;
  serviceId?: string;
}> = ({ state, serviceId }) => {
  const s = STYLE[state] ?? { bg: '#1f2937', fg: '#9ca3af', label: state };
  return (
    <span
      title={serviceId ? `${serviceId}: ${state}` : state}
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
};

export default ServiceStatusChip;
