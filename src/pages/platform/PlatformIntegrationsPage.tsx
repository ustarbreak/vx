import React, { useState } from 'react';
import { integrationsData, getIntegrationStats } from '../../data/integrationsData';
import { servicesData } from '../../data/servicesData';
import { comingSoonServices } from '../../data/comingSoonServices';
import { 
  Key, Globe, CheckCircle2, XCircle, Clock, 
  ExternalLink, Edit, Trash2, Plus, Filter,
  Shield, Network, Server, Zap, AlertCircle
} from 'lucide-react';

export default function PlatformIntegrationsPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'pending'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);

  const stats = getIntegrationStats();

  const filteredIntegrations = integrationsData.filter(integration => {
    const matchesFilter = filter === 'all' || integration.status === filter;
    const matchesSearch = integration.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         integration.serviceId.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getServiceName = (serviceId: string) => {
    if (serviceId === 'coming-soon') return 'Coming Soon';
    const service = servicesData.find(s => s.id === serviceId);
    return service?.name || serviceId;
  };

  const getServiceIcon = (serviceId: string) => {
    if (serviceId === 'coming-soon') return '🔮';
    const service = servicesData.find(s => s.id === serviceId);
    return service?.icon || '🔧';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'inactive': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'pending': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      default: return 'text-[var(--ic-muted)] bg-slate-500/10 border-slate-500/20';
    }
  };

  const getLicenseColor = (licenseType: string) => {
    switch (licenseType) {
      case 'open-source': return 'text-green-400 bg-green-500/10';
      case 'commercial': return 'text-purple-400 bg-purple-500/10';
      case 'freemium': return 'text-blue-400 bg-blue-500/10';
      default: return 'text-[var(--ic-muted)] bg-slate-500/10';
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <Key className="w-7 h-7 text-cyan-400" />
            Integration Management
          </h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Manage API keys and service integrations</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] text-sm font-medium hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20">
          <Plus className="w-4 h-4" />
          Add Integration
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-[var(--ic-muted)]">Total Integrations</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-xs text-[var(--ic-muted)]">Active</span>
          </div>
          <p className="text-2xl font-bold text-green-400">{stats.active}</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-green-400" />
            <span className="text-xs text-[var(--ic-muted)]">Open Source</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{stats.openSource}</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-[var(--ic-muted)]">Commercial</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{stats.commercial}</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-[var(--ic-muted)]">Freemium</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{stats.freemium}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search integrations..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'inactive', 'pending'] as const).map(status => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  filter === status
                    ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]'
                    : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] bg-[var(--ic-surface)] border border-[var(--ic-border)]'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Integrations List */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Integration</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Service</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">License</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Pricing</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Last Sync</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredIntegrations.map(integration => (
                <tr key={integration.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--ic-heading)]">{integration.name}</p>
                      {integration.apiEndpoint && (
                        <p className="text-xs text-[var(--ic-muted)] font-mono">{integration.apiEndpoint}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getServiceIcon(integration.serviceId)}</span>
                      <span className="text-sm text-[var(--ic-text)]">{getServiceName(integration.serviceId)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-lg bg-[var(--ic-surface-2)] text-xs text-[var(--ic-muted)] capitalize">
                      {integration.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${getStatusColor(integration.status)}`}>
                      {integration.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${getLicenseColor(integration.licenseType)}`}>
                      {integration.licenseType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${
                      integration.pricing === 'free' ? 'text-green-400' :
                      integration.pricing === 'paid' ? 'text-yellow-400' : 'text-purple-400'
                    }`}>
                      {integration.pricing}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--ic-muted)]">
                      {integration.lastSync ? new Date(integration.lastSync).toLocaleDateString() : 'Never'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {integration.documentationUrl && (
                        <a
                          href={integration.documentationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                          title="Documentation"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => setSelectedIntegration(integration.id)}
                        className="p-1.5 rounded text-[var(--ic-muted)] hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        className="p-1.5 rounded text-[var(--ic-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Integration Detail Modal */}
      {selectedIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedIntegration(null)} />
          <div className="relative w-full max-w-2xl bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl shadow-2xl p-6">
            <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Integration Details</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">Name</p>
                  <p className="text-sm text-[var(--ic-heading)]">
                    {integrationsData.find(i => i.id === selectedIntegration)?.name}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">Service</p>
                  <p className="text-sm text-[var(--ic-heading)]">
                    {getServiceName(integrationsData.find(i => i.id === selectedIntegration)?.serviceId || '')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">API Endpoint</p>
                  <p className="text-sm text-[var(--ic-heading)] font-mono">
                    {integrationsData.find(i => i.id === selectedIntegration)?.apiEndpoint || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">API Key</p>
                  <p className="text-sm text-[var(--ic-heading)] font-mono">
                    ••••••••••••••••
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-[var(--ic-border)]">
                <button
                  onClick={() => setSelectedIntegration(null)}
                  className="flex-1 py-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-text)] text-sm font-medium hover:bg-[var(--ic-surface)] transition-colors"
                >
                  Close
                </button>
                <button className="flex-1 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] text-sm font-medium hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20">
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
