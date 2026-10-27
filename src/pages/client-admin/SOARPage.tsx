import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Zap, Play, Eye, FlaskConical, History, Loader2, X, RefreshCw, ChevronDown,
  ChevronRight, AlertTriangle, CheckCircle2, ShieldAlert, Inbox, RotateCcw,
  Ban, ScrollText,
} from 'lucide-react';
import { isDemoMode } from '../../services/demoMode';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api';
import {
  soarApi, MODE_LABELS, RunMode, PlaybookRow, PlaybookDetail, PlaybookRunRow,
  PreviewResult, StepStatus, RunStatus,
} from '../../services/soarApi';
import { RunStatusChip } from '../IncidentsPage';

// ---------------------------------------------------------------------------
// Design helpers
// ---------------------------------------------------------------------------
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function Badge({ className = '', title, children }: { className?: string; title?: string; children: React.ReactNode }) {
  return <span title={title} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border border-transparent ${className}`}>{children}</span>;
}

/** Step-level chips — completed / failed / skipped / running, never invented. */
const StepChip: React.FC<{ status: StepStatus }> = ({ status }) => {
  const map: Record<StepStatus, { cls: string; icon: any }> = {
    completed: { cls: 'bg-green-500/20 text-green-400', icon: CheckCircle2 },
    failed: { cls: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
    skipped: { cls: 'bg-slate-600/40 text-[var(--ic-muted)]', icon: Ban },
    running: { cls: 'bg-cyan-500/20 text-cyan-300 animate-pulse', icon: Loader2 },
  };
  const { cls, icon: Icon } = map[status] ?? map.skipped;
  return <Badge className={`flex items-center gap-1 ${cls}`}><Icon size={9} className={status === 'running' ? 'animate-spin' : ''} />{status}</Badge>;
};

const ModeChip: React.FC<{ mode: RunMode }> = ({ mode }) => {
  const cls = mode === 'execute' ? 'bg-red-500/15 text-red-300 border border-red-500/30'
    : mode === 'simulate' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
    : 'bg-slate-600/30 text-[var(--ic-text)] border border-[var(--ic-border)]';
  const title = mode === 'execute' ? 'Actual execution — side effects were performed by the engine'
    : mode === 'simulate' ? 'Simulation — zero side effects, steps report skipped'
    : 'Preview — static plan only, nothing ran';
  return <Badge className={cls} title={title}>{mode}</Badge>;
};

interface Toast { kind: 'ok' | 'err'; msg: string }

// ---------------------------------------------------------------------------
// Confirmation dialog for consequential actions (block_ip / isolate_host …).
// The backend ALSO requires confirm=true — this UI never bypasses that rule.
// ---------------------------------------------------------------------------
const ConfirmDialog: React.FC<{
  title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean;
  busy?: boolean; onConfirm: () => void; onCancel: () => void;
}> = ({ title, body, confirmLabel, danger = true, busy, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <ShieldAlert className={danger ? 'text-red-400' : 'text-yellow-400'} size={20} />
        <h3 className="text-base font-bold text-[var(--ic-heading)]">{title}</h3>
      </div>
      <div className="text-sm text-[var(--ic-text)] space-y-2">{body}</div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg text-sm border border-[var(--ic-border)] text-[var(--ic-text)] hover:bg-[var(--ic-surface-2)] disabled:opacity-50">Cancel</button>
        <button onClick={onConfirm} disabled={busy}
          className={`px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-cyan-600 hover:bg-cyan-500'}`}>
          {busy && <Loader2 size={14} className="animate-spin" />} {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Execution log viewer — details arrive ALREADY redacted from the backend
// (app/services/soar.py redacts secrets/passwords/tokens keys and credential-
// like values). We render verbatim and say so honestly.
// ---------------------------------------------------------------------------
const LogViewer: React.FC<{ run: PlaybookRunRow }> = ({ run }) => {
  if (!run.result_log?.length) {
    return <p className="text-xs text-[var(--ic-muted)]">No step log returned for this run yet.</p>;
  }
  return (
    <div className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--ic-border)] flex items-center gap-2">
        <ScrollText size={13} className="text-[var(--ic-muted)]" />
        <span className="text-xs font-semibold text-[var(--ic-heading)]">Execution log — {run.uid}</span>
        <Badge className="ml-auto bg-amber-500/15 text-amber-300" title="Secrets, passwords and token-like values are masked server-side before storage">redacted by backend</Badge>
      </div>
      <ul className="divide-y divide-[var(--ic-border)] font-mono text-[11px]">
        {run.result_log.map(l => (
          <li key={l.step} className="px-3 py-2 flex items-start gap-2">
            <span className="text-[var(--ic-muted)] w-6 shrink-0">#{l.step}</span>
            <StepChip status={l.status} />
            <div className="min-w-0 flex-1">
              <p className="text-[var(--ic-heading)]">{l.name} <span className="text-[var(--ic-muted)]">· {l.action}</span></p>
              <p className="text-[var(--ic-text)] whitespace-pre-wrap break-all mt-0.5 opacity-90">{l.detail || '—'}</p>
            </div>
          </li>
        ))}
      </ul>
      {run.error && (
        <p className="px-3 py-2 text-[11px] text-red-300 border-t border-[var(--ic-border)]">run error: {run.error}</p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Preview panel — GET /api/soar/playbooks/{id}/preview (static plan, executed
// = false). Clearly separated from simulate/execute results.
// ---------------------------------------------------------------------------
const PreviewPanel: React.FC<{ preview: PreviewResult; playbookName: string }> = ({ preview, playbookName }) => (
  <div className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] p-3 space-y-2">
    <div className="flex items-center gap-2 text-xs">
      <Eye size={13} className="text-cyan-300" />
      <span className="font-semibold text-[var(--ic-heading)]">Static plan — {playbookName}</span>
      <Badge className="bg-slate-600/40 text-[var(--ic-muted)]" title="This request performs NO execution whatsoever">executed: false</Badge>
      {preview.requires_confirmation && <Badge className="bg-red-500/15 text-red-300" title="Contains block_ip / isolate_host — actual execution needs confirm=true">needs confirmation</Badge>}
    </div>
    <ul className="space-y-1">
      {preview.plan.map(p => (
        <li key={p.step} className="flex items-center gap-2 text-[11px] font-mono">
          <span className="text-[var(--ic-muted)] w-6">#{p.step}</span>
          <span className="text-[var(--ic-heading)]">{p.name}</span>
          <span className="text-[var(--ic-muted)]">→ {p.action}</span>
          {p.consequential && <Badge className="bg-red-500/15 text-red-300">consequential</Badge>}
        </li>
      ))}
    </ul>
  </div>
);

// ---------------------------------------------------------------------------
// Runs history — filterable list of executions with step counters. Opening a
// run fetches its full redacted log via GET /api/soar/runs/{uid}.
// ---------------------------------------------------------------------------
const RunsHistory: React.FC<{ incidentUid?: string; pushToast: (t: Toast) => void }> = ({ incidentUid, pushToast }) => {
  const [runs, setRuns] = useState<PlaybookRunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState<RunStatus | ''>('');
  const [fMode, setFMode] = useState<RunMode | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [fullRun, setFullRun] = useState<PlaybookRunRow | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await soarApi.listRuns({ status: fStatus, mode: fMode, incident_uid: incidentUid, page, page_size: pageSize });
      setRuns(r.items); setTotal(r.total);
    } catch (e: any) { setError(e?.message ?? 'Failed to load runs'); }
    finally { setLoading(false); }
  }, [fStatus, fMode, incidentUid, page]);
  useEffect(() => { load(); }, [load]);

  const open = async (uid: string) => {
    if (openUid === uid) { setOpenUid(null); setFullRun(null); return; }
    setOpenUid(uid); setFullRun(null); setLogLoading(true);
    try { setFullRun(await soarApi.getRun(uid)); }
    catch (e: any) { pushToast({ kind: 'err', msg: e?.message ?? 'Failed to load run log' }); setOpenUid(null); }
    finally { setLogLoading(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--ic-border)] flex items-center gap-3 flex-wrap">
        <History size={16} className="text-fuchsia-400" />
        <h2 className="text-sm font-bold text-[var(--ic-heading)]">Execution history</h2>
        {incidentUid && <Badge className="bg-cyan-500/15 text-cyan-300">filtered: {incidentUid}</Badge>}
        <select value={fStatus} onChange={e => { setFStatus(e.target.value as any); setPage(1); }}
          className="ml-auto bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-2 py-1 text-xs text-[var(--ic-heading)]">
          <option value="">All statuses</option>
          {(['queued', 'running', 'completed', 'failed', 'partial', 'cancelled'] as RunStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fMode} onChange={e => { setFMode(e.target.value as any); setPage(1); }}
          className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-2 py-1 text-xs text-[var(--ic-heading)]">
          <option value="">All modes</option>
          {(['simulate', 'preview', 'execute'] as RunMode[]).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={load} title="Re-pull runs from the backend"
          className="p-1.5 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {loading && runs.length === 0 && <div className="p-8 flex items-center justify-center gap-2 text-[var(--ic-muted)] text-sm"><Loader2 size={16} className="animate-spin" /> Loading runs…</div>}
      {error && <div className="m-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2"><AlertTriangle size={14} />{error} <button onClick={load} className="underline ml-auto shrink-0">Retry</button></div>}
      {!loading && !error && runs.length === 0 && (
        <div className="p-8 flex flex-col items-center gap-2 text-center">
          <Inbox size={24} className="text-[var(--ic-muted)]" />
          <p className="text-sm text-[var(--ic-heading)] font-semibold">No executions recorded yet</p>
          <p className="text-xs text-[var(--ic-muted)]">Run a playbook from the inventory above — every real run, simulation and preview is journaled here.</p>
        </div>
      )}
      {runs.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ic-border)] text-left text-xs text-[var(--ic-muted)]">
              <th className="py-2 px-4 font-semibold">Run</th>
              <th className="py-2 px-2 font-semibold">Playbook</th>
              <th className="py-2 px-2 font-semibold">Mode</th>
              <th className="py-2 px-2 font-semibold">Status</th>
              <th className="py-2 px-2 font-semibold">Steps</th>
              <th className="py-2 px-2 font-semibold">Triggered by</th>
              <th className="py-2 px-2 font-semibold">Started</th>
              <th className="py-2 px-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <React.Fragment key={r.uid}>
                <tr className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                  <td className="py-2 px-4 font-mono text-xs text-cyan-300">{r.uid}{r.retry_of ? <span title={`retry of ${r.retry_of}`} className="ml-1 text-[10px] text-[var(--ic-muted)]">↻</span> : null}</td>
                  <td className="py-2 px-2 text-[var(--ic-heading)] text-xs">{r.playbook_name ?? `#${r.playbook_id}`}</td>
                  <td className="py-2 px-2"><ModeChip mode={r.mode} /></td>
                  <td className="py-2 px-2"><RunStatusChip status={r.status} /></td>
                  <td className="py-2 px-2 text-xs text-[var(--ic-text)]" title={`${r.completed_steps} completed · ${r.failed_steps} failed · ${r.skipped_steps} skipped of ${r.total_steps}`}>
                    <span className="text-green-400">{r.completed_steps}</span>/<span className="text-red-400">{r.failed_steps}</span>/<span className="text-[var(--ic-muted)]">{r.skipped_steps}</span>
                    <span className="text-[var(--ic-muted)]"> of {r.total_steps}</span>
                  </td>
                  <td className="py-2 px-2 text-xs text-[var(--ic-muted)]">{r.triggered_by}</td>
                  <td className="py-2 px-2 text-xs text-[var(--ic-muted)]">{fmt(r.started_at)}</td>
                  <td className="py-2 px-2">
                    <button onClick={() => open(r.uid)} className="flex items-center gap-1 text-xs text-cyan-400 hover:underline">
                      {openUid === r.uid ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Log
                    </button>
                  </td>
                </tr>
                {openUid === r.uid && (
                  <tr className="bg-[var(--ic-surface-2)]">
                    <td colSpan={8} className="px-4 py-3">
                      {logLoading && <p className="text-xs text-[var(--ic-muted)] flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Fetching redacted log…</p>}
                      {!logLoading && fullRun && <LogViewer run={fullRun} />}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      {total > pageSize && (
        <div className="px-4 py-2 flex items-center justify-between text-xs text-[var(--ic-muted)] border-t border-[var(--ic-border)]">
          <span>Page {page} of {totalPages} · {total} runs</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-[var(--ic-border)] disabled:opacity-40">←</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-[var(--ic-border)] disabled:opacity-40">→</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Playbook detail drawer — definition, trigger/action summary, recent runs,
// static preview, and the three clearly-separated run buttons.
// ---------------------------------------------------------------------------
const PlaybookDrawer: React.FC<{
  pbId: number; incidentUid: string | null; onClose: () => void;
  canExecute: boolean; pushToast: (t: Toast) => void; onDataChanged: () => void;
}> = ({ pbId, incidentUid, onClose, canExecute, pushToast, onDataChanged }) => {
  const [pb, setPb] = useState<PlaybookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [lastRun, setLastRun] = useState<PlaybookRunRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<null | { mode: RunMode }>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPb(await soarApi.getPlaybook(pbId)); }
    catch (e: any) { setError(e?.message ?? 'Failed to load playbook'); }
    finally { setLoading(false); }
  }, [pbId]);
  useEffect(() => { load(); }, [load]);

  const doPreview = async () => {
    setBusy('preview');
    try { setPreview(await soarApi.preview(pbId)); }
    catch (e: any) { pushToast({ kind: 'err', msg: e?.message ?? 'Preview failed' }); }
    finally { setBusy(null); }
  };

  const doRun = async (mode: RunMode, confirm = false) => {
    setBusy(mode);
    try {
      // Fresh idempotency key per user intent → double-clicks replay instead of double-running.
      const res = await soarApi.run(pbId, { mode, incident_uid: incidentUid, confirm, idempotency_key: crypto.randomUUID() });
      setLastRun(res.run);
      setConfirmOpen(null);
      pushToast({
        kind: res.run.status === 'failed' ? 'err' : 'ok',
        msg: res.replayed
          ? `Duplicate request detected — replayed existing run ${res.run.uid} (no second execution)`
          : `${MODE_LABELS[mode]} finished: ${res.run.status}${res.run.failed_steps ? ` (${res.run.failed_steps} failed step${res.run.failed_steps > 1 ? 's' : ''})` : ''}`,
      });
      onDataChanged();
      load();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409 && /confirm/i.test(e.message)) {
        setConfirmOpen({ mode });   // backend demanded explicit confirmation
      } else {
        pushToast({ kind: 'err', msg: e?.message ?? 'Run failed' });
      }
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex justify-end" onClick={onClose}>
      <aside className="w-full max-w-2xl h-full bg-[var(--ic-surface)] border-l border-[var(--ic-border)] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[var(--ic-surface)] border-b border-[var(--ic-border)] px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-cyan-300">{pb?.uid ?? `PB #${pbId}`}</span>
              {pb && <Badge className={pb.enabled ? 'bg-green-500/20 text-green-400' : 'bg-slate-600/40 text-[var(--ic-muted)]'}>{pb.enabled ? 'enabled' : 'disabled'}</Badge>}
              {pb?.consequential && <Badge className="bg-red-500/15 text-red-300" title="Contains block_ip / isolate_host steps">consequential</Badge>}
            </div>
            <h2 className="text-lg font-bold text-[var(--ic-heading)] mt-1">{pb?.name ?? 'Loading…'}</h2>
          </div>
          <button onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={20} /></button>
        </div>

        {loading && <div className="p-10 flex items-center justify-center gap-2 text-[var(--ic-muted)] text-sm"><Loader2 className="animate-spin" size={18} /> Loading playbook…</div>}
        {error && !loading && <div className="m-5 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-2"><AlertTriangle size={16} />{error} <button onClick={load} className="underline ml-auto">Retry</button></div>}

        {pb && !loading && !error && (
          <div className="p-5 space-y-5">
            <p className="text-sm text-[var(--ic-text)]">{pb.description || <span className="text-[var(--ic-muted)] italic">No description.</span>}</p>

            {/* Trigger & action summaries */}
            <section className="grid grid-cols-2 gap-4">
              <div>
                <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Triggers</h5>
                {pb.triggers?.length ? (
                  <ul className="space-y-1">
                    {pb.triggers.map((t, i) => <li key={i}><Badge className="bg-cyan-500/10 text-cyan-300">{String(t.type ?? JSON.stringify(t))}</Badge></li>)}
                  </ul>
                ) : <p className="text-xs text-[var(--ic-muted)]">Manual only.</p>}
              </div>
              <div>
                <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Actions</h5>
                {pb.action_summary?.length ? (
                  <div className="flex flex-wrap gap-1">{pb.action_summary.map(a => <Badge key={a} className="bg-slate-600/40 text-[var(--ic-text)] font-mono">{a}</Badge>)}</div>
                ) : <p className="text-xs text-[var(--ic-muted)]">No steps defined.</p>}
              </div>
            </section>

            {/* Steps definition */}
            <section>
              <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Definition ({pb.steps.length} steps)</h5>
              <ol className="space-y-1">
                {pb.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
                    <span className="text-[var(--ic-muted)] font-mono w-6">#{i + 1}</span>
                    <span className="text-[var(--ic-heading)] font-medium">{s.name}</span>
                    <span className="text-[var(--ic-muted)] font-mono">· {s.action}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Mode separation: preview ≠ simulate ≠ execute */}
            <section className="space-y-2">
              <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider">Run controls</h5>
              {incidentUid && <p className="text-xs text-cyan-300 font-mono">linked incident: {incidentUid}</p>}
              <div className="flex flex-wrap gap-2">
                <button disabled={busy !== null} onClick={doPreview}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--ic-border)] bg-[var(--ic-surface-2)] text-[var(--ic-text)] hover:border-cyan-500/40 disabled:opacity-50">
                  {busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} className="text-cyan-300" />} Preview (static plan)
                </button>
                <button disabled={busy !== null || !pb.enabled}
                  title={!pb.enabled ? 'Playbook is disabled' : undefined}
                  onClick={() => doRun('simulate')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 disabled:opacity-50">
                  {busy === 'simulate' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Simulate (no side effects)
                </button>
                <button disabled={busy !== null || !pb.enabled || !canExecute}
                  title={!canExecute ? 'Your role may not execute playbooks' : !pb.enabled ? 'Playbook is disabled' : undefined}
                  onClick={() => pb.consequential ? setConfirmOpen({ mode: 'execute' }) : doRun('execute')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                  {busy === 'execute' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Execute (real actions)
                </button>
              </div>
              {!canExecute && <p className="text-[11px] text-amber-400">Your role can view and simulate but not execute — ask an administrator.</p>}
            </section>

            {preview && <PreviewPanel preview={preview} playbookName={pb.name} />}

            {/* Last execution result — straight from the backend response */}
            {lastRun && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider">Latest result</h5>
                  <span className="font-mono text-xs text-cyan-300">{lastRun.uid}</span>
                  <ModeChip mode={lastRun.mode} />
                  <RunStatusChip status={lastRun.status} />
                  <span className="text-[10px] text-[var(--ic-muted)]">{fmt(lastRun.started_at)} → {fmt(lastRun.finished_at)}</span>
                </div>
                <LogViewer run={lastRun} />
              </section>
            )}

            {/* Recent runs journal */}
            <section>
              <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Recent runs ({pb.recent_runs.length})</h5>
              {pb.recent_runs.length ? (
                <div className="space-y-1">
                  {pb.recent_runs.map(r => (
                    <div key={r.uid} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
                      <span className="font-mono text-cyan-300">{r.uid}</span>
                      <ModeChip mode={r.mode} />
                      <RunStatusChip status={r.status} />
                      <span className="text-[var(--ic-muted)]">{r.completed_steps}/{r.total_steps} steps</span>
                      {r.incident_uid && <span className="font-mono text-[10px] text-fuchsia-400">{r.incident_uid}</span>}
                      <span className="ml-auto text-[10px] text-[var(--ic-muted)]">{fmt(r.started_at)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-[var(--ic-muted)]">No runs recorded for this playbook yet.</p>}
            </section>
          </div>
        )}

        {confirmOpen && pb && (
          <ConfirmDialog
            title="Confirm consequential execution"
            busy={busy !== null}
            confirmLabel="Yes, execute for real"
            body={<>
              <p>Playbook <b className="text-[var(--ic-heading)]">{pb.name}</b> contains high-impact steps ({pb.action_summary?.filter(a => ['block_ip', 'isolate_host'].includes(a)).join(', ') ?? 'block/isolate'}).</p>
              <p>The backend will refuse the request without <code className="text-cyan-300">confirm=true</code>. This performs <b>real actions</b> through approved connectors only — no arbitrary commands.</p>
              {incidentUid && <p>Linked incident: <span className="font-mono text-cyan-300">{incidentUid}</span></p>}
            </>}
            onConfirm={() => doRun(confirmOpen.mode, true)}
            onCancel={() => setConfirmOpen(null)}
          />
        )}
      </aside>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Guide (kept from previous version — pure documentation, no data claims)
// ---------------------------------------------------------------------------
const PlaybookGuide: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-[var(--ic-surface-2)] transition">
        <span className="text-sm font-semibold text-[var(--ic-heading)]">📘 Guide — Créer des playbooks avancés (triggers · steps · variables)</span>
        <span className="text-xs text-cyan-400">{open ? 'Réduire ▲' : 'Déplier ▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-[var(--ic-text)] space-y-4 border-t border-[var(--ic-border)] pt-4">
          <p className="text-[var(--ic-muted)]">Un playbook = un <b>trigger</b>, une suite de <b>steps</b> (allow-list : notify, create_ticket, enrich_ioc, add_evidence, update_status, snapshot, block_ip, isolate_host) et des variables partagées. Les steps destructifs (<code className="text-red-300">block_ip</code>, <code className="text-red-300">isolate_host</code>) exigent <code className="text-cyan-300">confirm=true</code> côté serveur et passent par l'approbation existante. Testez toujours en <b>Preview</b> puis <b>Simulate</b> avant <b>Execute</b> ; chaque exécution est journalisée avec logs secret-redactés.</p>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page — production mode reads ONLY /api/soar/*; fabricated-success UI
// and hard-coded playbook stats have been removed entirely.
// ---------------------------------------------------------------------------
export default function SOARPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'client_user';
  const canExecute = ['platform_admin', 'client_admin'].includes(role);

  const [searchParams] = useSearchParams();
  const incidentParam = searchParams.get('incident') || undefined;

  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [pbTotal, setPbTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPb, setOpenPb] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const pushToast = useCallback((t: Toast) => { setToast(t); setTimeout(() => setToast(null), 5000); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await soarApi.listPlaybooks(1, 100);
      setPlaybooks(r.items); setPbTotal(r.total);
    } catch (e: any) { setError(e?.message ?? 'Failed to load playbooks'); setPlaybooks([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep link from Incidents ("Run playbook") → open first enabled playbook.
  useEffect(() => {
    if (incidentParam && !openPb && playbooks.length) {
      const first = playbooks.find(p => p.enabled) ?? playbooks[0];
      setOpenPb(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentParam, playbooks]);

  const stats = useMemo(() => ({
    total: pbTotal,
    enabled: playbooks.filter(p => p.enabled).length,
    consequential: playbooks.filter(p => p.consequential).length,
  }), [playbooks, pbTotal]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">SOAR Automation</h1>
          <p className="text-[var(--ic-muted)] mt-1 text-sm">
            Security Orchestration, Automation &amp; Response — {isDemoMode() ? 'Demo Mode (simulated engine)' : 'live backend engine'}.
            Status shown here comes only from confirmed backend responses.
          </p>
        </div>
        <button onClick={load} title="Re-pull from /api/soar/playbooks"
          className="flex items-center gap-2 text-xs text-[var(--ic-muted)] hover:text-[var(--ic-heading)] border border-[var(--ic-border)] rounded-lg px-3 py-2">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <PlaybookGuide />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Zap, color: 'text-blue-400', label: 'Playbooks', value: stats.total },
          { icon: CheckCircle2, color: 'text-green-400', label: 'Enabled', value: stats.enabled },
          { icon: ShieldAlert, color: 'text-red-400', label: 'Consequential (need confirm)', value: stats.consequential },
        ].map(c => (
          <div key={c.label} className="bg-[var(--ic-surface)] rounded-xl p-5 border border-[var(--ic-border)]">
            <div className="flex items-center justify-between mb-1">
              <c.icon className={`w-5 h-5 ${c.color}`} />
              <span className="text-2xl font-bold text-[var(--ic-heading)]">{loading ? '…' : c.value}</span>
            </div>
            <p className="text-[var(--ic-muted)] text-xs">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ---- Playbook inventory ---- */}
      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--ic-border)] flex items-center gap-2">
          <Zap size={16} className="text-yellow-400" />
          <h2 className="text-sm font-bold text-[var(--ic-heading)]">Playbook inventory</h2>
          <span className="ml-auto text-xs text-[var(--ic-muted)]">{stats.total} registered</span>
        </div>

        {loading && playbooks.length === 0 && (
          <div className="p-10 flex items-center justify-center gap-2 text-[var(--ic-muted)] text-sm"><Loader2 size={18} className="animate-spin" /> Loading playbooks from the backend…</div>
        )}
        {error && (
          <div className="m-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-3">
            <AlertTriangle size={16} /><div className="flex-1"><p className="font-semibold">Could not load playbooks</p><p className="text-xs mt-0.5">{error}</p></div>
            <button onClick={load} className="text-xs underline shrink-0">Retry</button>
          </div>
        )}
        {!loading && !error && playbooks.length === 0 && (
          <div className="p-10 flex flex-col items-center gap-2 text-center">
            <Inbox size={28} className="text-[var(--ic-muted)]" />
            <p className="text-sm font-semibold text-[var(--ic-heading)]">No playbooks registered</p>
            <p className="text-xs text-[var(--ic-muted)] max-w-md">Create one through the platform API (/api/soar/playbooks) or ask your MSP administrator. Empty state is honest — we never display placeholder playbooks as real.</p>
          </div>
        )}
        {playbooks.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)] text-left text-xs text-[var(--ic-muted)]">
                <th className="py-3 px-4 font-semibold">Playbook</th>
                <th className="py-3 px-2 font-semibold">Category</th>
                <th className="py-3 px-2 font-semibold">Triggers / Actions</th>
                <th className="py-3 px-2 font-semibold">Status</th>
                <th className="py-3 px-2 font-semibold">Steps</th>
                <th className="py-3 px-2 font-semibold">Updated</th>
                <th className="py-3 px-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {playbooks.map(p => (
                <tr key={p.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                  <td className="py-3 px-4">
                    <p className="text-[var(--ic-heading)] font-medium text-sm">{p.name}</p>
                    <p className="text-gray-400 text-xs truncate max-w-[280px]">{p.description}</p>
                  </td>
                  <td className="py-3 px-2 text-xs text-[var(--ic-muted)]">{p.category}</td>
                  <td className="py-3 px-2">
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {(p.action_summary ?? []).slice(0, 4).map(a => <Badge key={a} className="bg-slate-600/40 text-[var(--ic-text)] font-mono">{a}</Badge>)}
                      {(p.action_summary?.length ?? 0) > 4 && <span className="text-[10px] text-[var(--ic-muted)]">+{(p.action_summary!.length - 4)}</span>}
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex flex-col gap-1 items-start">
                      <Badge className={p.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}>{p.enabled ? 'enabled' : 'disabled'}</Badge>
                      {p.consequential && <Badge className="bg-red-500/15 text-red-300" title="Execution requires confirm=true and an admin role">consequential</Badge>}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-xs text-[var(--ic-text)]">{p.steps?.length ?? 0}</td>
                  <td className="py-3 px-2 text-xs text-gray-400">{fmt(p.updated_at ?? p.created_at)}</td>
                  <td className="py-3 px-2">
                    <button onClick={() => setOpenPb(p.id)} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">Details &amp; run</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Runs history (execution journal) ---- */}
      <RunsHistory incidentUid={incidentParam} pushToast={pushToast} />

      {openPb !== null && (
        <PlaybookDrawer pbId={openPb} incidentUid={incidentParam ?? null}
          onClose={() => setOpenPb(null)} canExecute={canExecute}
          pushToast={pushToast} onDataChanged={() => { /* runs journal refetches itself */ }} />
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-[60] px-4 py-3 rounded-xl text-sm shadow-xl border max-w-md ${toast.kind === 'ok' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
