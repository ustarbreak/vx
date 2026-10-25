import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Activity, CheckCircle, AlertTriangle } from 'lucide-react';

interface SDWANAlert {
  id: string;
  type: 'link-down' | 'performance' | 'security' | 'configuration';
  severity: 'critical' | 'high' | 'medium' | 'low';
  site: string;
  link: string;
  status: 'active' | 'resolved' | 'investigating';
  timestamp: string;
  ticketCreated: boolean;
}

export default function SDWANPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<SDWANAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      setAlerts([
        { id: 'SDWAN-001', type: 'link-down', severity: 'critical', site: 'Branch-Office-NYC', link: 'Primary ISP', status: 'active', timestamp: '2027-01-15T09:30:00Z', ticketCreated: true },
        { id: 'SDWAN-002', type: 'performance', severity: 'high', site: 'Branch-Office-LA', link: 'Secondary ISP', status: 'investigating', timestamp: '2027-01-15T08:45:00Z', ticketCreated: false },
        { id: 'SDWAN-003', type: 'configuration', severity: 'medium', site: 'Branch-Office-CHI', link: 'VPN Tunnel', status: 'resolved', timestamp: '2027-01-15T07:20:00Z', ticketCreated: true },
      ]);
      setLoading(false);
    };
    fetchAlerts();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">SD-WAN Management</h1>
        <p className="text-gray-400 mt-1">Monitor and manage software-defined WAN connections</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Network className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">12</span>
          </div>
          <p className="text-gray-400 text-sm">Total Sites</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">10</span>
          </div>
          <p className="text-gray-400 text-sm">Healthy</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-white">1</span>
          </div>
          <p className="text-gray-400 text-sm">Degraded</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">1</span>
          </div>
          <p className="text-gray-400 text-sm">Down</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Site</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Link</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-b border-slate-800 hover:bg-slate-800 cursor-pointer" onClick={() => navigate(`/client-admin/sd-wan/${alert.id}`)}>
                <td className="py-3 px-4 text-white capitalize">{alert.type}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    alert.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    alert.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>{alert.severity}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{alert.site}</td>
                <td className="py-3 px-4 text-gray-300">{alert.link}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    alert.status === 'active' ? 'bg-red-500/20 text-red-400' :
                    alert.status === 'investigating' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                  }`}>{alert.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{new Date(alert.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
