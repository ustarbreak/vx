import React, { useState } from 'react';
import { AlertTriangle, Clock, User, Server, Hash, ChevronDown, ChevronRight, CheckCircle2, Shield, Zap, ArrowRight } from 'lucide-react';
import { mockIncidents } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';

const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  info: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
};

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  open: { icon: AlertTriangle, color: 'text-red-400', label: 'Open' },
  investigating: { icon: Clock, color: 'text-yellow-400', label: 'Investigating' },
  contained: { icon: Shield, color: 'text-cyan-400', label: 'Contained' },
  resolved: { icon: CheckCircle2, color: 'text-green-400', label: 'Resolved' },
  closed: { icon: CheckCircle2, color: 'text-slate-400', label: 'Closed' },
};

function IncidentsContent() {
  const [expandedId, setExpandedId] = useState<string | null>('inc-001');

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Incident Response</h1>
        <p className="text-slate-500 text-sm mt-1">Active incident tracking and automated playbook execution</p>
      </div>

      <div className="space-y-4">
        {mockIncidents.map(incident => {
          const isExpanded = expandedId === incident.id;
          const sevConfig = severityConfig[incident.severity];
          const statConfig = statusConfig[incident.status];
          const StatusIcon = statConfig.icon;

          return (
            <div key={incident.id} className={`bg-slate-900/50 border ${sevConfig.border} rounded-xl overflow-hidden`}>
              <button onClick={() => setExpandedId(isExpanded ? null : incident.id)}
                className="w-full p-4 text-left hover:bg-slate-800/20">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${sevConfig.bg} flex-shrink-0`}>
                    <AlertTriangle className={`w-5 h-5 ${sevConfig.text}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-slate-200">{incident.title}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${sevConfig.bg} ${sevConfig.text}`}>{incident.severity}</span>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statConfig.color} bg-slate-800/50`}>
                        <StatusIcon className="w-3 h-3" />{statConfig.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {incident.assignee}</span>
                      <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {incident.affectedSystems.length} systems</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-800/50">
                  <div className="mt-4">
                    <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Timeline</h5>
                    <div className="relative pl-6 space-y-4">
                      <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-700" />
                      {incident.timeline.map((event, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-4 top-1.5 w-3 h-3 rounded-full border-2 ${
                            idx === incident.timeline.length - 1 ? 'border-cyan-400 bg-cyan-400/20' : 'border-slate-600 bg-slate-800'
                          }`} />
                          <p className="text-sm text-slate-200">{event.action}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                            <span>{new Date(event.timestamp).toLocaleString()}</span>
                            <span>•</span>
                            <span>{event.actor}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-cyan-500/20">
                      <Zap className="w-3.5 h-3.5" /> Run Playbook
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 text-xs font-medium border border-yellow-500/20">
                      <ArrowRight className="w-3.5 h-3.5" /> Escalate
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-medium border border-green-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
                    </button>
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

export default function IncidentsPage() {
  return <ServiceGate serviceId="incident-response"><IncidentsContent /></ServiceGate>;
}
