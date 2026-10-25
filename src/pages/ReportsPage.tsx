// Advanced Reporting portal page (Phase 1 skeleton of the 20-report system).
// Navigation: 3 levels — family bar -> report tabs -> numbered page pills.
// Downloads: page / report / family-as-report-list / all (CSV now, PDF Phase 6).
// Data: reportsApi — demo generator when Demo Mode ON, real API when OFF.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isDemoMode } from '../services/demoMode';
import { demoTenants } from '../data/demoWorld';
import {
  reportsApi, Block, Page, ReportBody, Meta, FAMILY_ORDER, REPORT_CATALOG,
} from '../services/reportsApi';

const COLORS: Record<string, string> = {
  o: '#10b981', b: '#ef4444', w: '#f59e0b', h: '#ea580c',
  '1': '#06b6d4', '2': '#3b82f6', '3': '#8b5cf6',
};
const BADGE_CLASS: Record<string, string> = {
  crit: 'bg-red-500/15 text-red-500 border border-red-500/30',
  high: 'bg-orange-500/15 text-orange-500 border border-orange-500/30',
  med: 'bg-amber-500/15 text-amber-500 border border-amber-500/30',
  low: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30',
  inf: 'bg-sky-500/15 text-sky-500 border border-sky-500/30',
};

function Cell({ v }: { v: any }) {
  const s = String(v ?? '');
  const m = s.match(/^@(crit|high|med|low|inf):(.*)$/);
  if (m) return <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${BADGE_CLASS[m[1]]}`}>{m[2]}</span>;
  return <>{s}</>;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 220, h = 42;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 6) - 3}`).join(' ');
  return (
    <svg width={w} height={h} className="text-cyan-400">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function GaugeRing({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative inline-block">
      <svg width="90" height="90">
        <circle cx="45" cy="45" r={r} fill="none" strokeWidth="9" className="stroke-slate-700" />
        <circle cx="45" cy="45" r={r} fill="none" strokeWidth="9" stroke="#10b981"
          strokeDasharray={`${(value / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 45 45)" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">{value}</span>
    </div>
  );
}

function Bar({ pct, color, label }: { pct: number; color: string; label?: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2.5 bg-[var(--ic-surface-2)] rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${Math.min(pct, 100)}%`, background: COLORS[color] ?? color }} />
      </div>
      <span className="text-xs text-[var(--ic-muted)] w-16 shrink-0">{label ?? `${pct}%`}</span>
    </div>
  );
}

function Donut({ items }: { items: Array<[string, number, string]> }) {
  const total = items.reduce((a, x) => a + x[1], 0) || 1;
  let acc = 0;
  const segs = items.map(([label, v, color]) => {
    const from = (acc / total) * 360; acc += v;
    const to = (acc / total) * 360;
    return <stop key={label} offset={`${from}deg`} stopColor={COLORS[color] ?? color} />;
  });
  let cum = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width="84" height="84" viewBox="0 0 42 42">
        {items.map(([label, v, color]) => {
          const dash = (v / total) * 100; const off = 25 - cum; cum += dash;
          return <circle key={label} cx="21" cy="21" r="15.9" fill="transparent" strokeWidth="7"
            stroke={COLORS[color] ?? color} strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={off} />;
        })}
      </svg>
      <ul className="space-y-1">
        {items.map(([label, v, color]) => (
          <li key={label} className="flex items-center gap-2 text-xs text-[var(--ic-text)]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[color] ?? color }} />
            {label} — {Math.round((v / total) * 100)}%
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  const kind = b[0];
  switch (kind) {
    case 'K': return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {b[1].map(([label, val, delta, color]) => (
          <div key={label} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--ic-muted)]">{label}</div>
            <div className="text-xl font-bold mt-1">{val}</div>
            <div className="text-xs mt-1" style={{ color: COLORS[color] }}>{delta}</div>
          </div>
        ))}
      </div>
    );
    case 'R': return (
      <div className="space-y-2">{b[1].map(([label, pct, color]) => (
        <div key={label}><div className="text-xs text-[var(--ic-muted)] mb-1">{label}</div><Bar pct={pct} color={color} /></div>
      ))}</div>
    );
    case 'B': return (
      <div>
        {b[1] ? <div className="text-sm font-semibold mb-2">{b[1]}</div> : null}
        <div className="space-y-2">{b[2].map(([label, pct, color, txt]) => (
          <Bar key={label} pct={pct} color={color} label={txt ?? `${pct}%`} />
        ))}</div>
      </div>
    );
    case 'T': return (
      <div className="overflow-x-auto rounded-lg border border-[var(--ic-border)]">
        {b[1] ? <div className="text-sm font-semibold px-3 pt-2">{b[1]}</div> : null}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
            {b[2].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{b[3].map((row, i) => (
            <tr key={i} className="border-b border-[var(--ic-border)] last:border-0">
              {row.map((cell, j) => <td key={j} className="px-3 py-2"><Cell v={cell} /></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
    case 'M': return (
      <div>
        {b[1] ? <div className="text-sm font-semibold mb-2">{b[1]}</div> : null}
        <div className="space-y-2">{b[2].map(([text, color], i) => (
          <div key={i} className="rounded-r-md border-l-4 bg-[var(--ic-surface)] px-3 py-2 text-sm"
            style={{ borderColor: COLORS[color] ?? '#64748b' }}>{text}</div>
        ))}</div>
      </div>
    );
    case 'L': return (
      <div>
        {b[1] ? <div className="text-sm font-semibold mb-2">{b[1]}</div> : null}
        <ul className="list-disc list-inside space-y-1 text-sm text-[var(--ic-text)]">
          {b[2].map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </div>
    );
    case 'F': return (
      <div>
        {b[1] ? <div className="text-sm font-semibold mb-2">{b[1]}</div> : null}
        <div className="flex flex-wrap gap-2 items-stretch">
          {b[2].map(([label, v], i) => (
            <React.Fragment key={label}>
              {i > 0 && <span className="self-center text-[var(--ic-muted)] text-lg">→</span>}
              <div className="flex-1 min-w-[110px] rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-3 text-center">
                <div className="text-xl font-bold text-cyan-400">{v.toLocaleString('fr-FR')}</div>
                <div className="text-[11px] text-[var(--ic-muted)] mt-1">{label}</div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
    case 'G': return (
      <div className="flex items-center gap-4">
        <div className="relative inline-block">
          <svg width="150" height="150" viewBox="0 0 150 150">
            <circle cx="75" cy="75" r="60" fill="none" strokeWidth="14" className="stroke-slate-700" />
            <circle cx="75" cy="75" r="60" fill="none" strokeWidth="14" stroke={COLORS[b[3]] ?? '#f59e0b'}
              strokeDasharray={`${(b[2] / 100) * 2 * Math.PI * 60} ${2 * Math.PI * 60}`} strokeLinecap="round" transform="rotate(-90 75 75)" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold">{b[2]}</span>
        </div>
        <div className="text-sm text-[var(--ic-text)]">{b[1]}</div>
      </div>
    );
    case 'S': return (
      <div>
        <div className="text-sm font-semibold mb-1">{b[1]}</div>
        <Sparkline values={b[2]} />
      </div>
    );
    case 'D': return (
      <div>
        {b[1] ? <div className="text-sm font-semibold mb-2">{b[1]}</div> : null}
        <Donut items={b[2]} />
      </div>
    );
    case 'H': return (
      <div>
        {b[1] ? <div className="text-sm font-semibold mb-2">{b[1]}</div> : null}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
          {b[2].map(([tac, heat]) => (
            <div key={tac} className="rounded-lg px-1.5 py-2 text-[10px] font-semibold text-center text-[var(--ic-heading)] leading-tight"
              style={{ background: `linear-gradient(135deg,#06b6d4,#3b82f6)`, opacity: 0.25 + (heat / 100) * 0.75 }} title={`${tac} — ${heat}%`}>
              {tac}
            </div>
          ))}
        </div>
      </div>
    );
    case 'C': return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {b[2].map(([col, items, color]) => (
          <div key={col} className="rounded-lg border-t-4 bg-[var(--ic-surface)] p-3" style={{ borderTopColor: COLORS[color] ?? color }}>
            <div className="text-xs uppercase tracking-wide text-[var(--ic-muted)] mb-2">{col}</div>
            <ul className="space-y-1 text-sm">{items.map((x) => <li key={x}>• {x}</li>)}</ul>
          </div>
        ))}
      </div>
    );
    case 'P': return (
      <div className="flex flex-wrap gap-6 text-xs text-[var(--ic-muted)] border-t border-dashed border-[var(--ic-border)] pt-3">
        {b[2].map((x, i) => <span key={i} className={i % 2 ? 'font-semibold text-[var(--ic-heading)]' : ''}>{x}{i % 2 ? '' : ':'}</span>)}
      </div>
    );
    default: return null;
  }
}

export default function ReportsPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  // Access model: client admin sees only its own tenant (orgId locked);
  // platform_admin & partner_admin may switch tenants via the filter below.
  const canSwitchTenant = user?.role === 'platform_admin' || user?.role === 'partner_admin';
  const [tenantOverride, setTenantOverride] = React.useState<string>('');
  const tenant = canSwitchTenant ? (tenantOverride || String(user?.orgId ?? '1')) : (user?.orgId ?? 'unknown');
  const [period, setPeriod] = React.useState('2026-10');
  const [family, setFamily] = React.useState(FAMILY_ORDER[0][0]);
  const [reportId, setReportId] = React.useState(REPORT_CATALOG[0][1]);
  const [pageNo, setPageNo] = React.useState<number | null>(null); // null = all pages
  const [body, setBody] = React.useState<ReportBody | null>(null);
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // deep link: #/{reportId}/{pageNo} handled through hash already owned by router;
  // keep simple internal state instead (route registered at /reports).
  React.useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([reportsApi.report(reportId, tenant, period), reportsApi.meta(period, String(tenant))])
      .then(([r, m]) => { if (alive) { setBody(r); setMeta(m); } })
      .catch((e) => { if (alive) setError(e?.message ?? 'Failed to load report'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reportId, period, tenant]);

  const famReports = REPORT_CATALOG.filter((x) => x[3] === family);
  const currentPages = body?.pages ?? [];
  const totalPages = REPORT_CATALOG.reduce((a, x) => a + x[4], 0);

  async function dl(scope: 'page' | 'report' | 'all') {
    setError(null);
    try {
      if (scope === 'all') {
        for (const [, id] of REPORT_CATALOG) await reportsApi.downloadCsv(id, tenant, period);
      } else if (scope === 'report') {
        await reportsApi.downloadCsv(reportId, tenant, period);
      } else if (pageNo) {
        await reportsApi.downloadCsv(reportId, tenant, period, pageNo);
      }
    } catch (e: any) { setError(e?.message ?? 'Export failed'); }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Advanced Reporting</h1>
          <p className="text-xs text-[var(--ic-muted)] mt-1">
            {meta ? `${meta.client} · ${meta.classification} · v${meta.version} · updated ${meta.last_updated}` : 'Loading meta…'}
            {isDemoMode() && <span className="ml-2 px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">DEMO DATA</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSwitchTenant && (
            <label className="text-xs text-[var(--ic-muted)] flex items-center gap-1.5">Tenant
              <select value={String(tenant)} onChange={(e) => setTenantOverride(e.target.value)}
                className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm">
                {demoTenants.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-[var(--ic-muted)]">Period</label>
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm" />
          <button onClick={() => dl('all')} className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 font-medium">⬇ All ({totalPages} pages)</button>
        </div>
      </div>

      {/* level 1: families */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--ic-border)] mb-3">
        {FAMILY_ORDER.map(([fid, fname]) => (
          <button key={fid} onClick={() => { setFamily(fid); const first = REPORT_CATALOG.find((x) => x[3] === fid); if (first) { setReportId(first[1]); setPageNo(null); } }}
            className={`px-3 py-2 text-xs font-semibold rounded-t ${family === fid ? 'bg-[var(--ic-surface)] text-[var(--ic-heading)] border border-b-0 border-[var(--ic-border)]' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
            {fname}
          </button>
        ))}
      </div>

      {/* level 2: reports in family */}
      <div className="flex flex-wrap gap-2 mb-3">
        {famReports.map(([num, id, title]) => (
          <button key={id} onClick={() => { setReportId(id); setPageNo(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${reportId === id ? 'bg-indigo-600/30 border-indigo-500 text-[var(--ic-heading)]' : 'border-[var(--ic-border)] text-[var(--ic-text)] hover:border-slate-500'}`}>
            #{num} {title}
          </button>
        ))}
      </div>

      {/* level 3: page pills + downloads */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setPageNo(null)}
          className={`px-2.5 py-1 rounded-full text-xs border ${pageNo === null ? 'bg-cyan-600/30 border-cyan-500' : 'border-[var(--ic-border)] text-[var(--ic-muted)]'}`}>All pages</button>
        {currentPages.map((_, i) => (
          <button key={i} onClick={() => setPageNo(i + 1)}
            className={`w-7 h-7 rounded-full text-xs border ${pageNo === i + 1 ? 'bg-cyan-600/30 border-cyan-500 text-[var(--ic-heading)]' : 'border-[var(--ic-border)] text-[var(--ic-muted)] hover:border-slate-500'}`}>{i + 1}</button>
        ))}
        <div className="ml-auto flex gap-2">
          <button disabled={!pageNo} onClick={() => dl('page')}
            className="text-xs px-2.5 py-1 rounded border border-[var(--ic-border)] disabled:opacity-40 hover:border-slate-500">⬇ This page CSV</button>
          <button onClick={() => dl('report')} className="text-xs px-2.5 py-1 rounded border border-[var(--ic-border)] hover:border-slate-500">⬇ Report CSV</button>
          <button title="PDF export arrives with Phase 6" disabled
            className="text-xs px-2.5 py-1 rounded border border-[var(--ic-border)] opacity-40 cursor-not-allowed">PDF (Phase 6)</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setReportId(reportId)} className="text-xs underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-lg bg-[var(--ic-surface)] animate-pulse" />)}</div>
      ) : body && (
        <div className="space-y-6">
          {(pageNo ? [currentPages[pageNo - 1]] : currentPages).map(([title, intro, blocks], pi) => (
            <section key={pi} data-page={pageNo ? pageNo : pi + 1}
              className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 md:p-5 print:break-after-page">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h2 className="text-base font-bold">{title}</h2>
                <span className="text-[10px] text-[var(--ic-muted)]">report #{body.number} · page {pageNo ? pageNo : pi + 1}/{body.pages.length}</span>
              </div>
              <p className="text-xs text-[var(--ic-muted)] mb-4">{intro}</p>
              <div className="space-y-4">{blocks.map((b, bi) => <BlockView key={bi} b={b} />)}</div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 text-[11px] text-[var(--ic-muted)]">
        Infracentra · Smarter Security. Stronger Infrastructure. — third-party tool names never appear in client output (brief §1).
        <button onClick={() => nav('/client-admin/dashboard')} className="underline ml-2">Back to dashboard</button>
      </div>
    </div>
  );
}
