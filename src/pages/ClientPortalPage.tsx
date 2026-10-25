import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ticketsApi, alertsApi, AdvTicket, AlertRow, ApiError } from '../services/api';
import { Ticket, Bell, Timer, ShieldAlert, GitCompare, Clock, VolumeX, Brain, FileLock2, Radio, RefreshCw, Inbox } from 'lucide-react';

const priBadge: Record<string, string> = {
  p1: 'bg-red-500/20 text-red-400 border-red-500/30',
  p2: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  p3: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  p4: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};
const sevBadge: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-400/30',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  info: 'bg-slate-500/15 text-[var(--ic-muted)] border-slate-500/30',
};

export default function ClientPortalPage() {
  const { user, organization } = useAuth();
  const [tab, setTab] = useState<'tickets' | 'notifications'>('tickets');
  const [tickets, setTickets] = useState<AdvTicket[]>([]);
  const [events, setEvents] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Multi-tenant scoping is enforced SERVER-SIDE: the JWT org claim limits
  // /api/tickets and /api/alerts to this client's tenant. No mock data.
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [t, e] = await Promise.all([ticketsApi.list(), alertsApi.list()]);
      setTickets(t); setEvents(e.slice(0, 15));
    } catch (ex: any) {
      setErr(ex instanceof ApiError ? ex.message : 'Backend unreachable.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--ic-heading)] flex items-center gap-3">
          <FileLock2 className="w-7 h-7 text-cyan-400" />Client Portal
        </h1>
        <p className="text-[var(--ic-muted)] mt-1">Your organization's tickets & notifications — live data from Advanced Ticketing and the Notification Engine.</p>
        <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 rounded-full bg-[var(--ic-surface)] border border-[var(--ic-border)] text-xs text-[var(--ic-text)]">
          Tenant scope: <span className="text-cyan-400 font-semibold">{organization?.name ?? (user as any)?.orgId ?? '—'}</span> · signed in as {user?.name}
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <button onClick={() => setTab('tickets')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === 'tickets' ? 'bg-cyan-500/15 text-cyan-300 border border-[var(--ic-primary)]' : 'bg-[var(--ic-surface)] text-[var(--ic-muted)] border border-[var(--ic-border)]'}`}><Ticket className="w-4 h-4" />My Tickets ({tickets.length})</button>
        <button onClick={() => setTab('notifications')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === 'notifications' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-[var(--ic-surface)] text-[var(--ic-muted)] border border-[var(--ic-border)]'}`}><Bell className="w-4 h-4" />Notifications</button>
        <button onClick={load} title="Refresh" className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {err && <p className="text-sm text-red-400 flex items-center gap-2"><ShieldAlert size={15} />{err}</p>}

      {tab === 'tickets' && (
        !tickets.length && !loading ? (
          <div className="text-center py-16 rounded-xl border border-dashed border-[var(--ic-border)] bg-[var(--ic-surface)]">
            <Inbox className="w-10 h-10 mx-auto text-[var(--ic-muted)]" />
            <p className="text-[var(--ic-muted)] mt-3 font-medium">No tickets yet — waiting for real data</p>
            <p className="text-xs text-[var(--ic-muted)] mt-1">Tickets appear automatically when alerts are ingested (alert → auto-ticket), or when an operator opens one.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {tickets.map(t => (
              <div key={t.uid} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-3 hover:border-[var(--ic-primary)] transition">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-cyan-400">{t.uid}</div>
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] mt-0.5">{t.title}</h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded border text-xs uppercase font-bold flex-shrink-0 ${priBadge[t.priority] ?? priBadge.p4}`}>{t.priority}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-[var(--ic-surface)] text-[var(--ic-text)] capitalize">{t.status.replace(/_/g, ' ')}</span>
                  {t.sla_state && (
                    <span className={`px-2 py-0.5 rounded flex items-center gap-1 ${t.sla_state === 'breached' ? 'bg-red-500/15 text-red-400' : t.sla_state === 'at_risk' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                      <Timer className="w-3 h-3" />{t.sla_state.replace(/_/g, ' ')}
                    </span>
                  )}
                  {t.duplicate_of && <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 flex items-center gap-1"><GitCompare className="w-3 h-3" />linked case</span>}
                  {t.assignee && <span className="px-2 py-0.5 rounded bg-[var(--ic-surface)] text-[var(--ic-muted)] flex items-center gap-1"><Clock className="w-3 h-3" />{t.assignee}</span>}
                  {t.source === 'alert' && <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300">auto-created from alert</span>}
                </div>
                {t.ai_category && (
                  <div className="text-[11px] text-purple-300 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5" />AI triage: {t.ai_category} · confidence {Math.round((t.ai_confidence ?? 0) * 100)}%</div>
                )}
                {t.vulnerability_ref && (
                  <div className="text-[11px] text-red-400 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" />{t.vulnerability_ref}</div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'notifications' && (
        <div className="space-y-3">
          <div className="text-xs text-[var(--ic-muted)] flex items-center gap-2"><Radio className="w-4 h-4 text-amber-400" />Live event feed from the Notification Engine; low-severity events are batched during quiet hours per your rules.</div>
          {!events.length && !loading && <p className="text-sm text-[var(--ic-muted)] py-8 text-center border border-dashed border-[var(--ic-border)] rounded-xl">No events yet — the engine is listening on <code className="text-cyan-400">POST /api/alerts</code>.</p>}
          {events.map(e => (
            <div key={e.uid} className="flex items-center gap-4 p-4 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)]">
              <span className={`px-2 py-1 rounded border text-[10px] uppercase font-bold flex-shrink-0 ${sevBadge[e.severity] ?? sevBadge.info}`}>{e.severity}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[var(--ic-heading)] truncate">{e.storm_suppressed ? <VolumeX className="w-3.5 h-3.5 text-purple-400 inline mr-1" /> : <Bell className="w-3.5 h-3.5 text-amber-400 inline mr-1" />}{e.title}</div>
                <div className="text-[11px] text-[var(--ic-muted)]">{e.source}{e.resource ? ` · ${e.resource}` : ''} · {new Date(e.created_at).toLocaleString()}{e.correlated_count > 1 ? ` · x${e.correlated_count + 1} correlated` : ''}</div>
              </div>
              {e.ticket_uid && <span className="text-[11px] text-cyan-400 font-mono flex-shrink-0">{e.ticket_uid}</span>}
              <span className={`text-[11px] flex items-center gap-1 flex-shrink-0 ${e.acked_by ? 'text-emerald-400' : 'text-[var(--ic-muted)]'}`}>{e.acked_by ? 'acknowledged' : 'open'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
