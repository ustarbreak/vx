import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, CheckCircle2, Circle, ExternalLink, Loader2, Plus, RefreshCw, Trash2, Wand2, X } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';
import { demoProjects } from '../../data/demoProjects';

type RunbookStep = { text: string; owner: string; scriptRef?: string; done: boolean };
type Runbook = {
  id: number | string;
  projectId: string;
  title: string;
  phase: string;
  steps: RunbookStep[];
  estMinutes: number;
};
type ProjectOption = { id: string; name: string };

const SEED_RUNBOOKS: Runbook[] = [
  {
    id: 'RB-001', projectId: 'PRJ-101', title: 'Go-Live SOC Damanecash — Week 1', phase: 'Deployment', estMinutes: 240,
    steps: [
      { text: 'Verify collector connectivity on fw-edge-01 & core-sw-01', owner: 'Y. El Amrani', done: true },
      { text: 'Import asset inventory into Monitored Devices', owner: 'S. Bennani', done: true },
      { text: 'Activate approved incident playbooks', owner: 'Y. El Amrani', scriptRef: 'auto-phish-containment', done: false },
      { text: 'Configure notification channels', owner: 'N. Benali', done: false },
      { text: 'Dry-run a P1 alert and validate the response chain', owner: 'K. Chraibi', done: false },
    ],
  },
  {
    id: 'RB-002', projectId: 'PRJ-102', title: 'Zero-Trust rollout Valoris — Segment DMZ', phase: 'Hardening', estMinutes: 180,
    steps: [
      { text: 'Snapshot current ACLs and verify rollback plan', owner: 'K. Chraibi', done: true },
      { text: 'Deploy deny-by-default ruleset in log-only mode', owner: 'A. Fassi', scriptRef: 'auto-network-block', done: true },
      { text: 'Review denied traffic with client IT', owner: 'K. Chraibi', done: false },
      { text: 'Approve enforcement and update SD-WAN policies', owner: 'A. Fassi', done: false },
    ],
  },
  {
    id: 'RB-003', projectId: 'PRJ-103', title: 'Backup validation drill Vivalis Salaf', phase: 'Resilience', estMinutes: 90,
    steps: [
      { text: 'Run integrity check on backup repository', owner: 'H. Tazi', done: false },
      { text: 'Perform restore test on an isolated host', owner: 'H. Tazi', done: false },
      { text: 'Record measured RTO/RPO in project notes', owner: 'SOC Analyst', done: false },
    ],
  },
];

function docToSteps(doc: string): RunbookStep[] {
  const lines = doc.split(/\r?\n/).map(line => line.trim().replace(/^([-*#]|\d+[.)])\s*/, '')).filter(Boolean);
  return (lines.length ? lines : ['Preparation', 'Execution', 'Validation & closure'])
    .slice(0, 50)
    .map(text => ({ text: text.slice(0, 140), owner: 'Unassigned', done: false }));
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unexpected request error';
}

export default function AutomationRunbooksPage() {
  const demo = isDemoMode();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('PRJ-101');
  const [phase, setPhase] = useState('Operations');
  const [doc, setDoc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (demo) {
        const options = demoProjects.map(p => ({
          id: 'PRJ-' + String(p.id).padStart(3, '0'),
          name: p.name,
        }));
        setProjects(options);
        setProjectId(current => options.some(p => p.id === current) ? current : (options[0]?.id ?? ''));
        setRunbooks(SEED_RUNBOOKS);
        return;
      }
      const rows = await api.get<any[]>('/projects/');
      const options = (Array.isArray(rows) ? rows : []).map(p => ({ id: String(p.id), name: p.name }));
      setProjects(options);
      setProjectId(current => options.some(p => p.id === current) ? current : (options[0]?.id ?? ''));
      const all = await Promise.all(options.map(async project => {
        const items = await api.get<Runbook[]>(`/projects/${project.id}/runbooks`);
        return Array.isArray(items) ? items : [];
      }));
      setRunbooks(all.flat());
    } catch (e) {
      setError(errorMessage(e));
      setProjects([]);
      setRunbooks([]);
    } finally {
      setLoading(false);
    }
  }, [demo]);

  useEffect(() => { void load(); }, [load]);

  const createRunbook = async () => {
    if (!title.trim() || !projectId || working) return;
    setWorking('create');
    setError('');
    setNotice('');
    const steps = docToSteps(doc);
    try {
      if (demo) {
        const item: Runbook = {
          id: 'RB-DEMO-' + Date.now().toString(36).toUpperCase(),
          projectId, title: title.trim(), phase: phase.trim() || 'Operations',
          steps, estMinutes: steps.length * 20,
        };
        setRunbooks(prev => [item, ...prev]);
        setNotice('Demo runbook created locally. It is not stored on the backend.');
      } else {
        const saved = await api.post<Runbook>(`/projects/${projectId}/runbooks`, {
          title: title.trim(), phase: phase.trim() || 'Operations',
          est_minutes: steps.length * 20, steps,
        });
        setRunbooks(prev => [saved, ...prev]);
        setNotice('Runbook saved to the selected project.');
      }
      setShowCreate(false);
      setTitle('');
      setDoc('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const toggleStep = async (runbook: Runbook, stepIndex: number) => {
    const steps = runbook.steps.map((step, index) => index === stepIndex ? { ...step, done: !step.done } : step);
    setWorking(String(runbook.id));
    setError('');
    setNotice('');
    try {
      if (!demo) {
        const saved = await api.patch<Runbook>(
          `/projects/${runbook.projectId}/runbooks/${runbook.id}`, { steps },
        );
        setRunbooks(prev => prev.map(item => item.id === runbook.id ? saved : item));
      } else {
        setRunbooks(prev => prev.map(item => item.id === runbook.id ? { ...item, steps } : item));
        setNotice('Demo checklist updated locally; no server record changed.');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const removeRunbook = async (runbook: Runbook) => {
    if (!window.confirm(`Delete runbook "${runbook.title}"?`)) return;
    setWorking(String(runbook.id));
    setError('');
    setNotice('');
    try {
      if (!demo) await api.del<void>(`/projects/${runbook.projectId}/runbooks/${runbook.id}`);
      setRunbooks(prev => prev.filter(item => item.id !== runbook.id));
      setNotice(demo ? 'Demo runbook removed locally.' : 'Runbook deleted.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const progress = (runbook: Runbook) =>
    Math.round(runbook.steps.filter(step => step.done).length / Math.max(1, runbook.steps.length) * 100);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-400" /> Automation · Project Runbooks
          </h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">
            Persisted project procedures and checklists. These are operational checklists, not executable SOAR playbooks.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="p-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)]">
            <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
          </button>
          <button onClick={() => setShowCreate(true)} disabled={!projects.length || loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50">
            <Plus className="w-4 h-4" /> New Runbook
          </button>
        </div>
      </header>

      {demo && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Demo Mode: checklist edits and new runbooks are local simulations only; no backend data is changed.
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
      </div>}
      {notice && <div role="status" className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-cyan-300">{notice}</div>}

      {loading ? <div className="p-10 flex items-center gap-3 text-[var(--ic-muted)]"><Loader2 className="w-5 h-5 animate-spin" /> Loading project runbooks…</div> :
        <div className="grid xl:grid-cols-2 gap-4">
          {runbooks.map(runbook => {
            const pct = progress(runbook);
            return <article key={runbook.id} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--ic-heading)]">{runbook.title}</h2>
                  <p className="text-xs text-[var(--ic-muted)] mt-1">{runbook.phase} · {runbook.estMinutes} min estimated · Project {runbook.projectId}</p>
                </div>
                <button onClick={() => void removeRunbook(runbook)} disabled={working === String(runbook.id)}
                  aria-label={'Delete ' + runbook.title} className="p-2 rounded-lg text-[var(--ic-muted)] hover:text-red-400 disabled:opacity-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 rounded-full bg-[var(--ic-surface-2)] overflow-hidden">
                  <div className="h-full bg-violet-500" style={{ width: pct + '%' }} />
                </div>
                <span className="text-xs text-[var(--ic-muted)] tabular-nums">{pct}%</span>
              </div>
              <ol className="space-y-2">
                {runbook.steps.map((step, index) => <li key={index} className="flex items-start gap-2 text-sm">
                  <button onClick={() => void toggleStep(runbook, index)} disabled={working === String(runbook.id)}
                    aria-label={(step.done ? 'Mark incomplete: ' : 'Complete: ') + step.text}
                    className="mt-0.5 text-violet-400 disabled:opacity-50">
                    {step.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={step.done ? 'text-[var(--ic-muted)] line-through' : 'text-[var(--ic-text)]'}>{step.text}</p>
                    <p className="text-[10px] text-[var(--ic-muted)]">{step.owner}{step.scriptRef ? ' · Script reference: ' + step.scriptRef : ''}</p>
                  </div>
                </li>)}
              </ol>
              <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
                Open Project Portfolio <ExternalLink className="w-3 h-3" />
              </Link>
            </article>;
          })}
          {!runbooks.length && <div className="xl:col-span-2 rounded-xl border border-dashed border-[var(--ic-border)] p-10 text-center text-sm text-[var(--ic-muted)]">
            No project runbooks exist yet. Create one to persist a procedure checklist against a project.
          </div>}
        </div>}

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowCreate(false)}>
        <div className="w-full max-w-lg rounded-2xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--ic-heading)] flex items-center gap-2"><Wand2 className="w-4 h-4 text-violet-400" /> Create project runbook</h2>
            <button onClick={() => setShowCreate(false)} aria-label="Close" className="text-[var(--ic-muted)]"><X className="w-5 h-5" /></button>
          </div>
          <label className="block text-xs text-[var(--ic-muted)]">Title
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Quarterly DR drill"
              className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm text-[var(--ic-heading)]" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-[var(--ic-muted)]">Project
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm text-[var(--ic-heading)]">
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[var(--ic-muted)]">Phase
              <input value={phase} onChange={e => setPhase(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm text-[var(--ic-heading)]" />
            </label>
          </div>
          <label className="block text-xs text-[var(--ic-muted)]">Procedure / documentation (one step per line)
            <textarea value={doc} onChange={e => setDoc(e.target.value)} rows={6}
              placeholder={'1. Preserve evidence\n2. Notify incident lead\n3. Validate containment'}
              className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm font-mono text-[var(--ic-heading)]" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-text)]">Cancel</button>
            <button onClick={() => void createRunbook()} disabled={!title.trim() || !projectId || working === 'create'}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {working === 'create' ? 'Saving…' : 'Save runbook'}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}
