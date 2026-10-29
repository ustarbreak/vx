// ---------------------------------------------------------------------------
// STAGE 6A — Outcome-label panel (analyst ground-truth capture).
//
// Talks exclusively to the existing endpoints in backend/app/routers/triage.py
// (POST/GET /api/triage/incidents/{uid}/outcome-label[s]) via triageApi.
// No parallel labeling system, no writes anywhere else.
//
// Behavior contract mirrors the backend:
//   * labels are APPEND-ONLY — "correct" submits a new row with supersedes_id;
//     prior rows stay visible in the history list forever;
//   * client_user role cannot label (backend 403) -> read-only view;
//   * reopening an incident does not erase labels; analysts may append a new
//     head via relabel_previous (mutually exclusive with supersedes_id);
//   * Demo Mode has no simulated triage store — errors are surfaced honestly.
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, StickyNote } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import {
  triageApi, OUTCOME_DISPOSITIONS, PRIORITY_CORRECTNESS_VALUES,
  OutcomeDisposition, PriorityCorrectness, OutcomeLabelRow,
} from '../services/triageApi';

const dispositionMeta: Record<OutcomeDisposition, { label: string; hint: string; cls: string }> = {
  true_positive: { label: 'True positive', hint: 'Real threat that needed response', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  false_positive: { label: 'False positive', hint: 'Benign activity flagged as threat', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  benign_duplicate: { label: 'Benign duplicate', hint: 'Duplicate of another incident', cls: 'bg-slate-500/15 text-[var(--ic-text)] border-[var(--ic-border)]' },
  unknown: { label: 'Unknown', hint: 'Cannot determine at this time', cls: 'bg-slate-500/15 text-[var(--ic-muted)] border-[var(--ic-border)]' },
};

const correctnessMeta: Record<PriorityCorrectness, { label: string; hint: string; cls: string }> = {
  correct: { label: 'Priority correct', hint: 'Assigned priority matched reality', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  too_high: { label: 'Too high', hint: 'Over-prioritized (wasted attention)', cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  too_low: { label: 'Too low', hint: 'Under-prioritized (risk missed)', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  unknown: { label: 'Unknown', hint: 'Cannot judge priority correctness', cls: 'bg-slate-500/15 text-[var(--ic-muted)] border-[var(--ic-border)]' },
};

const inputCls = 'w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] placeholder:text-[var(--ic-muted)] focus:outline-none focus:border-cyan-500/50';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

interface Props {
  uid: string;
  /** Incident status — used only for the reopen hint; backend is authoritative. */
  status?: string;
  pushToast: (t: { kind: 'ok' | 'err'; msg: string }) => void;
}

/** Small vocabulary pill used both in the form and the history rows. */
const Pill: React.FC<{ cls: string; title?: string; children: React.ReactNode }> = ({ cls, title, children }) => (
  <span title={title} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{children}</span>
);

const OutcomeLabelPanel: React.FC<Props> = ({ uid, status, pushToast }) => {
  const { user } = useAuth();
  const role = user?.role ?? 'client_user';
  // Mirrors backend rule: client_user may NOT label (endpoint returns 403).
  const canLabel = role !== 'client_user' && role !== 'sales';

  const [rows, setRows] = useState<OutcomeLabelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [disposition, setDisposition] = useState<OutcomeDisposition>('true_positive');
  const [correctness, setCorrectness] = useState<PriorityCorrectness>('correct');
  const [rationale, setRationale] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  /** When set, the form submits as a correction of this historical row id. */
  const [correctingId, setCorrectingId] = useState<number | null>(null);

  const latest = rows[0] ?? null;
  const reopened = status === 'investigating' && rows.length > 0;

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null); setForbidden(false);
    try {
      const r = await triageApi.getOutcomeLabels(uid);
      setRows(r.history ?? []);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setLoadError(e?.message ?? 'Failed to load outcome labels');
    } finally { setLoading(false); }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      await triageApi.postOutcomeLabel(uid, {
        disposition,
        priority_correctness: correctness,
        rationale: rationale.trim() || null,
        reviewer: reviewer.trim() || null,
        ...(correctingId !== null
          ? { supersedes_id: correctingId }
          : reopened ? { relabel_previous: true } : {}),
      });
      pushToast({ kind: 'ok', msg: correctingId !== null ? 'Correction recorded (original kept)' : 'Outcome label recorded' });
      setShowForm(false); setCorrectingId(null); setRationale(''); setReviewer('');
      await load();
    } catch (e: any) {
      pushToast({ kind: 'err', msg: e?.message ?? 'Label submission failed' });
    } finally { setBusy(false); }
  };

  const openForm = (asCorrectionOf: number | null) => {
    setCorrectingId(asCorrectionOf);
    if (asCorrectionOf === null && latest) {
      // Prefill from current head so corrections start from the known truth.
      setDisposition(latest.disposition); setCorrectness(latest.priority_correctness);
    }
    setShowForm(true);
  };

  const headline = useMemo(() => {
    if (!latest) return null;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill cls={dispositionMeta[latest.disposition].cls}>{dispositionMeta[latest.disposition].label}</Pill>
        <Pill cls={correctnessMeta[latest.priority_correctness].cls}>{correctnessMeta[latest.priority_correctness].label}</Pill>
        {latest.priority_labeled_at && (
          <span className="text-[10px] text-[var(--ic-muted)]">judged at {latest.priority_labeled_at}</span>
        )}
      </div>
    );
  }, [latest]);

  return (
    <section className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-emerald-400" /> Outcome label (ground truth)
        </h5>
        {canLabel && !loading && !showForm && (
          <button disabled={busy} onClick={() => openForm(null)}
            className="text-xs text-cyan-400 hover:underline disabled:opacity-50">
            {latest ? 'Add / relabel' : 'Add label'}
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-[var(--ic-muted)] py-2">
          <Loader2 size={14} className="animate-spin" /> Loading label history…
        </div>
      )}

      {/* Error / forbidden states */}
      {forbidden && !loading && (
        <p className="text-xs text-yellow-300">Labeling requires analyst access (your role is read-only here).</p>
      )}
      {loadError && !loading && (
        <div className="text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <div>{loadError}<button onClick={load} className="block mt-1 underline">Retry</button></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !loadError && !forbidden && rows.length === 0 && !showForm && (
        <p className="text-xs text-[var(--ic-muted)]">
          No outcome label yet{canLabel ? ' — record how this incident actually resolved.' : '.'}
        </p>
      )}

      {/* Current effective label */}
      {!loading && latest && !showForm && (
        <div className="space-y-1">
          {headline}
          {(latest.rationale || latest.reviewer) && (
            <p className="text-xs text-[var(--ic-text)] whitespace-pre-wrap">{latest.rationale || <span className="italic text-[var(--ic-muted)]">No rationale</span>}</p>
          )}
          <p className="text-[10px] text-[var(--ic-muted)]">
            by {latest.labeled_by}{latest.reviewer ? ` · reviewed by ${latest.reviewer}` : ''} · {fmt(latest.created_at)}
          </p>
          {reopened && (
            <p className="text-[10px] text-yellow-300/80">Incident was reopened after this label — submitting will append a new head; the original stays in history.</p>
          )}
        </div>
      )}

      {/* Form (new label or auditable correction) */}
      {showForm && (
        <div className="space-y-3 border-t border-[var(--ic-border)] pt-3">
          <p className="text-[11px] text-[var(--ic-muted)]">
            {correctingId !== null
              ? <>Correcting label #{correctingId}. The original row is preserved; this creates a new immutable row linked to it.</>
              : 'Appends a new immutable label row. Nothing is overwritten.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[11px] uppercase tracking-wider text-[var(--ic-muted)]">
              Disposition
              <select className={`${inputCls} mt-1 normal-case tracking-normal`} value={disposition}
                onChange={e => setDisposition(e.target.value as OutcomeDisposition)}>
                {OUTCOME_DISPOSITIONS.map(d => <option key={d} value={d}>{dispositionMeta[d].label}</option>)}
              </select>
            </label>
            <label className="block text-[11px] uppercase tracking-wider text-[var(--ic-muted)]">
              Priority was
              <select className={`${inputCls} mt-1 normal-case tracking-normal`} value={correctness}
                onChange={e => setCorrectness(e.target.value as PriorityCorrectness)}>
                {PRIORITY_CORRECTNESS_VALUES.map(c => <option key={c} value={c}>{correctnessMeta[c].label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[10px] text-[var(--ic-muted)] -mt-1">{dispositionMeta[disposition].hint} · {correctnessMeta[correctness].hint}</p>
          <textarea className={`${inputCls} resize-none`} rows={2} maxLength={2000}
            placeholder="Optional rationale (what made you judge this way?)"
            value={rationale} onChange={e => setRationale(e.target.value)} />
          <input className={inputCls} placeholder={`Reviewer (optional — defaults to you: ${user?.email ?? ''})`}
            value={reviewer} onChange={e => setReviewer(e.target.value)} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={submit}
              className="px-4 py-2 rounded-lg text-sm bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin inline" /> : null}
              {correctingId !== null ? 'Record correction' : 'Record label'}
            </button>
            <button disabled={busy} onClick={() => { setShowForm(false); setCorrectingId(null); }}
              className="px-4 py-2 rounded-lg text-sm border border-[var(--ic-border)] text-[var(--ic-text)] hover:bg-[var(--ic-border)] disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Immutable history */}
      {!loading && rows.length > 0 && (
        <div className="border-t border-[var(--ic-border)] pt-3">
          <h6 className="text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2 flex items-center gap-1">
            <History size={11} /> Label history ({rows.length}) — append-only, newest first
          </h6>
          <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {rows.map(r => (
              <li key={r.id} className={`p-2.5 rounded-lg border text-xs space-y-1 ${r.id === latest?.id ? 'border-cyan-500/30 bg-[var(--ic-surface)]' : 'border-[var(--ic-border)] bg-[var(--ic-surface)] opacity-90'}`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[10px] text-[var(--ic-muted)]">#{r.id}</span>
                  <Pill cls={dispositionMeta[r.disposition].cls}>{dispositionMeta[r.disposition].label}</Pill>
                  <Pill cls={correctnessMeta[r.priority_correctness].cls}>{correctnessMeta[r.priority_correctness].label}</Pill>
                  {r.supersedes_id != null && <Pill cls="border-purple-500/30 bg-purple-500/10 text-purple-300" title={`Corrects label #${r.supersedes_id}`}>correction → #{r.supersedes_id}</Pill>}
                  {r.id === latest?.id && <Pill cls="border-cyan-500/30 bg-cyan-500/10 text-cyan-300">current</Pill>}
                </div>
                {r.rationale && <p className="flex items-start gap-1 text-[var(--ic-text)]"><StickyNote size={11} className="mt-0.5 shrink-0 text-[var(--ic-muted)]" /><span className="whitespace-pre-wrap">{r.rationale}</span></p>}
                <div className="flex items-center gap-2 text-[10px] text-[var(--ic-muted)] flex-wrap">
                  <span>{fmt(r.created_at)}</span><span>·</span><span>{r.labeled_by}</span>
                  {r.reviewer && <><span>· reviewer {r.reviewer}</span></>}
                  {r.priority_labeled_at && <span>· judged at {r.priority_labeled_at}</span>}
                  {canLabel && r.id !== latest?.id && (
                    <button onClick={() => openForm(r.id)} className="ml-auto text-cyan-400 hover:underline">Correct this</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default OutcomeLabelPanel;
