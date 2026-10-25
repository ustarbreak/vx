import React, { useState } from 'react';
import { Search, Shield, Skull, Bug, AlertOctagon, Globe, Hash, Link2, Clock, Zap, ChevronDown, ChevronUp, Target } from 'lucide-react';
import { mockThreats } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  info: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
};

function ThreatsContent() {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = mockThreats.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.ioc.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Threat Intelligence</h1>
        <p className="text-slate-500 text-sm mt-1">Aggregated IoCs from MISP, AlienVault OTX, and internal feeds</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search threats, IoCs..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50" />
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map(threat => {
          const colors = severityColors[threat.severity];
          return (
            <div key={threat.id} className={`bg-slate-900/50 border ${colors.border} rounded-xl overflow-hidden`}>
              <div className="p-4 cursor-pointer" onClick={() => setExpandedId(expandedId === threat.id ? null : threat.id)}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${colors.bg} flex-shrink-0`}>
                    <Target className={`w-5 h-5 ${colors.text}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-slate-200">{threat.title}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${colors.bg} ${colors.text}`}>
                        {threat.severity}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{threat.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(threat.timestamp).toLocaleString()}</span>
                      <span>Confidence: <span className="font-medium text-slate-300">{threat.confidence}%</span></span>
                    </div>
                  </div>
                  {expandedId === threat.id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </div>
              </div>
              {expandedId === threat.id && (
                <div className="px-4 pb-4 border-t border-slate-800/50 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-slate-800/30">
                      <p className="text-xs text-slate-500 mb-1">IoC</p>
                      <code className="text-xs text-cyan-300 font-mono break-all">{threat.ioc}</code>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/30">
                      <p className="text-xs text-slate-500 mb-1">Affected Assets</p>
                      <p className="text-lg font-bold text-white">{threat.affectedAssets}</p>
                    </div>
                  </div>
                  <div className="mt-3 p-3 rounded-lg bg-slate-800/30">
                    <p className="text-xs text-slate-500 mb-2">MITRE ATT&CK</p>
                    <div className="flex flex-wrap gap-1.5">
                      {threat.mitreAttack.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 text-xs font-mono">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ThreatsPage() {
  return <ServiceGate serviceId="threat-intel"><ThreatsContent /></ServiceGate>;
}
