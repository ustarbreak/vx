import React, { useState, useEffect } from 'react';
import { Lock, Shield, AlertTriangle, CheckCircle } from 'lucide-react';

interface FirewallRule {
  id: string;
  name: string;
  source: string;
  destination: string;
  port: string;
  action: 'allow' | 'deny' | 'log';
  hits: number;
  status: 'active' | 'inactive';
}

export default function FirewallManagementPage() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      setRules([
        { id: 'FW-001', name: 'Allow HTTP/HTTPS', source: 'Any', destination: 'Web Servers', port: '80,443', action: 'allow', hits: 125678, status: 'active' },
        { id: 'FW-002', name: 'Block Malicious IPs', source: 'Threat List', destination: 'Any', port: 'Any', action: 'deny', hits: 4523, status: 'active' },
        { id: 'FW-003', name: 'Allow SSH Internal', source: '10.0.0.0/8', destination: 'Servers', port: '22', action: 'allow', hits: 8934, status: 'active' },
        { id: 'FW-004', name: 'Log Suspicious Traffic', source: 'External', destination: 'DMZ', port: 'Any', action: 'log', hits: 23456, status: 'active' },
        { id: 'FW-005', name: 'Legacy Rule', source: '192.168.1.0/24', destination: 'Any', port: '8080', action: 'allow', hits: 0, status: 'inactive' },
      ]);
      setLoading(false);
    };
    fetchRules();
  }, []);

  const stats = {
    total: rules.length,
    active: rules.filter(r => r.status === 'active').length,
    allow: rules.filter(r => r.action === 'allow').length,
    deny: rules.filter(r => r.action === 'deny').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Firewall Management</h1>
        <p className="text-gray-400 mt-1">Manage firewall rules and monitor traffic</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Lock className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Rules</p>
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
            <Shield className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.allow}</span>
          </div>
          <p className="text-gray-400 text-sm">Allow Rules</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.deny}</span>
          </div>
          <p className="text-gray-400 text-sm">Deny Rules</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Rule Name</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Source</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Destination</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Port</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Action</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Hits</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-slate-800 hover:bg-slate-800">
                <td className="py-3 px-4 text-white font-medium">{rule.name}</td>
                <td className="py-3 px-4 text-gray-300 font-mono text-sm">{rule.source}</td>
                <td className="py-3 px-4 text-gray-300 font-mono text-sm">{rule.destination}</td>
                <td className="py-3 px-4 text-gray-300 font-mono">{rule.port}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    rule.action === 'allow' ? 'bg-green-500/20 text-green-400' :
                    rule.action === 'deny' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>{rule.action}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{rule.hits.toLocaleString()}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    rule.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{rule.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
