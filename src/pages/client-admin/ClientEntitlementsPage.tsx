import React from 'react';
import { useAuth } from '../../../src/context/AuthContext';
import { serviceCatalog } from '../../../src/data/mockData';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function ClientEntitlementsPage() {
  const { organization } = useAuth();
  if (!organization) return <div className="p-6 text-[var(--ic-heading)]">No organization found.</div>;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Service Entitlements</h1>
        <p className="text-[var(--ic-muted)] text-sm mt-1">View your organization's provisioned services</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {serviceCatalog.map(service => {
          const ent = organization.entitlements.find(e => e.serviceId === service.id);
          const isEnabled = ent?.enabled ?? false;
          const isAvailable = service.availableTiers.includes(organization.tier);

          return (
            <div key={service.id} className={`bg-[var(--ic-surface)] border rounded-xl p-5 transition-all ${
              isEnabled ? 'border-[var(--ic-border)]' : !isAvailable ? 'opacity-40 border-[var(--ic-border)]' : 'border-[var(--ic-border)]'
            }`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{service.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ic-heading)]">{service.name}</h3>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${
                        service.category === 'security' ? 'bg-cyan-500/10 text-cyan-400' :
                        service.category === 'networking' ? 'bg-purple-500/10 text-purple-400' :
                        'bg-green-500/10 text-green-400'
                      }`}>
                        {service.category}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ic-muted)] mt-1">{service.description}</p>
                  </div>
                </div>
                {isEnabled ? (
                  <CheckCircle2 className="w-5 h-5 text-cyber-green flex-shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-[var(--ic-muted)] flex-shrink-0" />
                )}
              </div>

              {isEnabled && (
                <div className="mt-3 pt-3 border-t border-[var(--ic-border)] flex items-center justify-between">
                  <span className="text-xs text-[var(--ic-muted)]">{ent?.seatCount} seats</span>
                  <span className="text-xs text-[var(--ic-muted)]">Activated: {ent?.activatedAt}</span>
                </div>
              )}
              {!isAvailable && (
                <p className="text-xs text-cyber-red mt-2">Not available for {organization.tier} tier</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
