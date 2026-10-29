import React, { useState, useEffect } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { demoDevices, demoDeviceMetrics, demoHealthStatuses, demoHash } from '../../data/demoWorld';

interface PerformanceMetric {
  timestamp: string;
  cpu: number;
  memory: number;
  disk: number;
  network: number;
}

interface SystemHealth {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  value: number;
  threshold: number;
  message: string;
}

export default function PerformanceStatistics() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState('24h');
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call to fetch performance metrics
    const fetchMetrics = async () => {
      try {
        // In production: GET /api/organizations/{id}/performance/metrics — the
        // backend aggregates collector samples per org; in demo mode the SAME
        // figures are derived deterministically from demoWorld (hostname hash),
        // never Math.random(). Org-scoped via the logged-in tenant.
        await new Promise(resolve => setTimeout(resolve, 500));

        const n = Number(String(user?.orgId ?? '').replace(/^org-dw-/, ''));
        const orgId = Number.isFinite(n) && n > 0 ? n : null;
        const orgDevices = orgId != null
          ? demoDevices.filter(d => d.orgId === orgId)
          : demoDevices;

        // Build a deterministic 24h series from the fleet's base metrics.
        const now = new Date();
        const series: PerformanceMetric[] = Array.from({ length: 24 }, (_, i) => {
          const time = new Date(now.getTime() - (23 - i) * 3600000);
          let cpu = 0, mem = 0, dsk = 0;
          for (const d of orgDevices) {
            const m = demoDeviceMetrics(d.hostname, `h${i}`);
            cpu += m.cpu; mem += m.memory; dsk += m.disk;
          }
          const k = Math.max(1, orgDevices.length);
          return {
            timestamp: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            cpu: Math.round(cpu / k),
            memory: Math.round(mem / k),
            disk: Math.round(dsk / k),
            network: 30 + demoHash(`net|${i}|${orgId ?? 'all'}`, 50),
          };
        });

        setMetrics(series);

        // Health cards come straight from the canonical demoWorld slice
        // (demoHealthStatuses), scoped to the tenant like the real feed.
        setSystemHealth(orgId != null
          ? demoHealthStatuses.filter(h => h.orgId === orgId)
          : demoHealthStatuses);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch performance metrics:', error);
        setLoading(false);
      }
    };

    fetchMetrics();

    // Real-time updates — deterministic hash-based walk (no Math.random):
    // each tick advances by a stable delta derived from the hour slot.
    const interval = setInterval(() => {
      setMetrics(prev => {
        if (!prev.length) return prev;
        const newMetrics = [...prev.slice(1)];
        const now = new Date();
        const slot = `${now.getHours()}:${Math.floor(now.getMinutes() / 5)}`;
        const last = prev[prev.length - 1];
        const step = (salt: string, span: number) => demoHash(`${slot}|${salt}`, span * 2 + 1) - span;
        newMetrics.push({
          timestamp: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          cpu: Math.max(0, Math.min(100, last.cpu + step('cpu', 5))),
          memory: Math.max(0, Math.min(100, last.memory + step('mem', 4))),
          disk: Math.max(0, Math.min(100, last.disk + step('dsk', 3))),
          network: Math.max(0, Math.min(100, last.network + step('net', 6))),
        });
        return newMetrics;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [user?.orgId]);

  const currentMetrics = metrics[metrics.length - 1] || { cpu: 0, memory: 0, disk: 0, network: 0 };
  const avgMetrics = {
    cpu: Math.round(metrics.reduce((sum, m) => sum + m.cpu, 0) / metrics.length),
    memory: Math.round(metrics.reduce((sum, m) => sum + m.memory, 0) / metrics.length),
    disk: Math.round(metrics.reduce((sum, m) => sum + m.disk, 0) / metrics.length),
    network: Math.round(metrics.reduce((sum, m) => sum + m.network, 0) / metrics.length),
  };

  const peakMetrics = {
    cpu: Math.round(Math.max(...metrics.map(m => m.cpu))),
    memory: Math.round(Math.max(...metrics.map(m => m.memory))),
    disk: Math.round(Math.max(...metrics.map(m => m.disk))),
    network: Math.round(Math.max(...metrics.map(m => m.network))),
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-500 bg-green-500/20';
      case 'warning': return 'text-yellow-500 bg-yellow-500/20';
      case 'critical': return 'text-red-500 bg-red-500/20';
      default: return 'text-gray-500 bg-gray-500/20';
    }
  };

  const getProgressColor = (value: number, threshold: number) => {
    if (value >= threshold) return 'bg-red-500';
    if (value >= threshold * 0.8) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading performance metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">System Performance</h1>
          <p className="text-gray-400 mt-1">
            Real-time system performance monitoring and analytics
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

      {/* Current Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Cpu className="w-6 h-6 text-blue-400" />
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              currentMetrics.cpu > 80 ? 'text-red-400' :
              currentMetrics.cpu > 60 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {currentMetrics.cpu > avgMetrics.cpu ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {Math.abs(currentMetrics.cpu - avgMetrics.cpu).toFixed(0)}%
            </div>
          </div>
          <p className="text-gray-400 text-sm">CPU Usage</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{currentMetrics.cpu.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.cpu}%</span>
              <span>Peak: {peakMetrics.cpu}%</span>
            </div>
            <div className="w-full bg-[var(--ic-surface)] rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  currentMetrics.cpu > 80 ? 'bg-red-500' :
                  currentMetrics.cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${currentMetrics.cpu}%` }}
              />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <MemoryStick className="w-6 h-6 text-purple-400" />
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              currentMetrics.memory > 80 ? 'text-red-400' :
              currentMetrics.memory > 60 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {currentMetrics.memory > avgMetrics.memory ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {Math.abs(currentMetrics.memory - avgMetrics.memory).toFixed(0)}%
            </div>
          </div>
          <p className="text-gray-400 text-sm">Memory Usage</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{currentMetrics.memory.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.memory}%</span>
              <span>Peak: {peakMetrics.memory}%</span>
            </div>
            <div className="w-full bg-[var(--ic-surface)] rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  currentMetrics.memory > 80 ? 'bg-red-500' :
                  currentMetrics.memory > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${currentMetrics.memory}%` }}
              />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <HardDrive className="w-6 h-6 text-green-400" />
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              currentMetrics.disk > 80 ? 'text-red-400' :
              currentMetrics.disk > 60 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {currentMetrics.disk > avgMetrics.disk ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {Math.abs(currentMetrics.disk - avgMetrics.disk).toFixed(0)}%
            </div>
          </div>
          <p className="text-gray-400 text-sm">Disk Usage</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{currentMetrics.disk.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.disk}%</span>
              <span>Peak: {peakMetrics.disk}%</span>
            </div>
            <div className="w-full bg-[var(--ic-surface)] rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  currentMetrics.disk > 80 ? 'bg-red-500' :
                  currentMetrics.disk > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${currentMetrics.disk}%` }}
              />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-cyan-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-cyan-400" />
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              currentMetrics.network > 80 ? 'text-red-400' :
              currentMetrics.network > 60 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {currentMetrics.network > avgMetrics.network ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {Math.abs(currentMetrics.network - avgMetrics.network).toFixed(0)}%
            </div>
          </div>
          <p className="text-gray-400 text-sm">Network I/O</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{currentMetrics.network.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.network}%</span>
              <span>Peak: {peakMetrics.network}%</span>
            </div>
            <div className="w-full bg-[var(--ic-surface)] rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  currentMetrics.network > 80 ? 'bg-red-500' :
                  currentMetrics.network > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${currentMetrics.network}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Performance Chart */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">Performance Over Time</h2>
          <Activity className="w-6 h-6 text-blue-400" />
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={metrics}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="timestamp" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" domain={[0, 100]} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1e293b', 
                border: '1px solid #334155',
                borderRadius: '8px'
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={2} name="CPU %" />
            <Line type="monotone" dataKey="memory" stroke="#8b5cf6" strokeWidth={2} name="Memory %" />
            <Line type="monotone" dataKey="disk" stroke="#10b981" strokeWidth={2} name="Disk %" />
            <Line type="monotone" dataKey="network" stroke="#06b6d4" strokeWidth={2} name="Network %" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* System Health */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">System Health</h2>
          <AlertTriangle className="w-6 h-6 text-yellow-400" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {systemHealth.map((health, idx) => (
            <div key={idx} className="bg-[var(--ic-surface)] rounded-lg p-4 border border-[var(--ic-border)]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[var(--ic-heading)] font-semibold">{health.component}</h3>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(health.status)}`}>
                  {health.status}
                </span>
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-400">Current</span>
                  <span className="text-[var(--ic-heading)] font-semibold">{health.value}</span>
                </div>
                <div className="w-full bg-[var(--ic-surface-2)] rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full ${getProgressColor(health.value, health.threshold)}`}
                    style={{ width: `${Math.min(100, (health.value / health.threshold) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                  <span>0</span>
                  <span>Threshold: {health.threshold}</span>
                </div>
              </div>
              <p className="text-gray-400 text-sm">{health.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
