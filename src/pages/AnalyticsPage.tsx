import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { TrendingDown, Shield, Target, Zap } from 'lucide-react';
import { mockRiskScore } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';

const riskTrendData = mockRiskScore.trend.map((score, idx) => ({
  month: ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'][idx], score,
}));

const radarData = [
  { subject: 'Vulnerability', score: 100 - mockRiskScore.vulnerabilities },
  { subject: 'Compliance', score: mockRiskScore.compliance },
  { subject: 'Threat Detection', score: 100 - mockRiskScore.threatExposure },
  { subject: 'IR Capability', score: mockRiskScore.incidentResponse },
  { subject: 'Asset Coverage', score: 85 },
  { subject: 'Patch Cadence', score: 78 },
];

function AnalyticsContent() {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Security Analytics</h1>
        <p className="text-[var(--ic-muted)] text-sm mt-1">Predictive insights and security posture metrics</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingDown className="w-4 h-4 text-cyber-green" /><span className="text-xs text-[var(--ic-muted)]">Risk Trend</span></div>
          <p className="text-2xl font-bold text-cyber-green">-11%</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><Shield className="w-4 h-4 text-cyan-400" /><span className="text-xs text-[var(--ic-muted)]">MTTD</span></div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">14m</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-purple-400" /><span className="text-xs text-[var(--ic-muted)]">MTTR</span></div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">2.4h</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><Target className="w-4 h-4 text-orange-400" /><span className="text-xs text-[var(--ic-muted)]">Block Rate</span></div>
          <p className="text-2xl font-bold text-cyber-green">94.2%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-4">Risk Score Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={riskTrendData}>
              <defs><linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
              <XAxis dataKey="month" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', fontSize: '12px' }} />
              <Area type="monotone" dataKey="score" stroke="#8b5cf6" fill="url(#riskGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-4">Security Posture</h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#1e293b" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#475569', fontSize: 9 }} />
              <Radar name="Score" dataKey="score" stroke="#00d4ff" fill="#00d4ff" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return <ServiceGate serviceId="analytics"><AnalyticsContent /></ServiceGate>;
}
