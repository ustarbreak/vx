import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Shield, AlertTriangle, RefreshCw, Activity } from 'lucide-react';
import { organizationsApi, usersDirectoryApi, tenantManagerApi, auditApi, type BackendOrganization, type BackendUserRow, type BackendAuditLog, ApiError } from '../../services/api';
import { serviceCatalog } from '../../data/mockData';

export default function PlatformDashboardPage() {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<BackendOrganization[]>([]);
  const [users, setUsers] = useState<BackendUserRow[]>([]);
  const [audit, setAudit] = useState<BackendAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setErrors([]);
    const failures: string[] = [];
    const [orgResult, userResult, auditResult] = await Promise.allSettled([
      organizationsApi.list(),
      usersDirectoryApi.list({ limit: 500 }),
      auditApi.logs({ limit: 100 }),
    ]);
    if (orgResult.status === 'fulfilled') setOrganizations(orgResult.value);
    else failures.push(orgResult.reason instanceof ApiError ? orgResult.reason.message : 'Organizations could not be loaded.');
    if (userResult.status === 'fulfilled') setUsers(userResult.value);
    else failures.push(userResult.reason instanceof ApiError ? userResult.reason.message : 'Users could not be loaded.');
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value);
    else failures.push(auditResult.reason instanceof ApiError ? auditResult.reason.message : 'Platform audit log could not be loaded.');
    setErrors(failures);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeClients = organizations.filter(o => String(o.status ?? '').toLowerCase() === 'active').length;
  const blockedAttempts = audit.filter(e => e.outcome === 'blocked').length;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Platform Administration</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Platform-wide operational overview from authorized backend records.</p>
        </div>
        <button onClick={() => void load(true)} disabled={loading || refreshing} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--ic-border)] text-sm text-[var(--ic-text)] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {errors.length > 0 && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-1">
        <p className="text-sm font-semibold text-amber-300">Some platform data is unavailable</p>
        {errors.map((e, i) => <p key={i} className="text-xs text-[var(--ic-muted)]">{e}</p>)}
      </div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric icon={<Building2 className="w-4 h-4 text-cyan-400" />} label="Organizations" value={loading ? '—' : organizations.length} detail={loading ? 'Loading' : `${activeClients} active · backend records`} />
        <Metric icon={<Users className="w-4 h-4 text-purple-400" />} label="Users" value={loading ? '—' : users.length} detail="Backend directory · current API limit 500" />
        <Metric icon={<Shield className="w-4 h-4 text-cyan-400" />} label="Service catalog" value={serviceCatalog.length} detail="Configured catalog entries · not active integrations" />
        <Metric icon={<AlertTriangle className="w-4 h-4 text-amber-400" />} label="Blocked events" value={loading ? '—' : blockedAttempts} detail={`From ${audit.length} latest audit records`} />
      </div>

      <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-4">Organization portfolio</h2>
        {loading ? <p className="text-sm text-[var(--ic-muted)]">Loading organizations…</p> :
          organizations.length === 0 ? <p className="text-sm text-[var(--ic-muted)]">No organizations were returned by the backend.</p> :
          <div className="space-y-2">{organizations.map(org => <button key={org.id} onClick={() => navigate(`/admin/tenants/${encodeURIComponent(String(org.id))}`)} className="w-full text-left flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--ic-border)] hover:border-cyan-500/40">
            <span><span className="block text-sm font-medium text-[var(--ic-heading)]">{org.name}</span><span className="block text-xs text-[var(--ic-muted)]">ID {org.id} · {org.tier ?? org.plan_tier ?? 'Plan not reported'}</span></span>
            <span className="text-xs text-[var(--ic-muted)]">{org.status ?? 'Status not reported'}</span>
          </button>)}</div>}
      </section>

      <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /> Recent platform audit</h2>
        {loading ? <p className="text-sm text-[var(--ic-muted)]">Loading audit events…</p> :
          audit.length === 0 ? <p className="text-sm text-[var(--ic-muted)]">No audit events were returned.</p> :
          <div className="space-y-2">{audit.slice(0, 10).map(entry => <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--ic-surface-2)]">
            <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${entry.outcome === 'blocked' || entry.outcome === 'failure' ? 'bg-red-400' : 'bg-emerald-400'}`} />
            <div className="min-w-0 flex-1"><p className="text-sm text-[var(--ic-text)]">{entry.action} · {entry.resource}</p><p className="text-xs text-[var(--ic-muted)] mt-1">{entry.actor_name} · {entry.outcome} · {new Date(entry.timestamp).toLocaleString()}</p>{entry.details && <p className="text-xs text-[var(--ic-muted)] mt-1 break-words">{entry.details}</p>}</div>
          </div>)}</div>}
      </section>
      <p className="text-xs text-[var(--ic-muted)]">Revenue, MRR, risk and compliance KPIs are intentionally omitted: the inspected API surface does not provide authoritative values for those metrics.</p>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail: string }) {
  return <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4"><div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-[var(--ic-muted)]">{label}</span></div><p className="text-2xl font-bold text-[var(--ic-heading)]">{value}</p><p className="text-xs text-[var(--ic-muted)] mt-1">{detail}</p></div>;
}
