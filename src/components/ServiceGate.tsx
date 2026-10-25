import React from 'react';
import { useEntitlement } from '../context/AuthContext';
import { ServiceId } from '../types';
import { Lock, ShieldAlert, ArrowRight } from 'lucide-react';

interface ServiceGateProps {
  serviceId: ServiceId;
  children: React.ReactNode;
}

export default function ServiceGate({ serviceId, children }: ServiceGateProps) {
  const { entitled, orgName } = useEntitlement(serviceId);

  if (!entitled) {
    return (
      <div className="p-4 lg:p-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[var(--ic-bg)]/85 border border-red-500/20 rounded-2xl p-10 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6">
              <Lock className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-[var(--ic-heading)] mb-3">Service Not Entitled</h2>
            <p className="text-[var(--ic-muted)] mb-6 max-w-md mx-auto">
              This service is not currently provisioned for your organization.
              Access has been blocked by Infracentra's entitlement enforcement layer.
            </p>
            {orgName && (
              <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4 mb-6 text-left max-w-sm mx-auto">
                <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider mb-1">Organization</p>
                <p className="text-sm text-[var(--ic-heading)] font-medium">{orgName}</p>
                <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider mb-1 mt-3">Service ID</p>
                <p className="text-sm text-[var(--ic-heading)] font-mono">{serviceId}</p>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-xs text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded-lg p-3 max-w-sm mx-auto">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span>Enforcement action logged to audit trail</span>
            </div>
            <p className="text-xs text-[var(--ic-muted)] mt-6">
              Contact your account administrator or Infracentra sales to activate this service.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
