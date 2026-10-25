import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ticketsApi, alertsApi, settingsApi, AdvTicket, AlertRow, TenantRef, pushDemoEvents,
} from '../../services/api';
import { Ticket, Radio, AlertOctagon, Skull, Building2, ArrowRight, VolumeX, Timer, CheckCircle2, RefreshCw, Play } from 'lucide-react';

export default function PlatformServicesOverviewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<number | string>('*');
  const [tenants, setTenants] = useState<TenantRef[]>([]);
  const [tickets, setTickets] = useState<AdvTicket[]>([]);
  const [events, setEvents] = useState<AlertRow[]>([]);
  const [dlqCount, setDlqCount] = useState(0);
  const [deliveryRate, setDeliveryRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const orgId = tenantId === '*' ? undefined : Number(tenantId);
      const [t, e, dlq] = await Promise.all([
        ticketsApi.list(orgId !== undefined ? { org_id: orgId } : {}),
        alertsApi.list(orgId),
        alertsApi.notifications('dead_letter').catch(() => [] as any),
      ]);
      setTickets(t); setEvents(e.slice(0, 50)); setDlqCount(dlq.length);
      // delivery success rate from engine analytics (real aggregation)
      try {
        const a = await alertsApi.analytics();
        const byStatus: Record<string, number> = (a as any)?.by_status ?? {};
        const ok = (byStatus.delivered ?? 0) + (byStatus.acknowledged ?? 0);
        const all = Object.values(byStatus).reduce((sum, v) => sum + Number(v), 0);
        if (all > 0) setDeliveryRate(Math.round((ok / all) * 100));
      } catch { /* analytics optional */ }
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => {
    settingsApi.overview().then(o => setTenants(o.tenants.map(t => ({ id: t.id, name: t.name } as any)))).catch(() => {});
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const kpis = useMemo(() => ({
    active: tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length,
    breached: tickets.filter(t => t.sla_state === 'breached').length,
    atRisk: tickets.filter(t => t.sla_state === 'at_risk').length,
    approvals: tickets.filter(t => t.status === 'awaiting_approval').length,
    suppressed: events.filter(e => e.storm_suppressed).length,
  }), [tickets, events]);

  const runDemo = async () => {
    setDemoBusy(true); setDemoMsg('');
    try {
      const res = await pushDemoEvents(tenantId === '*' ? undefined : Number(tenantId));
      setDemoMsg(`Pushed ${res.alerts} sample events through the real pipeline → ${res.tickets.length} ticket(s) auto-created${res.tickets.length ? ` (${res.tickets.join(', ')})` : ''}.`);
      await load();
    } catch (e: any) { setDemoMsg(e.message ?? 'Demo push failed.'); }
    finally { setDemoBusy(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)] flex items-center gap-3"><Building2 className="w-7 h-7 text-purple-400" />Ticketing & Notification Services — Cross-Tenant Overview</h1>
          <p className="text-[var(--ic-muted)] mt-1">Platform-admin view across all client tenants — live backend data.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={tenantId} onChange={e => setTenantId(e.target.value)} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-text)]">
            <option value="*">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={load} title="Refresh" className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* Single demo toggle: pushes SAMPLE ALERTS into the REAL ingest endpoint.
          Everything downstream (correlation, rules, notifications, auto-tickets)
          is produced by the actual backend — never mocked in the UI. */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)]">
        <button onClick={runDemo} disabled={demoBusy || user?.role !== 'platform_admin'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 text-[var(--ic-heading)] text-sm font-medium hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-50">
          <Play className="w-4 h-4" />{demoBusy ? 'Pushing events…' : 'Demo Mode: simulate an alert feed'}
        </button>
        <span className="text-xs text-[var(--ic-muted)]">Injects realistic sample events via <code className="text-cyan-400">POST /api/alerts</code>; tickets & notifications are generated by the real engines.</span>
        {demoMsg && <span className="text-xs text-purple-300 w-full">{demoMsg}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {[
          { l: 'Active tickets', v: kpis.active, i: Ticket, c: 'text-cyan-400' },
          { l: 'SLA breached', v: kpis.breached, i: AlertOctagon, c: 'text-red-400' },
          { l: 'At risk', v: kpis.atRisk, i: Timer, c: 'text-amber-400' },
          { l: 'Pending approvals', v: kpis.approvals, i: CheckCircle2, c: 'text-purple-400' },
          { l: 'Storm-suppressed', v: kpis.suppressed, i: VolumeX, c: 'text-indigo-400' },
          { l: 'Dead letters', v: dlqCount, i: Skull, c: 'text-red-400' },
          { l: 'Delivery success', v: deliveryRate === null ? '—' : `${deliveryRate}%`, i: Radio, c: 'text-emerald-400' },
        ].map(k => (
          <div key={k.l} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
            <k.i className={`w-5 h-5 ${k.c}`} />
            <div className="text-2xl font-bold text-[var(--ic-heading)] mt-2">{k.v}</div>
            <div className="text-[11px] text-[var(--ic-muted)]">{k.l}</div>
          </div>
        ))}
      </div>

      {/* Per-tenant rollup — computed server-side per selected scope */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
            <th className="px-4 py-3">Recent activity</th><th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Source</th><th className="px-4 py-3">Auto-ticket</th><th className="px-4 py-3">When</th>
          </tr></thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--ic-muted)]">No events yet — waiting for real data on <code className="text-cyan-400">POST /api/alerts</code>.</td></tr>
            )}
            {events.map(e => (
              <tr key={e.uid} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="px-4 py-3 text-[var(--ic-heading)] max-w-xs truncate">{e.title}{e.correlated_count > 1 ? <span className="text-sky-400 text-xs ml-2">x{e.correlated_count + 1}</span> : null}</td>
                <td className={`px-4 py-3 uppercase text-xs font-bold ${e.severity === 'critical' ? 'text-red-400' : e.severity === 'high' ? 'text-orange-400' : 'text-yellow-400'}`}>{e.severity}</td>
                <td className="px-4 py-3 text-[var(--ic-muted)]">{e.source}</td>
                <td className="px-4 py-3 font-mono text-cyan-400">{e.ticket_uid ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--ic-muted)] text-xs">{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Deep links into the operational pages */}
      <div className="grid md:grid-cols-2 gap-4">
        <button onClick={() => navigate('/client-admin/advanced-tickets')} className="text-left p-5 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] hover:border-cyan-500/40 transition group">
          <div className="flex items-center justify-between"><Ticket className="w-6 h-6 text-cyan-400" /><ArrowRight className="w-5 h-5 text-[var(--ic-muted)] group-hover:text-cyan-400" /></div>
          <h3 className="text-[var(--ic-heading)] font-semibold mt-3">Open Advanced Ticketing console</h3>
          <p className="text-xs text-[var(--ic-muted)] mt-1">Queue, SLA breach predictions, evidence vault, approvals and workload management.</p>
        </button>
        <button onClick={() => navigate('/client-admin/notifications')} className="text-left p-5 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] hover:border-amber-500/40 transition group">
          <div className="flex items-center justify-between"><Radio className="w-6 h-6 text-amber-400" /><ArrowRight className="w-5 h-5 text-[var(--ic-muted)] group-hover:text-amber-400" /></div>
          <h3 className="text-[var(--ic-heading)] font-semibold mt-3">Open Notification Engine console</h3>
          <p className="text-xs text-[var(--ic-muted)] mt-1">Rule builder, delivery diagnostics, retries, dead-letter queue and analytics.</p>
        </button>
      </div>
    </div>
  );
}
