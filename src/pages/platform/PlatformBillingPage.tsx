import React, { useEffect, useState } from 'react';
import { CreditCard, Download, RefreshCw, Building2, Gauge, Wallet } from 'lucide-react';
import { platformAdminApi, PlatformBillingResponse } from '../../services/api';

const money = (n: number, currency: string) => new Intl.NumberFormat('fr-FR',{style:'currency',currency: currency || 'MAD',maximumFractionDigits:0}).format(n || 0);

export default function PlatformBillingPage() {
  const [period,setPeriod] = useState(new Date().toISOString().slice(0,7));
  const [data,setData] = useState<PlatformBillingResponse|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const load = async () => { setLoading(true); setError(null); try { setData(await platformAdminApi.billing(period)); } catch(e:any) { setError(e?.message ?? 'Unable to load platform billing'); } finally { setLoading(false); } };
  useEffect(()=>{load();},[period]);
  const metrics = [
    ['Recorded MRR', data ? money(data.summary.recorded_mrr,data.currency) : '—', Wallet],
    ['Active organizations', data?.summary.active_organizations ?? '—', Building2],
    ['Trial organizations', data?.summary.trial_organizations ?? '—', CreditCard],
    ['Usage events', data?.summary.usage_event_count ?? '—', Gauge],
  ];
  return <div className="p-4 lg:p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Global Billing & Metering</h1><p className="text-sm text-[var(--ic-muted)] mt-1">Recorded commercial values and metered usage across the platform. No invoice amounts are inferred.</p></div>
      <div className="flex gap-2"><input type="month" value={period} onChange={e=>setPeriod(e.target.value)} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm"/><button onClick={load} className="p-2 border border-[var(--ic-border)] rounded-lg"><RefreshCw size={16}/></button></div>
    </header>
    {error && <div className="p-3 rounded-lg border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{metrics.map(([label,value,Icon]:any)=><div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><Icon size={18} className="text-cyan-400 mb-2"/><div className="text-xs text-[var(--ic-muted)]">{label}</div><div className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{loading?'…':value}</div></div>)}</div>
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
      <h2 className="font-semibold text-[var(--ic-heading)]">Metered usage — {period}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">{['endpoints','seats','siem_gb','backup_gb'].map(key=>{const item=data?.usage[key];return <div key={key} className="rounded-lg bg-[var(--ic-surface-2)] p-3"><div className="text-xs text-[var(--ic-muted)]">{key.replace('_',' ').toUpperCase()}</div><div className="text-xl font-bold text-[var(--ic-heading)] mt-1">{item?item.quantity.toLocaleString('fr-FR'):'Unavailable'}</div><div className="text-[10px] text-[var(--ic-muted)]">{item?item.events+' recorded events':'No meter events received'}</div></div>})}</div>
    </section>
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
      <div className="p-4 border-b border-[var(--ic-border)] flex items-center justify-between"><div><h2 className="font-semibold text-[var(--ic-heading)]">Organization billing register</h2><p className="text-xs text-[var(--ic-muted)]">Commercial values are read from the organization records; usage is read from immutable P4 events.</p></div><Download size={17} className="text-[var(--ic-muted)]"/></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-[var(--ic-muted)] border-b border-[var(--ic-border)]"><th className="p-3">Organization</th><th className="p-3">Type</th><th className="p-3">Plan</th><th className="p-3">MRR</th><th className="p-3">Endpoints</th><th className="p-3">Seats</th><th className="p-3">Contract end</th><th className="p-3">Status</th></tr></thead><tbody>{(data?.organizations ?? []).map(org=><tr key={org.id} className="border-b border-[var(--ic-border)]/60"><td className="p-3 font-medium text-[var(--ic-heading)]">{org.name}</td><td className="p-3">{org.is_partner?'Partner / MSSP':'Client'}</td><td className="p-3">{org.plan_tier ?? '—'}</td><td className="p-3">{money(org.monthly_revenue,data?.currency ?? 'MAD')}</td><td className="p-3">{org.endpoint_count}</td><td className="p-3">{org.seat_limit}</td><td className="p-3">{org.contract_end ? new Date(org.contract_end).toLocaleDateString() : '—'}</td><td className="p-3">{org.status}</td></tr>)}</tbody></table></div>
      {!loading && !data?.organizations.length && <p className="p-5 text-sm text-[var(--ic-muted)]">No organizations recorded.</p>}
    </section>
    <p className="text-xs text-[var(--ic-muted)]">{data?.invoice_system ?? 'Invoice ledger unavailable.'} Direct tenant invoice generation must be connected to a persisted invoice ledger before it can be presented as a platform capability.</p>
  </div>;
}
