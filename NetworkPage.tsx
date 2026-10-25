import React from 'react';
import { Network, Wifi, WifiOff, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { mockNetworkDevices } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';

const throughputData = [
  { time: '00:00', mbps: 420 }, { time: '04:00', mbps: 380 }, { time: '08:00', mbps: 890 },
  { time: '12:00', mbps: 1200 }, { time: '16:00', mbps: 950 }, { time: '20:00', mbps: 620 },
];

function NetworkContent() {
  const online = mockNetworkDevices.filter(d => d.status === 'online').length;
  const degraded = mockNetworkDevices.filter(d => d.status === 'degraded').length;
  const offline = mockNetworkDevices.filter(d => d.status === 'offline').length;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Network className="w-7 h-7 text-purple-400" /> Network Monitoring
        </h1>
        <p className="text-slate-500 text-sm mt-1">Real-time network device status and throughput</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Devices</p>
          <p className="text-2xl font-bold text-white mt-1">{mockNetworkDevices.length}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Online</p>
          <p className="text-2xl font-bold text-cyber-green mt-1">{online}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Degraded</p>
          <p className="text-2xl font-bold text-cyber-yellow mt-1">{degraded}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Offline</p>
          <p className="text-2xl font-bold text-cyber-red mt-1">{offline}</p>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Network Throughput (24h)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={throughputData}>
            <defs><linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
            <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', fontSize: '12px' }} />
            <Area type="monotone" dataKey="mbps" stroke="#8b5cf6" fill="url(#netGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Device Inventory</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Hostname</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Type</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">IP</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Status</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400">Throughput</th>
            </tr>
          </thead>
          <tbody>
            {mockNetworkDevices.map(d => (
              <tr key={d.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="px-4 py-3 text-sm text-slate-200 font-mono">{d.hostname}</td>
                <td className="px-4 py-3 text-xs text-slate-400 capitalize">{d.type}</td>
                <td className="px-4 py-3 text-xs text-slate-400 font-mono">{d.ip}</td>
                <td className="px-4 py-3">
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${
                    d.status === 'online' ? 'text-cyber-green' : d.status === 'degraded' ? 'text-cyber-yellow' : 'text-cyber-red'
                  }`}>
                    {d.status === 'online' ? <Wifi className="w-3 h-3" /> : d.status === 'degraded' ? <Activity className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">{d.throughputMbps} Mbps</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function NetworkPage() {
  return <ServiceGate serviceId="network-monitoring"><NetworkContent /></ServiceGate>;
}
