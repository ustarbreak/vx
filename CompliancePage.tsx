import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { mockNISTMapping } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  compliant: { icon: CheckCircle2, color: 'text-cyber-green', label: 'Compliant' },
  partial: { icon: AlertCircle, color: 'text-cyber-yellow', label: 'Partial' },
  'non-compliant': { icon: XCircle, color: 'text-cyber-red', label: 'Non-Compliant' },
};

function ComplianceContent() {
  const [expanded, setExpanded] = useState<string | null>('ID');
  const chartData = mockNISTMapping.map(c => ({ name: c.categoryName, score: c.overallScore, color: c.overallScore >= 80 ? '#00ff88' : c.overallScore >= 60 ? '#ffd700' : '#ff3366' }));

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Compliance Mapper</h1>
        <p className="text-slate-500 text-sm mt-1">NIST CSF 2.0 control mapping</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Category Scores</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical">
            <XAxis type="number" domain={[0, 100]} stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} width={80} />
            <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any) => [`${v}%`, 'Score']} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((e, i) => <Cell key={i} fill={e.color} opacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-3">
        {mockNISTMapping.map(cat => (
          <div key={cat.category} className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <button onClick={() => setExpanded(expanded === cat.category ? null : cat.category)}
              className="w-full p-4 flex items-center justify-between hover:bg-slate-800/30">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                  cat.overallScore >= 80 ? 'bg-cyber-green/10 text-cyber-green' : cat.overallScore >= 60 ? 'bg-cyber-yellow/10 text-cyber-yellow' : 'bg-cyber-red/10 text-cyber-red'
                }`}>{cat.category}</div>
                <div className="text-left">
                  <h4 className="text-sm font-semibold text-slate-200">{cat.categoryName}</h4>
                  <p className="text-xs text-slate-500">{cat.controls.length} controls • {cat.overallScore}%</p>
                </div>
              </div>
              {expanded === cat.category ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            </button>
            {expanded === cat.category && (
              <div className="px-4 pb-4 border-t border-slate-800/50 mt-0 pt-3 space-y-2">
                {cat.controls.map(ctrl => {
                  const cfg = statusConfig[ctrl.status];
                  const Icon = cfg.icon;
                  return (
                    <div key={ctrl.id} className="p-3 rounded-lg bg-slate-800/20 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                        <div>
                          <span className="text-xs font-mono text-slate-500">{ctrl.id}</span>
                          <h5 className="text-sm text-slate-200">{ctrl.title}</h5>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${cfg.color}`}>{ctrl.score}%</div>
                        <span className={`text-[10px] uppercase ${cfg.color}`}>{cfg.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompliancePage() {
  return <ServiceGate serviceId="compliance"><ComplianceContent /></ServiceGate>;
}
