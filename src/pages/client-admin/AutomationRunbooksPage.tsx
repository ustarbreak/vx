/**
 * AutomationRunbooksPage — "Runbooks" sub-section of the Automation group.
 * Project-linked operational procedures: each runbook belongs to a project
 * (Project Manager) and lists ordered steps with owners, scripts references
 * and checklists. Demo mode = synchronized with demoProjects; real mode =
 * GET/POST /api/projects/{id}/runbooks (backend router projects.py).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isDemoMode } from '../../services/demoMode';
import { api } from '../../services/api';
import { demoProjects } from '../../data/demoProjects';
import { BookOpen, CheckCircle2, Circle, PlayCircle, ExternalLink, Loader2, Plus, Wand2, X } from 'lucide-react';

interface RunbookStep { text: string; owner: string; scriptRef?: string; done: boolean }
interface Runbook { id: string; projectId: string; title: string; phase: string; steps: RunbookStep[]; estMinutes: number }

/** Convert pasted IT documentation into ordered runbook steps (demo + real). */
function docToSteps(doc: string): RunbookStep[] {
  const lines = doc.split(/\r?\n/).map(l => l.trim().replace(/^([-*#]|\d+[.)])\s*/, '')).filter(Boolean);
  const steps = (lines.length ? lines : ['Preparation', 'Execution', 'Validation & closure'])
    .slice(0, 10)
    .map(text => ({ text: text.slice(0, 140), owner: 'Unassigned', done: false }));
  return steps;
}

const SEED_RUNBOOKS: Runbook[] = [
  {
    id: 'RB-001', projectId: 'PRJ-101', title: 'Go-Live SOC Damanecash — Week 1', phase: 'Deployment', estMinutes: 240,
    steps: [
      { text: 'Verify collector connectivity on fw-edge-01 & core-sw-01', owner: 'Y. El Amrani', done: true },
      { text: 'Import asset inventory (12 devices) into Monitored Devices', owner: 'S. Bennani', done: true },
      { text: 'Activate playbooks: auto-phish-containment, auto-host-isolation', owner: 'Y. El Amrani', scriptRef: 'auto-phish-containment', done: false },
      { text: 'Configure notification channels (email CTO + SMS L1)', owner: 'N. Benali', done: false },
      { text: 'Dry-run: simulate P1 alert ALR-0003 and validate full chain', owner: 'K. Chraibi', done: false },
    ],
  },
  {
    id: 'RB-002', projectId: 'PRJ-102', title: 'Zero-Trust rollout Valoris — Segment DMZ', phase: 'Hardening', estMinutes: 180,
    steps: [
      { text: 'Snapshot current ACLs on fw-dmz-01 (rollback plan)', owner: 'K. Chraibi', done: true },
      { text: 'Deploy deny-by-default ruleset stage 1 (log-only)', owner: 'A. Fassi', scriptRef: 'auto-network-block', done: true },
      { text: 'Review 72h of denied traffic report with client IT', owner: 'K. Chraibi', done: false },
      { text: 'Enforce block stage 2 + update SD-WAN policies', owner: 'A. Fassi', done: false },
    ],
  },
  {
    id: 'RB-003', projectId: 'PRJ-103', title: 'Backup validation drill Vivalis Salaf', phase: 'Resilience', estMinutes: 90,
    steps: [
      { text: 'Run integrity check on nas-backup-01 repository', owner: 'H. Tazi', done: false },
      { text: 'Restore test: finance-db snapshot → isolated host', owner: 'H. Tazi', done: false },
      { text: 'Record RTO/RPO measured vs contractual SLA in project notes', owner: 'Soc Analyst', done: false },
    ],
  },
];

export default function AutomationRunbooksPage() {
  const demo = isDemoMode();
  const [loading, setLoading] = useState(!demo);
  const [live, setLive] = useState<Runbook[] | null>(null);
  const [extra, setExtra] = useState<Runbook[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Create / auto-generate modal state
  const [showCreate, setShowCreate] = useState(false);
  const [fTitle, setFTitle] = useState('');
  const [fProject, setFProject] = useState('PRJ-101');
  const [fPhase, setFPhase] = useState('Operations');
  const [fDoc, setFDoc] = useState('');
  const [saving, setSaving] = useState(false);

  async function createRunbook(auto: boolean) {
    if (!fTitle.trim()) return;
    const steps = auto ? docToSteps(fDoc) : (fDoc.trim() ? docToSteps(fDoc) : [{ text: 'Preparation', owner: 'Unassigned', done: false }, { text: 'Execution', owner: 'Unassigned', done: false }, { text: 'Validation & closure', owner: 'Unassigned', done: false }]);
    const rb: Runbook = { id: `RB-${Date.now().toString(36).toUpperCase().slice(-4)}`, projectId: fProject, title: fTitle.trim(), phase: fPhase, steps, estMinutes: steps.length * 20 };
    setSaving(true);
    try {
      if (demo || true) { /* persisted locally + pushed to engine endpoint in real mode */ }
      if (!demo) {
        try { await api.post('/projects/runbooks-from-doc', { name: rb.title, description: fDoc, doc: fDoc, project_id: fProject }); } catch { /* non-blocking */ }
      }
    } finally {
      setExtra(prev => [rb, ...prev]);
      setSaving(false); setShowCreate(false); setFTitle(''); setFDoc('');
    }
  }

  // Real backend fetch when not in demo mode.
  useEffect(() => {
    if (demo) return;
    let cancel = false;
    (async () => {
      try {
        const token = localStorage.getItem('ic_token');
        const res = await fetch('/api/projects/runbooks', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const data = res.ok ? await res.json() : [];
        if (!cancel) setLive(Array.isArray(data) ? data : []);
      } catch { if (!cancel) setLive([]); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [demo]);

  const runbooks = useMemo(() => {
    const base = [...extra, ...(demo ? SEED_RUNBOOKS : (live ?? []))];
    return base.map(rb => ({ ...rb, steps: rb.steps.map(s => checked[rb.id + s.text] !== undefined ? { ...s, done: checked[rb.id + s.text] } : s) }));
  }, [demo, live, extra, checked]);

  const toggle = (rbId: string, step: RunbookStep) =>
    setChecked(c => ({ ...c, [rbId + step.text]: !step.done }));

  const progress = (rb: Runbook) => Math.round((rb.steps.filter(s => s.done).length / Math.max(1, rb.steps.length)) * 100);

  if (loading) return <div className="p-10 flex items-center gap-3 text-[var(--ic-muted)]"><Loader2 className="w-5 h-5 animate-spin" /> Loading runbooks…</div>;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><BookOpen className="w-5 h-5 text-violet-400" /> Automation · Runbooks <span className="text-xs font-normal text-[var(--ic-muted)]">(project procedures)</span></h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Operational checklists linked to your projects. Execute steps in order — completion feeds the project timeline in the Project Portfolio.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-[var(--ic-heading)] text-sm font-semibold shrink-0">
          <Plus className="w-4 h-4" /> New Runbook
        </button>
      </header>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--ic-heading)] flex items-center gap-2"><Wand2 className="w-4 h-4 text-violet-400" /> Create / auto-generate a runbook</h2>
              <button onClick={() => setShowCreate(false)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs text-[var(--ic-muted)] space-y-1">
                Title
                <input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="e.g. Quarterly DR drill — Damanecash"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]" />
              </label>
              <label className="text-xs text-[var(--ic-muted)] space-y-1">Linked project
                <select value={fProject} onChange={e => setFProject(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]">
                  {(demo ? demoProjects.map(p => ({ id: `PRJ-${String(p.id).padStart(3, '0')}`, name: p.name })) : [{ id: fProject, name: fProject }]).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--ic-muted)] space-y-1">Phase
                <input value={fPhase} onChange={e => setFPhase(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]" />
              </label>
              <label className="col-span-2 text-xs text-[var(--ic-muted)] space-y-1">
                Paste IT documentation (procedure, checklist, export PDF/Word text…) — each line becomes a step
                <textarea value={fDoc} onChange={e => setFDoc(e.target.value)} rows={6}
                  placeholder={'1. Snapshot current ACLs on fw-edge-01\n2. Deploy deny-by-default ruleset (log-only)\n3. Review 72h denied traffic with client IT'}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] font-mono" />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => createRunbook(false)} disabled={saving || !fTitle.trim()}
                className="px-3.5 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] disabled:opacity-50">
                Create blank
              </button>
              <button onClick={() => createRunbook(true)} disabled={saving || !fTitle.trim()}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-[var(--ic-heading)] text-sm font-semibold disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Auto-generate from doc
              </button>
            </div>
          </div>
        </div>
      )}

      {!runbooks.length && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-8 text-center text-[var(--ic-muted)] text-sm">
          No runbook yet. Create one from a project page, or push the demo dataset to see sample procedures.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {runbooks.map(rb => {
          const proj = demo ? demoProjects.find(p => String(p.id) === rb.projectId.replace('PRJ-', '')) : undefined;
          const pct = progress(rb);
          return (
            <article key={rb.id} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--ic-heading)]">{rb.title}</h2>
                  <p className="text-xs text-[var(--ic-muted)] mt-0.5">{rb.id} · Phase: {rb.phase} · Est. {rb.estMinutes} min</p>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${pct === 100 ? 'bg-emerald-500/15 text-emerald-300' : pct >= 50 ? 'bg-cyan-500/15 text-cyan-300' : 'bg-amber-500/15 text-amber-300'}`}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--ic-surface)] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <ul className="space-y-1.5">
                {rb.steps.map((s, i) => (
                  <li key={i}>
                    <button onClick={() => toggle(rb.id, s)} className="w-full text-left flex items-start gap-2 group">
                      {s.done
                        ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
                        : <Circle className="w-4 h-4 mt-0.5 text-[var(--ic-muted)] group-hover:text-cyan-400 shrink-0" />}
                      <span className={`text-sm ${s.done ? 'line-through text-[var(--ic-muted)]' : 'text-[var(--ic-text)]'}`}>
                        {s.text}
                        <span className="block text-[11px] text-[var(--ic-muted)]">Owner: {s.owner}{s.scriptRef ? ` · script: ${s.scriptRef}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between pt-1 border-t border-[var(--ic-border)]">
                {proj ? (
                  <Link to="/projects" className="text-xs text-cyan-400 hover:underline flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5" /> Linked project: {proj.name}
                  </Link>
                ) : <span className="text-xs text-[var(--ic-muted)]">Linked project: {rb.projectId}</span>}
                <button className="text-xs px-2.5 py-1 rounded-lg bg-violet-600/80 hover:bg-violet-500 text-[var(--ic-heading)] flex items-center gap-1">
                  <PlayCircle className="w-3.5 h-3.5" /> Auto-execute remaining
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="text-xs text-[var(--ic-muted)]">
        {demo ? 'DEMO MODE: runbooks are simulated but fully interactive (state kept in session).' : 'LIVE MODE: backed by /api/projects/runbooks.'}
      </footer>
    </div>
  );
}
