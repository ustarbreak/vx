import React, { useState, useEffect } from 'react';
import { Wifi, Users, CheckCircle, XCircle, Clock } from 'lucide-react';

interface VPNConnection {
  id: string;
  user: string;
  device: string;
  ip: string;
  location: string;
  status: 'connected' | 'disconnected' | 'connecting';
  connectedAt?: string;
  duration?: string;
  bandwidth: string;
}

export default function VPNGatewayPage() {
  const [connections, setConnections] = useState<VPNConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConnections = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      setConnections([
        { id: 'VPN-001', user: 'John Doe', device: 'Laptop-JohnDoe', ip: '10.0.10.20', location: 'New York, USA', status: 'connected', connectedAt: '2027-01-15T08:30:00Z', duration: '1h 15m', bandwidth: '2.4 Mbps' },
        { id: 'VPN-002', user: 'Jane Smith', device: 'Mobile-JaneSmith', ip: '10.0.10.21', location: 'London, UK', status: 'connected', connectedAt: '2027-01-15T09:00:00Z', duration: '45m', bandwidth: '1.8 Mbps' },
        { id: 'VPN-003', user: 'Bob Wilson', device: 'Laptop-BobWilson', ip: '10.0.10.22', location: 'Tokyo, Japan', status: 'connecting', bandwidth: '0 Mbps' },
        { id: 'VPN-004', user: 'Alice Brown', device: 'Desktop-AliceBrown', ip: '10.0.10.23', location: 'Paris, France', status: 'disconnected', connectedAt: '2027-01-14T18:00:00Z', duration: '6h 30m', bandwidth: '0 Mbps' },
      ]);
      setLoading(false);
    };
    fetchConnections();
  }, []);

  const stats = {
    total: connections.length,
    connected: connections.filter(c => c.status === 'connected').length,
    connecting: connections.filter(c => c.status === 'connecting').length,
    disconnected: connections.filter(c => c.status === 'disconnected').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">VPN Gateway</h1>
        <p className="text-gray-400 mt-1">Monitor and manage VPN connections</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Wifi className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Connections</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.connected}</span>
          </div>
          <p className="text-gray-400 text-sm">Connected</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-white">{stats.connecting}</span>
          </div>
          <p className="text-gray-400 text-sm">Connecting</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-gray-400" />
            <span className="text-2xl font-bold text-white">{stats.disconnected}</span>
          </div>
          <p className="text-gray-400 text-sm">Disconnected</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">User</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Location</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Connected At</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Duration</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Bandwidth</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((conn) => (
              <tr key={conn.id} className="border-b border-slate-800 hover:bg-slate-800">
                <td className="py-3 px-4 text-white font-medium">{conn.user}</td>
                <td className="py-3 px-4 text-gray-300">{conn.device}</td>
                <td className="py-3 px-4 text-gray-300 font-mono">{conn.ip}</td>
                <td className="py-3 px-4 text-gray-300">{conn.location}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    conn.status === 'connected' ? 'bg-green-500/20 text-green-400' :
                    conn.status === 'connecting' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{conn.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{conn.connectedAt ? new Date(conn.connectedAt).toLocaleString() : '-'}</td>
                <td className="py-3 px-4 text-gray-300">{conn.duration || '-'}</td>
                <td className="py-3 px-4 text-gray-300">{conn.bandwidth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
