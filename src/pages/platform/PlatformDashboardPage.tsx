import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Building2, CheckCircle2, CircleHelp, RefreshCw, Server, Shield, Ticket, Users, Workflow, PlugZap } from 'lucide-react';
import { ApiError, platformDashboardApi, PlatformDashboardOverview } from '../../services/api';

const KPI = [
  { key: 'organizations', label: 'Organizations', icon: Building2 },
  { key: 'active_tenants', label: 'Active tenants', icon: CheckCircle2 },
  { key: 'partners', label: 'Partners / MSSPs', icon: Building2 },
  { key: 'platform_staff', label: 'Platform team', icon: Users },
  { key: 'users', label: 'Platform & tenant users', icon: Users },
  { key: 'integrations', label: 'Configured integrations', icon: PlugZap },
  { key: 'agents', label: 'Enrolled agents', icon: Server },
  { key: 'active_incidents', label: 'Active incidents', icon: Shield },
  { key: 'open_tickets', label: 'Open tickets', icon: Ticket },
  { key: 'security_ops_tasks', label: 'Security operations tasks', icon: Workflow },
] as const;

function Distribution({ title, values }: { title: string; values?: Record<string, number> }) {
  const entries = Object.entries(values ?? {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return (
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--ic-heading)] mb-4">{title}</h2>
      {entries.length === 0 ? <p className="text-sm text-[var(--ic-muted)]">No persisted records.</p> : (
        <div className="space-y-3">
          {entries.map(([label, value]) => (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--ic-text)] capitalize">{label.replaceAll('_', ' ')}</span>
                <span className="text-[var(--ic-muted)] tabular-nums">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--ic-surface-2)] overflow-hidden">
                <div className="h-full rounded-full bg-cyan-500" style={{ width: `${total ? (value / total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PlatformDashboardPage() {
  const [data, setData] = useState<PlatformDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await platformDashboardApi.overview();
      setData(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-cyan-500" />
            <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Platform Command Center</h1>
          </div>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Global operational inventory and workload from persisted platform records.</p>
          {data && <p className="text-xs text-[var(--ic-muted)] mt-2">Live snapshot · {new Date(data.generated_at).toLocaleString()}</p>}
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> Live dashboard unavailable</div>
          <p className="mt-1">{error}</p>
          <p className="mt-1 text-xs">No demo values are substituted in live mode.</p>
        </div>
      )}

      {loading && !data ? <div className="rounded-xl border border-[var(--ic-border)] p-8 text-sm text-[var(--ic-muted)]">Loading live platform metrics…</div> : null}

      {data && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {KPI.map(({ key, label, icon: Icon }) => (
              <div key={key} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--ic-muted)]">{label}</span>
                  <Icon className="w-4 h-4 text-cyan-500" />
                </div>
                <p className="mt-2 text-2xl font-bold text-[var(--ic-heading)] tabular-nums">{data.counts[key] ?? '—'}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
            <Distribution title="Tenant lifecycle" values={data.distributions.tenant_status} />
            <Distribution title="Tenant country distribution" values={data.distributions.tenant_country} />
            <Distribution title="Integration configuration status" values={data.distributions.integration_status} />
            <Distribution title="Agent reported status" values={data.distributions.agent_status} />
            <Distribution title="Ticket workload" values={data.distributions.ticket_status} />
            <Distribution title="Incident workload" values={data.distributions.incident_status} />
            <Distribution title="Security operations task status" values={data.distributions.security_task_status} />
          </div>

          <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--ic-heading)] flex items-center gap-2 mb-3"><CircleHelp className="w-4 h-4 text-cyan-500" /> Data integrity & coverage</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {Object.entries(data.limitations).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-[var(--ic-surface-2)] p-3">
                  <p className="text-xs font-semibold text-[var(--ic-heading)] capitalize">{key.replaceAll('_', ' ')}</p>
                  <p className="text-xs text-[var(--ic-muted)] mt-1">{value}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
