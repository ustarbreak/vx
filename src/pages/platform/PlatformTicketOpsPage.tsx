import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Building2, Clock3, Filter, RefreshCw, ShieldAlert, Ticket, UserCheck, Zap } from 'lucide-react';
import { ApiError, platformTicketOpsApi, ticketsApi, type AdvTicket, type PlatformTicketOverview } from '../../services/api';

const badge = (value: string) => {
  const colors: Record<string, string> = {
    p1: 'bg-red-500/15 text-red-400', p2: 'bg-orange-500/15 text-orange-400',
    p3: 'bg-yellow-500/15 text-yellow-400', p4: 'bg-slate-500/15 text-slate-400',
    open: 'bg-cyan-500/15 text-cyan-400', in_progress: 'bg-blue-500/15 text-blue-400',
    escalated: 'bg-red-500/15 text-red-400', resolved: 'bg-emerald-500/15 text-emerald-400',
  };
  return colors[value] || 'bg-slate-500/15 text-[var(--ic-muted)]';
};

export default function PlatformTicketOpsPage() {
  const [overview, setOverview] = useState<PlatformTicketOverview | null>(null);
  const [rows, setRows] = useState<AdvTicket[]>([]);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [summary, tickets] = await Promise.all([
        platformTicketOpsApi.overview(),
        ticketsApi.list({ status: status || undefined, priority: priority || undefined, q: query || undefined }),
      ]);
      setOverview(summary); setRows(tickets);
    } catch (e) {
      setOverview(null); setRows([]);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setLoading(false); }
  }, [status, priority, query]);

  useEffect(() => { void load(); }, [load]);

  const update = async (ticket: AdvTicket, patch: Record<string, string>) => {
    setBusy(ticket.uid); setError('');
    try {
      await ticketsApi.update(ticket.uid, patch);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const escalate = async () => {
    setBusy('escalations'); setError('');
    try { await platformTicketOpsApi.runEscalations(); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const cards = overview ? [
    { label: 'All tickets', value: overview.counts.total, icon: Ticket },
    { label: 'Active queue', value: overview.counts.open, icon: Activity },
    { label: 'P1 / P2 priority', value: overview.counts.p1_p2, icon: ShieldAlert },
    { label: 'SLA breached', value: overview.counts.sla_breached, icon: Clock3 },
    { label: 'Unassigned', value: overview.counts.unassigned, icon: UserCheck },
  ] : [];

  return <main className="p-4 lg:p-6 space-y-6">
    <header className="flex flex-wrap justify-between items-start gap-4">
      <div><div className="flex items-center gap-2"><Ticket className="w-6 h-6 text-cyan-400" /><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Global Ticket Operations</h1></div>
        <p className="text-sm text-[var(--ic-muted)] mt-1">Cross-tenant service desk, SLA exposure, assignment and escalation control.</p>
        {overview && <p className="text-xs text-[var(--ic-muted)] mt-2">Live database snapshot · {new Date(overview.generated_at).toLocaleString()}</p>}
      </div>
      <div className="flex gap-2">
        <button onClick={() => void load()} disabled={loading || !!busy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        <button onClick={() => void escalate()} disabled={!!busy || loading} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-3 py-2 text-sm"><Zap className="w-4 h-4" />Run SLA escalations</button>
      </div>
    </header>

    {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
    {loading && !overview && <div className="rounded-xl border border-[var(--ic-border)] p-8 text-sm text-[var(--ic-muted)]">Loading live ticket operations…</div>}
    {overview && <>
      <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {cards.map(({label,value,icon:Icon}) => <div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><div className="flex justify-between items-center text-xs text-[var(--ic-muted)]"><span>{label}</span><Icon className="w-4 h-4 text-cyan-400" /></div><p className="mt-2 text-2xl font-bold text-[var(--ic-heading)] tabular-nums">{value}</p></div>)}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <h2 className="font-semibold text-[var(--ic-heading)] mb-3">Tenant queue distribution</h2>
          <div className="space-y-3">{overview.by_organization.slice(0,8).map(org => <div key={org.org_id}>
            <div className="flex justify-between text-xs mb-1"><span className="text-[var(--ic-heading)]">{org.organization}</span><span className="text-[var(--ic-muted)]">{org.open} active / {org.total} total · {org.p1_p2} P1/P2</span></div>
            <div className="h-2 rounded-full bg-[var(--ic-surface-2)] overflow-hidden"><div className="h-full rounded-full bg-cyan-500" style={{width:`${org.total ? Math.min(100,org.open/org.total*100) : 0}%`}} /></div>
          </div>)}{!overview.by_organization.length && <p className="text-sm text-[var(--ic-muted)]">No ticket records.</p>}</div>
        </div>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <h2 className="font-semibold text-[var(--ic-heading)] mb-3">Assignee workload</h2>
          <div className="space-y-2">{overview.workload.slice(0,8).map(x => <div key={x.assignee} className="flex justify-between text-xs border-b border-[var(--ic-border)] pb-2"><span className="text-[var(--ic-muted)]">{x.assignee}</span><span className="font-semibold text-[var(--ic-heading)]">{x.open}</span></div>)}{!overview.workload.length && <p className="text-sm text-[var(--ic-muted)]">No active assignments.</p>}</div>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
        <div className="p-4 border-b border-[var(--ic-border)] flex flex-wrap justify-between gap-3">
          <div><h2 className="font-semibold text-[var(--ic-heading)]">Global service desk</h2><p className="text-xs text-[var(--ic-muted)] mt-1">Changes are persisted through the existing ticket API and audit trail.</p></div>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tickets…" className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-xs" />
            <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-xs"><option value="">All statuses</option>{['new','triage','open','in_progress','pending_vendor','escalated','awaiting_approval','resolved','closed'].map(x=><option key={x}>{x}</option>)}</select>
            <select value={priority} onChange={e=>setPriority(e.target.value)} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-xs"><option value="">All priorities</option>{['p1','p2','p3','p4'].map(x=><option key={x}>{x}</option>)}</select>
          </div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
          <thead className="text-[11px] uppercase text-[var(--ic-muted)] bg-[var(--ic-surface-2)]"><tr><th className="p-3 text-left">Ticket</th><th className="p-3 text-left">Priority</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Assignee</th><th className="p-3 text-left">SLA</th><th className="p-3 text-left">Created</th><th className="p-3 text-left">Actions</th></tr></thead>
          <tbody>{rows.map(t=><tr key={t.uid} className="border-t border-[var(--ic-border)]">
            <td className="p-3"><p className="font-medium text-[var(--ic-heading)]">{t.title}</p><p className="text-[11px] text-[var(--ic-muted)]">{t.uid} · Org #{t.org_id} · {t.category}</p></td>
            <td className="p-3"><select aria-label={`Priority ${t.uid}`} disabled={!!busy} value={t.priority} onChange={e=>void update(t,{priority:e.target.value})} className={`rounded-md px-2 py-1 text-xs ${badge(t.priority)}`}>{['p1','p2','p3','p4'].map(x=><option key={x}>{x}</option>)}</select></td>
            <td className="p-3"><select aria-label={`Status ${t.uid}`} disabled={!!busy} value={t.status} onChange={e=>void update(t,{status:e.target.value})} className={`rounded-md px-2 py-1 text-xs ${badge(t.status)}`}>{['new','triage','open','in_progress','pending_vendor','escalated','awaiting_approval','resolved','closed'].map(x=><option key={x}>{x}</option>)}</select></td>
            <td className="p-3 text-xs text-[var(--ic-muted)]">{t.assignee || 'Unassigned'}</td>
            <td className="p-3 text-xs"><span className={t.sla_state==='breached'?'text-red-400':'text-[var(--ic-muted)]'}>{t.sla_state || 'Not evaluated'}</span></td>
            <td className="p-3 text-xs text-[var(--ic-muted)]">{new Date(t.created_at).toLocaleString()}</td>
            <td className="p-3"><a href={`#/client-admin/tickets/${encodeURIComponent(t.uid)}`} className="text-cyan-400 underline text-xs">Open ticket</a></td>
          </tr>)}{!rows.length && <tr><td colSpan={7} className="p-8 text-center text-sm text-[var(--ic-muted)]">No tickets match these filters.</td></tr>}</tbody>
        </table></div>
        <div className="p-3 border-t border-[var(--ic-border)] text-xs text-[var(--ic-muted)] flex items-center gap-2"><Filter className="w-3.5 h-3.5" />{rows.length} tickets in current view</div>
      </section>
    </>}
  </main>;
}
