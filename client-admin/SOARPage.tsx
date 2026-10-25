import React, { useState, useEffect } from 'react';
import { Zap, Play, Pause, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

interface Playbook {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'running';
  executions: number;
  lastRun?: string;
  successRate: number;
}

export default function SOARPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlaybooks = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      setPlaybooks([
        { id: 'PB-001', name: 'Ransomware Response', description: 'Automated response to ransomware detection', status: 'active', executions: 145, lastRun: '2027-01-15T08:30:00Z', successRate: 98 },
        { id: 'PB-002', name: 'Phishing Investigation', description: 'Investigate and remediate phishing attempts', status: 'active', executions: 234, lastRun: '2027-01-15T09:15:00Z', successRate: 95 },
        { id: 'PB-003', name: 'Network Isolation', description: 'Isolate compromised devices from network', status: 'running', executions: 67, lastRun: '2027-01-15T09:20:00Z', successRate: 100 },
        { id: 'PB-004', name: 'User Account Lockout', description: 'Lock compromised user accounts', status: 'inactive', executions: 23, lastRun: '2027-01-10T14:00:00Z', successRate: 100 },
      ]);
      setLoading(false);
    };
    fetchPlaybooks();
  }, []);

  const stats = {
    total: playbooks.length,
    active: playbooks.filter(p => p.status === 'active').length,
    running: playbooks.filter(p => p.status === 'running').length,
    totalExecutions: playbooks.reduce((sum, p) => sum + p.executions, 0),
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">SOAR Automation</h1>
        <p className="text-gray-400 mt-1">Security Orchestration, Automation and Response</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Playbooks</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.active}</span>
          </div>
          <p className="text-gray-400 text-sm">Active</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Play className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-white">{stats.running}</span>
          </div>
          <p className="text-gray-400 text-sm">Running</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-white">{stats.totalExecutions}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Executions</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Playbook</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Description</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Executions</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Success Rate</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Run</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {playbooks.map((playbook) => (
              <tr key={playbook.id} className="border-b border-slate-800 hover:bg-slate-800">
                <td className="py-3 px-4 text-white font-medium">{playbook.name}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{playbook.description}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    playbook.status === 'active' ? 'bg-green-500/20 text-green-400' :
                    playbook.status === 'running' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{playbook.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{playbook.executions}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-16 bg-slate-800 rounded-full h-2">
                      <div className={`h-2 rounded-full ${playbook.successRate >= 95 ? 'bg-green-500' : playbook.successRate >= 80 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${playbook.successRate}%` }} />
                    </div>
                    <span className="text-gray-300 text-sm">{playbook.successRate}%</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{playbook.lastRun ? new Date(playbook.lastRun).toLocaleString() : 'Never'}</td>
                <td className="py-3 px-4">
                  <button className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">Execute</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
