import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart3, TrendingUp, TrendingDown, Activity,
  Server, Shield, Network, AlertTriangle, ChevronDown
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';

export default function StatisticsPage() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('24h');

  // Mock data
  const trafficData = [
    { time: '00:00', inbound: 400, outbound: 240 },
    { time: '04:00', inbound: 300, outbound: 139 },
    { time: '08:00', inbound: 600, outbound: 480 },
    { time: '12:00', inbound: 800, outbound: 390 },
    { time: '16:00', inbound: 900, outbound: 480 },
    { time: '20:00', inbound: 700, outbound: 380 },
    { time: '23:59', inbound: 500, outbound: 430 },
  ];

  const deviceStatusData = [
    { name: 'Online', value: 45, color: '#10b981' },
    { name: 'Offline', value: 3, color: '#ef4444' },
    { name: 'Warning', value: 7, color: '#f59e0b' },
  ];

  const alertsByServiceData = [
    { service: 'Threat Intel', alerts: 12, color: '#3b82f6' },
    { service: 'Endpoint', alerts: 8, color: '#8b5cf6' },
    { service: 'Network', alerts: 15, color: '#06b6d4' },
    { service: 'Compliance', alerts: 5, color: '#10b981' },
    { service: 'Backup', alerts: 3, color: '#f59e0b' },
  ];

  const performanceData = [
    { time: 'Mon', cpu: 65, memory: 78, disk: 45 },
    { time: 'Tue', cpu: 59, memory: 72, disk: 46 },
    { time: 'Wed', cpu: 80, memory: 85, disk: 47 },
    { time: 'Thu', cpu: 81, memory: 82, disk: 48 },
    { time: 'Fri', cpu: 76, memory: 79, disk: 49 },
    { time: 'Sat', cpu: 55, memory: 68, disk: 50 },
    { time: 'Sun', cpu: 45, memory: 62, disk: 51 },
  ];

  const stats = [
    {
      title: 'Network Traffic',
      value: '2.4 GB/s',
      change: '+12%',
      trend: 'up',
      icon: Network,
      color: 'blue',
      link: '/client-admin/statistics/network',
    },
    {
      title: 'Active Devices',
      value: '45',
      change: '+3',
      trend: 'up',
      icon: Server,
      color: 'green',
      link: '/client-admin/statistics/devices',
    },
    {
      title: 'Security Alerts',
      value: '28',
      change: '-5',
      trend: 'down',
      icon: Shield,
      color: 'red',
      link: '/client-admin/alerts',
    },
    {
      title: 'System Performance',
      value: '92%',
      change: '+2%',
      trend: 'up',
      icon: Activity,
      color: 'purple',
      link: '/client-admin/statistics/performance',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Statistics & Analytics</h1>
          <p className="text-gray-400 mt-1">
            Comprehensive view of your infrastructure performance
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Statistics Dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white transition-colors">
              <BarChart3 className="w-4 h-4" />
              <span>View Statistics</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            <div className="absolute right-0 mt-2 w-56 bg-slate-800 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
              <div className="py-2">
                <button
                  onClick={() => navigate('/client-admin/statistics')}
                  className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 flex items-center gap-3"
                >
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className="font-medium">Global Overview</p>
                    <p className="text-xs text-gray-400">All statistics</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate('/client-admin/statistics/network')}
                  className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 flex items-center gap-3"
                >
                  <Network className="w-4 h-4 text-cyan-400" />
                  <div>
                    <p className="font-medium">Network Statistics</p>
                    <p className="text-xs text-gray-400">Traffic & devices</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate('/client-admin/statistics/devices')}
                  className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 flex items-center gap-3"
                >
                  <Server className="w-4 h-4 text-green-400" />
                  <div>
                    <p className="font-medium">Device Statistics</p>
                    <p className="text-xs text-gray-400">All devices metrics</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate('/client-admin/statistics/performance')}
                  className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 flex items-center gap-3"
                >
                  <Activity className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className="font-medium">System Performance</p>
                    <p className="text-xs text-gray-400">CPU, Memory, Disk</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
          {['24h', '7d', '30d', '90d'].map((range) => (
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

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div
              key={idx}
              onClick={() => navigate(stat.link)}
              className="bg-slate-900 rounded-xl p-6 border border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 bg-${stat.color}-500/20 rounded-lg`}>
                  <Icon className={`w-6 h-6 text-${stat.color}-400`} />
                </div>
                <div className={`flex items-center gap-1 text-sm ${
                  stat.trend === 'up' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {stat.trend === 'up' ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                  {stat.change}
                </div>
              </div>
              <p className="text-gray-400 text-sm">{stat.title}</p>
              <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Network Traffic Chart */}
        <div 
          onClick={() => navigate('/client-admin/statistics/network')}
          className="bg-slate-900 rounded-xl p-6 border border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Network Traffic</h2>
            <BarChart3 className="w-6 h-6 text-blue-400" />
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
              />
              <Area 
                type="monotone" 
                dataKey="outbound" 
                stackId="2"
                stroke="#8b5cf6" 
                fill="#8b5cf6" 
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Device Status Chart */}
        <div 
          onClick={() => navigate('/client-admin/statistics/devices')}
          className="bg-slate-900 rounded-xl p-6 border border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Device Status</h2>
            <Server className="w-6 h-6 text-green-400" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={deviceStatusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {deviceStatusData.map((entry, index) => (
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

        {/* Alerts by Service */}
        <div 
          onClick={() => navigate('/client-admin/alerts')}
          className="bg-slate-900 rounded-xl p-6 border border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Alerts by Service</h2>
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={alertsByServiceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="service" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1e293b', 
                  border: '1px solid #334155',
                  borderRadius: '8px'
                }}
              />
              <Bar dataKey="alerts" fill="#3b82f6">
                {alertsByServiceData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* System Performance */}
        <div 
          onClick={() => navigate('/client-admin/statistics/performance')}
          className="bg-slate-900 rounded-xl p-6 border border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">System Performance</h2>
            <Activity className="w-6 h-6 text-purple-400" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={performanceData}>
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
              <Line type="monotone" dataKey="cpu" stroke="#ef4444" strokeWidth={2} />
              <Line type="monotone" dataKey="memory" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="disk" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
