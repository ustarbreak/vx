import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../src/context/AuthContext';
import { Building2, Users, Shield, TrendingUp, CheckCircle2, RefreshCw } from 'lucide-react';
import ValueEngineSection from '../../components/ValueEngineWidgets';
import WorldAttackMap from '../../components/WorldAttackMap';
import { agentApi, AgentProbeOut } from '../../services/api';
import { PostureKpiStrip, OpsSummaryTable, InfraHealthCard, useDashboardAlerts } from './DashboardOpsWidgets';

/** Reporting-period presets feeding valueApi.get(period) (YYYY-MM server-side). */
const PERIOD_PRESETS: { label: string; months: number }[] = [
  { label: 'This month', months: 0 },
  { label: 'Last month', months: 1 },
  { label: 'Last 3 months', months: 2 },
  { label: 'Last 6 months', months: 5 },
];

function periodMonthsAgo(monthsAgo: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Map time window for the selected reporting period (last 30 days when "this month"). */
function mapWindow(monthsAgo: number): { start_time: string } {
  const days = monthsAgo === 0 ? 30 : Math.min(365, monthsAgo * 31 + 9);
  return { start_time: new Date(Date.now() - days * 86400000).toISOString() };
}

export default function ClientAdminDashboardPage() {
  const { organization } = useAuth();
  const nav = useNavigate();
  const [periodIdx, setPeriodIdx] = useState(0);
  const [probes, setProbes] = useState<AgentProbeOut[] | null>(null);
  const [probesError, setProbesError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const orgNumericId = organization ? Number(organization.id) || undefined : undefined;
  const { alerts, error: alertsError, refresh: refreshAlerts } = useDashboardAlerts(orgNumericId);

  // Infrastructure health — real collector fleet via /api/agents/probes.
  useEffect(() => {
    let cancelled = false;
    agentApi.listProbes()
      .then((rows) => { if (!cancelled) { setProbes(Array.isArray(rows) ? rows : []); setProbesError(false); } })
      .catch(() => { if (!cancelled) { setProbes(null); setProbesError(true); } });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const lastEventAt = useMemo(() => {
    if (!alerts || alerts.length === 0) return null;
    return alerts.map(a => a.created_at).sort().slice(-1)[0];
  }, [alerts]);

  if (!organization) return <div className="p-6 text-[var(--ic-heading)]">No organization found.</div>;

  const activeServices = organization.entitlements.filter(e => e.enabled).length;
  const period = periodMonthsAgo(PERIOD_PRESETS[periodIdx].months);

  const refreshAll = () => {
    setRefreshKey(k => k + 1);
    refreshAlerts();
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* A — Header with tenant context + site/period filters + quick actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Client Administration — Overview</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Your posture, your team and the business value delivered this month — one page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--ic-muted)]" htmlFor="dash-period">Reporting period</label>
          <select id="dash-period" value={periodIdx} onChange={(e) => setPeriodIdx(Number(e.target.value))}
            className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--ic-text)] focus:outline-none focus:border-cyan-500/60">
            {PERIOD_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label} ({periodMonthsAgo(p.months)})</option>)}
          </select>
          <button onClick={() => nav('/client-admin/monitored-devices')} title="Site scope: all authorized sites — manage here"
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300">
            Site: All authorized sites
          </button>
          <button onClick={refreshAll}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh data
          </button>
        </div>
      </div>

      {/* D — Global security posture strip (real backend values, drill-downs) */}
      <PostureKpiStrip alerts={alerts} probes={probes} assetCount={organization.assetCount} complianceScore={organization.complianceScore} />

      {/* C — Worldwide Attacking Map (GET /api/security/attack-map; demo fixtures only in Demo Mode) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-widest">Worldwide attack map</h2>
          <span className="text-[11px] text-[var(--ic-muted)]">Observed events · approximate geolocation · click an event to open the incident</span>
        </div>
        <WorldAttackMap
          key={`${period}-${refreshKey}`}
          filters={mapWindow(PERIOD_PRESETS[periodIdx].months)}
          onSelectEvent={(e) => nav(`/client-admin/alerts/${e.id}`)}
        />
      </section>

      {/* E — Security operations summary with incident drill-down */}
      <OpsSummaryTable alerts={alerts} error={alertsError} onRefresh={refreshAlerts} />

      {/* F — Infrastructure / ingestion health */}
      <InfraHealthCard probes={probes} probesError={probesError} lastEventAt={lastEventAt} />

      {/* Merged: former "Overview" + "Value & Loyalty" → single Executive Dashboard.
          Cards untouched; the header period selector drives the dependent view. */}
      <ValueEngineSection key={`value-${period}-${refreshKey}`} orgId={orgNumericId} />

      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
            organization.tier === 'enterprise' ? 'bg-amber-500/10 text-amber-400' :
            organization.tier === 'mid-market' ? 'bg-purple-500/10 text-purple-400' :
            'bg-blue-500/10 text-blue-400'
          }`}>
            <Building2 className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-[var(--ic-heading)]">{organization.name}</h2>
            <p className="text-sm text-[var(--ic-muted)] mt-1">
              {organization.tier.toUpperCase()} • {organization.industry} • {organization.country}
            </p>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-xs text-[var(--ic-muted)]">{organization.memberCount} members</span>
              <span className="text-xs text-[var(--ic-muted)]">{organization.assetCount} assets</span>
              <span className="text-xs text-[var(--ic-muted)]">Contract: {organization.contractEnd}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-[var(--ic-muted)]">Active Services</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{activeServices}</p>
          <p className="text-xs text-[var(--ic-muted)] mt-1">of {organization.entitlements.length} available</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-[var(--ic-muted)]">Team Members</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{organization.memberCount}</p>
          <p className="text-xs text-[var(--ic-muted)] mt-1">Active users</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-xs text-[var(--ic-muted)]">Risk Score</span>
          </div>
          <p className={`text-2xl font-bold ${
            organization.riskScore <= 30 ? 'text-cyber-green' :
            organization.riskScore <= 60 ? 'text-cyber-yellow' : 'text-cyber-red'
          }`}>{organization.riskScore}</p>
          <p className="text-xs text-cyber-green mt-1">-11% vs last month</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-xs text-[var(--ic-muted)]">Compliance</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{organization.complianceScore}%</p>
          <p className="text-xs text-[var(--ic-muted)] mt-1">NIST CSF 2.0</p>
        </div>
      </div>
    </div>
  );
}
