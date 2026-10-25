import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Monitor, Printer, Wifi, Shield, Activity, TrendingUp, TrendingDown } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

interface Device {
  id: string;
  hostname: string;
  ip: string;
  type: 'server' | 'switch' | 'router' | 'firewall' | 'endpoint' | 'printer' | 'ap';
  os: string;
  status: 'online' | 'offline' | 'warning';
  cpu: number;
  memory: number;
  disk: number;
  uptime: string;
  location: string;
  lastSeen: string;
  alerts: number;
}

export default function DeviceStatistics() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('24h');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    // Simulate API call to fetch devices
    const fetchDevices = async () => {
      try {
        // In production: const response = await fetch('/api/devices');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Single source of truth: the coherent demo world (same 24 devices,
        // same hostnames/IPs/status as Network page, Alerts, Tickets, PSA).
        const { demoDevices } = await import('../../data/demoWorld');
        const hash = (str: string, mod: number) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % mod; return h; };
        const mockDevices: Device[] = demoDevices.map((d, i) => ({
          id: String(i + 1), hostname: d.hostname, ip: d.ip, type: (d.type === 'storage' ? 'server' : d.type) as Device['type'],
          os: d.os, status: d.status === 'degraded' ? 'warning' : d.status,
          cpu: d.status === 'offline' ? 0 : 15 + hash(d.hostname, 60),
          memory: d.status === 'offline' ? 0 : 25 + hash(d.hostname + 'm', 55),
          disk: d.status === 'offline' ? 0 : 20 + hash(d.hostname + 'd', 60),
          uptime: d.status === 'offline' ? '0d 0h' : `${2 + hash(d.hostname, 90)}d ${hash(d.hostname + 'h', 23)}h`,
          location: d.location, lastSeen: d.lastSeenMin === 0 ? 'just now' : `${d.lastSeenMin} min ago`,
          alerts: d.alerts,
        }));
        
        setDevices(mockDevices);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch devices:', error);
        setLoading(false);
      }
    };

    fetchDevices();

    // Simulate real-time updates
    const interval = setInterval(() => {
      setDevices(prev => prev.map(device => ({
        ...device,
        cpu: device.status === 'offline' ? 0 : Math.max(0, Math.min(100, device.cpu + Math.floor(Math.random() * 10 - 5))),
        memory: device.status === 'offline' ? 0 : Math.max(0, Math.min(100, device.memory + Math.floor(Math.random() * 8 - 4))),
      })));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const filteredDevices = filterType === 'all' 
    ? devices 
    : devices.filter(d => d.type === filterType);

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    warning: devices.filter(d => d.status === 'warning').length,
    avgCpu: Math.round(devices.filter(d => d.status !== 'offline').reduce((sum, d) => sum + d.cpu, 0) / devices.filter(d => d.status !== 'offline').length),
    avgMemory: Math.round(devices.filter(d => d.status !== 'offline').reduce((sum, d) => sum + d.memory, 0) / devices.filter(d => d.status !== 'offline').length),
  };

  const deviceTypeData = [
    { name: 'Servers', value: devices.filter(d => d.type === 'server').length, color: '#3b82f6' },
    { name: 'Endpoints', value: devices.filter(d => d.type === 'endpoint').length, color: '#8b5cf6' },
    { name: 'Network', value: devices.filter(d => ['router', 'switch', 'firewall', 'ap'].includes(d.type)).length, color: '#06b6d4' },
    { name: 'Other', value: devices.filter(d => ['printer'].includes(d.type)).length, color: '#10b981' },
  ];

  const cpuDistribution = [
    { range: '0-25%', count: devices.filter(d => d.cpu <= 25 && d.status !== 'offline').length },
    { range: '26-50%', count: devices.filter(d => d.cpu > 25 && d.cpu <= 50 && d.status !== 'offline').length },
    { range: '51-75%', count: devices.filter(d => d.cpu > 50 && d.cpu <= 75 && d.status !== 'offline').length },
    { range: '76-100%', count: devices.filter(d => d.cpu > 75 && d.status !== 'offline').length },
  ];

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'server': return Server;
      case 'endpoint': return Monitor;
      case 'printer': return Monitor;
      case 'router': return Shield;
      case 'switch': return Shield;
      case 'firewall': return Shield;
      case 'ap': return Wifi;
      default: return Monitor;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'offline': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading device statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Device Statistics</h1>
          <p className="text-gray-400 mt-1">
            Comprehensive device monitoring and analytics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="server">Servers</option>
            <option value="endpoint">Endpoints</option>
            <option value="router">Routers</option>
            <option value="switch">Switches</option>
            <option value="firewall">Firewalls</option>
            <option value="ap">Access Points</option>
            <option value="printer">Printers</option>
          </select>
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
        <div 
          onClick={() => navigate('/client-admin/infrastructure')}
          className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)] hover:border-blue-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Server className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex items-center gap-1 text-green-400 text-sm">
              <TrendingUp className="w-4 h-4" />
              +3
            </div>
          </div>
          <p className="text-gray-400 text-sm">Total Devices</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{stats.total}</p>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-green-400" />
            </div>
            <div className="text-green-400 text-sm">{stats.online} online</div>
          </div>
          <p className="text-gray-400 text-sm">Average CPU</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{stats.avgCpu}%</p>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-purple-400" />
            </div>
            <div className="text-yellow-400 text-sm">{stats.warning} warnings</div>
          </div>
          <p className="text-gray-400 text-sm">Average Memory</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{stats.avgMemory}%</p>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-red-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-red-400" />
            </div>
            <div className="text-red-400 text-sm">{stats.offline} offline</div>
          </div>
          <p className="text-gray-400 text-sm">Device Health</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{Math.round((stats.online / stats.total) * 100)}%</p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Device Type Distribution */}
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[var(--ic-heading)]">Device Type Distribution</h2>
            <Server className="w-6 h-6 text-blue-400" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={deviceTypeData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {deviceTypeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1e293b', 
                  border: '1px solid #334155',
                  borderRadius: '8px'
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* CPU Distribution */}
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[var(--ic-heading)]">CPU Usage Distribution</h2>
            <Activity className="w-6 h-6 text-green-400" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={cpuDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="range" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1e293b', 
                  border: '1px solid #334155',
                  borderRadius: '8px'
                }}
              />
              <Bar dataKey="count" fill="#3b82f6" name="Devices" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Devices Table */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">All Devices</h2>
          <span className="text-gray-400 text-sm">{filteredDevices.length} devices</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">OS</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">CPU</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Memory</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Disk</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Uptime</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((device) => {
                const Icon = getDeviceIcon(device.type);
                return (
                  <tr 
                    key={device.id} 
                    className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer transition-colors"
                    onClick={() => navigate(`/client-admin/infrastructure/device/${device.id}`)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <Icon className="w-5 h-5 text-blue-400" />
                        <div>
                          <p className="text-[var(--ic-heading)] font-medium">{device.hostname}</p>
                          <p className="text-gray-400 text-xs">{device.location}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-300 font-mono">{device.ip}</td>
                    <td className="py-3 px-4 text-gray-300 capitalize">{device.type}</td>
                    <td className="py-3 px-4 text-gray-300">{device.os}</td>
                    <td className="py-3 px-4">
                      <span className={`flex items-center gap-2 ${getStatusColor(device.status)}`}>
                        <div className={`w-2 h-2 rounded-full ${
                          device.status === 'online' ? 'bg-green-500' :
                          device.status === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
                        } animate-pulse`} />
                        <span className="capitalize">{device.status}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-[var(--ic-surface)] rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              device.cpu > 80 ? 'bg-red-500' :
                              device.cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${device.cpu}%` }}
                          />
                        </div>
                        <span className="text-gray-300 text-sm">{device.cpu}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-[var(--ic-surface)] rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              device.memory > 80 ? 'bg-red-500' :
                              device.memory > 60 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${device.memory}%` }}
                          />
                        </div>
                        <span className="text-gray-300 text-sm">{device.memory}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-[var(--ic-surface)] rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              device.disk > 80 ? 'bg-red-500' :
                              device.disk > 60 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${device.disk}%` }}
                          />
                        </div>
                        <span className="text-gray-300 text-sm">{device.disk}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-300 text-sm">{device.uptime}</td>
                    <td className="py-3 px-4">
                      {device.alerts > 0 ? (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full text-xs font-medium">
                          {device.alerts}
                        </span>
                      ) : (
                        <span className="text-gray-500">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
