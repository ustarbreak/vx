import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Search, Eye, Edit, CheckCircle2, XCircle, Shield, Ban, Users, DollarSign, Key, FileText, Server, Activity, Copy, RefreshCw, Trash2, Plus, ExternalLink } from 'lucide-react';
import { demoOrganizations, serviceCatalog } from '../../data/mockData';
import { Organization, ServiceId, ServiceEntitlement } from '../../types';
import { organizationsApi, ApiError } from '../../services/api';

const ORG_TYPE_LABEL: Record<string, string> = { HQ: 'Siège (HQ)', SUBSIDIARY: 'Filiale', AGENCY: 'Agence' };

// ---------------------------------------------------------------------------
// Create-Organization modal — posts to the REAL backend (POST /api/organizations/)
// ---------------------------------------------------------------------------
function CreateOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', tier: 'sme', contact_email: '', industry: '', country: '', contact_phone: '', org_type: 'HQ' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await organizationsApi.create({
        name: form.name.trim(),
        tier: form.tier,
        contact_email: form.contact_email.trim(),
        industry: form.industry.trim() || undefined,
        country: form.country.trim() || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
        org_type: form.org_type,
      } as any);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create organization');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-bold text-[var(--ic-heading)]">New Organization</h2>
        </div>
        {error && <p className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Company name *</label>
            <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Damanecash" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Tier *</label>
            <select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })} className={inputCls}>
              <option value="sme">SME</option>
              <option value="mid-market">Mid-Market</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Contact email *</label>
            <input required type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className={inputCls} placeholder="admin@damanecash.ma" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Industry</label>
              <input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} className={inputCls} placeholder="Finance" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Country</label>
              <input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className={inputCls} placeholder="France" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Phone</label>
            <input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} className={inputCls} placeholder="+33 1 23 45 67 89" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Type d'organisation *</label>
            <select value={form.org_type} onChange={e => setForm({ ...form, org_type: e.target.value })} className={inputCls}>
              <option value="HQ">Siège social (HQ) — peut rattacher des filiales/agences</option>
              <option value="SUBSIDIARY">Filiale — rattachée à un siège</option>
              <option value="AGENCY">Agence — site déporté</option>
            </select>
            <p className="text-[11px] text-[var(--ic-muted)] mt-1">Un siège (HQ) offre une vue consolidée multi-sites de toute l'infrastructure du groupe.</p>
          </div>
          <div className="bg-cyan-500/10 border border-[var(--ic-border)] rounded-lg p-3 text-[11px] text-cyan-300">
            The tenant is created in the database immediately. To give it working services and a client admin account, use <strong>Settings → Seed demo tenant</strong> or create users via the API afterwards.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-muted)] hover:bg-[var(--ic-surface)]">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-[var(--ic-heading)] disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const tierColors: Record<string, string> = {
  sme: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'mid-market': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  enterprise: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

// Mock API keys per client
const mockApiKeys: Record<string, { key: string; createdAt: string; lastUsed: string; status: 'active' | 'revoked' }[]> = {
  'org-aegis': [
    { key: 'ic_live_a1b2c3d4e5f6g7h8i9j0', createdAt: '2026-06-15', lastUsed: '2027-01-15T09:00:00Z', status: 'active' },
    { key: 'ic_test_x9y8z7w6v5u4t3s2r1q0', createdAt: '2026-06-15', lastUsed: '2027-01-14T18:00:00Z', status: 'active' },
  ],
  'org-techstart': [
    { key: 'ic_live_m1n2o3p4q5r6s7t8u9v0', createdAt: '2026-09-20', lastUsed: '2027-01-15T07:40:00Z', status: 'active' },
  ],
  'org-medsecure': [
    { key: 'ic_live_w1x2y3z4a5b6c7d8e9f0', createdAt: '2026-11-01', lastUsed: '2027-01-15T06:30:00Z', status: 'active' },
  ],
};

// Mock licenses
const mockLicenses: Record<string, { id: string; type: string; seats: number; expiresAt: string; status: 'active' | 'expiring' | 'expired' }> = {
  'org-aegis': { id: 'LIC-2026-001', type: 'Enterprise Annual', seats: 500, expiresAt: '2028-06-15', status: 'active' },
  'org-techstart': { id: 'LIC-2026-002', type: 'SME Annual', seats: 50, expiresAt: '2027-09-20', status: 'expiring' },
  'org-medsecure': { id: 'LIC-2026-003', type: 'Mid-Market Annual', seats: 200, expiresAt: '2027-11-01', status: 'active' },
};

// Mock devices per client
const mockDevices: Record<string, { id: string; hostname: string; type: string; os: string; ip: string; status: 'online' | 'offline' | 'degraded'; lastSeen: string; agent: string }[]> = {
  'org-aegis': [
    { id: 'dev-001', hostname: 'FIN-WS-042', type: 'endpoint', os: 'Windows 11', ip: '10.0.5.42', status: 'online', lastSeen: '2027-01-15T09:20:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-002', hostname: 'FIN-SRV-003', type: 'server', os: 'Windows Server 2022', ip: '10.0.1.3', status: 'online', lastSeen: '2027-01-15T09:20:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-003', hostname: 'DEV-SRV-007', type: 'server', os: 'Ubuntu 22.04', ip: '10.0.2.7', status: 'online', lastSeen: '2027-01-15T09:20:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-004', hostname: 'HR-DB-001', type: 'database', os: 'RHEL 9', ip: '10.0.3.1', status: 'online', lastSeen: '2027-01-15T09:20:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-005', hostname: 'MKT-WS-018', type: 'endpoint', os: 'macOS 14.2', ip: '10.0.5.18', status: 'degraded', lastSeen: '2027-01-15T08:45:00Z', agent: 'EDR v4.2.0' },
  ],
  'org-techstart': [
    { id: 'dev-101', hostname: 'TS-WS-001', type: 'endpoint', os: 'Windows 11', ip: '192.168.1.10', status: 'online', lastSeen: '2027-01-15T07:40:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-102', hostname: 'TS-SRV-001', type: 'server', os: 'Ubuntu 22.04', ip: '192.168.1.2', status: 'online', lastSeen: '2027-01-15T07:40:00Z', agent: 'EDR v4.2.1' },
  ],
  'org-medsecure': [
    { id: 'dev-201', hostname: 'MS-WS-001', type: 'endpoint', os: 'Windows 11', ip: '172.16.0.10', status: 'online', lastSeen: '2027-01-15T06:30:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-202', hostname: 'MS-SRV-001', type: 'server', os: 'Windows Server 2022', ip: '172.16.0.2', status: 'online', lastSeen: '2027-01-15T06:30:00Z', agent: 'EDR v4.2.1' },
    { id: 'dev-203', hostname: 'MS-DB-001', type: 'database', os: 'RHEL 9', ip: '172.16.0.3', status: 'online', lastSeen: '2027-01-15T06:30:00Z', agent: 'EDR v4.2.1' },
  ],
};

export default function PlatformClientsPage() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [activeTab, setActiveTab] = useState<'services' | 'devices' | 'members' | 'api-keys' | 'license' | 'activity'>('services');
  const [entitlements, setEntitlements] = useState<Record<string, ServiceEntitlement[]>>(
    Object.fromEntries(demoOrganizations.map(o => [o.id, [...o.entitlements]]))
  );
  // Real tenants from the backend (POST/GET /api/organizations/) — merged with demo rows
  const [backendOrgs, setBackendOrgs] = useState<import('../../types').Organization[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const loadOrgs = () => {
    organizationsApi.list()
      .then(list => setBackendOrgs(list.map(o => ({
        id: `org-db-${o.id}`,
        dbId: o.id,
        name: o.name,
        tier: (o.tier as any) || 'sme',
        status: (o.status === 'active' ? 'active' : o.status === 'suspended' ? 'suspended' : 'trial') as any,
        contactEmail: o.contact_email,
        industry: o.industry ?? undefined,
        country: o.country ?? undefined,
        memberCount: o.member_count,
        assetCount: o.asset_count,
        riskScore: o.risk_score,
        complianceScore: o.compliance_score,
        monthlyRevenue: o.monthly_revenue,
        planTier: o.plan_tier, endpointCount: o.endpoint_count, seatLimit: o.seat_limit,
        siemLimitGbDay: o.siem_limit_gb, billingCycle: o.billing_cycle, invoiceDisplay: o.monthly_invoice_display,
        entitlements: [],
      } as unknown as import('../../types').Organization))))
      .catch(() => setBackendOrgs([]));
  };
  useEffect(() => { loadOrgs(); }, []);

  // entitlements state for backend orgs defaults to empty list
  const getEntitlements = (orgId: string): ServiceEntitlement[] => entitlements[orgId] ?? [];

  const allOrgs = [...demoOrganizations, ...backendOrgs.filter(b => !demoOrganizations.some(d => d.name.toLowerCase() === b.name.toLowerCase()))];

  const filtered = allOrgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.contactEmail.toLowerCase().includes(search.toLowerCase())
  );

  const toggleEntitlement = (orgId: string, serviceId: ServiceId) => {
    setEntitlements(prev => ({
      ...prev,
      [orgId]: (prev[orgId] ?? []).map(e =>
        e.serviceId === serviceId
          ? {
              ...e,
              enabled: !e.enabled,
              activatedAt: !e.enabled ? new Date().toISOString().split('T')[0] : e.activatedAt,
              deactivatedAt: !e.enabled ? null : new Date().toISOString().split('T')[0],
            }
          : e
      ),
    }));
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <Building2 className="w-7 h-7 text-purple-400" />
            Client Management
          </h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Manage organizations, entitlements, licenses, and API keys</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-[var(--ic-heading)] text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Organization
        </button>
      </div>

      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreated={loadOrgs}
        />
      )}

      {/* Search */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {/* Client List */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Client</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Tier</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Services</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Devices</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Revenue</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(org => {
              const orgEnts = getEntitlements(org.id);
              const activeCount = orgEnts.filter(e => e.enabled).length;
              const deviceCount = mockDevices[org.id]?.length || 0;
              return (
                <tr key={org.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] transition-colors cursor-pointer" onClick={() => { setSelectedOrg(org); setActiveTab('services'); }}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-[var(--ic-heading)]">{org.name}</p>
                    <p className="text-xs text-[var(--ic-muted)]">{org.contactEmail}</p>
                    {(org as any).orgType && (
                      <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        (org as any).orgType === 'HQ' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                        : (org as any).orgType === 'SUBSIDIARY' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                        {ORG_TYPE_LABEL[(org as any).orgType] ?? (org as any).orgType}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${tierColors[org.tier]}`}>
                      {org.tier}
                    </span>
                    {org.planTier && (
                      <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        org.planTier === 'PRO' ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                        : org.planTier === 'SOUVERAIN' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : 'bg-blue-500/10 text-blue-300 border-blue-500/30'}`}>{org.planTier}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${
                      org.status === 'active' ? 'text-green-400' :
                      org.status === 'suspended' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        org.status === 'active' ? 'bg-green-500' :
                        org.status === 'suspended' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      {org.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-[var(--ic-text)]">{activeCount}/{serviceCatalog.length}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-[var(--ic-text)]">{deviceCount}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-cyber-green font-medium">${org.monthlyRevenue.toLocaleString()}/mo</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      {/* Fiche complète (Tenant Detail) — route /admin/tenants/:orgId */}
                      {(org as any).dbId != null ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); nav(`/admin/tenants/${(org as any).dbId}`); }}
                          className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-300 text-xs font-medium hover:bg-purple-500/20 transition-colors border border-[var(--ic-border)] inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> Ouvrir la fiche
                        </button>
                      ) : (
                        <span title="Créez le tenant via l'API backend pour activer la fiche complète"
                              className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface)] text-[var(--ic-muted)] text-xs border border-[var(--ic-border)] cursor-not-allowed inline-flex items-center gap-1 opacity-60">
                          <ExternalLink className="w-3 h-3" /> Ouvrir la fiche
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedOrg(org); setActiveTab('services'); }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium hover:bg-cyan-500/20 transition-colors border border-[var(--ic-border)]"
                      >
                        Manage
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Client Detail Modal */}
      {selectedOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedOrg(null)} />
          <div className="relative w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl shadow-2xl">
            {/* Header */}
            <div className="sticky top-0 z-10 p-6 border-b border-[var(--ic-border)] bg-[var(--ic-bg)]/95 backdrop-blur-xl">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-[var(--ic-heading)]">{selectedOrg.name}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${tierColors[selectedOrg.tier]}`}>
                      {selectedOrg.tier}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--ic-muted)] mt-1">
                    {selectedOrg.contactEmail} • {selectedOrg.industry} • {selectedOrg.country}
                  </p>
                </div>
                <button onClick={() => setSelectedOrg(null)} className="p-2 rounded-lg text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)]">✕</button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 overflow-x-auto">
                {[
                  { id: 'services', label: 'Services', icon: Shield },
                  { id: 'devices', label: 'Devices', icon: Server },
                  { id: 'members', label: 'Members', icon: Users },
                  { id: 'api-keys', label: 'API Keys', icon: Key },
                  { id: 'license', label: 'License', icon: FileText },
                  { id: 'activity', label: 'Activity', icon: Activity },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                      activeTab === tab.id
                        ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]'
                        : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)]'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {activeTab === 'services' && (
                <div className="space-y-3">
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-4">
                    <p className="text-xs text-red-400 font-medium">
                      ⚠️ Enforcement Active: Disabling a service immediately blocks access for all users. All attempts are logged.
                    </p>
                  </div>
                  {serviceCatalog.map(service => {
                    const ent = getEntitlements(selectedOrg.id).find(e => e.serviceId === service.id);
                    const isAvailable = service.availableTiers.includes(selectedOrg.tier);
                    const isEnabled = ent?.enabled ?? false;
                    return (
                      <div key={service.id} className={`p-4 rounded-lg border transition-all ${
                        isEnabled ? 'bg-cyan-500/5 border-[var(--ic-border)]' :
                        !isAvailable ? 'bg-[var(--ic-surface)] border-[var(--ic-border)] opacity-50' :
                        'bg-[var(--ic-surface)] border-[var(--ic-border)]'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{service.icon}</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <h5 className="text-sm font-medium text-[var(--ic-heading)]">{service.name}</h5>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${
                                  service.category === 'security' ? 'bg-cyan-500/10 text-cyan-400' :
                                  service.category === 'networking' ? 'bg-purple-500/10 text-purple-400' :
                                  'bg-green-500/10 text-green-400'
                                }`}>{service.category}</span>
                              </div>
                              <p className="text-xs text-[var(--ic-muted)] mt-0.5">{service.description}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--ic-muted)]">${service.basePrice}/mo</span>
                            {isAvailable ? (
                              <button
                                onClick={() => toggleEntitlement(selectedOrg.id, service.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                  isEnabled
                                    ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                                    : 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-[var(--ic-border)]'
                                }`}
                              >
                                {isEnabled ? 'Disable' : 'Enable'}
                              </button>
                            ) : (
                              <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--ic-surface-2)] text-[var(--ic-muted)]">N/A</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === 'devices' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--ic-text)]">Monitored Devices ({mockDevices[selectedOrg.id]?.length || 0})</h3>
                    <button className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-[var(--ic-border)]">
                      Deploy Agent
                    </button>
                  </div>
                  <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--ic-border)]">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Hostname</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Type</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">OS</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">IP</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Status</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Agent</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mockDevices[selectedOrg.id]?.map(device => (
                          <tr key={device.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                            <td className="px-4 py-3 text-sm text-[var(--ic-heading)] font-mono">{device.hostname}</td>
                            <td className="px-4 py-3 text-xs text-[var(--ic-muted)] capitalize">{device.type}</td>
                            <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{device.os}</td>
                            <td className="px-4 py-3 text-xs text-[var(--ic-muted)] font-mono">{device.ip}</td>
                            <td className="px-4 py-3">
                              <span className={`flex items-center gap-1.5 text-xs font-medium ${
                                device.status === 'online' ? 'text-cyber-green' :
                                device.status === 'degraded' ? 'text-cyber-yellow' : 'text-cyber-red'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  device.status === 'online' ? 'bg-cyber-green' :
                                  device.status === 'degraded' ? 'bg-cyber-yellow' : 'bg-cyber-red'
                                }`} />
                                {device.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{device.agent}</td>
                            <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{new Date(device.lastSeen).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'members' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--ic-text)]">Organization Members</h3>
                    <button className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-[var(--ic-border)]">
                      Invite Member
                    </button>
                  </div>
                  <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--ic-border)]">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Name</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Email</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Role</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">MFA</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Last Login</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Mock members based on org */}
                        {selectedOrg.id === 'org-infracentra' && (
                          <>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Sarah Chen</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">sarah.chen@infracentracorp.io</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-500/10 text-purple-400">Admin</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-green">Enabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-15 09:15</td>
                            </tr>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Marcus Johnson</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">marcus.j@infracentracorp.io</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-500/10 text-blue-400">Analyst</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-green">Enabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-15 08:50</td>
                            </tr>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Alex Rivera</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">alex.r@infracentracorp.io</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-500/10 text-blue-400">Analyst</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-green">Enabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-14 22:00</td>
                            </tr>
                          </>
                        )}
                        {selectedOrg.id === 'org-techstart' && (
                          <>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Jordan Kim</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">jordan@techstart.io</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-500/10 text-purple-400">Admin</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-green">Enabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-15 07:40</td>
                            </tr>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Sam Ortiz</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">sam@techstart.io</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-500/10 text-blue-400">User</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-red">Disabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-14 19:10</td>
                            </tr>
                          </>
                        )}
                        {selectedOrg.id === 'org-medsecure' && (
                          <>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Dr. Lisa Wong</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">dr.wong@medsecure.health</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-500/10 text-purple-400">Admin</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-green">Enabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-15 06:30</td>
                            </tr>
                            <tr className="border-b border-[var(--ic-border)]">
                              <td className="px-4 py-3 text-sm text-[var(--ic-heading)]">Parker Nguyen</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">parker@medsecure.health</td>
                              <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-500/10 text-blue-400">User</span></td>
                              <td className="px-4 py-3 text-xs text-cyber-green">Enabled</td>
                              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">2027-01-15 08:00</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'api-keys' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--ic-text)]">API Keys</h3>
                    <button className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-[var(--ic-border)] flex items-center gap-2">
                      <Key className="w-3.5 h-3.5" />
                      Generate New Key
                    </button>
                  </div>
                  <div className="space-y-3">
                    {mockApiKeys[selectedOrg.id]?.map((apiKey, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)]">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <code className="text-sm text-[var(--ic-heading)] font-mono">{apiKey.key}</code>
                            <button className="p-1 rounded text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-cyan-500/10">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                            apiKey.status === 'active' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-500/10 text-red-400'
                          }`}>
                            {apiKey.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-[var(--ic-muted)]">
                          <span>Created: {apiKey.createdAt}</span>
                          <span>Last used: {new Date(apiKey.lastUsed).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <button className="px-2 py-1 rounded text-xs text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-cyan-500/10 flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> Rotate
                          </button>
                          <button className="px-2 py-1 rounded text-xs text-[var(--ic-muted)] hover:text-red-400 hover:bg-red-500/10 flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'license' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-[var(--ic-text)]">License Information</h3>
                  {mockLicenses[selectedOrg.id] && (
                    <div className="p-6 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)]">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">License ID</p>
                          <p className="text-sm text-[var(--ic-heading)] font-mono mt-1">{mockLicenses[selectedOrg.id].id}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">Type</p>
                          <p className="text-sm text-[var(--ic-heading)] mt-1">{mockLicenses[selectedOrg.id].type}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">Seats</p>
                          <p className="text-sm text-[var(--ic-heading)] mt-1">{mockLicenses[selectedOrg.id].seats}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">Expires</p>
                          <p className="text-sm text-[var(--ic-heading)] mt-1">{mockLicenses[selectedOrg.id].expiresAt}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ic-muted)] uppercase tracking-wider">Status</p>
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
                            mockLicenses[selectedOrg.id].status === 'active' ? 'bg-cyber-green/10 text-cyber-green' :
                            mockLicenses[selectedOrg.id].status === 'expiring' ? 'bg-cyber-yellow/10 text-cyber-yellow' :
                            'bg-red-500/10 text-red-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              mockLicenses[selectedOrg.id].status === 'active' ? 'bg-cyber-green' :
                              mockLicenses[selectedOrg.id].status === 'expiring' ? 'bg-cyber-yellow' : 'bg-red-500'
                            }`} />
                            {mockLicenses[selectedOrg.id].status}
                          </span>
                        </div>
                      </div>
                      <div className="mt-6 pt-6 border-t border-[var(--ic-border)]">
                        <button className="px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 text-sm font-medium border border-[var(--ic-border)] hover:bg-cyan-500/20">
                          Renew License
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'activity' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-[var(--ic-text)]">Recent Activity</h3>
                  <div className="space-y-2">
                    {[
                      { time: '2 min ago', action: 'Risk score recalculated', type: 'system' },
                      { time: '15 min ago', action: 'New threat alert detected', type: 'alert' },
                      { time: '1 hour ago', action: 'Compliance scan completed', type: 'compliance' },
                      { time: '3 hours ago', action: 'User login successful', type: 'auth' },
                      { time: '6 hours ago', action: 'Threat intel feed updated', type: 'system' },
                    ].map((log, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--ic-surface)]">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          log.type === 'alert' ? 'bg-red-500' :
                          log.type === 'compliance' ? 'bg-purple-500' :
                          log.type === 'auth' ? 'bg-yellow-500' : 'bg-slate-500'
                        }`} />
                        <div className="flex-1">
                          <p className="text-sm text-[var(--ic-text)]">{log.action}</p>
                        </div>
                        <span className="text-xs text-[var(--ic-muted)] flex-shrink-0">{log.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
