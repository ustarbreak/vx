import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, HelpCircle, RefreshCw, Save, ShieldCheck, XCircle } from 'lucide-react';
import ServiceGate from '../components/ServiceGate';
import { api, ApiError } from '../services/api';
import { isDemoMode } from '../services/demoMode';
import { useAuth } from '../context/AuthContext';
import { mockNISTMapping } from '../data/mockData';

type AssessmentStatus = 'not_assessed' | 'compliant' | 'partial' | 'non_compliant';
type ComplianceControl = {
  id: string;
  framework: string;
  category: string;
  category_name: string;
  title: string;
  status: AssessmentStatus;
  score: number | null;
  evidence: string;
  assessed_by: string | null;
  assessed_at: string | null;
};
type Draft = { status: AssessmentStatus; evidence: string };

const STATUS_OPTIONS: Array<{ value: AssessmentStatus; label: string }> = [
  { value: 'not_assessed', label: 'Not assessed' },
  { value: 'compliant', label: 'Compliant' },
  { value: 'partial', label: 'Partially compliant' },
  { value: 'non_compliant', label: 'Non-compliant' },
];
const STATUS_META: Record<AssessmentStatus, { label: string; color: string; icon: typeof CircleHelp }> = {
  not_assessed: { label: 'Not assessed', color: 'text-[var(--ic-muted)]', icon: CircleHelp },
  compliant: { label: 'Compliant', color: 'text-emerald-400', icon: CheckCircle2 },
  partial: { label: 'Partial', color: 'text-amber-400', icon: AlertCircle },
  non_compliant: { label: 'Non-compliant', color: 'text-red-400', icon: XCircle },
};

function demoControls(): ComplianceControl[] {
  return mockNISTMapping.flatMap(category => category.controls.map(control => ({
    id: control.id,
    framework: 'NIST CSF 2.0',
    category: category.category,
    category_name: category.categoryName,
    title: control.title,
    status: control.status === 'non-compliant' ? 'non_compliant' : control.status,
    score: control.score,
    evidence: 'Simulated demo evidence — not an audit artifact.',
    assessed_by: 'Demo fixture',
    assessed_at: null,
  })));
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unexpected request error';
}

function ComplianceContent() {
  const { user } = useAuth();
  const demo = isDemoMode();
  const canAssess = demo || user?.role === 'client_admin';
  const [controls, setControls] = useState<ComplianceControl[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = demo ? demoControls() : await api.get<ComplianceControl[]>('/compliance/controls');
      setControls(rows);
      setDrafts(Object.fromEntries(rows.map(row => [row.id, { status: row.status, evidence: row.evidence || '' }])));
    } catch (e) {
      setControls([]);
      setDrafts({});
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [demo]);

  const assessed = controls.filter(control => control.status !== 'not_assessed');
  const score = assessed.length
    ? Math.round(assessed.reduce((sum, control) => sum + (control.score ?? 0), 0) / assessed.length)
    : null;
  const categories = useMemo(() => {
    const groups = new Map<string, { name: string; controls: ComplianceControl[] }>();
    controls.forEach(control => {
      const group = groups.get(control.category) ?? { name: control.category_name, controls: [] };
      group.controls.push(control);
      groups.set(control.category, group);
    });
    return Array.from(groups.entries()).map(([id, group]) => ({ id, ...group }));
  }, [controls]);

  const save = async (control: ComplianceControl) => {
    const draft = drafts[control.id];
    if (!draft) return;
    if (draft.status !== 'not_assessed' && !draft.evidence.trim()) {
      setError('Add an evidence note before marking a control as assessed.');
      return;
    }
    setSaving(control.id);
    setError('');
    setNotice('');
    try {
      let updated: ComplianceControl;
      if (demo) {
        updated = {
          ...control, status: draft.status,
          score: draft.status === 'compliant' ? 100 : draft.status === 'partial' ? 50 : draft.status === 'non_compliant' ? 0 : null,
          evidence: draft.evidence,
          assessed_by: 'Demo user',
          assessed_at: draft.status === 'not_assessed' ? null : new Date().toISOString(),
        };
        setNotice('Demo assessment saved locally. It is not stored as real audit evidence.');
      } else {
        updated = await api.patch<ComplianceControl>('/compliance/controls/' + encodeURIComponent(control.id), draft);
        setNotice('Assessment and evidence note saved to this tenant.');
      }
      setControls(prev => prev.map(row => row.id === control.id ? updated : row));
      setDrafts(prev => ({ ...prev, [control.id]: { status: updated.status, evidence: updated.evidence || '' } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(null);
    }
  };

  const stats = {
    total: controls.length,
    assessed: assessed.length,
    compliant: controls.filter(c => c.status === 'compliant').length,
    gaps: controls.filter(c => c.status === 'partial' || c.status === 'non_compliant').length,
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-cyan-400" /> Compliance Mapper
          </h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">NIST CSF 2.0 starter control register with tenant-owned assessment notes.</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-text)] disabled:opacity-50">
          <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} /> Refresh
        </button>
      </header>

      {demo && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Demo Mode: statuses and evidence notes are sample fixtures or local simulations, not real audit evidence.
      </div>}
      {!demo && <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-[var(--ic-muted)]">
        This is a 12-control starter register. Scores are calculated only from controls explicitly assessed with an evidence note; this is not an automatic certification or a complete framework audit.
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-cyan-300">{notice}</div>}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Controls in register', stats.total],
          ['Assessed with evidence', stats.assessed],
          ['Compliant', stats.compliant],
          ['Open gaps', stats.gaps],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <p className="text-xs text-[var(--ic-muted)]">{label}</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{loading ? '—' : value}</p>
        </div>)}
      </section>

      <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-[var(--ic-heading)]">Evidence-backed posture</h2>
            <p className="text-xs text-[var(--ic-muted)] mt-1">Unassessed controls are excluded from the score.</p></div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{score === null ? 'Not assessed' : score + '%'}</p>
        </div>
        <div className="h-2 rounded-full bg-[var(--ic-surface-2)] overflow-hidden mt-3">
          <div className="h-full bg-cyan-500" style={{ width: (score ?? 0) + '%' }} />
        </div>
      </section>

      {loading ? <p className="p-10 text-center text-sm text-[var(--ic-muted)]">Loading control register…</p> :
        <div className="space-y-4">
          {categories.map(category => {
            const done = category.controls.filter(c => c.status !== 'not_assessed');
            const catScore = done.length ? Math.round(done.reduce((sum, c) => sum + (c.score ?? 0), 0) / done.length) : null;
            return <section key={category.id} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--ic-border)]">
                <div><h2 className="font-semibold text-[var(--ic-heading)]">{category.id} · {category.name}</h2>
                  <p className="text-xs text-[var(--ic-muted)] mt-1">{done.length}/{category.controls.length} assessed</p></div>
                <span className="text-lg font-bold text-[var(--ic-heading)]">{catScore === null ? '—' : catScore + '%'}</span>
              </div>
              <div className="divide-y divide-[var(--ic-border)]">
                {category.controls.map(control => {
                  const draft = drafts[control.id] ?? { status: control.status, evidence: control.evidence };
                  const meta = STATUS_META[control.status];
                  const Icon = meta.icon;
                  return <article key={control.id} className="p-4 grid lg:grid-cols-[minmax(0,1fr)_220px] gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className={'w-4 h-4 ' + meta.color} />
                        <span className="font-mono text-xs text-[var(--ic-muted)]">{control.id}</span>
                        <span className={'text-xs ' + meta.color}>{meta.label}</span>
                      </div>
                      <h3 className="text-sm font-medium text-[var(--ic-heading)] mt-1">{control.title}</h3>
                      <p className="text-xs text-[var(--ic-muted)] mt-2">
                        {control.assessed_by ? 'Assessed by ' + control.assessed_by : 'No assessment recorded'}
                        {control.assessed_at ? ' · ' + new Date(control.assessed_at).toLocaleString() : ''}
                      </p>
                      {control.evidence && <p className="text-xs text-[var(--ic-text)] mt-2 whitespace-pre-wrap">Evidence: {control.evidence}</p>}
                    </div>
                    <div className="space-y-2">
                      <select aria-label={'Assessment status for ' + control.id} disabled={!canAssess || saving === control.id}
                        value={draft.status} onChange={e => setDrafts(prev => ({ ...prev, [control.id]: { ...draft, status: e.target.value as AssessmentStatus } }))}
                        className="w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-2 py-2 text-xs text-[var(--ic-heading)] disabled:opacity-60">
                        {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <textarea aria-label={'Evidence note for ' + control.id} disabled={!canAssess || saving === control.id}
                        rows={2} value={draft.evidence} onChange={e => setDrafts(prev => ({ ...prev, [control.id]: { ...draft, evidence: e.target.value } }))}
                        placeholder="Evidence note / reference (required when assessed)"
                        className="w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-2 py-2 text-xs text-[var(--ic-heading)] disabled:opacity-60" />
                      {canAssess && <button onClick={() => void save(control)} disabled={saving === control.id}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> {saving === control.id ? 'Saving…' : 'Save assessment'}
                      </button>}
                    </div>
                  </article>;
                })}
              </div>
            </section>;
          })}
          {!controls.length && <div className="rounded-xl border border-dashed border-[var(--ic-border)] p-10 text-center text-sm text-[var(--ic-muted)]">No compliance controls are available.</div>}
        </div>}
    </div>
  );
}

export default function CompliancePage() {
  return <ServiceGate serviceId="compliance"><ComplianceContent /></ServiceGate>;
}
