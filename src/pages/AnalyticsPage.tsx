import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, Cell, Legend,
} from 'recharts';
import {
  AlertTriangle, RefreshCw, Shield, Target, Timer, Activity, Database, Info,
} from 'lucide-react';
import ServiceGate from '../components/ServiceGate';
import { RelationshipGraph, type RGNode, type RGEdge } from '../components/RelationshipGraph';
import DashboardWidget, {
  WidgetLayoutProvider,
  WidgetGrid,
  ResetLayoutButton,
  CustomizeHint,
  type WidgetLayoutEntry,
} from '../components/DashboardWidget';
import { isDemoMode } from '../services/demoMode';
import { fetchIndicatorMatches, type IndicatorMatch } from '../services/threatIntel';
import { alertsApi, type AlertRow } from '../services/api';
import {
  fetchAnalyticsOverview, RANGE_PRESETS, windowForPreset, fmtMinutes,
  AnalyticsOverview,
} from '../services/analyticsApi';

const ANALYTICS_LAYOUT: WidgetLayoutEntry[] = [
  { id: 'an-kpis', colSpan: 3, collapsed: false },
  { id: 'an-trend', colSpan: 2, collapsed: false },
  { id: 'an-severity', colSpan: 1, collapsed: false },
  { id: 'an-categories', colSpan: 1, collapsed: false },
  { id: 'an-assets', colSpan: 2, collapsed: false },
];

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', info: '#64748b',
};

/** "in 5 min" / "3 h ago" style freshness label for generated_at. */
function freshnessLabel(generatedAt: string): string {
  const diff = Date.now() - Date.parse(generatedAt);
  if (Number.isNaN(diff)) return 'unknown';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

function KpiCard({ icon, label, value, sub, tone = 'text-[var(--ic-heading)]' }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-[var(--ic-muted)]">{label}</span></div>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--ic-muted)] mt-1">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Correlation Explorer (§6C). Nodes/edges come ONLY from persisted records:
//  • alerts (GET /api/alerts — server-side correlated groups via resource)
//  • incidents (via /api/analytics/overview scope + /threat-intel/matches,
//    which joins IoC ⇄ incident ⇄ asset ⇄ related alert UIDs server-side)
// Cross-filtering: selecting a severity/category in the charts above filters
// the graph nodes; clicking an alert node pivots to the Alerts workspace.
// No anomaly scores, no inferred edges.
// ---------------------------------------------------------------------------
function CorrelationExplorer({ sevFilter }: { sevFilter: string | null }) {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [matches, setMatches] = useState<IndicatorMatch[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([alertsApi.list().catch(() => [] as AlertRow[]), fetchIndicatorMatches().catch(() => [] as IndicatorMatch[])])
      .then(([a, m]) => { if (!cancelled) { setAlerts(a); setMatches(m); } })
      .catch(e => { if (!cancelled) setErr(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  const { nodes, edges } = useMemo(() => {
    const n = new Map<string, RGNode>(); const e: RGEdge[] = [];
    if (!alerts || !matches) return { nodes: [], edges: [] };
    // Group alerts by resource — this is the backend's own correlation key
    // (same resource ⇒ same storm group / correlated_count on the row).
    const byRes = new Map<string, AlertRow[]>();
    alerts.forEach(a => { if (a.resource) (byRes.get(a.resource) ?? byRes.set(a.resource, []).get(a.resource)!).push(a); });
    [...byRes.entries()].filter(([, list]) => list.length > 1).slice(0, 12).forEach(([res, list]) => {
      const resId = `asset:${res}`;
      n.set(resId, { id: resId, label: res, kind: 'asset' });
      list.slice(0, 6).forEach(a => {
        if (sevFilter && a.severity !== sevFilter) return;
        const aid = `alert:${a.uid}`;
        n.set(aid, { id: aid, label: a.uid, kind: 'alert', severity: a.severity, meta: { uid: a.uid } });
        e.push({ source: aid, target: resId, evidence: `Alert ${a.uid} recorded against resource ${res} (server correlation key)` });
      });
    });
    // Incident ⇄ indicator ⇄ alert joins supplied by /threat-intel/matches.
    matches.slice(0, 40).forEach(m => {
      if (sevFilter && m.severity !== sevFilter) return;
      const iid = `inc:${m.incident_uid}`;
      n.set(iid, { id: iid, label: m.incident_uid, kind: 'incident', severity: m.severity, meta: { uid: m.incident_uid } });
      const indId = `ind:${m.indicator}`;
      n.set(indId, { id: indId, label: m.indicator, kind: 'indicator', severity: m.severity });
      e.push({ source: indId, target: iid, evidence: `IoC attached to incident ${m.incident_uid} during IR triage` });
      m.assets.forEach(a => {
        const aid2 = `asset:${a}`;
        if (!n.has(aid2)) n.set(aid2, { id: aid2, label: a, kind: 'asset' });
        e.push({ source: iid, target: aid2, evidence: `Affected asset recorded on ${m.incident_uid}` });
      });
      m.related_alert_uids.forEach(u => {
        const alid = `alert:${u}`;
        if (!n.has(alid)) n.set(alid, { id: alid, label: u, kind: 'alert' });
        e.push({ source: alid, target: iid, evidence: `Alert correlated to ${m.incident_uid} by shared resource (backend join)` });
      });
    });
    return { nodes: [...n.values()], edges: e };
  }, [alerts, matches, sevFilter]);

  if (err) return (
    <div className="bg-[var(--ic-surface)] border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4" /> Correlation sources unreachable: {err}
    </div>
  );
  if (!alerts || !matches) return <div className="h-24 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] animate-pulse" />;

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 space-y-3">
      <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400" /> Correlation explorer
      </h3>
      <p className="text-[10px] text-[var(--ic-muted)]">
        Relationships shown only where persisted records link them: alert→resource (correlation key), IoC→incident (IR triage), incident→asset, alert→incident (backend join). {sevFilter ? `Cross-filtered to severity “${sevFilter}”.` : 'Select a severity bar above to cross-filter.'}
      </p>
      {nodes.length === 0 ? (
        <p className="text-xs text-[var(--ic-muted)] py-6 text-center">No correlated records in scope{sevFilter ? ` for severity “${sevFilter}”` : ''}. Edges appear when the backend actually links events — none are inferred.</p>
      ) : (
        <RelationshipGraph nodes={nodes} edges={edges} height={360} maxNodes={150}
          title="Correlation explorer graph of alerts, assets, indicators and incidents"
          onOpen={node => {
            if (node.kind === 'alert') navigate(`/client-admin/alerts?q=${encodeURIComponent(node.label)}`);
            else if (node.kind === 'incident') navigate(`/incidents?q=${encodeURIComponent(node.label)}`);
            else if (node.kind === 'asset') navigate(`/client-admin/monitored-devices?q=${encodeURIComponent(node.label)}`);
          }} />
      )}
    </div>
  );
}

function AnalyticsContent() {
  const [rangeKey, setRangeKey] = useState('7d');
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  // Cross-filter selected via the severity chart (§6C intelligent-graph rule).
  const [sevSel, setSevSel] = useState<string | null>(null);

  const load = useCallback(() => {
    const preset = RANGE_PRESETS.find(p => p.key === rangeKey) ?? RANGE_PRESETS[1];
    const win = windowForPreset(preset.hours);
    setStatus('loading');
    fetchAnalyticsOverview({ ...win, bucket: preset.bucket })
      .then(d => { setData(d); setStatus('ok'); })
      .catch(e => { setError(String(e?.message ?? e)); setStatus('error'); });
  }, [rangeKey]);

  useEffect(() => { load(); }, [load, reloadTick]);

  // Trend chart data straight from server buckets (UTC).
  const trendData = useMemo(() => (data?.trend ?? []).map(t => ({
    bucket: t.bucket.length > 13 ? t.bucket.slice(5, 10) + (t.bucket.includes('T') ? ' ' + t.bucket.slice(11, 16) : '') : t.bucket,
    events: t.events, detections: t.detections,
  })), [data]);

  const sevBars = useMemo(() => Object.entries(data?.events.by_severity ?? {}).map(([k, v]) => ({ sev: k, n: v })), [data]);
  const catBars = useMemo(() => Object.entries(data?.detections.by_category ?? {}).map(([k, v]) => ({ cat: k, n: v })), [data]);

  const empty = status === 'ok' && data && data.events.total === 0 && data.detections.total === 0;

  return (
    <WidgetLayoutProvider pageKey="analytics" defaultLayout={ANALYTICS_LAYOUT}>
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Security Analytics</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">
            Aggregated from this tenant's alert &amp; incident records — all timestamps UTC
          </p>
          {isDemoMode() && (
            <p className="text-[10px] text-fuchsia-400/70 mt-1 uppercase tracking-wide">
              Demo Mode — metrics computed from the simulated dataset (same aggregation rules as the API)
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {RANGE_PRESETS.map(p => (
            <button key={p.key} onClick={() => setRangeKey(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                rangeKey === p.key
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'bg-[var(--ic-surface)] border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-text)]'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setReloadTick(t => t + 1)} title="Refresh"
            className="p-1.5 rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] text-[var(--ic-muted)] hover:text-cyan-300">
            <RefreshCw className={`w-4 h-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
          <CustomizeHint />
          <ResetLayoutButton pageKey="analytics" defaultLayout={ANALYTICS_LAYOUT} />
        </div>
      </div>

      {/* Time window + freshness strip (timezone and data age are explicit) */}
      {data && status === 'ok' && (
        <div className="text-xs text-[var(--ic-muted)] flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1"><Info className="w-3.5 h-3.5" />
            Window: {new Date(data.window.since).toISOString().slice(0, 16).replace('T', ' ')} → {new Date(data.window.until).toISOString().slice(0, 16).replace('T', ' ')} UTC
            ({data.window.bucket === 'hour' ? 'hourly' : 'daily'} buckets)</span>
          <span>Aggregation time: {new Date(data.generated_at).toLocaleString()} (local) · computed {freshnessLabel(data.generated_at)}</span>
          <span className={data.data_freshness === 'live' ? 'text-emerald-400' : 'text-amber-400'}>
            ● {data.data_freshness === 'live' ? 'Data present in window' : 'No data in window'}
          </span>
        </div>
      )}

      {/* Backend error state */}
      {status === 'error' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300">Analytics backend unreachable or rejected the request</p>
            <p className="text-xs text-[var(--ic-muted)] mt-1 break-all">{error}</p>
            <button onClick={() => setReloadTick(t => t + 1)}
              className="mt-2 px-3 py-1 rounded-lg text-xs bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30">
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {status === 'loading' && !data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] animate-pulse" />)}
        </div>
      )}

      {/* Empty dataset state — never fake zeros on charts */}
      {empty && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-8 text-center">
          <Database className="w-8 h-8 text-[var(--ic-muted)] mx-auto mb-3" />
          <p className="text-sm font-semibold text-[var(--ic-heading)]">No security events or detections in this window</p>
          <p className="text-xs text-[var(--ic-muted)] mt-2 max-w-lg mx-auto">
            The backend returned an empty result set for the selected range. Widen the time range, or verify that
            collectors are reporting (Monitored Devices) and that SIEM ingest is active. Metrics shown elsewhere
            always reflect this same window — nothing is back-filled with sample data.
          </p>
        </div>
      )}

      {data && status === 'ok' && !empty && (
        <>
          {/* Everything below is one reorderable/resizable widget grid */}
          <WidgetGrid>
          <DashboardWidget id="an-kpis" title="Key Metrics" spanOptions={[1, 2, 3]} subtitle="Every number traced to /api/analytics/overview fields">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard icon={<Activity className="w-4 h-4 text-cyan-400" />} label="Events (stored alert rows)"
              value={String(data.events.total)}
              sub={`${data.events.raw_events_weighted} raw incl. correlated duplicates (not counted as separate events)`} />
            <KpiCard icon={<Shield className="w-4 h-4 text-purple-400" />} label="Detections (deduped incidents)"
              value={String(data.detections.total)}
              sub={`Open: ${Object.entries(data.detections.by_status).filter(([s]) => !['resolved', 'closed'].includes(s)).reduce((a, [, n]) => a + n, 0)} · scope: this org, window above`} />
            <KpiCard icon={<Timer className="w-4 h-4 text-emerald-400" />} label="MTTD (acknowledge proxy)"
              value={fmtMinutes(data.detections.mttd_minutes)} tone={data.detections.mttd_minutes == null ? 'text-[var(--ic-muted)]' : 'text-[var(--ic-heading)]'}
              sub="mean created→acknowledged over acked incidents; “No data” when no sample" />
            <KpiCard icon={<Target className="w-4 h-4 text-orange-400" />} label="MTTR (resolution)"
              value={fmtMinutes(data.detections.mttr_minutes)} tone={data.detections.mttr_minutes == null ? 'text-[var(--ic-muted)]' : 'text-[var(--ic-heading)]'}
              sub="mean created→resolved over resolved/closed incidents" />
          </div>
          </DashboardWidget>

          {/* Trend + severity distribution */}
          <DashboardWidget id="an-trend" title="Historical trend (UTC)" spanOptions={[1, 2, 3]}
            subtitle="Events = stored alert rows · Detections = deduped incidents — two compatible series, never summed together.">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="evGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} /><stop offset="95%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient>
                    <linearGradient id="detGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} /><stop offset="95%" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="bucket" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '8px', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="events" name="Events" stroke="#22d3ee" fill="url(#evGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="detections" name="Detections" stroke="#a855f7" fill="url(#detGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
          </DashboardWidget>

          <DashboardWidget id="an-severity" title="Severity distribution" spanOptions={[1, 2, 3]}
            subtitle="Event rows by severity within the selected window.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sevBars} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#475569" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="sev" stroke="#94a3b8" fontSize={11} width={70} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="n" name="Events" radius={[0, 4, 4, 0]}
                     onClick={(entry: any) => { const sev = entry?.payload?.sev; if (sev) setSevSel(s => (s === sev ? null : sev)); }}>
                    {sevBars.map(b => <Cell key={b.sev} fill={SEV_COLORS[b.sev] ?? '#64748b'} stroke={sevSel === b.sev ? '#f8fafc' : 'none'} strokeWidth={sevSel === b.sev ? 2 : 0} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                <span className="text-[var(--ic-muted)]">Click a bar to cross-filter the correlation explorer:</span>
                {sevBars.map(b => (
                  <button key={b.sev} onClick={() => setSevSel(s => (s === b.sev ? null : b.sev))}
                    aria-pressed={sevSel === b.sev}
                    className={`px-2 py-0.5 rounded-full border uppercase font-bold ${sevSel === b.sev ? 'border-slate-200 text-white bg-slate-600/40' : 'border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-text)]'}`}>
                    {b.sev}
                  </button>
                ))}
                {sevSel && <button onClick={() => setSevSel(null)} className="text-cyan-400 underline">clear filter</button>}
              </div>
          </DashboardWidget>

          {/* Detection categories + affected assets drill-down */}
          <DashboardWidget id="an-categories" title="Detection categories" spanOptions={[1, 2, 3]}
            subtitle="Incident records grouped by category (deduped detections).">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={catBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="cat" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={40} />
                  <YAxis stroke="#475569" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="n" name="Detections" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
          </DashboardWidget>

          <DashboardWidget id="an-assets" title={`Affected assets (top ${data.top_assets.length || '—'})`} spanOptions={[1, 2, 3]}
            subtitle="By event volume in window. Links drill into the monitoring inventory and IR board.">
              {data.top_assets.length === 0 ? (
                <p className="text-xs text-[var(--ic-muted)] py-6 text-center">No asset-attributed events in this window.</p>
              ) : (
                <ul className="divide-y divide-[var(--ic-border)] max-h-[200px] overflow-auto">
                  {data.top_assets.map(a => (
                    <li key={a.resource} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-cyan-300 truncate">{a.resource}</span>
                      <span className="flex items-center gap-3 shrink-0">
                        <span className="text-[var(--ic-muted)]">{a.events} events</span>
                        <Link to={`/client-admin/monitored-devices?q=${encodeURIComponent(a.resource)}`}
                          className="text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline">device</Link>
                        <Link to={`/incidents?q=${encodeURIComponent(a.resource)}`}
                          className="text-purple-400 hover:text-purple-300 underline-offset-2 hover:underline">incidents</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </DashboardWidget>
          </WidgetGrid>

          {/* §6C — Correlation Explorer over persisted, backend-linked records */}
          <CorrelationExplorer sevFilter={sevSel} />

          <p className="text-[10px] text-[var(--ic-muted)]">
            Metric definitions: events = Alert rows scoped to this organization; detections = Incident rows (deduplicated lifecycle records);
            MTTD/MTTR denominators only include incidents carrying the respective timestamp in-window. Duplicate correlated signals are reported
            via <code className="font-mono">raw_events_weighted</code> and never inflated into independent detections.
          </p>
        </>
      )}
    </div>
    </WidgetLayoutProvider>
  );
}

export default function AnalyticsPage() {
  return <ServiceGate serviceId="analytics"><AnalyticsContent /></ServiceGate>;
}
