import React, { useEffect, useState } from 'react';
import { Shield, AlertTriangle, Target, TrendingDown, Clock, Zap } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { mockRiskScore, mockAlerts, mockAlertTimeline, mockThreatTrend } from '../data/mockData';
import { computeDemoStats, isDemoWorldInstalled } from '../data/demoWorld';
import { isDemoMode } from '../services/demoMode';
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

function RiskGauge({ score }: { score: number }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      let current = 0;
      const interval = setInterval(() => {
        current += 1;
        if (current >= score) { clearInterval(interval); setAnimatedScore(score); }
        else setAnimatedScore(current);
      }, 20);
      return () => clearInterval(interval);
    }, 300);
    return () => clearTimeout(timer);
  }, [score]);

  const getColor = (s: number) => {
    if (s <= 30) return { text: 'text-cyber-green', stroke: '#00ff88', label: 'Low Risk' };
    if (s <= 60) return { text: 'text-cyber-yellow', stroke: '#ffd700', label: 'Moderate Risk' };
    return { text: 'text-cyber-red', stroke: '#ff3366', label: 'High Risk' };
  };
  const color = getColor(animatedScore);
  const circumference = 2 * Math.PI * 70;
  const dashOffset = circumference - (animatedScore / 100) * circumference * 0.75;

  return (
    <div className="relative flex flex-col items-center">
      <svg width="200" height="160" viewBox="0 0 200 160">
        <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(100,116,139,0.1)" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} transform="rotate(135, 100, 100)" />
        <circle cx="100" cy="100" r="70" fill="none" stroke={color.stroke} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} strokeDashoffset={dashOffset}
          transform="rotate(135, 100, 100)" className="transition-all duration-500"
          style={{ filter: `drop-shadow(0 0 8px ${color.stroke}40)` }} />
      </svg>
      <div className="absolute top-12 text-center">
        <div className={`text-4xl font-bold ${color.text}`}>{animatedScore}</div>
        <div className="text-xs text-[var(--ic-muted)] mt-1">/ 100</div>
      </div>
      <div className={`text-sm font-medium mt-2 ${color.text}`}>{color.label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [counts, setCounts] = useState({ activeThreats: 7, autoRemediated: 23 });

  useEffect(() => {
    let alive = true;
    async function load() {
      if (isDemoMode() || isDemoWorldInstalled()) {
        const st = computeDemoStats();
        if (alive) setCounts({ activeThreats: st.alertsCritical + st.ticketsP1, autoRemediated: st.playbooks * 5 + 3 });
        return;
      }
      try {
        const res: any = await fetch(((import.meta as any).env?.VITE_API_URL || '/api/v1') + '/alerts');
        const arr = Array.isArray(res) ? res : (res?.items ?? []);
        if (alive && arr.length) setCounts(c => ({ ...c, activeThreats: arr.filter((a: any) => ['critical','high'].includes(a.severity)).length }));
      } catch { /* real backend unreachable — keep defaults honest */ }
    }
    load();
    window.addEventListener('demo-world-pushed', load);
    return () => { alive = false; window.removeEventListener('demo-world-pushed', load); };
  }, []);

  return (
    <WidgetLayoutProvider pageKey="soc-dashboard" defaultLayout={DEFAULT_LAYOUT}>
      <div className="p-4 lg:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Security Operations Dashboard</h1>
            <p className="text-[var(--ic-muted)] text-sm mt-1">Real-time threat monitoring & predictive analytics</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <CustomizeHint />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
              <Clock className="w-3.5 h-3.5 text-[var(--ic-muted)]" />
              <span className="text-xs text-[var(--ic-muted)]">Last updated: {new Date().toLocaleTimeString()}</span>
            </div>
            <AddWidgetButton pageKey="soc-dashboard" defaultLayout={DEFAULT_LAYOUT} />
            <ResetLayoutButton pageKey="soc-dashboard" defaultLayout={DEFAULT_LAYOUT} />
          </div>
        </div>

        {/* Everything is one reorderable, resizable widget grid */}
        <WidgetGrid>
          <DashboardWidget id="kpi-alerts" title="Open Alerts" spanOptions={[1, 2]}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-400" />
              <p className="text-3xl font-bold text-[var(--ic-heading)]">
                {mockAlerts.filter(a => a.status === 'open').length}
              </p>
            </div>
          </DashboardWidget>
          <DashboardWidget id="kpi-threats" title="Active Threats" spanOptions={[1, 2]}>
            <div className="flex items-center gap-2">
              <Target className="w-6 h-6 text-orange-400" />
              <p className="text-3xl font-bold text-[var(--ic-heading)]">{counts.activeThreats}</p>
            </div>
          </DashboardWidget>
          <DashboardWidget id="kpi-compliance" title="Compliance" spanOptions={[1, 2]}>
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-green-400" />
              <p className="text-3xl font-bold text-[var(--ic-heading)]">{mockRiskScore.compliance}%</p>
            </div>
          </DashboardWidget>
          <DashboardWidget id="kpi-remediated" title="Auto-Remediated" spanOptions={[1, 2]}>
            <div className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-cyan-400" />
              <p className="text-3xl font-bold text-[var(--ic-heading)]">{counts.autoRemediated}</p>
            </div>
          </DashboardWidget>

          <DashboardWidget id="risk-gauge" title="Predictive Risk Score">
            <RiskGauge score={mockRiskScore.overall} />
          </DashboardWidget>

          <DashboardWidget id="recent-alerts" title="Recent Security Alerts" spanOptions={[2, 3]}>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {mockAlerts.slice(0, 5).map(alert => (
                <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--ic-surface-2)]">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    alert.severity === 'critical' ? 'bg-cyber-red animate-pulse' :
                    alert.severity === 'high' ? 'bg-cyber-orange' : 'bg-cyber-yellow'
                  }`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--ic-heading)]">{alert.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--ic-muted)]">{alert.source}</span>
                      <span className="text-xs text-[var(--ic-muted)]">•</span>
                      <span className="text-xs text-[var(--ic-muted)]">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </DashboardWidget>

          <DashboardWidget id="alert-volume" title="24h Alert Volume" spanOptions={[1, 2, 3]}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={mockAlertTimeline}>
                <defs><linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3}/><stop offset="95%" stopColor="#00d4ff" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', fontSize: '12px' }} />
                <Area type="monotone" dataKey="alerts" stroke="#00d4ff" fill="url(#alertGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </DashboardWidget>

          <DashboardWidget id="threat-trend" title="Threat Detection vs Blocked" spanOptions={[1, 2, 3]}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={mockThreatTrend}>
                <XAxis dataKey="date" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="threats" fill="#ff3366" radius={[4, 4, 0, 0]} opacity={0.8} />
                <Bar dataKey="blocked" fill="#00ff88" radius={[4, 4, 0, 0]} opacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </DashboardWidget>

          {/* Catalog widgets the user added via “Add widget” render here */}
          {AllCatalogEntries()}
        </WidgetGrid>
      </div>
    </WidgetLayoutProvider>
  );
}
