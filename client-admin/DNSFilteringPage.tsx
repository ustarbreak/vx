import React, { useState, useEffect } from 'react';
import { Globe, Shield, AlertTriangle, CheckCircle } from 'lucide-react';

interface DNSRule {
  id: string;
  domain: string;
  category: string;
  action: 'block' | 'allow' | 'monitor';
  hits: number;
  lastHit?: string;
}

export default function DNSFilteringPage() {
  const [rules, setRules] = useState<DNSRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      setRules([
        { id: 'DNS-001', domain: '*.malware-site.com', category: 'Malware', action: 'block', hits: 1247, lastHit: '2027-01-15T09:30:00Z' },
        { id: 'DNS-002', domain: 'phishing-bank.com', category: 'Phishing', action: 'block', hits: 89, lastHit: '2027-01-15T08:15:00Z' },
        { id: 'DNS-003', domain: '*.social-media.com', category: 'Social Media', action: 'monitor', hits: 45678, lastHit: '2027-01-15T09:45:00Z' },
        { id: 'DNS-004', domain: 'trusted-partner.com', category: 'Business', action: 'allow', hits: 234, lastHit: '2027-01-15T09:00:00Z' },
      ]);
      setLoading(false);
    };
    fetchRules();
  }, []);

  const stats = {
    total: rules.length,
    blocked: rules.filter(r => r.action === 'block').length,
    monitored: rules.filter(r => r.action === 'monitor').length,
    totalHits: rules.reduce((sum, r) => sum + r.hits, 0),
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">DNS Filtering</h1>
        <p className="text-gray-400 mt-1">Manage DNS filtering rules and monitor blocked domains</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Globe className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Rules</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.blocked}</span>
          </div>
          <p className="text-gray-400 text-sm">Blocked</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-white">{stats.monitored}</span>
          </div>
          <p className="text-gray-400 text-sm">Monitored</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.totalHits.toLocaleString()}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Hits</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Domain</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Category</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Action</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Hits</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Hit</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-slate-800 hover:bg-slate-800">
                <td className="py-3 px-4 text-white font-mono">{rule.domain}</td>
                <td className="py-3 px-4 text-gray-300">{rule.category}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    rule.action === 'block' ? 'bg-red-500/20 text-red-400' :
                    rule.action === 'monitor' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                  }`}>{rule.action}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{rule.hits.toLocaleString()}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{rule.lastHit ? new Date(rule.lastHit).toLocaleString() : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
