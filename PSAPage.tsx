import React, { useState } from 'react';
import { Shield, CheckCircle2, XCircle, Clock, HardDrive, Database } from 'lucide-react';
import { mockPatches, mockBackups } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';

function PSAContent() {
  const [tab, setTab] = useState<'patches' | 'backups'>('patches');

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="w-7 h-7 text-green-400" /> PSA Services
        </h1>
        <p className="text-slate-500 text-sm mt-1">Patch Management & Backup/DR</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('patches')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'patches' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}>
          <HardDrive className="w-4 h-4 inline mr-2" />Patch Management
        </button>
        <button onClick={() => setTab('backups')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'backups' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}>
          <Database className="w-4 h-4 inline mr-2" />Backup & DR
        </button>
      </div>

      {tab === 'patches' && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Device</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">OS</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Pending</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Critical</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {mockPatches.map(p => (
                <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-sm text-slate-200 font-mono">{p.deviceName}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.os}</td>
                  <td className="px-4 py-3"><span className={`text-sm font-medium ${p.pendingPatches > 5 ? 'text-cyber-yellow' : 'text-slate-300'}`}>{p.pendingPatches}</span></td>
                  <td className="px-4 py-3"><span className={`text-sm font-medium ${p.criticalPatches > 0 ? 'text-cyber-red' : 'text-cyber-green'}`}>{p.criticalPatches}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-700">
                        <div className={`h-full rounded-full ${p.compliance >= 90 ? 'bg-cyber-green' : p.compliance >= 70 ? 'bg-cyber-yellow' : 'bg-cyber-red'}`} style={{ width: `${p.compliance}%` }} />
                      </div>
                      <span className="text-xs text-slate-400">{p.compliance}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'backups' && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Job</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Target</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Schedule</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Last Run</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Status</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Size</th>
              </tr>
            </thead>
            <tbody>
              {mockBackups.map(b => (
                <tr key={b.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-sm text-slate-200">{b.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono">{b.target}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{b.schedule}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(b.lastRun).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${
                      b.status === 'success' ? 'text-cyber-green' : b.status === 'failed' ? 'text-cyber-red' : 'text-cyber-yellow'
                    }`}>
                      {b.status === 'success' ? <CheckCircle2 className="w-3 h-3" /> : b.status === 'failed' ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">{b.sizeGB} GB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PSAPage() {
  return <ServiceGate serviceId="patch-management"><PSAContent /></ServiceGate>;
}
