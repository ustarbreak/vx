import React, { useCallback, useEffect, useState } from 'react';
import {
  Zap, Plus, Trash2, Play, Eye, X, Save, RefreshCw, ShieldAlert, ChevronDown, ChevronUp, Terminal,
} from 'lucide-react';
import {
  playbooksApi, Playbook, PlaybookStep, ApiError,
} from '../../services/api';

// Action catalogue — must stay in sync with backend/app/routers/settings.py run executor
const ACTIONS: { id: string; label: string; params: string[] }[] = [
  { id: 'notify', label: 'Send notification', params: ['channel', 'recipient', 'message'] },
  { id: 'create_ticket', label: 'Create ticket', params: ['title', 'priority', 'category'] },
  { id: 'isolate_host', label: 'Isolate host (EDR)', params: ['host'] },
  { id: 'block_ip', label: 'Block IP on firewall', params: ['ip', 'duration_minutes'] },
  { id: 'disable_user', label: 'Disable AD user', params: ['username'] },
  { id: 'collect_forensics', label: 'Collect forensic snapshot', params: ['host'] },
  { id: 'enrich_vt', label: 'Enrich indicator (VirusTotal)', params: ['indicator'] },
  { id: 'webhook', label: 'Call external webhook', params: ['url', 'method'] },
  { id: 'wait', label: 'Wait / delay', params: ['seconds'] },
];

interface RunResult { ok: boolean; log: { step: number; name: string; action: string; status: string; detail: string }[] }

const emptyPb = (): Playbook => ({ id: 0, name: '', description: '', category: 'incident_response', steps: [], enabled: true });

const CustomPlaybooksLibrary: React.FC = () => {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [viewing, setViewing] = useState<Playbook | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [runResult, setRunResult] = useState<{ pb: Playbook; res: RunResult } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setPlaybooks(await playbooksApi.list()); }
    catch (ex: any) { setError(ex instanceof ApiError ? ex.message : 'Backend unreachable — is the API container running?'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (pb: Playbook) => {
    await playbooksApi.save(pb.id ? pb : { ...pb, id: undefined } as any);
    setEditing(null); await load();
  };

  const remove = async (id: number) => { await playbooksApi.remove(id); await load(); };

  const run = async (pb: Playbook) => {
    if (!pb.id) return;
    setRunningId(pb.id); setError('');
    try { setRunResult({ pb, res: await playbooksApi.run(pb.id) }); }
    catch (ex: any) { setError(ex.message); }
    finally { setRunningId(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Zap className="text-cyan-400" /> Custom Playbooks</h1>
          <p className="text-sm text-[var(--ic-muted)]">Automation runbooks stored on the backend. “Play” executes every step server-side and returns the real execution log.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={() => setEditing(emptyPb())} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold"><Plus size={16} /> New Playbook</button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2"><ShieldAlert size={16} />{error}</div>}

      {playbooks.length === 0 && !loading && (
        <div className="bg-[var(--ic-surface)] rounded-xl p-10 text-center">
          <p className="text-[var(--ic-muted)] mb-2">No playbooks yet.</p>
          <p className="text-xs text-[var(--ic-muted)] mb-4">Build a runbook (notify → isolate → block → ticket…) and execute it against real incidents with one click.</p>
          <button onClick={() => setEditing(emptyPb())} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold inline-flex items-center gap-2"><Plus size={14} /> Create your first playbook</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {playbooks.map(pb => (
          <div key={pb.id} className="bg-[var(--ic-surface-2)] rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[var(--ic-heading)] font-bold">{pb.name || 'Untitled'} {!pb.enabled && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-slate-600/40 text-[var(--ic-muted)]">disabled</span>}</p>
                <p className="text-xs text-[var(--ic-muted)]">{pb.description || 'No description'} · <span className="capitalize">{pb.category.replace('_', ' ')}</span></p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded bg-[var(--ic-surface-2)] text-[var(--ic-text)]">{pb.steps.length} steps</span>
            </div>
            <ol className="text-xs text-[var(--ic-muted)] space-y-0.5 list-decimal list-inside">
              {pb.steps.slice(0, 3).map((s, i) => <li key={i}>{s.name || s.action} <span className="text-[var(--ic-muted)]">[{s.action}]</span></li>)}
              {pb.steps.length > 3 && <li className="list-none text-[var(--ic-muted)]">… +{pb.steps.length - 3} more</li>}
            </ol>
            <div className="flex gap-2 pt-1">
              <button onClick={() => run(pb)} disabled={runningId === pb.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[var(--ic-heading)] text-xs font-semibold"><Play size={13} /> {runningId === pb.id ? 'Running…' : 'Play'}</button>
              <button onClick={() => setViewing(pb)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] text-xs font-semibold"><Eye size={13} /> Display</button>
              <button onClick={() => setEditing(JSON.parse(JSON.stringify(pb)))}
                className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] text-xs">Edit</button>
              <button onClick={() => remove(pb.id)} className="ml-auto p-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* DISPLAY modal — shows exactly what the playbook does */}
      {viewing && (
        <Modal onClose={() => setViewing(null)}>
          <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Eye className="text-cyan-400" size={18} /> {viewing.name}</h2>
          <p className="text-sm text-[var(--ic-muted)]">{viewing.description}</p>
          <ol className="mt-3 space-y-2">
            {viewing.steps.map((s, i) => (
              <li key={i} className="bg-[var(--ic-surface)] rounded-lg p-3 text-sm">
                <p className="text-[var(--ic-heading)] font-semibold">{i + 1}. {s.name || s.action}</p>
                <p className="text-xs text-cyan-400 font-mono">{s.action}</p>
                {Object.entries(s.params || {}).filter(([k, v]) => String(v)).length > 0 && (
                  <pre className="mt-1 text-[11px] text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded p-2 overflow-x-auto">{JSON.stringify(s.params, null, 2)}</pre>
                )}
              </li>
            ))}
            {viewing.steps.length === 0 && <li className="text-sm text-[var(--ic-muted)]">This playbook has no steps yet.</li>}
          </ol>
        </Modal>
      )}

      {/* RUN result modal — real server-side execution log */}
      {runResult && (
        <Modal onClose={() => setRunResult(null)}>
          <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Terminal className={runResult.res.ok ? 'text-emerald-400' : 'text-red-400'} size={18} />
            Execution: {runResult.pb.name} <span className={`text-xs font-semibold ${runResult.res.ok ? 'text-emerald-400' : 'text-red-400'}`}>{runResult.res.ok ? '✓ COMPLETED' : '✗ STOPPED ON ERROR'}</span></h2>
          <div className="mt-3 ic-page rounded-lg p-3 font-mono text-xs space-y-1 max-h-96 overflow-y-auto">
            {runResult.res.log.map(l => (
              <p key={l.step}>
                <span className="text-[var(--ic-muted)]">[{String(l.step).padStart(2, '0')}]</span>{' '}
                <span className={l.status === 'success' ? 'text-emerald-400' : l.status === 'skipped' ? 'text-[var(--ic-muted)]' : 'text-red-400'}>{l.status.toUpperCase()}</span>{' '}
                <span className="text-cyan-300">{l.name}</span>
                <span className="text-[var(--ic-muted)]"> · {l.action}</span>
                {l.detail && <span className="text-[var(--ic-muted)]"> — {l.detail}</span>}
              </p>
            ))}
          </div>
          <p className="text-[11px] text-[var(--ic-muted)] mt-2">Executed server-side by the automation engine. Side effects (tickets created, notifications sent) are visible in their respective pages.</p>
        </Modal>
      )}

      {editing && <Editor initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
};

const Modal: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
    <div onClick={e => e.stopPropagation()} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 relative">
      <button onClick={onClose} className="absolute right-4 top-4 text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={18} /></button>
      <div className="space-y-2">{children}</div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Step editor
// ---------------------------------------------------------------------------

const Editor: React.FC<{ initial: Playbook; onClose: () => void; onSave: (pb: Playbook) => Promise<void> }> = ({ initial, onClose, onSave }) => {
  const [pb, setPb] = useState<Playbook>({ ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [openStep, setOpenStep] = useState<number | null>(0);

  const inp = 'w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] focus:border-cyan-500 outline-none';
  const lbl = 'block text-xs font-semibold text-[var(--ic-muted)] mb-1 uppercase tracking-wide';

  const addStep = () => {
    setPb({ ...pb, steps: [...pb.steps, { name: '', action: 'notify', params: {} }] });
    setOpenStep(pb.steps.length);
  };
  const updStep = (i: number, patch: Partial<PlaybookStep>) => {
    const steps = pb.steps.map((s, j) => j === i ? { ...s, ...patch } : s);
    setPb({ ...pb, steps });
  };
  const updParam = (i: number, k: string, v: string) => {
    const steps = pb.steps.map((s, j) => j === i ? { ...s, params: { ...s.params, [k]: v } } : s);
    setPb({ ...pb, steps });
  };
  const delStep = (i: number) => setPb({ ...pb, steps: pb.steps.filter((_, j) => j !== i) });
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= pb.steps.length) return;
    const steps = [...pb.steps]; [steps[i], steps[j]] = [steps[j], steps[i]];
    setPb({ ...pb, steps });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pb.name.trim()) { setErr('Playbook needs a name.'); return; }
    setBusy(true); setErr('');
    try { await onSave(pb); } catch (ex: any) { setErr(ex.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={ev => ev.stopPropagation()}
        className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Zap className="text-cyan-400" size={20} /> {pb.id ? 'Edit' : 'New'} Playbook</h2>
          <button type="button" onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={20} /></button>
        </div>
        <div><label className={lbl}>Name *</label><input className={inp} value={pb.name} onChange={e => setPb({ ...pb, name: e.target.value })} placeholder="Ransomware containment runbook" /></div>
        <div><label className={lbl}>Description</label><textarea className={inp} rows={2} value={pb.description} onChange={e => setPb({ ...pb, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lbl}>Category</label>
            <select className={inp} value={pb.category} onChange={e => setPb({ ...pb, category: e.target.value })}>
              {['incident_response', 'containment', 'forensics', 'recovery', 'compliance'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select></div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-[var(--ic-heading)]">
              <input type="checkbox" checked={pb.enabled} onChange={e => setPb({ ...pb, enabled: e.target.checked })} className="accent-cyan-500" /> Enabled
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className={lbl}>Steps (executed in order by the backend engine)</p>
            <button type="button" onClick={addStep} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]"><Plus size={12} /> Add step</button>
          </div>
          {pb.steps.map((s, i) => {
            const meta = ACTIONS.find(a => a.id === s.action) || ACTIONS[0];
            const open = openStep === i;
            return (
              <div key={i} className="bg-[var(--ic-surface)] rounded-lg">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="text-xs text-[var(--ic-muted)] w-5">{i + 1}.</span>
                  <input className="flex-1 bg-transparent text-sm text-[var(--ic-heading)] outline-none" value={s.name} placeholder={meta.label}
                    onChange={e => updStep(i, { name: e.target.value })} onFocus={() => setOpenStep(i)} />
                  <span className="text-[10px] font-mono text-cyan-400">{s.action}</span>
                  <button type="button" onClick={() => moveStep(i, -1)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><ChevronUp size={14} /></button>
                  <button type="button" onClick={() => moveStep(i, 1)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><ChevronDown size={14} /></button>
                  <button type="button" onClick={() => setOpenStep(open ? null : i)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)] text-xs">{open ? '▾' : '▸'}</button>
                  <button type="button" onClick={() => delStep(i)} className="text-red-400 hover:text-red-300"><Trash2 size={13} /></button>
                </div>
                {open && (
                  <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-[var(--ic-muted)]">Action</label>
                      <select className={inp} value={s.action}
                        onChange={e => updStep(i, { action: e.target.value, params: {} })}>
                        {ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                      </select>
                    </div>
                    {meta.params.map(p => (
                      <div key={p}>
                        <label className="text-[11px] text-[var(--ic-muted)]">{p}</label>
                        <input className={inp} value={String(s.params?.[p] ?? '')} onChange={e => updParam(i, p, e.target.value)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {pb.steps.length === 0 && <p className="text-xs text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded-lg p-3">No steps yet — click “Add step”.</p>}
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-text)] bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)]">Cancel</button>
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-[var(--ic-heading)]">
            <Save size={15} /> {busy ? 'Saving…' : 'Save to Backend'}</button>
        </div>
      </form>
    </div>
  );
};

export default CustomPlaybooksLibrary;
