import React, { useState, useEffect } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';

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
  const [timeRange, setTimeRange] = useState('24h');
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call to fetch performance metrics
    const fetchMetrics = async () => {
      try {
        // In production: const response = await fetch('/api/performance/metrics');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Generate mock time series data
        const now = new Date();
        const mockMetrics: PerformanceMetric[] = Array.from({ length: 24 }, (_, i) => {
          const time = new Date(now.getTime() - (23 - i) * 3600000);
          return {
            timestamp: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            cpu: 40 + Math.random() * 40,
            memory: 60 + Math.random() * 25,
            disk: 45 + Math.random() * 15,
            network: 30 + Math.random() * 50,
          };
        });
        
        setMetrics(mockMetrics);

        // Generate system health data
        const mockHealth: SystemHealth[] = [
          { component: 'CPU Usage', status: 'healthy', value: 52, threshold: 80, message: 'Normal operation' },
          { component: 'Memory Usage', status: 'warning', value: 78, threshold: 75, message: 'High memory usage detected' },
          { component: 'Disk I/O', status: 'healthy', value: 45, threshold: 80, message: 'Normal disk activity' },
          { component: 'Network Latency', status: 'healthy', value: 12, threshold: 50, message: 'Low latency' },
          { component: 'Database Connections', status: 'critical', value: 95, threshold: 90, message: 'Connection pool nearly exhausted' },
          { component: 'API Response Time', status: 'healthy', value: 245, threshold: 500, message: 'Within acceptable range' },
        ];
        
        setSystemHealth(mockHealth);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch performance metrics:', error);
        setLoading(false);
      }
    };

    fetchMetrics();

    // Simulate real-time updates
    const interval = setInterval(() => {
      setMetrics(prev => {
        const newMetrics = [...prev.slice(1)];
        const now = new Date();
        newMetrics.push({
          timestamp: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          cpu: Math.max(0, Math.min(100, prev[prev.length - 1].cpu + (Math.random() * 10 - 5))),
          memory: Math.max(0, Math.min(100, prev[prev.length - 1].memory + (Math.random() * 8 - 4))),
          disk: Math.max(0, Math.min(100, prev[prev.length - 1].disk + (Math.random() * 6 - 3))),
          network: Math.max(0, Math.min(100, prev[prev.length - 1].network + (Math.random() * 12 - 6))),
        });
        return newMetrics;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

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
          <h1 className="text-3xl font-bold text-white">System Performance</h1>
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
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-gray-400 hover:bg-slate-700'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Current Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
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
          <p className="text-2xl font-bold text-white mt-1">{currentMetrics.cpu.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.cpu}%</span>
              <span>Peak: {peakMetrics.cpu}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
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

        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
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
          <p className="text-2xl font-bold text-white mt-1">{currentMetrics.memory.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.memory}%</span>
              <span>Peak: {peakMetrics.memory}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
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

        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
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
          <p className="text-2xl font-bold text-white mt-1">{currentMetrics.disk.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.disk}%</span>
              <span>Peak: {peakMetrics.disk}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
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

        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
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
          <p className="text-2xl font-bold text-white mt-1">{currentMetrics.network.toFixed(1)}%</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Avg: {avgMetrics.network}%</span>
              <span>Peak: {peakMetrics.network}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
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
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Performance Over Time</h2>
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
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">System Health</h2>
          <AlertTriangle className="w-6 h-6 text-yellow-400" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {systemHealth.map((health, idx) => (
            <div key={idx} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold">{health.component}</h3>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(health.status)}`}>
                  {health.status}
                </span>
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-400">Current</span>
                  <span className="text-white font-semibold">{health.value}</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2">
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
