// ---------------------------------------------------------------------------
// Dashboard ops widgets — posture KPI strip, security-operations summary and
// infrastructure health for the Client Admin Overview page.
//
// Honesty rules:
//   * Every number here comes from a real backend call (alertsApi.list,
//     agentApi.listProbes) or from tenant context served by AuthContext.
//   * When an endpoint fails or returns nothing we render an explicit
//     "Unavailable" state — never a fabricated zero and never demo fixtures
//     outside Demo Mode (the demo branches live in demoMode.ts only).
//   * Drill-downs go to routes that exist in App.tsx:
//       /client-admin/alerts/:id  (AlertsPage detail)
//       /client-admin/agents      (collector fleet)
//       /client-admin/alerts      (full incident queue)
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Server, Activity, AlertTriangle, CheckCircle2, WifiOff, ArrowRight,
} from 'lucide-react';
import { alertsApi, agentApi, AlertRow, AgentProbeOut } from '../../services/api';

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  info: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

export function ageMinutes(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

function fmtAge(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${Math.floor(min / 1440)}d`;
}

/** Shared loader for the alert list (used by posture strip + ops table). */
export function useDashboardAlerts(orgId?: number) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null); // null = not loaded/unavailable
  const [error, setError] = useState(false);
  const load = () => {
    alertsApi.list(orgId)
      .then((rows) => { setAlerts(Array.isArray(rows) ? rows : []); setError(false); })
      .catch(() => { setAlerts(null); setError(true); });
  };
  useEffect(() => {
    load();
    window.addEventListener('demo-world-pushed', load);
    return () => window.removeEventListener('demo-world-pushed', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  return { alerts, error, refresh: load };
}

interface PostureKpi { label: string; value: string; sub: string; icon: React.ReactNode; tone: string; to?: string }

/** D — Global security posture strip. All values derived from real data. */
export function PostureKpiStrip({ alerts, probes, assetCount, complianceScore }: {
  alerts: AlertRow[] | null;
  probes: AgentProbeOut[] | null;
  assetCount: number;
  complianceScore: number;
}) {
  const nav = useNavigate();
  const open = alerts === null ? null : alerts.filter(a => !a.acked_at);
  const critOpen = open ? open.filter(a => a.severity === 'critical').length : null;
  const highOpen = open ? open.filter(a => a.severity === 'high').length : null;
  const online = probes ? probes.filter(p => p.status === 'online').length : null;

  const kpis: PostureKpi[] = [
    {
      label: 'Open critical incidents', value: critOpen === null ? '—' : String(critOpen),
      sub: critOpen === null ? 'unavailable — alerts API unreachable' : 'unacknowledged · source: /api/alerts',
      icon: <AlertTriangle className="w-4 h-4 text-rose-400" />, tone: 'text-rose-300', to: '/client-admin/alerts?severity=critical',
    },
    {
      label: 'Open high incidents', value: highOpen === null ? '—' : String(highOpen),
      sub: highOpen === null ? 'unavailable' : 'unacknowledged · source: /api/alerts',
      icon: <Shield className="w-4 h-4 text-orange-400" />, tone: 'text-orange-300', to: '/client-admin/alerts?severity=high',
    },
    {
      label: 'Agents online', value: online === null ? '—' : `${online}/${probes!.length}`,
      sub: online === null ? 'unavailable — collectors API unreachable' : 'collectors reporting · source: /api/agents/probes',
      icon: <Server className="w-4 h-4 text-cyan-400" />, tone: 'text-cyan-300', to: '/client-admin/agents',
    },
    {
      label: 'Assets', value: String(assetCount),
      sub: 'inventory count · tenant context',
      icon: <Activity className="w-4 h-4 text-purple-400" />, tone: 'text-purple-300', to: '/client-admin/asset-inventory',
    },
    {
      label: 'Compliance', value: `${complianceScore}%`,
      sub: 'NIST CSF 2.0 · tenant context',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, tone: 'text-emerald-300', to: '/client-admin/compliance-reports',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {kpis.map(k => (
        <button key={k.label} onClick={() => k.to && nav(k.to)}
          className="text-left bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 hover:border-cyan-500/40 transition-colors group">
          <div className="flex items-center gap-2 mb-2">
            {k.icon}
            <span className="text-xs text-[var(--ic-muted)]">{k.label}</span>
          </div>
          <p className={`text-2xl font-bold ${k.tone}`}>{k.value}</p>
          <p className="text-[10px] text-[var(--ic-muted)] mt-1 flex items-center gap-1">
            {k.sub}
            {k.to && <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </p>
        </button>
      ))}
    </div>
  );
}

/** E — Security operations summary: actionable (unacked) incidents with drill-down. */
export function OpsSummaryTable({ alerts, error, onRefresh }: {
  alerts: AlertRow[] | null; error: boolean; onRefresh: () => void;
}) {
  const nav = useNavigate();
  const rows = useMemo(() => {
    if (!alerts) return [];
    const rank = (s: string) => ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s] ?? 0);
    return [...alerts].filter(a => !a.acked_at)
      .sort((a, b) => rank(b.severity) - rank(a.severity) || Date.parse(a.created_at) - Date.parse(b.created_at))
      .slice(0, 8);
  }, [alerts]);

  return (
    <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ic-border)]">
        <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-widest">Security operations — actionable incidents</h2>
        <div className="flex items-center gap-3">
          {alerts && <span className="text-[11px] text-[var(--ic-muted)]">{rows.length} shown · {alerts.filter(a => !a.acked_at).length} open</span>}
          <button onClick={onRefresh} className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300">Refresh</button>
          <button onClick={() => nav('/client-admin/alerts')} className="text-[11px] px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20">View all</button>
        </div>
      </div>
      {error || alerts === null ? (
        <p className="px-5 py-8 text-sm text-[var(--ic-muted)]">
          Incident feed unavailable — the alerts API could not be reached. No data is being simulated.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-[var(--ic-muted)]">No open incidents — every alert has been acknowledged.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--ic-muted)]">
              <th className="px-5 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Incident</th>
              <th className="px-3 py-2 font-medium hidden md:table-cell">Affected asset</th>
              <th className="px-3 py-2 font-medium hidden lg:table-cell">Source</th>
              <th className="px-3 py-2 font-medium">Age</th>
              <th className="px-5 py-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id} onClick={() => nav(`/client-admin/alerts/${a.id}`)}
                className="border-t border-[var(--ic-border)] hover:bg-cyan-500/5 cursor-pointer">
                <td className="px-5 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase ${SEV_BADGE[a.severity] ?? SEV_BADGE.info}`}>{a.severity}</span>
                </td>
                <td className="px-3 py-2.5 text-[var(--ic-text)]">
                  {a.title}
                  {a.correlated_count > 1 && <span className="ml-2 text-[10px] text-[var(--ic-muted)]">×{a.correlated_count} correlated</span>}
                </td>
                <td className="px-3 py-2.5 text-[var(--ic-muted)] hidden md:table-cell font-mono text-xs">{a.resource ?? '—'}</td>
                <td className="px-3 py-2.5 text-[var(--ic-muted)] hidden lg:table-cell text-xs">{a.source}</td>
                <td className="px-3 py-2.5 text-[var(--ic-muted)] text-xs whitespace-nowrap">{fmtAge(ageMinutes(a.created_at))}</td>
                <td className="px-5 py-2.5 text-right"><ArrowRight className="w-4 h-4 inline text-cyan-400" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** F — Infrastructure health from /api/agents/probes (+ ingestion freshness from alerts). */
export function InfraHealthCard({ probes, probesError, lastEventAt }: {
  probes: AgentProbeOut[] | null; probesError: boolean; lastEventAt: string | null;
}) {
  const nav = useNavigate();
  if (probesError || probes === null) {
    return (
      <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-widest mb-3 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-amber-400" /> Infrastructure health
        </h2>
        <p className="text-sm text-[var(--ic-muted)]">Collector status unavailable — /api/agents/probes could not be reached. Not simulated.</p>
      </section>
    );
  }
  const online = probes.filter(p => p.status === 'online');
  const offline = probes.filter(p => p.status !== 'online');
  return (
    <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-widest">Infrastructure health</h2>
        <button onClick={() => nav('/client-admin/agents')} className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300">Manage collectors</button>
      </div>
      {probes.length === 0 ? (
        <p className="text-sm text-[var(--ic-muted)]">No collection agents enrolled yet. Install one from the Agents page to start ingesting telemetry.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm mb-3">
            <span className="flex items-center gap-1.5 text-emerald-300"><span className="w-2 h-2 rounded-full bg-emerald-400" />{online.length} online</span>
            {offline.length > 0 && <span className="flex items-center gap-1.5 text-rose-300"><span className="w-2 h-2 rounded-full bg-rose-400" />{offline.length} offline</span>}
            <span className="text-[11px] text-[var(--ic-muted)] ml-auto">
              Last event received: {lastEventAt ? new Date(lastEventAt).toLocaleString() : 'none recorded'}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto divide-y divide-[var(--ic-border)]">
            {probes.slice(0, 12).map(p => (
              <div key={p.id} className="flex items-center gap-3 py-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="text-[var(--ic-text)] font-mono">{p.hostname}</span>
                <span className="text-[var(--ic-muted)]">{p.os} · v{p.agent_version}</span>
                <span className="text-[var(--ic-muted)] ml-auto whitespace-nowrap">
                  heartbeat: {p.last_seen ? fmtAge(ageMinutes(p.last_seen)) + ' ago' : 'never'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
