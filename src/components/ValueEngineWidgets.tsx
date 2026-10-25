import React, { useEffect, useState } from 'react';
import { Receipt, TrendingDown, ShieldAlert, Gauge, Download, RefreshCw } from 'lucide-react';
import { valueApi, ValuePayload } from '../services/api';

/**
 * Value Engine widgets — the 6 "show the money" mechanics computed by the
 * backend (/api/value) or, in Demo Mode, derived from the SAME demo tickets
 * and alerts as every other page, so numbers never contradict each other.
 *
 * Mechanics: 1 Value Receipt · 2 Red Line · 3 Risk Cost of Inaction ·
 * 4 Before/After · 5 Maturity vs benchmark · 6 Proof Pack export.
 */

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export function useValueEngine(orgId?: number): { v: ValuePayload | null; loading: boolean; refresh: () => void } {
  const [v, setV] = useState<ValuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    valueApi.get(undefined, orgId)
      .then(setV)
      .catch(() => setV(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    window.addEventListener('demo-world-pushed', load);
    return () => window.removeEventListener('demo-world-pushed', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  return { v, loading, refresh: load };
}

/** Mechanic 1 — Value Receipt: what the platform literally saved this month. */
export function ValueReceiptCard({ v }: { v: ValuePayload }) {
  const r = v.receipt;
  return (
    <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/30 rounded-xl p-5 relative overflow-hidden">
      <div className="absolute top-2 right-3 font-mono text-[9px] text-[var(--ic-muted)] truncate max-w-[180px]" title={r.hash}>#{r.hash.slice(0, 16)}</div>
      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4" /> Your security receipt — {v.period}
      </p>
      <div className="flex items-end gap-6 flex-wrap">
        <div>
          <p className="text-3xl font-bold text-emerald-300">{usd(r.total_usd)}</p>
          <p className="text-[11px] text-[var(--ic-muted)]">business value generated this month</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          <div><p className="font-bold text-[var(--ic-heading)]">{r.hours_saved} h</p><p className="text-[10px] text-[var(--ic-muted)]">analyst time saved</p></div>
          <div><p className="font-bold text-[var(--ic-heading)]">{r.auto_closed}</p><p className="text-[10px] text-[var(--ic-muted)]">auto-closed tickets</p></div>
          <div><p className="font-bold text-[var(--ic-heading)]">{r.ai_triaged}</p><p className="text-[10px] text-[var(--ic-muted)]">AI-triaged</p></div>
          <div><p className="font-bold text-[var(--ic-heading)]">{r.alerts_suppressed}</p><p className="text-[10px] text-[var(--ic-muted)]">alert noise removed</p></div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--ic-muted)]">
        Labor {usd(r.labor_saved_usd)} + downtime avoided {usd(r.downtime_avoided_usd)} · {r.tickets_resolved}/{r.tickets_total} tickets resolved
      </p>
    </div>
  );
}

/** Mechanics 2+4 — Red line & before/after MTTR. */
export function RedLineCard({ v }: { v: ValuePayload }) {
  const rl = v.red_line;
  const pct = Math.min(100, Math.max(0, (rl.avg_mttr_min / rl.baseline_mttr_min) * 100));
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
      <p className="text-xs font-semibold text-cyan-400 uppercase tracking-widest flex items-center gap-2 mb-3">
        <TrendingDown className="w-4 h-4" /> Before → After (mean time to resolve)
      </p>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--ic-muted)] line-through">{rl.baseline_mttr_min} min</span>
        <div className="flex-1 h-2 rounded-full bg-[var(--ic-surface)] relative overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-bold text-emerald-300">{rl.avg_mttr_min} min</span>
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-[var(--ic-muted)]">
        <span>Improvement <b className="text-emerald-400">−{rl.improvement_pct} %</b></span>
        <span>False positives <b className="text-[var(--ic-text)]">{rl.false_positive_pct} %</b></span>
      </div>
    </div>
  );
}

/** Mechanic 3 — Risk cost of inaction: open exposure in dollars. */
export function RiskCostCard({ v }: { v: ValuePayload }) {
  const rc = v.risk_cost;
  return (
    <div className="bg-[var(--ic-surface)] border border-red-500/25 rounded-xl p-5">
      <p className="text-xs font-semibold text-red-400 uppercase tracking-widest flex items-center gap-2 mb-3">
        <ShieldAlert className="w-4 h-4" /> Cost of doing nothing
      </p>
      <p className="text-2xl font-bold text-red-300">{usd(rc.exposure_usd)}</p>
      <p className="text-[11px] text-[var(--ic-muted)] mb-3">open risk exposure right now</p>
      <ul className="space-y-1.5 text-[12px]">
        <li className="flex justify-between"><span className="text-[var(--ic-muted)]">Close the {rc.critical_open} critical ticket(s)</span><b className="text-emerald-400">+{usd(rc.critical_open * rc.per_action.close_p1)}</b></li>
        <li className="flex justify-between"><span className="text-[var(--ic-muted)]">Close the {rc.high_open} high ticket(s)</span><b className="text-emerald-400">+{usd(rc.high_open * rc.per_action.close_p2)}</b></li>
        <li className="flex justify-between"><span className="text-[var(--ic-muted)]">Fix {rc.sla_breaches} SLA breach(es)</span><b className="text-emerald-400">+{usd(rc.sla_breaches * rc.per_action.fix_breach)}</b></li>
      </ul>
    </div>
  );
}

/** Mechanic 5 — Security maturity vs sector benchmark. */
export function MaturityCard({ v }: { v: ValuePayload }) {
  const m = v.maturity;
  const comp = m.components;
  const bars: [string, number][] = [
    ['Automation rate', comp.automation_rate], ['SLA compliance', comp.sla_compliance],
    ['AI triage rate', comp.ai_triage_rate], ['Alert coverage', comp.alert_coverage],
  ];
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
      <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4" /> Operations maturity
      </p>
      <div className="flex items-center gap-4 mb-3">
        <p className="text-3xl font-bold text-purple-300">{m.score}<span className="text-sm text-[var(--ic-muted)]">/100</span></p>
        <div className="text-[11px]">
          <p className={m.score >= m.benchmark_sector_avg ? 'text-emerald-400' : 'text-amber-400'}>
            {m.score >= m.benchmark_sector_avg ? '▲ Above' : '▼ Below'} sector avg ({m.benchmark_sector_avg})
          </p>
          <p className="text-[var(--ic-muted)]">peers: finance / retail / SME Morocco</p>
        </div>
      </div>
      <div className="space-y-2">
        {bars.map(([label, val]) => (
          <div key={label} className="flex items-center gap-2 text-[11px]">
            <span className="w-32 text-[var(--ic-muted)]">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-[var(--ic-surface)] overflow-hidden">
              <div className="h-full rounded-full bg-purple-500/70" style={{ width: `${Math.min(100, val)}%` }} />
            </div>
            <span className="w-10 text-right text-[var(--ic-text)]">{val}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full strip used inside the merged Overview page (mechanics 1–6 together). */
export default function ValueEngineSection({ orgId }: { orgId?: number }) {
  const { v, loading, refresh } = useValueEngine(orgId);
  if (loading) {
    return (
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 animate-pulse">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-40 rounded-xl bg-[var(--ic-surface)]" />)}
      </div>
    );
  }
  if (!v) {
    return (
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 text-sm text-[var(--ic-muted)] flex items-center justify-between">
        <span>Value engine unavailable — start the backend or enable Demo Mode.</span>
        <button onClick={refresh} className="p-1.5 rounded-lg hover:bg-[var(--ic-surface)] text-[var(--ic-muted)]"><RefreshCw className="w-4 h-4" /></button>
      </div>
    );
  }
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-widest">Business value — live proof</h2>
        <div className="flex gap-2">
          <button onClick={refresh} title="Recompute" className="p-1.5 rounded-lg text-[var(--ic-muted)] hover:text-cyan-300 hover:bg-[var(--ic-surface)]"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => valueApi.proofPackCsv(v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20">
            <Download className="w-3.5 h-3.5" /> Proof Pack (CSV)
          </button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="md:col-span-2 xl:col-span-2"><ValueReceiptCard v={v} /></div>
        <RedLineCard v={v} />
        <RiskCostCard v={v} />
        <div className="md:col-span-2 xl:col-span-4"><MaturityCard v={v} /></div>
      </div>
    </section>
  );
}
