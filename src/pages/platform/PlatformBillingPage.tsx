import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Building2, CalendarDays, CreditCard, RefreshCw, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, platformBillingApi, type PlatformBillingOverview, type PlatformBillingTenant } from '../../services/api';

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const fmt = (n: number, currency = 'MAD') => new Intl.NumberFormat('fr-MA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const usage = (tenant: PlatformBillingTenant, metric: string) => {
  const value = tenant.usage[metric];
  return value ? `${value.quantity.toLocaleString()} · ${value.event_count} events` : 'No metering evidence';
};

export default function PlatformBillingPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<PlatformBillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await platformBillingApi.overview(period)); }
    catch (e) { setData(null); setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  const cards = data ? [
    { label: 'Active direct tenants', value: data.counts.active ?? 0, icon: Building2 },
    { label: 'Partner / MSSP organizations', value: data.counts.partners ?? 0, icon: Users },
    { label: 'Tenants with usage evidence', value: data.counts.tenants_with_usage ?? 0, icon: Activity },
    { label: 'Recorded usage events', value: data.counts.usage_events ?? 0, icon: CreditCard },
  ] : [];

  return (
    <main className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><Wallet className="w-6 h-6 text-cyan-400" /><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Billing & Subscription Control</h1></div>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Global tenant plans, contractual limits and recorded usage evidence.</p>
          {data && <p className="text-xs text-[var(--ic-muted)] mt-2">Live database snapshot · {new Date(data.generated_at).toLocaleString()} · Period {data.period}</p>}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-xs text-[var(--ic-muted)]"><CalendarDays className="w-4 h-4" /><input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="bg-transparent text-[var(--ic-heading)]" /></label>
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
      {loading && !data && <div className="rounded-xl border border-[var(--ic-border)] p-8 text-sm text-[var(--ic-muted)]">Loading subscription and metering records…</div>}

      {data && <>
        <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {cards.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--ic-muted)]"><span>{label}</span><Icon className="w-4 h-4 text-cyan-400" /></div>
            <p className="mt-2 text-2xl font-bold text-[var(--ic-heading)] tabular-nums">{value}</p>
          </div>)}
        </section>

        <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
          <div className="p-4 border-b border-[var(--ic-border)] flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold text-[var(--ic-heading)]">Subscription portfolio</h2><p className="text-xs text-[var(--ic-muted)] mt-1">Stored contract and plan fields per organization. Missing usage remains unavailable, not zero.</p></div>
            <Link to="/admin/packs" className="text-xs text-cyan-400 underline">Manage pricing packs</Link>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-[var(--ic-surface-2)] text-[11px] uppercase text-[var(--ic-muted)]"><tr>
              <th className="p-3 text-left">Organization</th><th className="p-3 text-left">Plan</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Cycle</th><th className="p-3 text-right">Recorded monthly amount</th><th className="p-3 text-left">Endpoint usage</th><th className="p-3 text-left">Seat usage</th><th className="p-3 text-left">SIEM usage</th><th className="p-3 text-left">Contract end</th>
            </tr></thead>
            <tbody>{data.tenants.map(t => <tr key={t.id} className="border-t border-[var(--ic-border)]">
              <td className="p-3"><p className="font-medium text-[var(--ic-heading)]">{t.name}</p><p className="text-[11px] text-[var(--ic-muted)]">{t.is_partner ? 'Partner / MSSP' : 'Direct tenant'} · #{t.id}</p></td>
              <td className="p-3"><span className="text-xs font-semibold text-[var(--ic-heading)]">{t.plan_tier}</span><p className="text-[11px] text-[var(--ic-muted)]">{t.tier}</p></td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{t.status}{t.trial ? ' · trial' : ''}</td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{t.billing_cycle}</td>
              <td className="p-3 text-right tabular-nums text-[var(--ic-heading)]">{fmt(t.monthly_revenue_recorded, data.currency)}</td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{usage(t, 'endpoints')}<p className="text-[10px]">Limit: {t.endpoint_limit ?? '—'}</p></td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{usage(t, 'seats')}<p className="text-[10px]">Limit: {t.seat_limit ?? '—'}</p></td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{usage(t, 'siem_gb')}<p className="text-[10px]">Limit: {t.siem_limit_gb_day ?? '—'} GB/day</p></td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{t.contract_end ? new Date(t.contract_end).toLocaleDateString() : 'Not recorded'}</td>
            </tr>)}
              {!data.tenants.length && <tr><td colSpan={9} className="p-8 text-center text-sm text-[var(--ic-muted)]">No organizations found.</td></tr>}
            </tbody>
          </table></div>
        </section>

        <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-[var(--ic-heading)]">Commercial data integrity</h2>
          {Object.entries(data.commercial_integrity).map(([key, value]) => <p key={key} className="text-xs text-[var(--ic-muted)]"><span className="font-semibold text-[var(--ic-heading)] capitalize">{key.replace(/_/g, ' ')}:</span> {value}</p>)}
          <p className="text-xs text-[var(--ic-muted)]">The monthly amount above is the persisted organization field, not proof of invoicing, cash collection or recognized revenue. Invoice/payment management must wait for a verified financial ledger.</p>
        </section>
      </>}
    </main>
  );
}
