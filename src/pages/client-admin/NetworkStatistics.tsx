import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Server, Activity, TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { demoNetInterfaces, demoHash } from '../../data/demoWorld';

interface NetworkDevice {
  id: string;
  hostname: string;
  ip: string;
  type: string;
  status: 'online' | 'offline' | 'warning';
  bandwidth: number;
  packetsIn: number;
  packetsOut: number;
  errors: number;
  location: string;
}

// Deterministic traffic jitter for the live tick — same value for the same
// (timeSlot, hour) in demo AND real mode; replaces Math.random() entirely.
const jitter = (time: string, salt: string, slot: number, span: number, offset: number) =>
  demoHash(`${time}|${salt}|${slot}`, span * 2 + 1) - span + offset;

export default function NetworkStatistics() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('24h');
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [loading, setLoading] = useState(true);

  // Simulated real-time data
  const [trafficData, setTrafficData] = useState([
    { time: '00:00', inbound: 400, outbound: 240, errors: 2 },
    { time: '04:00', inbound: 300, outbound: 139, errors: 1 },
    { time: '08:00', inbound: 600, outbound: 480, errors: 3 },
    { time: '12:00', inbound: 800, outbound: 390, errors: 5 },
    { time: '16:00', inbound: 900, outbound: 480, errors: 2 },
    { time: '20:00', inbound: 700, outbound: 380, errors: 1 },
    { time: '23:59', inbound: 500, outbound: 430, errors: 0 },
  ]);

  useEffect(() => {
    // Simulate API call to fetch network devices
    const fetchDevices = async () => {
      try {
        // In production this is GET /api/organizations/{id}/net-interfaces —
        // the backend derives the SAME rows deterministically from the
        // discovered_devices table (hostname hash), mirroring demoWorld.
        await new Promise(resolve => setTimeout(resolve, 500));

        const netDevices: NetworkDevice[] = demoNetInterfaces.map(ni => ({
          id: ni.id,
          hostname: ni.hostname,
          ip: ni.ip,
          type: ni.type,
          status: ni.status,
          bandwidth: ni.inboundMbps + ni.outboundMbps,
          packetsIn: ni.packetsIn,
          packetsOut: ni.packetsOut,
          errors: ni.errors,
          location: ni.location,
        }));

        setDevices(netDevices);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch network devices:', error);
        setLoading(false);
      }
    };

    fetchDevices();

    // Real-time updates — deterministic hash-based jitter (no Math.random),
    // so every viewer sees identical numbers at the same wall-clock slot.
    const interval = setInterval(() => {
      const slot = Math.floor(Date.now() / 5000); // advances every tick
      setTrafficData(prev => prev.map(item => ({
        ...item,
        inbound: Math.max(0, item.inbound + jitter(item.time, 'in', slot, 50, 0)),
        outbound: Math.max(0, item.outbound + jitter(item.time, 'out', slot, 40, 0)),
        errors: Math.max(0, item.errors + jitter(item.time, 'err', slot, 1, 0)),
      })));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const stats = {
    totalBandwidth: devices.reduce((sum, d) => sum + d.bandwidth, 0),
    totalPacketsIn: devices.reduce((sum, d) => sum + d.packetsIn, 0),
    totalPacketsOut: devices.reduce((sum, d) => sum + d.packetsOut, 0),
    totalErrors: devices.reduce((sum, d) => sum + d.errors, 0),
    onlineDevices: devices.filter(d => d.status === 'online').length,
    offlineDevices: devices.filter(d => d.status === 'offline').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'offline': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <Wifi className="w-4 h-4" />;
      case 'offline': return <WifiOff className="w-4 h-4" />;
      case 'warning': return <Activity className="w-4 h-4" />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading network statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Network Statistics</h1>
          <p className="text-gray-400 mt-1">
            Real-time network traffic and device monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          {['1h', '24h', '7d', '30d'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                timeRange === range
                  ? 'bg-blue-600 text-[var(--ic-heading)]'
                  : 'bg-[var(--ic-surface)] text-gray-400 hover:bg-[var(--ic-surface-2)]'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Network className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex items-center gap-1 text-green-400 text-sm">
              <TrendingUp className="w-4 h-4" />
              +12%
            </div>
          </div>
          <p className="text-gray-400 text-sm">Total Bandwidth</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{stats.totalBandwidth} Mbps</p>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-green-400" />
            </div>
            <div className="flex items-center gap-1 text-green-400 text-sm">
              <TrendingUp className="w-4 h-4" />
              +8%
            </div>
          </div>
          <p className="text-gray-400 text-sm">Packets In</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{(stats.totalPacketsIn / 1000).toFixed(1)}K</p>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-purple-400" />
            </div>
            <div className="flex items-center gap-1 text-red-400 text-sm">
              <TrendingDown className="w-4 h-4" />
              -3%
            </div>
          </div>
          <p className="text-gray-400 text-sm">Packets Out</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{(stats.totalPacketsOut / 1000).toFixed(1)}K</p>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-red-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-red-400" />
            </div>
            <div className="flex items-center gap-1 text-red-400 text-sm">
              <TrendingUp className="w-4 h-4" />
              +5
            </div>
          </div>
          <p className="text-gray-400 text-sm">Total Errors</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{stats.totalErrors}</p>
        </div>
      </div>

      {/* Network Traffic Chart */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">Network Traffic Over Time</h2>
          <Network className="w-6 h-6 text-blue-400" />
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={trafficData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1e293b', 
                border: '1px solid #334155',
                borderRadius: '8px'
              }}
            />
            <Legend />
            <Area 
              type="monotone" 
              dataKey="inbound" 
              stackId="1"
              stroke="#3b82f6" 
              fill="#3b82f6" 
              fillOpacity={0.3}
              name="Inbound (Mbps)"
            />
            <Area 
              type="monotone" 
              dataKey="outbound" 
              stackId="2"
              stroke="#8b5cf6" 
              fill="#8b5cf6" 
              fillOpacity={0.3}
              name="Outbound (Mbps)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Network Devices Table */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">Network Devices</h2>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-2 text-green-400">
              <Wifi className="w-4 h-4" />
              {stats.onlineDevices} Online
            </span>
            <span className="flex items-center gap-2 text-red-400">
              <WifiOff className="w-4 h-4" />
              {stats.offlineDevices} Offline
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Bandwidth</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Packets In</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Packets Out</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Errors</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr 
                  key={device.id} 
                  className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer transition-colors"
                  onClick={() => navigate(`/client-admin/infrastructure/device/${device.id}`)}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <Server className="w-5 h-5 text-blue-400" />
                      <span className="text-[var(--ic-heading)] font-medium">{device.hostname}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300 font-mono">{device.ip}</td>
                  <td className="py-3 px-4 text-gray-300 capitalize">{device.type}</td>
                  <td className="py-3 px-4">
                    <div className={`flex items-center gap-2 ${getStatusColor(device.status)}`}>
                      {getStatusIcon(device.status)}
                      <span className="capitalize">{device.status}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{device.bandwidth} Mbps</td>
                  <td className="py-3 px-4 text-gray-300">{(device.packetsIn / 1000).toFixed(1)}K</td>
                  <td className="py-3 px-4 text-gray-300">{(device.packetsOut / 1000).toFixed(1)}K</td>
                  <td className="py-3 px-4">
                    <span className={device.errors > 10 ? 'text-red-400 font-semibold' : 'text-gray-300'}>
                      {device.errors}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{device.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
