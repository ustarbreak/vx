import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, CheckCircle, Bell, Search, Eye, Clock, Server, Shield,
  RefreshCw, X, ChevronLeft, ChevronRight, ArrowUpDown, Inbox, Users,
  FileText, History, Send, Loader2, ShieldAlert, Ticket,
} from 'lucide-react';
import {
  alertsApi, ApiError,
  type AlertPage as AlertPageData, type AlertSummary,
  type AlertDetail, type AlertEventRow,
} from '../../services/alertsApi';

// ---------------------------------------------------------------------------
// Constants — statuses mirror the backend lifecycle (active | acked | resolved)
// ---------------------------------------------------------------------------
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const STATUSES = ['active', 'acked', 'resolved'] as const;
const SOURCES = ['siem', 'wazuh', 'snmp', 'syslog', 'api', 'nmap', 'manual'];

const sevBadge: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};
const statusBadge: Record<string, string> = {
  active: 'bg-red-500/15 text-red-300 border-red-500/30',
  acked: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${className}`}>{children}</span>
);

type SortKey = 'created_at' | 'severity' | 'status' | 'title' | 'source';

export default function AlertsPage() {
  const navigate = useNavigate();
  const { alertId } = useParams<{ alertId?: string }>();

  // ---- filters (server-side) ------------------------------------------------
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');                       // debounced
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // ---- data -----------------------------------------------------------------
  const [data, setData] = useState<AlertPageData | null>(null);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // ---- selection / bulk -----------------------------------------------------
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [assignTo, setAssignTo] = useState('');

  // ---- detail drawer ----------------------------------------------------------
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Debounce search → server-side q param
  const debounceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { setQ(searchInput.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(debounceRef.current);
  }, [searchInput]);

  const params = useMemo(() => ({
    q: q || undefined,
    severity: severity === 'all' ? undefined : severity,
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
    assignee: assigneeFilter === 'all' ? undefined : assigneeFilter,
    sort, order, page, page_size: pageSize,
  }), [q, severity, status, source, assigneeFilter, sort, order, page]);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const summaryParams = { ...params }; delete (summaryParams as any).page; delete (summaryParams as any).page_size; delete (summaryParams as any).sort; delete (summaryParams as any).order;
      const [pg, sm] = await Promise.all([alertsApi.page(params), alertsApi.summary(summaryParams)]);
      setData(pg); setSummary(sm);
    } catch (ex: any) {
      setError(ex instanceof ApiError
        ? (ex.status === 0 ? 'Backend unreachable — is the API running?' : ex.message)
        : 'Failed to load alerts.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [params]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [load]);

  // ---- detail ---------------------------------------------------------------
  async function openDetail(id: number) {
    setDetailLoading(true); setDetailErr(''); setNoteBody('');
    try {
      const d = await alertsApi.detail(id);
      setDetail(d);
    } catch (ex: any) {
      setDetailErr(ex instanceof ApiError ? ex.message : 'Failed to load alert detail.');
    } finally { setDetailLoading(false); }
  }

  // ---- route param compatibility (/client-admin/alerts/:alertId) ------------
  // Numeric ids open the detail view; severity/status values map to filters.
  // "acked" and legacy "acknowledged" both map to the backend status "acked".
  useEffect(() => {
    if (!alertId) return;
    if (alertId === 'all') {
      setSeverity('all'); setStatus('all'); setSearchInput('');
    } else if ((SEVERITIES as readonly string[]).includes(alertId)) {
      setSeverity(alertId); setStatus('all'); setPage(1);
    } else if (alertId === 'active' || alertId === 'resolved') {
      setStatus(alertId); setSeverity('all'); setPage(1);
    } else if (alertId === 'acked' || alertId === 'acknowledged') {
      setStatus('acked'); setSeverity('all'); setPage(1);
    } else if (/^\d+$/.test(alertId)) {
      void openDetail(Number(alertId));
    } else {
      setSearchInput(alertId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId]);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const closeDetail = () => { setDetail(null); if (alertId) navigate('/client-admin/alerts'); };

  const reloadDetailAndList = async () => {
    if (detail) { try { setDetail(await alertsApi.detail(detail.id)); } catch { /* keep stale view */ } }
    await load(true);
  };

  /** PATCH with optimistic concurrency; on 409 reload + surface honest message. */
  const patchAlert = async (patch: Record<string, any>) => {
    if (!detail) return;
    setActionBusy(true); setDetailErr('');
    try {
      await alertsApi.update(detail.id, { ...patch, expected_version: detail.version });
      await reloadDetailAndList();
    } catch (ex: any) {
      if (ex instanceof ApiError && ex.status === 409) {
        setDetailErr('This alert was modified by someone else. The latest state has been reloaded — review it and retry your action.');
        await reloadDetailAndList();
      } else {
        setDetailErr(ex?.message ?? 'Update failed.');
      }
    } finally { setActionBusy(false); }
  };

  const addNote = async () => {
    if (!detail || !noteBody.trim()) return;
    setActionBusy(true);
    try { await alertsApi.addNote(detail.id, noteBody.trim()); setNoteBody(''); await reloadDetailAndList(); }
    catch (ex: any) { setDetailErr(ex?.message ?? 'Could not save note.'); }
    finally { setActionBusy(false); }
  };

  // ---- bulk actions ---------------------------------------------------------
  const toggleAll = () => {
    setSelected(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  };
  const toggleOne = (id: number) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const runBulk = async (action: 'ack' | 'resolve' | 'reopen' | 'assign') => {
    if (!selected.size) return;
    setBulkBusy(true); setBulkMsg('');
    try {
      const res = await alertsApi.bulk(Array.from(selected), action, action === 'assign' ? (assignTo || undefined) : undefined);
      const failed = res.results.filter(r => !r.ok);
      setBulkMsg(`${res.applied} alert(s) ${action === 'assign' ? 'assigned' : action === 'ack' ? 'acknowledged' : action + 'd'}.`
        + (failed.length ? ` ${failed.length} skipped: ${failed[0].reason}${failed.length > 1 ? ' (+more)' : ''}` : ''));
      setSelected(new Set()); setAssignTo('');
      await load(true);
    } catch (ex: any) {
      setBulkMsg(ex?.message ?? 'Bulk action failed.');
    } finally { setBulkBusy(false); }
  };

  // ---- render ---------------------------------------------------------------
  const stats = summary;
  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <Bell className="text-cyan-400" /> Security Alerts
          </h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">
            Persisted alert inventory from the detection pipeline — search, triage, assignment and lifecycle are all server-backed.
          </p>
        </div>
        <button onClick={() => load(true)} title="Refresh"
          className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] border border-[var(--ic-border)]">
          <RefreshCw size={16} className={(loading || refreshing) ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPI cards — driven by /alerts/summary (totals across the FULL filtered set, honest across pages) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Critical', value: stats?.by_severity?.critical ?? 0, grad: 'from-red-500 to-red-600', icon: AlertTriangle, link: '/client-admin/alerts/critical' },
          { label: 'High', value: stats?.by_severity?.high ?? 0, grad: 'from-orange-500 to-orange-600', icon: Bell, link: '/client-admin/alerts/high' },
          { label: 'Active', value: stats?.by_status?.active ?? 0, grad: 'from-yellow-500 to-yellow-600', icon: Clock, link: '/client-admin/alerts/active' },
          { label: 'Total (filtered)', value: stats?.total ?? 0, grad: 'from-blue-500 to-blue-600', icon: Shield, link: '/client-admin/alerts/all' },
        ].map(c => (
          <div key={c.label} onClick={() => navigate(c.link)}
            className={`bg-gradient-to-br ${c.grad} rounded-xl p-5 text-white cursor-pointer hover:scale-[1.02] transition-transform`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm">{c.label}</p>
                <p className="text-3xl font-bold mt-2">{loading ? '…' : c.value}</p>
              </div>
              <c.icon className="w-10 h-10 text-white/40" />
            </div>
          </div>
        ))}
      </div>
      {stats && (
        <p className="text-xs text-[var(--ic-muted)]">
          Acked: {stats.by_status?.acked ?? 0} · Resolved: {stats.by_status?.resolved ?? 0} · Unassigned active: {stats.unassigned_active}
          {' '}· Scope: current tenant · times shown in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
        </p>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
          <ShieldAlert size={16} /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-4 border border-[var(--ic-border)] flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search title, description, resource or UID…"
            className="w-full bg-[var(--ic-bg)] text-[var(--ic-heading)] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-[var(--ic-border)]" />
        </div>
        <select value={severity} onChange={e => { setSeverity(e.target.value); setPage(1); }}
          className="bg-[var(--ic-bg)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)]">
          <option value="all">All Severities</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="bg-[var(--ic-bg)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)]">
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={source} onChange={e => { setSource(e.target.value); setPage(1); }}
          className="bg-[var(--ic-bg)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)]">
          <option value="all">All Sources</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={assigneeFilter} onChange={e => { setAssigneeFilter(e.target.value); setPage(1); }}
          className="bg-[var(--ic-bg)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)]">
          <option value="all">Any Assignee</option>
          <option value="__unassigned__">Unassigned</option>
        </select>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="bg-cyan-500/10 border border-cyan-500/40 rounded-lg p-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-cyan-300 font-semibold">{selected.size} selected</span>
          <button disabled={bulkBusy} onClick={() => runBulk('ack')} className="px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 disabled:opacity-50">Acknowledge</button>
          <button disabled={bulkBusy} onClick={() => runBulk('resolve')} className="px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 disabled:opacity-50">Resolve</button>
          <button disabled={bulkBusy} onClick={() => runBulk('reopen')} className="px-3 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 disabled:opacity-50">Reopen</button>
          <input value={assignTo} onChange={e => setAssignTo(e.target.value)} placeholder="analyst@org.io"
            className="bg-[var(--ic-bg)] text-[var(--ic-heading)] rounded px-2 py-1.5 text-xs border border-[var(--ic-border)] w-44" />
          <button disabled={bulkBusy || !assignTo.trim()} onClick={() => runBulk('assign')} className="px-3 py-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 disabled:opacity-50">Assign</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={16} /></button>
          {bulkBusy && <Loader2 size={16} className="animate-spin text-cyan-300" />}
        </div>
      )}
      {bulkMsg && <p className="text-xs text-cyan-300 -mt-2">{bulkMsg}</p>}

      {/* Table */}
      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
              <th className="px-3 py-3"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} className="accent-cyan-500" /></th>
              {([['Severity', 'severity'], ['Title', 'title'], ['Source', 'source'], ['Status', 'status'], ['Created', 'created_at']] as const).map(([lbl, key]) => (
                <th key={key} className="px-3 py-3">
                  <button onClick={() => { if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(key as SortKey); setOrder('desc'); } setPage(1); }}
                    className="flex items-center gap-1 hover:text-[var(--ic-heading)]">
                    {lbl}<ArrowUpDown size={12} className={sort === key ? 'text-cyan-400' : 'opacity-40'} />
                  </button>
                </th>
              ))}
              <th className="px-3 py-3">Assignee</th>
              <th className="px-3 py-3">Correlated</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-[var(--ic-muted)]">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No alerts match this filter set. {q || severity !== 'all' || status !== 'all' ? 'Try clearing filters.' : 'The alert inventory is empty — detections will appear here as they arrive.'}
              </td></tr>
            )}
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-[var(--ic-border)] animate-pulse"><td colSpan={9} className="px-4 py-4"><div className="h-4 bg-[var(--ic-surface-2)] rounded w-3/4" /></td></tr>
            ))}
            {!loading && rows.map(a => (
              <tr key={a.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]/50 cursor-pointer" onClick={() => openDetail(a.id)}>
                <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} className="accent-cyan-500" />
                </td>
                <td className="px-3 py-3"><Badge className={sevBadge[a.severity] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'}>{a.severity}</Badge></td>
                <td className="px-3 py-3">
                  <div className="text-[var(--ic-heading)] font-medium max-w-72 truncate">{a.title}</div>
                  <div className="text-xs text-[var(--ic-muted)] font-mono">{a.uid}{a.resource ? ` · ${a.resource}` : ''}</div>
                </td>
                <td className="px-3 py-3 text-[var(--ic-text)]">{a.source}</td>
                <td className="px-3 py-3"><Badge className={statusBadge[a.status] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'}>{a.status}</Badge></td>
                <td className="px-3 py-3 text-[var(--ic-muted)] whitespace-nowrap" title={fmt(a.created_at)}>{ago(a.created_at)}</td>
                <td className="px-3 py-3 text-[var(--ic-muted)] text-xs">{a.assignee ?? <span className="opacity-60">— unassigned</span>}</td>
                <td className="px-3 py-3 text-[var(--ic-muted)]">{a.correlated_count > 1 ? `×${a.correlated_count}` : ''}{a.storm_suppressed ? ' 🌩' : ''}</td>
                <td className="px-3 py-3">
                  <Eye size={16} className="text-gray-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-[var(--ic-muted)]">
        <span>{total.toLocaleString()} alert(s) · page {page} of {pages} · sorted by {sort} ({order})</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); setSelected(new Set()); }}
            className="p-2 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] disabled:opacity-40 hover:bg-[var(--ic-surface-2)]"><ChevronLeft size={16} /></button>
          <button disabled={page >= pages} onClick={() => { setPage(p => p + 1); setSelected(new Set()); }}
            className="p-2 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] disabled:opacity-40 hover:bg-[var(--ic-surface-2)]"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {(detail || detailLoading) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={closeDetail}>
            <motion.div initial={{ x: 60 }} animate={{ x: 0 }} exit={{ x: 60 }} transition={{ type: 'tween', duration: 0.2 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-2xl h-full bg-[var(--ic-bg)] border-l border-[var(--ic-border)] overflow-y-auto p-6 space-y-5">
              {detailLoading || !detail ? (
                <div className="flex items-center gap-2 text-[var(--ic-muted)]"><Loader2 className="animate-spin" /> Loading alert…</div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={sevBadge[detail.severity]}>{detail.severity}</Badge>
                        <Badge className={statusBadge[detail.status]}>{detail.status}</Badge>
                        {detail.storm_suppressed && <Badge className="bg-slate-500/20 text-slate-300 border-slate-500/30">storm-suppressed</Badge>}
                      </div>
                      <h2 className="text-xl font-bold text-[var(--ic-heading)] mt-2">{detail.title}</h2>
                      <p className="text-xs text-[var(--ic-muted)] font-mono mt-1">{detail.uid} · v{detail.version} · source {detail.source} · org #{detail.org_id}</p>
                    </div>
                    <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-[var(--ic-surface-2)] text-[var(--ic-muted)]"><X size={18} /></button>
                  </div>

                  {detailErr && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-2.5 text-xs text-red-300">{detailErr}</div>}

                  <p className="text-sm text-[var(--ic-text)] whitespace-pre-wrap">{detail.description || 'No description provided.'}</p>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Info icon={Server} k="Resource" v={detail.resource ?? '—'} />
                    <Info icon={Users} k="Assignee" v={detail.assignee ?? 'Unassigned'} />
                    <Info icon={Clock} k="Created" v={fmt(detail.created_at)} />
                    <Info icon={Bell} k="Acknowledged" v={detail.acked_by ? `${detail.acked_by} · ${fmt(detail.acked_at)}` : 'Not yet'} />
                    <Info icon={CheckCircle} k="Resolved" v={detail.resolved_by ? `${detail.resolved_by} · ${fmt(detail.resolved_at)}` : 'Not resolved'} />
                    <Info icon={AlertTriangle} k="Correlated events" v={`${detail.correlated_count} folded into this record`} />
                  </div>

                  {/* Lifecycle actions — validated transitions enforced server-side */}
                  <div className="flex flex-wrap gap-2">
                    {detail.status !== 'acked' && (
                      <button disabled={actionBusy} onClick={() => patchAlert({ status: 'acked' })}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm disabled:opacity-50">Acknowledge</button>
                    )}
                    {detail.status !== 'resolved' && (
                      <button disabled={actionBusy} onClick={() => patchAlert({ status: 'resolved' })}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm disabled:opacity-50">Resolve</button>
                    )}
                    {detail.status === 'resolved' && (
                      <button disabled={actionBusy} onClick={() => patchAlert({ status: 'active' })}
                        className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm disabled:opacity-50">Reopen</button>
                    )}
                    <button disabled={actionBusy} onClick={() => { const who = window.prompt('Assign to (email):', detail.assignee ?? ''); if (who !== null) patchAlert(who.trim() ? { assignee: who.trim() } : { clear_assignee: true }); }}
                      className="px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-sm disabled:opacity-50">Assign…</button>
                  </div>

                  {/* Related records — real links only, never fabricated */}
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] uppercase tracking-wide">Linked records</h3>
                    {detail.related_incidents.length === 0 && detail.related_tickets.length === 0 && (
                      <p className="text-xs text-[var(--ic-muted)]">No incidents or tickets are linked to this alert yet. Links appear when a notification rule auto-tickets or an analyst opens an incident from it.</p>
                    )}
                    {detail.related_incidents.map(i => (
                      <button key={i.uid} onClick={() => navigate(`/client-admin/incidents/${i.uid}`)}
                        className="w-full flex items-center gap-2 text-sm bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-left">
                        <Shield size={14} className="text-red-400" /><span className="font-mono text-xs">{i.uid}</span>
                        <span className="text-[var(--ic-heading)] truncate flex-1">{i.title}</span><Badge className={sevBadge[i.severity] ?? ''}>{i.severity}</Badge>
                      </button>
                    ))}
                    {detail.related_tickets.map(t => (
                      <button key={t.uid} onClick={() => navigate(`/client-admin/tickets/${t.uid}`)}
                        className="w-full flex items-center gap-2 text-sm bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-left">
                        <Ticket size={14} className="text-purple-400" /><span className="font-mono text-xs">{t.uid}</span>
                        <span className="text-[var(--ic-heading)] truncate flex-1">{t.title}</span><span className="text-xs text-[var(--ic-muted)]">{t.status}</span>
                      </button>
                    ))}
                  </section>

                  {/* Notes */}
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] uppercase tracking-wide flex items-center gap-1"><FileText size={14} /> Investigation notes</h3>
                    <div className="flex gap-2">
                      <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={2} placeholder="Add a note for the team…"
                        className="flex-1 bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)] focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <button disabled={actionBusy || !noteBody.trim()} onClick={addNote}
                        className="self-end px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm disabled:opacity-50"><Send size={14} /></button>
                    </div>
                    {detail.notes.length === 0 && <p className="text-xs text-[var(--ic-muted)]">No notes yet.</p>}
                    {detail.notes.map(n => (
                      <div key={n.id} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg p-3 text-sm">
                        <div className="text-xs text-[var(--ic-muted)] mb-1">{n.author} · {fmt(n.created_at)}</div>
                        <div className="text-[var(--ic-text)] whitespace-pre-wrap">{n.body}</div>
                      </div>
                    ))}
                  </section>

                  {/* Event history */}
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] uppercase tracking-wide flex items-center gap-1"><History size={14} /> Event history</h3>
                    {detail.events.length === 0 && <p className="text-xs text-[var(--ic-muted)]">No recorded history for this alert.</p>}
                    <ol className="relative border-l border-[var(--ic-border)] ml-2 space-y-3">
                      {detail.events.map((e: AlertEventRow) => (
                        <li key={e.id} className="ml-4 text-sm">
                          <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-cyan-500/60" />
                          <div className="text-[var(--ic-heading)]">{e.action} <span className="text-xs text-[var(--ic-muted)]">— {e.detail}</span></div>
                          <div className="text-xs text-[var(--ic-muted)]">{e.actor} · {fmt(e.created_at)}</div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const Info: React.FC<{ icon: React.ElementType; k: string; v: string }> = ({ icon: Icon, k, v }) => (
  <div className="flex items-start gap-2 text-sm">
    <Icon size={14} className="mt-0.5 text-[var(--ic-muted)] shrink-0" />
    <div><div className="text-xs text-[var(--ic-muted)]">{k}</div><div className="text-[var(--ic-text)] break-all">{v}</div></div>
  </div>
);
