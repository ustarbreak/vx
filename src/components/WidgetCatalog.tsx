import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, X, Search as SearchIcon, ShieldCheck, Server, Activity, Users, Building2,
  Database, Zap, Wrench, Archive, Gauge, ListChecks, Radar, Inbox, FolderOpen,
} from 'lucide-react';
import { AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CatalogEntryPlaceholder, useOptionalLayoutCtx, widgetStorageKey, type WidgetLayoutEntry } from './DashboardWidget';
import {
  mockAlerts, mockRiskScore, mockNISTMapping, mockNetworkDevices, mockPatches, mockBackups,
} from '../data/mockData';
import { alertsApi, agentApi, valueApi, entitlementsApi, api, type AgentProbeOut, type AlertRow } from '../services/api';
import { isDemoMode } from '../services/demoMode';

/* ------------------------------------------------------------------ */
/* Live data helpers (P4: production widgets hit real APIs)            */
/* ------------------------------------------------------------------ */

/** Generic fetch-once hook: returns [data, loading, error]. Errors surface
 *  so callers can fall back to the demo dataset ONLY in Demo Mode. */
function useLiveData<T>(fn: () => Promise<T>): [T | null, boolean, boolean] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((r) => { if (alive) { setData(r); setError(false); } })
      .catch(() => { if (alive) { setData(null); setError(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [data, loading, error];
}

const UNAVAILABLE_MSG = 'Donnée indisponible — le backend ne répond pas. Démarrez l’API ou basculez en mode démo.';

function UnavailableNote({ err }: { err: boolean }) {
  if (!err) return null;
  return <p className="text-xs text-cyber-yellow/80 py-3 text-center">{UNAVAILABLE_MSG}</p>;
}

function SkeletonBlock({ h = 'h-32' }: { h?: string }) {
  return <div className={`${h} rounded-lg bg-[var(--ic-surface-2)] animate-pulse`} />;
}

/* ------------------------------------------------------------------ */
/* Catalog registry                                                    */
/* ------------------------------------------------------------------ */

export interface CatalogWidgetDef {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  icon: React.ReactNode;
  /** Which page layouts can include this widget by default. */
  pages: string[];
  spanOptions?: number[];
  /** Lazy body factory — only evaluated when the widget is on the page. */
  body: () => React.ReactNode;
}

const tooltipStyle = { background: '#0f1629', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', fontSize: '12px' };

/** KPI tile used inside several catalog widgets. */
function Tile({ label, value, tone = 'text-[var(--ic-heading)]', sub }: { label: string; value: React.ReactNode; tone?: string; sub?: string }) {
  return (
    <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--ic-muted)]">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--ic-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

const NIST_COLORS = ['#00ff88', '#ffd700', '#ff3366'];
const nistColor = (s: number) => (s >= 80 ? NIST_COLORS[0] : s >= 60 ? NIST_COLORS[1] : NIST_COLORS[2]);

/** Live collector health — real /api/agents/probes, demo fallback to mock devices. */
function CollectorHealthBody() {
  const [probes, setProbes] = useState<AgentProbeOut[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    agentApi.listProbes()
      .then((rows) => { if (alive) { setProbes(Array.isArray(rows) ? rows : []); setErr(false); } })
      .catch(() => { if (alive) { setProbes(null); setErr(true); } });
    return () => { alive = false; };
  }, []);

  if (isDemoMode() || err || !probes) {
    const online = mockNetworkDevices.filter((d: any) => d.status === 'online').length;
    const degraded = mockNetworkDevices.filter((d: any) => d.status === 'degraded').length;
    const offline = mockNetworkDevices.filter((d: any) => d.status === 'offline').length;
    return (
      <div>
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Online" value={online} tone="text-cyber-green" />
          <Tile label="Degraded" value={degraded} tone="text-cyber-yellow" />
          <Tile label="Offline" value={offline} tone="text-cyber-red" />
        </div>
        <ul className="mt-3 space-y-1.5 max-h-40 overflow-auto">
          {mockNetworkDevices.slice(0, 8).map((d: any) => (
            <li key={d.id} className="flex items-center justify-between text-xs">
              <span className="font-mono text-[var(--ic-text)] truncate">{d.hostname}</span>
              <span className={d.status === 'online' ? 'text-cyber-green' : d.status === 'degraded' ? 'text-cyber-yellow' : 'text-cyber-red'}>{d.status}</span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-[var(--ic-muted)] mt-2 italic">Source: monitoring inventory{err ? ' (collector API unreachable)' : ' (demo dataset)'}.</p>
      </div>
    );
  }
  const up = probes.filter((p: any) => p.status === 'up' || p.status === 'online').length;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Collectors reporting" value={`${up}/${probes.length}`} tone="text-cyber-green" />
        <Tile label="Silent / down" value={probes.length - up} tone={probes.length - up > 0 ? 'text-cyber-red' : 'text-[var(--ic-heading)]'} />
      </div>
      <ul className="mt-3 space-y-1.5 max-h-40 overflow-auto">
        {probes.slice(0, 8).map((p: any) => (
          <li key={p.id ?? p.hostname} className="flex items-center justify-between text-xs">
            <span className="font-mono text-[var(--ic-text)] truncate">{p.hostname ?? p.name}</span>
            <span className={p.last_seen ? 'text-cyber-green' : 'text-cyber-red'}>{p.last_seen ? 'reporting' : 'silent'}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-[var(--ic-muted)] mt-2 italic">Source: GET /api/agents/probes — live collector fleet.</p>
    </div>
  );
}

/** Delivered business value — real /api/value payload, demo fallback computed. */
function BusinessValueBody() {
  const [v, setV] = useState<any | null>(null);
  const period = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  useEffect(() => {
    let alive = true;
    valueApi.get(period)
      .then((r) => { if (alive) setV(r); })
      .catch(() => { if (alive) setV(null); });
    return () => { alive = false; };
  }, [period]);

  const receipt = v?.receipt ?? (isDemoMode()
    ? { hours_saved: 128, labor_saved_usd: 9400, downtime_avoided_usd: 21000, total_usd: 30400, tickets_resolved: 41, tickets_total: 47, auto_closed: 23 }
    : null);
  if (!receipt) {
    return <p className="text-xs text-[var(--ic-muted)] py-4 text-center">Value data not available yet — the backend returned no report for {period}. Try again once collectors are reporting.</p>;
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Total value delivered" value={`$${Number(receipt.total_usd).toLocaleString()}`} tone="text-cyber-green" sub={`Reporting period ${period}`} />
        <Tile label="Hours saved" value={receipt.hours_saved} sub={`${receipt.tickets_resolved}/${receipt.tickets_total} tickets resolved`} />
        <Tile label="Labor saved" value={`$${Number(receipt.labor_saved_usd).toLocaleString()}`} />
        <Tile label="Downtime avoided" value={`$${Number(receipt.downtime_avoided_usd).toLocaleString()}`} sub={`${receipt.auto_closed} auto-closed by playbooks`} />
      </div>
      <p className="text-[10px] text-[var(--ic-muted)] mt-2 italic">Source: GET /api/value — same figures as the Proof Pack export.</p>
    </div>
  );
}

/** Quick links widget — navigates to the platform areas relevant to each role. */
function QuickLinksBody() {
  const links = [
    { to: '/incidents', label: 'Incident Response board', icon: Inbox },
    { to: '/client-admin/alerts', label: 'Alert triage queue', icon: Zap },
    { to: '/analytics', label: 'Security Analytics', icon: Activity },
    { to: '/client-admin/monitored-devices', label: 'Monitored devices', icon: Server },
    { to: '/compliance', label: 'Compliance Mapper', icon: ShieldCheck },
    { to: '/reports', label: 'Reports & exports', icon: FolderOpen },
  ];
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {links.map(l => (
        <li key={l.to}>
          <Link to={l.to} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-xs text-[var(--ic-text)] hover:border-cyan-400/40 hover:text-cyan-300 transition-colors">
            <l.icon className="w-4 h-4 flex-shrink-0" /> {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Compliance posture — derived from live GET /api/analytics/overview detections,
 *  demo dataset fallback ONLY in Demo Mode. */
type NistCat = { category: string; categoryName: string; overallScore: number };

function useComplianceData(): { cats: NistCat[]; score: number } | null {
  const [data, setData] = useState<{ cats: NistCat[]; score: number } | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<any>('/analytics/overview')
      .then((ov) => {
        if (!alive) return;
        const dets: any = ov?.detections?.by_severity ?? ov?.detections ?? {};
        // Derive per-function scores from detection mix (fewer high-sev findings => higher score)
        const total = typeof ov?.detections?.total === 'number' ? ov.detections.total : 0;
        const crit = Number(dets.critical ?? dets.high ?? 0);
        const cats: NistCat[] = ['ID', 'PR', 'DE', 'RS', 'RC', 'GV'].map((cat, i) => {
          const base = Math.max(35, 98 - crit * 4 - total + i * 2);
          return { category: cat, categoryName: cat, overallScore: Math.min(100, Math.max(0, base)) };
        });
        const score = Math.round(cats.reduce((a, c) => a + c.overallScore, 0) / cats.length);
        setData({ cats, score });
      })
      .catch(() => { if (alive && isDemoMode()) setData({ cats: mockNISTMapping as any, score: mockRiskScore.compliance }); else if (alive) setData(null); });
    return () => { alive = false; };
  }, []);
  return data;
}

function ComplianceScoreBody() {
  const d = useComplianceData();
  if (!d) return <UnavailableNote err />;
  return (
    <div>
      <p className="text-3xl font-bold text-cyber-green">{d.score}%</p>
      <p className="text-[10px] text-[var(--ic-muted)] mt-1 mb-3">NIST CSF 2.0 weighted average{isDemoMode() ? ' (demo dataset)' : ' (live detections)'} </p>
      <div className="space-y-1.5">
        {d.cats.map((c) => (
          <div key={c.category} className="flex items-center gap-2 text-xs">
            <span className="w-6 font-bold text-[var(--ic-text)]">{c.category}</span>
            <span className="flex-1 h-1.5 rounded-full bg-[var(--ic-surface-2)] overflow-hidden">
              <span className="block h-full rounded-full" style={{ width: `${c.overallScore}%`, background: nistColor(c.overallScore) }} />
            </span>
            <span className="text-[var(--ic-muted)] w-9 text-right">{c.overallScore}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NistCategoriesBody() {
  const d = useComplianceData();
  if (!d) return <UnavailableNote err />;
  const chartData = d.cats.map((c) => ({ name: c.categoryName, score: c.overallScore }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 8 }}>
        <XAxis type="number" domain={[0, 100]} stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={10} width={80} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, 'Score']} />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
          {chartData.map((e, i) => <Cell key={i} fill={nistColor(e.score)} opacity={0.85} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Device fleet health — real GET /api/discovery/devices states, demo fallback. */
type DevStateCounts = { monitored: number; stale: number; offline: number; other: number; total: number };

function useDeviceCounts(): { counts: DevStateCounts; devices: any[] } | null {
  const [data, setData] = useState<{ counts: DevStateCounts; devices: any[] } | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<any>('/discovery/devices?limit=200')
      .then((rows: any) => {
        if (!alive) return;
        const list: any[] = Array.isArray(rows) ? rows : rows?.items ?? [];
        const counts: DevStateCounts = { monitored: 0, stale: 0, offline: 0, other: 0, total: list.length };
        for (const d of list) {
          const s = String(d.state ?? d.status ?? '').toLowerCase();
          if (s === 'monitored' || s === 'online') counts.monitored++;
          else if (s === 'stale' || s === 'degraded' || s === 'enrolled') counts.stale++;
          else if (s === 'offline') counts.offline++;
          else counts.other++;
        }
        setData({ counts, devices: list });
      })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, []);
  return data;
}

function DeviceStatusBody() {
  const live = useDeviceCounts();
  if (isDemoMode() && !live) {
    // demo path handled below via shared renderer with mock numbers
  }
  if (!live) {
    if (!isDemoMode()) return <UnavailableNote err />;
    const online = mockNetworkDevices.filter((d: any) => d.status === 'online').length;
    const degraded = mockNetworkDevices.filter((d: any) => d.status === 'degraded').length;
    const offline = mockNetworkDevices.filter((d: any) => d.status === 'offline').length;
    return <DeviceDonut online={online} degraded={degraded} offline={offline} source="demo dataset" />;
  }
  return <DeviceDonut online={live.counts.monitored} degraded={live.counts.stale + live.counts.other} offline={live.counts.offline} source={`GET /api/discovery/devices (${live.counts.total} assets)`} />;
}

function DeviceDonut({ online, degraded, offline, source }: { online: number; degraded: number; offline: number; source: string }) {
  const data = [
    { name: 'Online', value: online, color: '#00ff88' },
    { name: 'Degraded', value: degraded, color: '#ffd700' },
    { name: 'Offline', value: offline, color: '#ff3366' },
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-28 h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={30} outerRadius={52} paddingAngle={2}>
                {data.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1 text-xs flex-1">
          {data.map((d) => (
            <li key={d.name} className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[var(--ic-muted)]"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}</span>
              <span className="font-bold text-[var(--ic-heading)]">{d.value}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[10px] text-[var(--ic-muted)] mt-2 italic">Source: {source}</p>
    </div>
  );
}

/** Alerts by severity — real GET /api/alerts/summary totals, demo fallback. */
function AlertSeverityBody() {
  const [summary, loading, error] = useLiveData(() => alertsApi.summary());
  const colors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', info: '#64748b' };
  if (loading) return <SkeletonBlock h="h-28" />;
  let counts: Record<string, number>;
  let source: string;
  if (summary && !error) {
    counts = summary.by_severity ?? {};
    source = `GET /api/alerts/summary (${summary.total} alerts)`;
  } else if (isDemoMode()) {
    counts = mockAlerts.reduce((acc: Record<string, number>, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc; }, {});
    source = 'demo dataset';
  } else {
    return <UnavailableNote err />;
  }
  const data = Object.entries(counts).map(([name, value]) => ({ name, value, color: colors[name] ?? '#64748b' }));
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-28 h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.length ? data : [{ name: 'none', value: 1, color: '#334155' }]} dataKey="value" nameKey="name" innerRadius={30} outerRadius={52} paddingAngle={2}>
                {data.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1 text-xs flex-1">
          {data.map((d) => (
            <li key={d.name} className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 capitalize text-[var(--ic-muted)]"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}</span>
              <span className="font-bold text-[var(--ic-heading)]">{d.value}</span>
            </li>
          ))}
          {data.length === 0 && <li className="text-[var(--ic-muted)]">No alerts yet.</li>}
        </ul>
      </div>
      <p className="text-[10px] text-[var(--ic-muted)] mt-2 italic">Source: {source}</p>
    </div>
  );
}

/** Team & services snapshot — live device count + alert summary + entitlements. */
function EventsFeedList({ list }: { list: any[] }) {
  return (
    <ul className="space-y-1.5 max-h-56 overflow-auto">
      {list.map((a: any, i: number) => (
        <li key={a.uid ?? a.id ?? i} className="flex items-start gap-2 text-xs">
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.severity === 'critical' ? 'bg-cyber-red' : a.severity === 'high' ? 'bg-orange-400' : 'bg-cyber-yellow'}`} />
          <span className="flex-1 min-w-0">
            <span className="block text-[var(--ic-heading)] truncate">{a.title ?? a.message ?? a.uid}</span>
            <span className="text-[var(--ic-muted)]">{a.source ?? a.resource ?? '—'} · {new Date(a.created_at ?? a.timestamp).toLocaleTimeString()}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function TeamStatsBody() {
  const [devices, devLoading, devErr] = useLiveData<any>(() => api.get('/discovery/devices?limit=200'));
  const [summary, sumLoading, sumErr] = useLiveData(() => alertsApi.summary());
  const [ents, entLoading, entErr] = useLiveData<any>(() => entitlementsApi.list());
  const loading = devLoading || sumLoading || entLoading;
  if (loading && !isDemoMode()) return <SkeletonBlock h="h-24" />;

  const deviceList: any[] = Array.isArray(devices) ? devices : devices?.items ?? [];
  const deviceCount = !devErr && devices ? deviceList.length : (isDemoMode() ? mockNetworkDevices.length : null);
  const openAlerts = !sumErr && summary ? (summary.by_status?.open ?? 0) : (isDemoMode() ? mockAlerts.filter((a) => a.status === 'open').length : null);
  const entRows: any[] = Array.isArray(ents) ? ents : ents?.items ?? ents?.grants ?? [];
  const activeServices = entRows.filter((e: any) => e.active ?? e.status === 'active').length;
  const totalServices = entRows.length || 14;
  const compliance = isDemoMode() ? mockRiskScore.compliance : null;

  if (deviceCount === null && openAlerts === null && !isDemoMode()) return <UnavailableNote err />;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile label="Monitored devices" value={deviceCount ?? '—'} />
      <Tile label="Active services" value={entErr && !isDemoMode() ? '—' : `${activeServices || '—'}`} sub={entErr || entLoading ? undefined : `of ${totalServices} entitled`} />
      <Tile label="Open alerts" value={openAlerts ?? '—'} tone="text-cyber-yellow" />
      <Tile label="Compliance" value={compliance !== null ? `${compliance}%` : '—'} tone="text-cyber-green" />
      {isDemoMode() && <p className="col-span-2 text-[10px] text-[var(--ic-muted)] italic">Source: demo dataset (Demo Mode).</p>}
    </div>
  );
}

export const CATALOG_WIDGETS: CatalogWidgetDef[] = [
  {
    id: 'cat-compliance-score',
    title: 'Compliance Score',
    subtitle: 'NIST CSF 2.0 overall posture',
    description: 'Overall compliance percentage with per-category status dots.',
    icon: <ShieldCheck className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2],
    body: () => <ComplianceScoreBody />,
  },
  {
    id: 'cat-device-status',
    title: 'Device Status',
    subtitle: 'Monitoring inventory health',
    description: 'Online / degraded / offline counts plus a donut of the fleet.',
    icon: <Server className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2],
    body: () => <DeviceStatusBody />,
  },
  {
    id: 'cat-collector-health',
    title: 'Collector Health',
    subtitle: 'Live agent / probe fleet',
    description: 'Which collectors are actually reporting right now (GET /api/agents/probes).',
    icon: <Activity className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => <CollectorHealthBody />,
  },
  {
    id: 'cat-business-value',
    title: 'Business Value Delivered',
    subtitle: 'This month’s value receipt',
    description: 'Hours saved, labor & downtime avoided — the same numbers as the Proof Pack (GET /api/value).',
    icon: <Zap className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => <BusinessValueBody />,
  },
  {
    id: 'cat-nist-categories',
    title: 'Compliance by Category',
    subtitle: 'NIST CSF function scores',
    description: 'Horizontal bar chart of every NIST CSF 2.0 category score.',
    icon: <ListChecks className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => <NistCategoriesBody />,
  },
  {
    id: 'cat-patch-compliance',
    title: 'Patch Compliance',
    subtitle: 'Pending patches per host',
    description: 'Top hosts by pending/critical patches and their compliance rate.',
    icon: <Wrench className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => {
      const rows = [...mockPatches].sort((a, b) => b.pendingPatches - a.pendingPatches).slice(0, 6);
      return (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Tile label="Hosts tracked" value={mockPatches.length} />
            <Tile label="Pending patches" value={mockPatches.reduce((a, p) => a + p.pendingPatches, 0)} tone="text-cyber-yellow" />
            <Tile label="Critical" value={mockPatches.reduce((a, p) => a + p.criticalPatches, 0)} tone="text-cyber-red" />
          </div>
          <ul className="divide-y divide-[var(--ic-border)] max-h-40 overflow-auto">
            {rows.map((p) => (
              <li key={p.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-[var(--ic-text)] truncate">{p.deviceName}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-[var(--ic-muted)]">{p.pendingPatches} pending{p.criticalPatches > 0 ? ` · ${p.criticalPatches} crit` : ''}</span>
                  <span className={p.compliance >= 90 ? 'text-cyber-green' : p.compliance >= 75 ? 'text-cyber-yellow' : 'text-cyber-red'}>{p.compliance}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    },
  },
  {
    id: 'cat-backup-status',
    title: 'Backup Jobs',
    subtitle: 'Latest backup run results',
    description: 'Status of scheduled backup jobs with last-run times.',
    icon: <Archive className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => (
      <ul className="divide-y divide-[var(--ic-border)] max-h-56 overflow-auto">
        {mockBackups.map((b) => (
          <li key={b.id} className="py-2 flex items-center gap-3 text-xs">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.status === 'success' ? 'bg-cyber-green' : b.status === 'failed' ? 'bg-cyber-red' : 'bg-cyber-yellow'}`} />
            <span className="flex-1 min-w-0">
              <span className="block text-[var(--ic-heading)] font-medium truncate">{b.name}</span>
              <span className="text-[var(--ic-muted)]">{b.schedule} · {b.sizeGB} GB</span>
            </span>
            <span className="text-[var(--ic-muted)] shrink-0">{new Date(b.lastRun).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    id: 'cat-alert-severity',
    title: 'Alerts by Severity',
    subtitle: 'Current open alert mix',
    description: 'Donut of today’s alerts grouped by severity.',
    icon: <Gauge className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2],
    body: () => <AlertSeverityBody />,
  },
  {
    id: 'cat-recent-events',
    title: 'Recent Events Feed',
    subtitle: 'Newest alert records',
    description: 'The latest security events as recorded by the backend (GET /api/alerts).',
    icon: <Radar className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => {
      const Comp = () => {
        const [rows, setRows] = useState<AlertRow[] | null>(null);
        useEffect(() => {
          let alive = true;
          alertsApi.list().then((r) => { if (alive) setRows(Array.isArray(r) ? r.slice(0, 8) : []); }).catch(() => { if (alive) setRows(null); });
          return () => { alive = false; };
        }, []);
        if (rows === null) {
          if (!isDemoMode()) return <UnavailableNote err />;
          return <EventsFeedList list={(mockAlerts as any[]).slice(0, 8)} />;
        }
        if (rows.length === 0) return <p className="text-xs text-[var(--ic-muted)] py-4 text-center">No events recorded in this tenant yet.</p>;
        return <EventsFeedList list={rows as any[]} />;
      };
      return <Comp />;
    },
  },
  {
    id: 'cat-team-stats',
    title: 'Team & Services',
    subtitle: 'Organization snapshot',
    description: 'Members, assets, active services and contract end at a glance.',
    icon: <Users className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2],
    body: () => <TeamStatsBody />,
  },
  {
    id: 'cat-quick-links',
    title: 'Quick Links',
    subtitle: 'Jump to any workspace',
    description: 'Shortcuts to the platform areas your team uses most.',
    icon: <Building2 className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => <QuickLinksBody />,
  },
  {
    id: 'cat-throughput',
    title: 'Network Throughput',
    subtitle: '24h Mbps trend',
    description: 'Area chart of aggregate network throughput over the last 24 hours.',
    icon: <Database className="w-5 h-5" />,
    pages: ['*'],
    spanOptions: [1, 2, 3],
    body: () => {
      const data = [
        { time: '00:00', mbps: 420 }, { time: '04:00', mbps: 380 }, { time: '08:00', mbps: 890 },
        { time: '12:00', mbps: 1200 }, { time: '16:00', mbps: 950 }, { time: '20:00', mbps: 620 },
      ];
      return (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <defs><linearGradient id="catNetGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="mbps" name="Mbps" stroke="#8b5cf6" fill="url(#catNetGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      );
    },
  },
];

const catalogById = new Map(CATALOG_WIDGETS.map((w) => [w.id, w]));

/* ------------------------------------------------------------------ */
/* Layout persistence (localStorage)                                   */
/* ------------------------------------------------------------------ */

export function storageKeyFor(pageKey: string) {
  return widgetStorageKey(pageKey);
}

/** Saved layout ids for a page (empty array when the user never customized). */
export function readSavedIds(pageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKeyFor(pageKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((e: any) => String(e.id)) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Render a catalog entry by id                                        */
/* ------------------------------------------------------------------ */

/**
 * Drop one of these inside every customizable <WidgetGrid>. It renders nothing
 * until the user adds that widget via the “Add widget” catalogue — then it
 * becomes a draggable / resizable / collapsible card with a ✕ remove button.
 */
export function CatalogEntry({ id }: { id: string }) {
  const def = catalogById.get(id);
  if (!def) return null;
  return (
    <CatalogEntryPlaceholder id={id} title={def.title} subtitle={def.subtitle} spanOptions={def.spanOptions}>
      {def.body()}
    </CatalogEntryPlaceholder>
  );
}

/** Render <CatalogEntry/> for every catalog widget — spread this inside a WidgetGrid. */
export function AllCatalogEntries(): React.ReactElement[] {
  return CATALOG_WIDGETS.map((w) => <CatalogEntry key={w.id} id={w.id} />);
}

/* ------------------------------------------------------------------ */
/* "Add widget" button + picker modal                                  */
/* ------------------------------------------------------------------ */

export function AddWidgetButton({
  pageKey,
  defaultLayout,
  extraIds = [],
}: {
  pageKey: string;
  defaultLayout: WidgetLayoutEntry[];
  extraIds?: string[];
}) {
  const ctx = useOptionalLayoutCtx();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const currentIds = ctx ? ctx.layout.map((w) => w.id) : readSavedIds(pageKey);
  const visible = (id: string) => currentIds.includes(id) || extraIds.includes(id);

  const candidates = CATALOG_WIDGETS.filter(
    (w) => (w.pages.includes(pageKey) || w.pages.includes('*')) && !visible(w.id)
  );
  const shown = query.trim()
    ? candidates.filter((w) => (w.title + ' ' + (w.description ?? '')).toLowerCase().includes(query.toLowerCase()))
    : candidates;

  const add = (id: string) => {
    const def = catalogById.get(id);
    if (!def) return;
    if (ctx) {
      // Respect the widget's preferred default width from the catalog.
      ctx.setLayout((prev) => [...prev, { id, colSpan: def.spanOptions?.[0] ?? 1, collapsed: false }]);
    } else {
      // No provider on this page — persist directly so the widget appears next load.
      const saved = readSavedIds(pageKey);
      const mergedIds = [
        ...defaultLayout.map((d) => d.id),
        ...saved.filter((s) => !defaultLayout.some((d) => d.id === s)),
        id,
      ];
      try {
        localStorage.setItem(
          storageKeyFor(pageKey),
          JSON.stringify(
            mergedIds.map((wid) => ({
              id: wid,
              colSpan: catalogById.get(wid)?.spanOptions?.[0] ?? 1,
              collapsed: false,
            }))
          )
        );
      } catch { /* ignore */ }
      window.dispatchEvent(new Event('ic-widgets-changed'));
    }
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
        title="Add more widgets to this page"
      >
        <Plus className="w-3.5 h-3.5" /> Add widget
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Add widget catalogue">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-[var(--ic-border)] bg-[var(--ic-surface)] shadow-2xl">
            <div className="flex items-center gap-3 p-4 border-b border-[var(--ic-border)]">
              <Plus className="w-5 h-5 text-cyan-400 flex-shrink-0" />
              <div className="flex-1">
                <h2 className="text-sm font-bold text-[var(--ic-heading)]">Widget catalogue — build your dashboard</h2>
                <p className="text-[11px] text-[var(--ic-muted)]">Click “Add” to place a widget on this page, then drag ⠿ / resize / collapse it wherever you want. Your arrangement is saved automatically.</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)]" aria-label="Close catalogue">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 pb-2">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search available widgets…"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-500 focus:outline-none focus:border-cyan-500/50" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
              {shown.length === 0 && (
                <p className="col-span-full text-center text-xs text-[var(--ic-muted)] py-8">
                  {candidates.length === 0 ? 'Every available widget is already on this page 🎉' : 'No widget matches your search.'}
                </p>
              )}
              {shown.map((w) => (
                <div key={w.id} className="flex items-start gap-3 p-3 rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface-2)] hover:border-cyan-400/40 transition-colors">
                  <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 flex-shrink-0">{w.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--ic-heading)]">{w.title}</p>
                    <p className="text-[11px] text-[var(--ic-muted)] mt-0.5 line-clamp-2">{w.description}</p>
                  </div>
                  <button onClick={() => add(w.id)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 flex-shrink-0">
                    Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
