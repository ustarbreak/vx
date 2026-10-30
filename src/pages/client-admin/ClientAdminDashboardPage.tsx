import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Building2, Users, Shield, TrendingUp, CheckCircle2, RefreshCw } from 'lucide-react';
import ValueEngineSection from '../../components/ValueEngineWidgets';
import WorldAttackMap from '../../components/WorldAttackMap';
import OrgTopologyMap from '../../components/OrgTopologyMap';
import { agentApi, AgentProbeOut } from '../../services/api';
import DashboardWidget, {
  WidgetLayoutProvider,
  WidgetGrid,
  ResetLayoutButton,
  CustomizeHint,
  type WidgetLayoutEntry,
} from '../../components/DashboardWidget';
import { AddWidgetButton, AllCatalogEntries } from '../../components/WidgetCatalog';
import { PostureKpiStrip, OpsSummaryTable, InfraHealthCard, useDashboardAlerts } from './DashboardOpsWidgets';

// Only grid widgets are listed here. The bare widgets (attack map, topology,
// ops summary, ingestion health, value engine) render their own cards outside
// the slot grid — listing them here would create empty placeholder slots.
const CA_DASH_LAYOUT: WidgetLayoutEntry[] = [
  // colSpan in thirds of the row; grid tracks adapt per breakpoint (1 / 6 / 12).
  { id: 'ca-posture', colSpan: 3, collapsed: false },
  { id: 'ca-org', colSpan: 2, collapsed: false },
  { id: 'ca-kpis', colSpan: 3, collapsed: false },
];

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
    <WidgetLayoutProvider pageKey="client-admin-dashboard" defaultLayout={CA_DASH_LAYOUT}>
    <div className="p-4 lg:p-6 space-y-6">
      {/* A — Header with tenant context + site/period filters + quick actions + widget builder */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Client Administration — Overview & Live Proof</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Your posture, your team and the business value delivered this month — one page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CustomizeHint />
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
          <AddWidgetButton pageKey="client-admin-dashboard" defaultLayout={CA_DASH_LAYOUT} />
          <ResetLayoutButton pageKey="client-admin-dashboard" defaultLayout={CA_DASH_LAYOUT} />
        </div>
      </div>

      {/* C — Worldwide Attacking Map (GET /api/security/attack-map; demo fixtures only in Demo Mode).
          Bare widget, declared OUTSIDE the slot grid: WorldAttackMap renders its own card +
          header ("Worldwide Threat Map"), so no DashboardWidget chrome is layered on top of it. */}
      <div data-widget-id="ca-attackmap">
        <WorldAttackMap
          key={`${period}-${refreshKey}`}
          filters={mapWindow(PERIOD_PRESETS[periodIdx].months)}
          onSelectEvent={(e) => nav(`/client-admin/alerts/${e.id}`)}
        />
      </div>

      {/* Everything below is a customizable widget grid: drag ⠿ to reorder,
          resize between 1–3 columns, collapse, and add catalog widgets via "+ Add widget". */}
      <WidgetGrid>
      {/* D — Global security posture strip (real backend values, drill-downs) */}
      <DashboardWidget id="ca-posture" title="Security posture" subtitle="Live KPIs across your estate" spanOptions={[2, 3]}>
        <PostureKpiStrip alerts={alerts} probes={probes} assetCount={organization.assetCount} complianceScore={organization.complianceScore} />
      </DashboardWidget>

      {/* Organizational Infrastructure Topology (GET /api/org-topology) —
          separate, complementary view: "what does my org look like and is it
          healthy?". Real registered sites + enrolled collectors only; network
          links are never inferred. Demo fixtures only behind Demo Mode.
          Bare widget (same pattern as the attack map): OrgTopologyMap renders
          its own card + toolbar, so no DashboardWidget chrome is layered on top. */}
      <div data-widget-id="ca-topology">
        <OrgTopologyMap compact />
      </div>

      {/* E — Security operations summary with incident drill-down.
          OpsSummaryTable renders its own card — bare widget, no double layer. */}
      <div data-widget-id="ca-ops">
        <OpsSummaryTable alerts={alerts} error={alertsError} onRefresh={refreshAlerts} />
      </div>

      {/* F — Infrastructure / ingestion health.
          InfraHealthCard renders its own card — bare widget, no double layer. */}
      <div data-widget-id="ca-infra">
        <InfraHealthCard probes={probes} probesError={probesError} lastEventAt={lastEventAt} />
      </div>

      {/* Merged: former "Overview" + "Value & Loyalty" → single Executive Dashboard.
          ValueEngineSection renders its own heading + individual cards — bare
          widget outside the grid so no outer card duplicates them. */}
      <div data-widget-id="ca-value">
        <ValueEngineSection key={`value-${period}-${refreshKey}`} orgId={orgNumericId} />
      </div>

      <DashboardWidget id="ca-org" title="Organization" subtitle="Contract & tier context" spanOptions={[1, 2, 3]}>
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 -m-2">
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
      </DashboardWidget>

      <DashboardWidget id="ca-kpis" title="Key indicators" subtitle="Services · team · risk · compliance" spanOptions={[2, 3]}>
      {/* Inner responsive grid — four small KPI components, NOT a nested widget:
          2 columns on mobile/tablet widths, 4 across when the card is wide. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 min-w-0">
        <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span className="text-xs text-[var(--ic-muted)] truncate">Active Services</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-[var(--ic-heading)] leading-tight">{activeServices}</p>
          <p className="text-[11px] text-[var(--ic-muted)] mt-0.5 truncate">of {organization.entitlements.length} available</p>
        </div>
        <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Users className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="text-xs text-[var(--ic-muted)] truncate">Team Members</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-[var(--ic-heading)] leading-tight">{organization.memberCount}</p>
          <p className="text-[11px] text-[var(--ic-muted)] mt-0.5 truncate">Active users</p>
        </div>
        <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <TrendingUp className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-xs text-[var(--ic-muted)] truncate">Risk Score</span>
          </div>
          <p className={`text-xl sm:text-2xl font-bold leading-tight ${
            organization.riskScore <= 30 ? 'text-cyber-green' :
            organization.riskScore <= 60 ? 'text-cyber-yellow' : 'text-cyber-red'
          }`}>{organization.riskScore}</p>
          <p className="text-[11px] text-cyber-green mt-0.5 truncate">-11% vs last month</p>
        </div>
        <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-xs text-[var(--ic-muted)] truncate">Compliance</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-[var(--ic-heading)] leading-tight">{organization.complianceScore}%</p>
          <p className="text-[11px] text-[var(--ic-muted)] mt-0.5 truncate">NIST CSF 2.0</p>
        </div>
      </div>
      </DashboardWidget>

      {/* User-added catalog widgets ("+ Add widget") render here as removable,
          draggable cards — same grid, persisted like everything else. */}
      {AllCatalogEntries()}
      </WidgetGrid>
    </div>
    </WidgetLayoutProvider>
  );
}
