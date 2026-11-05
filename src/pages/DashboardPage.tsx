import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Shield, AlertTriangle, Target, Zap, Clock, RefreshCw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { mockRiskScore, mockAlerts, mockAlertTimeline, mockThreatTrend } from '../data/mockData';
import { isDemoMode } from '../services/demoMode';
import { api, alertsApi, type AlertRow, type AlertSummary } from '../services/api';
import { fetchLiveThreats } from '../services/threatIntel';
import { soarApi } from '../services/soarApi';
import DashboardWidget, {
  WidgetLayoutProvider,
  WidgetGrid,
  ResetLayoutButton,
  CustomizeHint,
  type WidgetLayoutEntry,
} from '../components/DashboardWidget';
import { AddWidgetButton, AllCatalogEntries } from '../components/WidgetCatalog';

const DEFAULT_LAYOUT: WidgetLayoutEntry[] = [
  { id: 'kpi-alerts', colSpan: 1, collapsed: false },
  { id: 'kpi-threats', colSpan: 1, collapsed: false },
  { id: 'kpi-compliance', colSpan: 1, collapsed: false },
  { id: 'kpi-remediated', colSpan: 1, collapsed: false },
  { id: 'risk-gauge', colSpan: 1, collapsed: false },
  { id: 'recent-alerts', colSpan: 2, collapsed: false },
  { id: 'alert-volume', colSpan: 2, collapsed: false },
  { id: 'threat-trend', colSpan: 1, collapsed: false },
];

type ComplianceControl = { status: string; score: number | null };
type TimelinePoint = { time: string; alerts: number };
type ThreatTrendPoint = { date: string; threats: number; blocked: number };

function KpiTile({ icon, value, tone }: { icon: ReactNode; value: ReactNode; tone: string }) {
  return <div className="flex items-center gap-3 min-w-0">
    <span className={tone + ' flex-shrink-0'}>{icon}</span>
    <p className={'text-xl sm:text-2xl font-bold text-[var(--ic-heading)] leading-none tabular-nums truncate ' + tone}>{value}</p>
  </div>;
}

function RiskGauge({ score }: { score: number | null }) {
  if (score === null) return <div className="h-full min-h-[150px] flex flex-col items-center justify-center text-center gap-2">
    <span className="text-2xl text-[var(--ic-muted)]">—</span>
    <p className="text-xs text-[var(--ic-muted)]">No validated predictive-risk score is available in Live Mode.</p>
  </div>;
  const color = score <= 30 ? { text: 'text-cyber-green', stroke: '#00ff88', label: 'Low Risk' }
    : score <= 60 ? { text: 'text-cyber-yellow', stroke: '#ffd700', label: 'Moderate Risk' }
    : { text: 'text-cyber-red', stroke: '#ff3366', label: 'High Risk' };
  const circumference = 2 * Math.PI * 70;
  const dashOffset = circumference - (score / 100) * circumference * 0.75;
  return <div className="relative flex flex-col items-center w-full min-w-0">
    <svg viewBox="0 0 200 160" className="w-full h-auto max-w-[200px]">
      <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(100,116,139,0.1)" strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} transform="rotate(135, 100, 100)" />
      <circle cx="100" cy="100" r="70" fill="none" stroke={color.stroke} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} strokeDashoffset={dashOffset}
        transform="rotate(135, 100, 100)" />
    </svg>
    <div className="absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
      <div className={'text-3xl font-bold tabular-nums ' + color.text}>{score}</div>
      <div className="text-xs text-[var(--ic-muted)] mt-1">/ 100</div>
    </div>
    <div className={'text-sm font-medium mt-2 ' + color.text}>{color.label} · demo score</div>
  </div>;
}

function buildTimeline(alerts: AlertRow[]): TimelinePoint[] {
  const now = Date.now();
  const buckets = Array.from({ length: 12 }, (_, i) => ({ time: `${String((i * 2) % 24).padStart(2, '0')}:00`, alerts: 0 }));
  alerts.forEach(alert => {
    const age = (now - new Date(alert.created_at).getTime()) / 3600000;
    if (age < 0 || age >= 24) return;
    const bucket = Math.min(11, Math.floor(age / 2));
    buckets[11 - bucket].alerts += 1;
  });
  return buckets;
}

type DashboardData = {
  alerts: AlertRow[];
  openAlerts: number | null;
  activeThreats: number | null;
  complianceScore: number | null;
  completedRuns: number | null;
  riskScore: number | null;
  alertTimeline: TimelinePoint[];
  threatTrend: ThreatTrendPoint[] | null;
  sourceErrors: string[];
};

const emptyData: DashboardData = {
  alerts: [], openAlerts: null, activeThreats: null, complianceScore: null,
  completedRuns: null, riskScore: null, alertTimeline: [], threatTrend: null, sourceErrors: [],
};

export default function DashboardPage() {
  const demo = isDemoMode();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    if (demo) {
      const alerts = mockAlerts.map((alert, index) => ({
        id: index + 1, uid: String(alert.id), org_id: 0, title: alert.title,
        severity: alert.severity, source: alert.source,
        status: alert.status === 'open' ? 'active' : alert.status === 'acknowledged' ? 'acked' : 'resolved',
        created_at: alert.timestamp, correlated_count: 0, storm_suppressed: false,
        version: 1,
      })) as AlertRow[];
      setData({
        alerts,
        openAlerts: mockAlerts.filter(a => a.status === 'open').length,
        activeThreats: mockThreatTrend[mockThreatTrend.length - 1]?.threats ?? null,
        complianceScore: mockRiskScore.compliance,
        completedRuns: 23,
        riskScore: mockRiskScore.overall,
        alertTimeline: mockAlertTimeline,
        threatTrend: mockThreatTrend,
        sourceErrors: [],
      });
      setLoading(false);
      return;
    }

    const errors: string[] = [];
    const [summaryResult, alertsResult, threatsResult, controlsResult, runsResult] = await Promise.allSettled([
      alertsApi.summary(),
      alertsApi.page({ page: 1, page_size: 100 }),
      fetchLiveThreats(),
      api.get<ComplianceControl[]>('/compliance/controls'),
      soarApi.listRuns({ status: 'completed', page: 1, page_size: 1 }),
    ]);

    let summary: AlertSummary | null = null;
    let alerts: AlertRow[] = [];
    let activeThreats: number | null = null;
    let complianceScore: number | null = null;
    let completedRuns: number | null = null;

    if (summaryResult.status === 'fulfilled') summary = summaryResult.value;
    else errors.push('Alert summary unavailable: ' + String(summaryResult.reason));
    if (alertsResult.status === 'fulfilled') alerts = alertsResult.value.items;
    else errors.push('Recent alerts unavailable: ' + String(alertsResult.reason));
    if (threatsResult.status === 'fulfilled') activeThreats = threatsResult.value.length;
    else errors.push('Threat feed unavailable: ' + String(threatsResult.reason));
    if (controlsResult.status === 'fulfilled') {
      const assessed = controlsResult.value.filter(c => c.status !== 'not_assessed' && c.score !== null);
      complianceScore = assessed.length
        ? Math.round(assessed.reduce((sum, c) => sum + (c.score ?? 0), 0) / assessed.length)
        : null;
    } else errors.push('Compliance assessment unavailable: ' + String(controlsResult.reason));
    if (runsResult.status === 'fulfilled') completedRuns = runsResult.value.total;
    else errors.push('SOAR run history unavailable: ' + String(runsResult.reason));

    const openAlerts = summary
      ? Number(summary.by_status.active ?? 0) + Number(summary.by_status.acked ?? 0)
      : null;

    setData({
      alerts,
      openAlerts,
      activeThreats,
      complianceScore,
      completedRuns,
      riskScore: null,
      alertTimeline: buildTimeline(alerts),
      threatTrend: null,
      sourceErrors: errors,
    });
    setLoading(false);
  }, [demo]);

  useEffect(() => { void load(); }, [load]);

  const value = (n: number | null) => n === null ? '—' : n.toLocaleString();
  const complianceValue = data.complianceScore === null ? '—' : data.complianceScore + '%';

  return (
    <WidgetLayoutProvider pageKey="soc-dashboard" defaultLayout={DEFAULT_LAYOUT}>
      <div className="p-4 lg:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ic-heading)]">SOC Command Center</h1>
            <p className="text-sm text-[var(--ic-muted)] mt-1">{demo ? 'Demo dataset · simulated values' : 'Live tenant data · unavailable sources are shown as unavailable'}</p>
          </div>
          <div className="flex items-center gap-3">
            <CustomizeHint />
            <AddWidgetButton pageKey="soc-dashboard" defaultLayout={DEFAULT_LAYOUT} />
            <ResetLayoutButton pageKey="soc-dashboard" defaultLayout={DEFAULT_LAYOUT} />
            <button onClick={() => void load()} disabled={loading} className="rounded-lg border border-[var(--ic-border)] p-2 text-[var(--ic-muted)]">
              <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
            </button>
          </div>
        </div>

        {!demo && data.sourceErrors.length > 0 && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
          {data.sourceErrors.length} data source(s) could not be loaded. A dash means no validated value was returned; it is not a zero.
        </div>}

        <WidgetGrid>
          <DashboardWidget id="kpi-alerts" title="Open Alerts" spanOptions={[1, 2]}>
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} tone="text-red-400" value={loading ? '…' : value(data.openAlerts)} />
          </DashboardWidget>
          <DashboardWidget id="kpi-threats" title="Threat Feed Records" spanOptions={[1, 2]}>
            <KpiTile icon={<Target className="w-5 h-5" />} tone="text-orange-400" value={loading ? '…' : value(data.activeThreats)} />
          </DashboardWidget>
          <DashboardWidget id="kpi-compliance" title="Compliance Score" spanOptions={[1, 2]}>
            <KpiTile icon={<Shield className="w-5 h-5" />} tone="text-green-400" value={loading ? '…' : complianceValue} />
          </DashboardWidget>
          <DashboardWidget id="kpi-remediated" title="Completed SOAR Runs" spanOptions={[1, 2]}>
            <KpiTile icon={<Zap className="w-5 h-5" />} tone="text-cyan-400" value={loading ? '…' : value(data.completedRuns)} />
          </DashboardWidget>

          <DashboardWidget id="risk-gauge" title="Predictive Risk Score">
            <RiskGauge score={data.riskScore} />
          </DashboardWidget>

          <DashboardWidget id="recent-alerts" title="Recent Security Alerts" spanOptions={[2, 3]}>
            <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
              {data.alerts.slice(0, 5).map(alert => (
                <div key={alert.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--ic-surface-2)] min-w-0">
                  <div className={'w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ' + (alert.severity === 'critical' ? 'bg-red-500' : alert.severity === 'high' ? 'bg-orange-500' : 'bg-yellow-500')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--ic-heading)] truncate">{alert.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--ic-muted)]">{alert.source}</span>
                      <span className="text-xs text-[var(--ic-muted)]">·</span>
                      <span className="text-xs text-[var(--ic-muted)]">{alert.created_at ? new Date(alert.created_at).toLocaleString() : 'Time unavailable'}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!data.alerts.length && <p className="text-xs text-[var(--ic-muted)] py-8 text-center">{loading ? 'Loading alerts…' : 'No alert records returned.'}</p>}
            </div>
          </DashboardWidget>

          <DashboardWidget id="alert-volume" title={demo ? '24h Alert Volume' : 'Recent 100 Alerts · 24h Distribution'} spanOptions={[1, 2, 3]}>
            {data.alertTimeline.length ? <div className="h-full min-h-[180px] max-h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.alertTimeline}>
                  <defs><linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3}/><stop offset="95%" stopColor="#00d4ff" stopOpacity={0}/></linearGradient></defs>
                  <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="alerts" stroke="#00d4ff" fill="url(#alertGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div> : <p className="text-xs text-[var(--ic-muted)] py-8 text-center">No alert history available.</p>}
          </DashboardWidget>

          <DashboardWidget id="threat-trend" title="Threat Trend">
            {data.threatTrend ? <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.threatTrend}>
                <XAxis dataKey="date" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="threats" fill="#f97316" radius={[3, 3, 0, 0]} />
                <Bar dataKey="blocked" fill="#06b6d4" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer> : <p className="text-xs text-[var(--ic-muted)] py-8 text-center">Live historical threat-trend data is not available from the current feed endpoint.</p>}
          </DashboardWidget>

          {AllCatalogEntries()}
        </WidgetGrid>
      </div>
    </WidgetLayoutProvider>
  );
}
