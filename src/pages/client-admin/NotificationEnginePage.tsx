import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import {
  Radio, RefreshCw, Plus, Trash2, Zap, ShieldAlert, Bell, Mail, MessageSquare,
  Smartphone, Inbox as InAppIcon, GitBranch, CheckCheck, RotateCcw, BarChart3,
  VolumeX, PlayCircle, X, AlertOctagon, Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  alertsApi, ticketsApi, ApiError,
  type AlertRow, type AlertSummary, type NotifRule, type NotificationRow,
  type NotificationRetryResult,
} from '../../services/alertsApi';

// ---------------------------------------------------------------------------
// Constants shared with the backend rule schema
// ---------------------------------------------------------------------------
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SOURCES = ['siem', 'wazuh', 'snmp', 'syslog', 'api', 'nmap', 'manual'];
const CHANNELS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'in_app', label: 'In-App', icon: <InAppIcon size={14} /> },
  { id: 'email', label: 'Email', icon: <Mail size={14} /> },
  { id: 'sms', label: 'SMS', icon: <MessageSquare size={14} /> },
  { id: 'webhook', label: 'Webhook', icon: <Zap size={14} /> },
];
const sevColor: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/40',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  low: 'bg-sky-500/20 text-sky-400 border-sky-500/40',
  info: 'bg-slate-500/20 text-[var(--ic-text)] border-slate-500/40',
};
const notifStatusColor: Record<string, string> = {
  sent: 'text-emerald-400', delivered: 'text-emerald-400', pending: 'text-amber-400',
  queued: 'text-amber-400', retrying: 'text-orange-400', failed: 'text-red-400',
  dead_letter: 'text-red-500', suppressed: 'text-[var(--ic-muted)]', quiet_hold: 'text-purple-400', acked: 'text-cyan-400',
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};
const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border border-transparent ${className}`}>{children}</span>
);

// ---------------------------------------------------------------------------
// Visual rule builder — persists to POST/PATCH /api/notification-rules
// ---------------------------------------------------------------------------

const emptyRule: NotifRule = {
  name: '', enabled: true, conditions: { severity: [], source: [], contains: '', min_severity: '' },
  channels: ['in_app'], recipients: [], create_ticket: true, ticket_priority: 'p2',
  escalate_after_minutes: 30, quiet_hours: null,
};

const RuleEditor: React.FC<{
  rule: NotifRule; tenants: { id: number; name: string }[]; isPlatform: boolean;
  onSave: (r: NotifRule) => Promise<void>; onClose: () => void;
}> = ({ rule: initial, tenants, isPlatform, onSave, onClose }) => {
  const [r, setR] = useState<NotifRule>({ ...emptyRule, ...initial, conditions: { ...emptyRule.conditions, ...(initial.conditions || {}) } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cond = r.conditions || {};
  const setCond = (patchObj: Record<string, any>) => setR({ ...r, conditions: { ...cond, ...patchObj } });
  const toggleIn = (key: 'severity' | 'source', v: string) => {
    const arr: string[] = cond[key] || [];
    setCond({ [key]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] });
  };
  const toggleCh = (v: string) => {
    const arr = r.channels || [];
    setR({ ...r, channels: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] });
  };

  const inp = 'w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] focus:border-cyan-500 outline-none';
  const lbl = 'block text-xs font-semibold text-[var(--ic-muted)] mb-1 uppercase tracking-wide';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSave(r); onClose(); }
    catch (ex: any) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Zap className="text-cyan-400" size={20} /> {initial.id ? 'Edit' : 'New'} Notification Rule</h2>
          <button type="button" onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={20} /></button>
        </div>
        <div>
          <label className={lbl}>Rule name *</label>
          <input className={inp} required value={r.name} onChange={e => setR({ ...r, name: e.target.value })} placeholder="e.g. Critical firewall events → SMS + auto-ticket P1" />
        </div>
        {isPlatform && (
          <div>
            <label className={lbl}>Scope</label>
            <select className={inp} value={r.org_id ?? ''} onChange={e => setR({ ...r, org_id: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Global (all tenants)</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <div className="bg-[var(--ic-surface)] rounded-lg p-4 space-y-3">
          <p className={lbl}>When an event matches (IF)</p>
          <div>
            <p className="text-xs text-[var(--ic-muted)] mb-1">Severity</p>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map(s => (
                <button type="button" key={s} onClick={() => toggleIn('severity', s)}
                  className={`px-2.5 py-1 rounded-full text-xs capitalize ${(cond.severity || []).includes(s) ? 'bg-cyan-600 text-[var(--ic-heading)]' : 'bg-[var(--ic-surface-2)] text-[var(--ic-text)]'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-[var(--ic-muted)] mb-1">Source</p>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map(s => (
                <button type="button" key={s} onClick={() => toggleIn('source', s)}
                  className={`px-2.5 py-1 rounded-full text-xs ${(cond.source || []).includes(s) ? 'bg-cyan-600 text-[var(--ic-heading)]' : 'bg-[var(--ic-surface-2)] text-[var(--ic-text)]'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[var(--ic-muted)]">Title contains</label>
              <input className={inp} value={cond.contains || ''} onChange={e => setCond({ contains: e.target.value })} placeholder="ransomware" /></div>
            <div><label className="text-xs text-[var(--ic-muted)]">Min severity</label>
              <select className={inp} value={cond.min_severity || ''} onChange={e => setCond({ min_severity: e.target.value })}>
                <option value="">Any</option>{SEVERITIES.slice().reverse().map(s => <option key={s} value={s}>{s}+</option>)}
              </select></div>
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-lg p-4 space-y-3">
          <p className={lbl}>Then (DO)</p>
          <div>
            <p className="text-xs text-[var(--ic-muted)] mb-1">Notify via channels</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(c => (
                <button type="button" key={c.id} onClick={() => toggleCh(c.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${(r.channels || []).includes(c.id) ? 'bg-cyan-600 text-[var(--ic-heading)]' : 'bg-[var(--ic-surface-2)] text-[var(--ic-text)]'}`}>
                  {c.icon}{c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--ic-muted)]">Recipients (comma separated emails / phone numbers / webhook URLs)</label>
            <input className={inp} value={(r.recipients || []).join(', ')}
              onChange={e => setR({ ...r, recipients: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
              placeholder="soc@client.com, +15551234567" />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-[var(--ic-heading)]">
              <input type="checkbox" checked={!!r.create_ticket} onChange={e => setR({ ...r, create_ticket: e.target.checked })} className="accent-cyan-500" />
              <GitBranch size={15} className="text-purple-400" /> Auto-create ticket from alert
            </label>
            {r.create_ticket && (
              <select className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm text-[var(--ic-heading)]" value={r.ticket_priority}
                onChange={e => setR({ ...r, ticket_priority: e.target.value })}>
                {['p1', 'p2', 'p3', 'p4'].map(p => <option key={p} value={p}>Ticket {p.toUpperCase()}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[var(--ic-muted)]">Escalate after (minutes, 0 = never)</label>
              <input type="number" min={0} className={inp} value={r.escalate_after_minutes}
                onChange={e => setR({ ...r, escalate_after_minutes: Number(e.target.value) })} /></div>
            <div><label className="text-xs text-[var(--ic-muted)]">Quiet hours (HH:MM-HH:MM, blank = off)</label>
              <input className={inp} placeholder="22:00-07:00" value={r.quiet_hours?.range || ''}
                onChange={e => setR({ ...r, quiet_hours: e.target.value.trim() ? { range: e.target.value.trim() } : null })} /></div>
          </div>
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-text)] bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)]">Cancel</button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-[var(--ic-heading)]">
            {busy ? 'Saving…' : 'Save Rule'}</button>
        </div>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Test-event modal — posts a REAL alert through the production pipeline
// ---------------------------------------------------------------------------

const SimulateAlertModal: React.FC<{ onClose: () => void; onDone: () => void; isPlatform: boolean; tenants: { id: number; name: string }[] }>
  = ({ onClose, onDone, isPlatform, tenants }) => {
  const [title, setTitle] = useState('Unauthorized SSH login brute-force detected');
  const [severity, setSeverity] = useState('high');
  const [source, setSource] = useState('wazuh');
  const [resource, setResource] = useState('FW-EDGE-01');
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [err, setErr] = useState('');

  const send = async () => {
    setBusy(true); setErr(''); setResult('');
    try {
      const res = await alertsApi.ingest({
        title, severity, source, resource,
        description: `Simulated event for demo purposes. Resource: ${resource}`,
        org_id: isPlatform && orgId ? Number(orgId) : undefined,
        raw_payload: { simulated: true },
      });
      setResult(res.pipeline?.ticket_uid
        ? `✓ Alert ingested → rule matched → ticket ${res.pipeline.ticket_uid} auto-created · ${res.pipeline.notifications?.length ?? 0} notification(s) dispatched`
        : `✓ Alert ingested · correlated ×${res.alert.correlated_count}${res.alert.storm_suppressed ? ' · storm-suppressed' : ''} · ${res.pipeline?.notifications?.length ?? 0} notification(s) dispatched`);
      setTimeout(() => { onDone(); onClose(); }, 1500);
    } catch (ex: any) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  const inp = 'w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] outline-none focus:border-cyan-500';
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><PlayCircle className="text-purple-400" size={20} /> Send Test Event</h2>
        <p className="text-xs text-[var(--ic-muted)]">This posts a real payload to <code className="text-cyan-400">POST /api/alerts</code> and runs it through the full production pipeline: correlation → storm protection → routing → auto-ticketing.</p>
        <input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Alert title" />
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={severity} onChange={e => setSeverity(e.target.value)}>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={inp} value={source} onChange={e => setSource(e.target.value)}>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input className={inp} value={resource} onChange={e => setResource(e.target.value)} placeholder="Resource / asset" />
        {isPlatform && (
          <select className={inp} value={orgId} onChange={e => setOrgId(e.target.value)}>
            <option value="">Tenant…</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {err && <p className="text-red-400 text-sm">{err}</p>}
        {result && <p className="text-emerald-400 text-sm">{result}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-text)] bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)]">Close</button>
          <button onClick={send} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-[var(--ic-heading)]">
            {busy ? 'Ingesting…' : 'Send Through Pipeline'}</button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
// §6E — Notification volume over time. Buckets are computed client-side ONLY
// from the persisted NotificationRow.created_at values returned by
// GET /api/notifications (hourly buckets for ranges ≤48h, daily otherwise).
// Stacked bars = per-channel counts (sum == bucket total); the line = failed
// rows (dead_letter/failed/retrying), so totals and failures stay readable
// together. Empty buckets are drawn as real zeros of the window, never
// back-filled with synthetic data.
// ---------------------------------------------------------------------------
const NOTIF_CHANNEL_COLORS: Record<string, string> = {
  email: '#22d3ee', sms: '#a855f7', webhook: '#f97316', in_app: '#34d399', push: '#eab308', console: '#64748b',
};
const NOTIF_FAIL_STATUSES = ['dead_letter', 'failed', 'retrying'];

const VolumeOverTimeChart: React.FC<{ notifs: NotificationRow[] }> = ({ notifs }) => {
  const [rangeH, setRangeH] = useState<24 | 48 | 168 | 720>(720); // hours
  const bucketMs = rangeH <= 48 ? 3_600_000 : 86_400_000;         // hourly vs daily

  const { rows, channels, total } = useMemo(() => {
    const now = Date.now();
    const start = now - rangeH * 3_600_000;
    const nb = Math.max(1, Math.ceil((now - start) / bucketMs));
    const idxOf = (t: number) => Math.floor((t - start) / bucketMs);
    const chans = new Set<string>();
    const buckets: { label: string; failed: number; total: number; byCh: Record<string, number> }[] =
      Array.from({ length: nb }, (_, i) => {
        const d = new Date(start + i * bucketMs);
        const label = bucketMs === 3_600_000
          ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return { label, failed: 0, total: 0, byCh: {} };
      });
    let counted = 0;
    notifs.forEach(n => {
      const t = Date.parse(n.created_at);
      if (Number.isNaN(t) || t < start) return;
      const i = idxOf(t);
      if (i < 0 || i >= nb) return;
      counted++;
      chans.add(n.channel);
      const b = buckets[i];
      b.total += 1;
      b.byCh[n.channel] = (b.byCh[n.channel] ?? 0) + 1;
      if (NOTIF_FAIL_STATUSES.includes(n.status)) b.failed += 1;
    });
    const rows = buckets.map(b => ({ ...b, ...(bucketMs === 3_600_000 ? {} : {}) , ...b.byCh, byCh: undefined } as any));
    void counted;
    return { rows, channels: [...chans], total: counted };
  }, [notifs, rangeH]);

  return (
    <div className="bg-[var(--ic-surface-2)] rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--ic-heading)]"><BarChart3 size={16} className="text-cyan-400" />Notification volume over time</h3>
        <div className="flex items-center gap-1.5">
          {([[24, '24 h'], [48, '48 h'], [168, '7 days'], [720, '30 days']] as const).map(([h, lbl]) => (
            <button key={h} onClick={() => setRangeH(h)} aria-pressed={rangeH === h}
              className={`px-2 py-0.5 rounded-md text-[11px] border ${rangeH === h ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-text)]'}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-[var(--ic-muted)] mb-3">
        {total} notification{total === 1 ? '' : 's'} in window · stacked bars = channel breakdown (sum equals the bucket total) · line = failed/dead-letter rows.
        Bucketed from persisted created_at timestamps ({bucketMs === 3_600_000 ? 'hourly' : 'daily'} UTC buckets).
      </p>
      {total === 0 ? (
        <p className="text-xs text-[var(--ic-muted)] py-10 text-center">No notifications recorded in this window — the chart shows the true empty state instead of sample data.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="label" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis stroke="#475569" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: any, name: any) => [v, String(name)]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {channels.map(ch => (
              <Bar key={ch} dataKey={ch} stackId="vol" fill={NOTIF_CHANNEL_COLORS[ch] ?? '#64748b'} name={`${ch}`} radius={[0, 0, 0, 0]} />
            ))}
            <Line type="monotone" dataKey="failed" name="failed / DLQ" stroke="#ef4444" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

const NotificationEnginePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isPlatform = user?.role === 'platform_admin';
  const [tab, setTab] = useState<'events' | 'rules' | 'delivery' | 'analytics'>('events');
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [rules, setRules] = useState<NotifRule[]>([]);
  const [notifs, setNotifs] = useState<NotificationRow[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, any>>({});
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<NotifRule | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryResult, setRetryResult] = useState<NotificationRetryResult | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      // Phase 5: paged inventory + server-side summary instead of client-derived KPIs.
      const [pg, sm, rl, n] = await Promise.all([
        alertsApi.page({ page_size: 100, sort: 'created_at', order: 'desc' }),
        alertsApi.summary({}),
        alertsApi.rules(),
        alertsApi.notifications(),
      ]);
      setAlerts(pg.items); setSummary(sm); setRules(rl); setNotifs(n);
      alertsApi.analytics().then(setAnalytics).catch(() => {});
      if (isPlatform) {
        ticketsApi.tenants().then(setTenants).catch(() => {});
      }
    } catch (ex: any) {
      setError(ex instanceof ApiError ? ex.message : 'Backend unreachable — is the API container running?');
    } finally { setLoading(false); }
  }, [isPlatform]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(true), 8000);   // live "waiting for data" feed
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const saveRule = async (r: NotifRule) => {
    if (r.id) await alertsApi.updateRule(r.id, r);
    else await alertsApi.createRule({ ...r, org_id: isPlatform ? r.org_id ?? null : null });
    await load(true);
  };

  const stats = useMemo(() => ({
    // KPIs from GET /alerts/summary — totals over the FULL tenant set, honest across pages.
    events: summary?.total ?? 0,
    unacked: (summary?.by_severity ? Object.values(summary.by_severity).reduce((s2, v) => s2 + v, 0) - (summary?.by_status?.acked ?? 0) - (summary?.by_status?.resolved ?? 0) : 0),
    suppressed: alerts.filter(a => a.storm_suppressed).length,   // page-scoped fallback (no server counter exists yet)
    autoTickets: alerts.filter(a => a.ticket_uid).length,        // page-scoped fallback (no server counter exists yet)
    dlq: notifs.filter(n => n.status === 'dead_letter' || n.status === 'failed').length,
    sent: notifs.filter(n => ['sent', 'delivered', 'acked'].includes(n.status)).length,
  }), [alerts, notifs, summary]);

  const retryOne = async (id: number) => {
    setRetryingId(id); setRetryResult(null); setError('');
    try {
      const res = await alertsApi.retryNotification(id);
      setRetryResult(res);           // backend-confirmed outcome only — never assume success
      await load(true);
    } catch (ex: any) {
      setError(ex instanceof ApiError ? `Retry rejected: ${ex.message}` : 'Retry failed — backend unreachable.');
    } finally { setRetryingId(null); }
  };

  const chIcon = (c: string) => c === 'email' ? <Mail size={13} /> : c === 'sms' ? <Smartphone size={13} /> : c === 'webhook' ? <Zap size={13} /> : <InAppIcon size={13} />;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Radio className="text-cyan-400" /> Notification & Event Intelligence</h1>
          <p className="text-sm text-[var(--ic-muted)]">Live event pipeline: ingestion → correlation → routing → delivery diagnostics. Every alert that matches a rule creates a ticket automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[var(--ic-muted)]">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-cyan-500" /> Live feed
          </label>
          <button onClick={() => load()} className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={() => setShowSim(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-[var(--ic-heading)] text-sm font-semibold"><PlayCircle size={16} /> Send Test Event</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi label="Events" value={stats.events} color="text-cyan-400" />
        <Kpi label="Unacked" value={stats.unacked} color="text-amber-400" />
        <Kpi label="Storm-Suppressed" value={stats.suppressed} color="text-[var(--ic-muted)]" />
        <Kpi label="Auto-Tickets" value={stats.autoTickets} color="text-purple-400" />
        <Kpi label="Delivered" value={stats.sent} color="text-emerald-400" />
        <Kpi label="Dead Letters" value={stats.dlq} color="text-red-400" />
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2"><ShieldAlert size={16} />{error}</div>}

      <div className="flex gap-1 border-b border-[var(--ic-border)]">
        {(['events', 'rules', 'delivery', 'analytics'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize ${tab === t ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
            {t === 'delivery' ? 'Delivery Diagnostics' : t === 'analytics' ? 'Analytics' : t}
          </button>
        ))}
      </div>

      {/* EVENTS FEED */}
      {tab === 'events' && (
        <div className="bg-[var(--ic-surface)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
              <th className="px-4 py-3">UID</th><th className="px-4 py-3">Title</th><th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Source</th><th className="px-4 py-3">Resource</th><th className="px-4 py-3">Correlation</th>
              <th className="px-4 py-3">Ticket</th><th className="px-4 py-3">Age</th><th className="px-4 py-3" /></tr></thead>
            <tbody>
              {alerts.length === 0 && !loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center">
                  <Bell className="mx-auto text-[var(--ic-muted)] mb-2" size={28} />
                  <p className="text-[var(--ic-muted)] mb-1">Listening for events — nothing has arrived yet.</p>
                  <p className="text-xs text-[var(--ic-muted)] mb-4">Real integrations (Wazuh, SNMP traps, syslog, SIEM webhooks) POST to <code className="text-cyan-400">/api/alerts</code>. Click “Send Test Event” to see exactly how live data will look and behave.</p>
                  <button onClick={() => setShowSim(true)} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-[var(--ic-heading)] text-sm font-semibold inline-flex items-center gap-2"><PlayCircle size={14} /> Send Test Event</button>
                </td></tr>
              )}
              {alerts.map(a => (
                <tr key={a.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ic-muted)]">{a.uid}</td>
                  <td className="px-4 py-3 text-[var(--ic-heading)]">
                    {a.title}
                    {a.storm_suppressed && <Badge className="ml-2 bg-slate-600/40 text-[var(--ic-text)]"><VolumeX size={10} className="inline mr-0.5" />storm guard</Badge>}
                  </td>
                  <td className="px-4 py-3"><Badge className={sevColor[a.severity]}>{a.severity}</Badge></td>
                  <td className="px-4 py-3 text-[var(--ic-muted)]">{a.source}</td>
                  <td className="px-4 py-3 text-[var(--ic-muted)]">{a.resource || '—'}</td>
                  <td className="px-4 py-3 text-[var(--ic-muted)]">{a.correlated_count > 1 ? `×${a.correlated_count} dup` : 'unique'}</td>
                  <td className="px-4 py-3">{a.ticket_uid
                    ? <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30"><GitBranch size={11} className="inline mr-1" />{a.ticket_uid}</Badge>
                    : <span className="text-[var(--ic-muted)]">—</span>}</td>
                  <td className="px-4 py-3 text-[var(--ic-muted)]">{ago(a.created_at)}</td>
                  <td className="px-4 py-3">
                    {!a.acked_by
                      ? <button onClick={() => alertsApi.ack(a.id).then(() => load(true))} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]"><CheckCheck size={13} /> Ack</button>
                      : <span className="text-xs text-emerald-400">✓ {a.acked_by}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RULES */}
      {tab === 'rules' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setEditing({ ...emptyRule })} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold"><Plus size={16} /> New Rule</button>
          </div>
          {rules.length === 0 && <p className="text-sm text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded-xl p-6 text-center">No routing rules yet. Rules decide which events notify whom — and which automatically open a ticket.</p>}
          {rules.map(r => {
            const c = r.conditions || {};
            return (
              <div key={r.id} className="bg-[var(--ic-surface-2)] rounded-xl p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-64">
                  <p className="text-[var(--ic-heading)] font-semibold text-sm">{r.name} {!r.enabled && <Badge className="bg-slate-600/40 text-[var(--ic-muted)]">disabled</Badge>}
                    {r.org_id == null && isPlatform && <Badge className="ml-2 bg-cyan-500/20 text-cyan-300">global</Badge>}</p>
                  <p className="text-xs text-[var(--ic-muted)] mt-1">
                    IF [{(c.severity || []).join(',') || 'any sev'}] · src[{(c.source || []).join(',') || 'any'}]{c.contains ? ` · contains "${c.contains}"` : ''}{c.min_severity ? ` · ≥${c.min_severity}` : ''}
                  </p>
                  <p className="text-xs text-[var(--ic-muted)]">THEN {(r.channels || []).map(ch => <span key={ch} className="inline-flex items-center gap-1 mr-2">{chIcon(ch)}{ch}</span>)}
                    {r.create_ticket && <span className="text-purple-300">· auto-ticket {(r.ticket_priority || '').toUpperCase()}</span>}
                    {r.escalate_after_minutes > 0 && <span className="text-amber-300"> · escalate after {r.escalate_after_minutes}m</span>}
                    {r.quiet_hours?.range && <span className="text-[var(--ic-muted)]"> · quiet {r.quiet_hours.range}</span>}
                  </p>
                  {(r.recipients || []).length > 0 && <p className="text-[11px] text-[var(--ic-muted)] mt-1">→ {(r.recipients || []).join(', ')}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => alertsApi.updateRule(r.id!, { enabled: !r.enabled }).then(() => load(true))}
                    className={`px-3 py-1.5 rounded text-xs font-semibold ${r.enabled ? 'bg-emerald-600/30 text-emerald-300' : 'bg-[var(--ic-surface-2)] text-[var(--ic-muted)]'}`}>{r.enabled ? 'ON' : 'OFF'}</button>
                  <button onClick={() => setEditing(r)} className="px-3 py-1.5 rounded text-xs bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)]">Edit</button>
                  <button onClick={() => alertsApi.deleteRule(r.id!).then(() => load(true))} className="p-1.5 rounded text-xs bg-red-600/30 hover:bg-red-600/50 text-red-300"><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DELIVERY DIAGNOSTICS */}
      {tab === 'delivery' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {retryResult && (
              <p className={`text-xs ${retryResult.status === 'sent' ? 'text-emerald-400' : retryResult.status === 'queued' || retryResult.status === 'retrying' ? 'text-amber-300' : 'text-red-400'}`}>
                Notification #{retryResult.id}: backend reports <b>{retryResult.status}</b> after attempt {retryResult.attempts}
                {retryResult.sent_at ? ` · delivered at ${fmt(retryResult.sent_at)}` : ''}
                {retryResult.last_error ? ` · last error: ${retryResult.last_error}` : ''}
              </p>
            )}
            {!retryResult && <span />}
            <div className="flex gap-2">
              {isPlatform && (
                <button onClick={() => alertsApi.retryDeadLetters().then((res: any) => { setError(`Backend requeued ${res?.retried ?? res?.requeued ?? 0} dead letter(s) — each still needs a confirmed delivery to count as sent.`); load(true); }).catch(e => setError(e instanceof ApiError ? e.message : e.message))}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-600/80 hover:bg-orange-500 text-[var(--ic-heading)] text-xs font-semibold"><RotateCcw size={14} /> Retry All Dead Letters (platform)</button>
              )}
            </div>
          </div>
          {!isPlatform && <p className="text-[11px] text-[var(--ic-muted)]">Bulk DLQ flush is platform-admin only. Tenant admins can retry individual dead letters below.</p>}
          <div className="bg-[var(--ic-surface)] rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                <th className="px-4 py-3">Alert</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Severity</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Last Error</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Actions</th></tr></thead>
              <tbody>
                {notifs.length === 0 && !loading && <tr><td colSpan={10} className="px-4 py-8 text-center text-[var(--ic-muted)]">No notifications dispatched yet — they appear here the moment real events flow in.</td></tr>}
                {notifs.map(n => (
                  <tr key={n.id} className="border-b border-[var(--ic-border)]">
                    <td className="px-4 py-3 text-xs">{n.alert_uid
                      ? <button onClick={() => navigate(`/client-admin/alerts/${n.alert_id ?? n.alert_uid}`)} className="font-mono text-cyan-400 hover:underline">{n.alert_uid}</button>
                      : <span className="text-[var(--ic-muted)]">—</span>}</td>
                    <td className="px-4 py-3 text-[var(--ic-text)]">{chIcon(n.channel)} {n.channel.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-[var(--ic-muted)] font-mono text-xs">{n.recipient}</td>
                    <td className="px-4 py-3 text-[var(--ic-heading)] max-w-64 truncate">{n.subject}</td>
                    <td className="px-4 py-3"><Badge className={sevColor[n.severity]}>{n.severity}</Badge></td>
                    <td className={`px-4 py-3 text-xs font-semibold uppercase ${notifStatusColor[n.status] || 'text-[var(--ic-muted)]'}`}>{n.status}</td>
                    <td className="px-4 py-3 text-[var(--ic-muted)]">{n.attempts}</td>
                    <td className="px-4 py-3 text-red-400 text-xs max-w-40 truncate">{n.last_error || '—'}</td>
                    <td className="px-4 py-3 text-[var(--ic-muted)] text-xs">{fmt(n.sent_at)}</td>
                    <td className="px-4 py-3 text-xs space-x-2 whitespace-nowrap">
                      {n.status === 'dead_letter' && (
                        <button disabled={retryingId === n.id} onClick={() => retryOne(n.id)}
                          className="inline-flex items-center gap-1 text-orange-300 hover:underline disabled:opacity-50">
                          {retryingId === n.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Retry
                        </button>
                      )}
                      {n.acked_by ? <span className="text-emerald-400">✓ {n.acked_by}</span>
                        : ['sent', 'delivered'].includes(n.status)
                          ? <button onClick={() => alertsApi.ackNotification(n.id).then(() => load(true))} className="text-cyan-400 hover:underline">Ack</button>
                          : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ANALYTICS */}
      {tab === 'analytics' && (
        <div className="space-y-4">
          {/* §6E — volume-over-time chart over the persisted notification rows */}
          <VolumeOverTimeChart notifs={notifs} />
          <div className="grid md:grid-cols-3 gap-4">
          <Panel title="By Severity" icon={<BarChart3 size={16} className="text-cyan-400" />}>
            {Object.entries(analytics.by_severity || {}).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
            {!Object.keys(analytics.by_severity || {}).length && <Empty />}
          </Panel>
          <Panel title="By Channel" icon={<Bell size={16} className="text-purple-400" />}>
            {Object.entries(analytics.by_channel || {}).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
            {!Object.keys(analytics.by_channel || {}).length && <Empty />}
          </Panel>
          <Panel title="Pipeline Health" icon={<AlertOctagon size={16} className="text-orange-400" />}>
            <Row k="Delivered" v={String(analytics.delivered ?? 0)} />
            <Row k="Failed / DLQ" v={String((analytics.failed ?? 0) + (analytics.dead_letters ?? 0))} />
            <Row k="Suppressed (storms)" v={String(analytics.suppressed ?? 0)} />
            <Row k="Acknowledged" v={String(analytics.acked ?? 0)} />
          </Panel>
          </div>
        </div>
      )}

      {editing && <RuleEditor rule={editing} tenants={tenants} isPlatform={isPlatform} onClose={() => setEditing(null)} onSave={saveRule} />}
      {showSim && <SimulateAlertModal isPlatform={isPlatform} tenants={tenants} onClose={() => setShowSim(false)} onDone={() => load(true)} />}
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="bg-[var(--ic-surface-2)] rounded-xl p-4"><p className={`text-2xl font-bold ${color}`}>{value}</p><p className="text-xs text-[var(--ic-muted)]">{label}</p></div>
);
const Panel: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="bg-[var(--ic-surface-2)] rounded-xl p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[var(--ic-heading)] mb-3">{icon}{title}</h3>{children}</div>
);
const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex justify-between text-sm py-1 border-b border-[var(--ic-border)] last:border-0"><span className="text-[var(--ic-muted)] capitalize">{k}</span><span className="text-[var(--ic-heading)] font-semibold">{v}</span></div>
);
const Empty = () => <p className="text-xs text-[var(--ic-muted)]">Awaiting data…</p>;

export default NotificationEnginePage;
