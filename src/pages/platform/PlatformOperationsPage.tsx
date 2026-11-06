import React, { useEffect, useState } from 'react';
import { Activity, PlugZap, RefreshCw, Server, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { platformAdminApi } from '../../services/api';

export default function PlatformOperationsPage() {
  const [health,setHealth] = useState<any>(null);
  const [connectors,setConnectors] = useState<any[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const load = async () => { setLoading(true); setError(null); try { const [h,c] = await Promise.all([platformAdminApi.health(),platformAdminApi.connectors()]); setHealth(h); setConnectors(c.results ?? []); } catch(e:any) { setError(e?.message ?? 'Platform health query failed'); } finally { setLoading(false); } };
  useEffect(()=>{load();},[]);
  const statusIcon=(s:string)=>['healthy','active','connected','ok'].includes((s||'').toLowerCase())?<CheckCircle2 className="w-4 h-4 text-emerald-400"/>:['attention','degraded','warning'].includes((s||'').toLowerCase())?<AlertTriangle className="w-4 h-4 text-amber-400"/>:<XCircle className="w-4 h-4 text-rose-400"/>;
  return <div className="p-4 lg:p-6 space-y-6">
    <header className="flex justify-between items-start gap-3"><div><h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Activity className="w-6 h-6 text-cyan-400"/>Platform Operations & Health</h1><p className="text-sm text-[var(--ic-muted)] mt-1">Live API health, configured connector status and operational attention points.</p></div><button onClick={load} className="px-3 py-2 border border-[var(--ic-border)] rounded-lg text-sm"><RefreshCw className="inline w-4 h-4 mr-2"/>Refresh</button></header>
    {error&&<div className="p-3 rounded-lg border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><Server className="text-cyan-400 mb-2"/><div className="text-xs text-[var(--ic-muted)]">Database</div><div className="text-lg font-semibold text-[var(--ic-heading)] flex items-center gap-2 mt-1">{health?.database?.status ?? (loading?'Checking…':'Unknown')}{health?.database?.status&&statusIcon(health.database.status)}</div></div>
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><PlugZap className="text-cyan-400 mb-2"/><div className="text-xs text-[var(--ic-muted)]">Connector health</div><div className="text-lg font-semibold text-[var(--ic-heading)] mt-1">{health?.connectors?.status ?? (loading?'Checking…':'Unknown')}</div><div className="text-xs text-[var(--ic-muted)]">{health?.connectors?.count ?? 'Not available'} checked</div></div>
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><ShieldCheck className="text-cyan-400 mb-2"/><div className="text-xs text-[var(--ic-muted)]">Last health snapshot</div><div className="text-sm font-semibold text-[var(--ic-heading)] mt-1">{health?.generated_at ? new Date(health.generated_at).toLocaleString() : '—'}</div></div>
    </div>
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden"><div className="p-4 border-b border-[var(--ic-border)]"><h2 className="font-semibold text-[var(--ic-heading)]">Connector registry</h2><p className="text-xs text-[var(--ic-muted)]">Statuses are returned by the backend connector health service. Credentials remain masked.</p></div>
      <div className="divide-y divide-[var(--ic-border)]">{connectors.map((c,i)=><div key={c.id ?? c.service_id ?? c.name ?? i} className="p-4 flex flex-wrap justify-between items-center gap-3"><div className="flex items-center gap-3">{statusIcon(c.status)}<div><div className="text-sm font-medium text-[var(--ic-heading)]">{c.name ?? c.service_id ?? c.connector ?? 'Connector'}</div><div className="text-xs text-[var(--ic-muted)]">{c.message ?? c.detail ?? c.last_check ?? 'Health check returned no detail'}</div></div></div><div className="text-xs text-[var(--ic-muted)]">{c.status ?? 'unknown'}</div></div>)}
      {!connectors.length&&!loading&&<p className="p-5 text-sm text-[var(--ic-muted)]">No configured connectors were returned. This is not a healthy status; configure integrations and run their tests.</p>}</div>
    </section>
  </div>;
}
