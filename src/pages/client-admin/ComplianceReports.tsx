import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, FileCheck, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isDemoMode } from '../../services/demoMode';
import { reportsApi } from '../../services/reportsApi';

type ReportState = {
  id: string;
  title: string;
  status: 'demo' | 'available' | 'unavailable' | 'error';
  message: string;
};

const REPORTS = [
  { id: 'compliance', title: 'Compliance Status Report' },
  { id: 'regulatory', title: 'Regulatory Compliance Report' },
  { id: 'audit', title: 'Audit Trail Report' },
];

export default function ComplianceReports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const demo = isDemoMode();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [reports, setReports] = useState<ReportState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.all(REPORTS.map(async item => {
        const report = await reportsApi.report(item.id, String(user?.orgId ?? 'tenant'), period);
        const unavailable = report.pages.some(page => page[2].some(block =>
          block[0] === 'M' && (block as any)[2]?.some((entry: any[]) =>
            String(entry[0]).toLowerCase().includes('donnee indisponible') ||
            String(entry[0]).toLowerCase().includes('donnée indisponible'),
          ),
        ));
        return {
          id: item.id, title: report.title,
          status: demo ? 'demo' as const : unavailable ? 'unavailable' as const : 'available' as const,
          message: demo ? 'Deterministic sample report — not production evidence.'
            : unavailable ? 'Live adapter is not connected; no compliance result is available.'
            : 'Built from the live reporting API.',
        };
      }));
      setReports(results);
    } catch (e) {
      setReports([]);
      setError(e instanceof Error ? e.message : 'Unable to load compliance reports');
    } finally {
      setLoading(false);
    }
  }, [demo, period, user?.orgId]);

  useEffect(() => { void load(); }, [load]);

  const download = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await reportsApi.downloadCsv(id, String(user?.orgId ?? 'tenant'), period);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <FileCheck className="w-6 h-6 text-cyan-400" /> Compliance & Audit Reports
          </h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Report availability is determined by the reporting API, not prefilled sample scores.</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] px-3 py-2 text-sm text-[var(--ic-heading)]" />
          <button onClick={() => void load()} disabled={loading}
            className="rounded-lg border border-[var(--ic-border)] p-2 text-[var(--ic-muted)] disabled:opacity-50">
            <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
          </button>
        </div>
      </header>

      {demo && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Demo Mode: report content is simulated and must not be used as customer audit evidence.
      </div>}
      {!demo && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Some compliance and audit report families still have no live data adapter. They will remain unavailable rather than display invented scores or report dates.
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? <div className="col-span-full p-10 text-center text-sm text-[var(--ic-muted)]">Checking report sources…</div> :
          reports.map(report => <article key={report.id} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-[var(--ic-heading)]">{report.title}</h2>
              <span className={'rounded-full px-2 py-1 text-[10px] uppercase ' +
                (report.status === 'available' ? 'bg-emerald-500/10 text-emerald-400' :
                 report.status === 'demo' ? 'bg-fuchsia-500/10 text-fuchsia-300' :
                 'bg-amber-500/10 text-amber-300')}>
                {report.status}
              </span>
            </div>
            <p className="text-xs text-[var(--ic-muted)] min-h-9">{report.message}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigate('/reports')} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-xs text-[var(--ic-text)]">
                Open Reporting Center
              </button>
              <button onClick={() => void download(report.id)} disabled={busy === report.id || report.status === 'unavailable' || report.status === 'error'}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> {busy === report.id ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </article>)}
      </div>

      {!loading && !reports.length && <div className="rounded-xl border border-dashed border-[var(--ic-border)] p-8 text-center text-sm text-[var(--ic-muted)] flex flex-col items-center gap-2">
        <AlertTriangle className="w-5 h-5" /> No report catalogue data was returned for this tenant and period.
      </div>}
    </div>
  );
}
