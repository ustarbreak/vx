import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  AlertTriangle, CheckCircle, XCircle, Filter, 
  Search, Bell, Eye, Clock, Server, Shield
} from 'lucide-react';

interface Alert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  device: string;
  service: string;
  timestamp: string;
  status: 'active' | 'acknowledged' | 'resolved';
  description: string;
}

export default function AlertsPage() {
  const navigate = useNavigate();
  const [alerts] = useState<Alert[]>([
    {
      id: '1',
      severity: 'critical',
      title: 'Ransomware Detected',
      device: 'server-db-01',
      service: 'Endpoint Protection',
      timestamp: '2 min ago',
      status: 'active',
      description: 'Suspicious encryption activity detected on server-db-01. Immediate action required.',
    },
    {
      id: '2',
      severity: 'high',
      title: 'Multiple Failed Login Attempts',
      device: 'firewall-main',
      service: 'Threat Intelligence',
      timestamp: '15 min ago',
      status: 'active',
      description: '15 failed login attempts from IP 192.168.1.100 in the last 5 minutes.',
    },
    {
      id: '3',
      severity: 'medium',
      title: 'High CPU Usage',
      device: 'server-web-01',
      service: 'Network Monitoring',
      timestamp: '1 hour ago',
      status: 'acknowledged',
      description: 'CPU usage exceeded 90% for more than 10 minutes.',
    },
    {
      id: '4',
      severity: 'low',
      title: 'Disk Space Warning',
      device: 'server-backup',
      service: 'Backup & DR',
      timestamp: '2 hours ago',
      status: 'resolved',
      description: 'Disk usage reached 85%. Consider cleaning up old backups.',
    },
  ]);

  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAlerts = alerts.filter(alert => {
    const matchesSearch = alert.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         alert.device.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSeverity = filterSeverity === 'all' || alert.severity === filterSeverity;
    const matchesStatus = filterStatus === 'all' || alert.status === filterStatus;
    return matchesSearch && matchesSeverity && matchesStatus;
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <AlertTriangle className="w-5 h-5 text-red-400" />;
      case 'acknowledged': return <Bell className="w-5 h-5 text-yellow-400" />;
      case 'resolved': return <CheckCircle className="w-5 h-5 text-green-400" />;
      default: return null;
    }
  };

  const stats = {
    total: alerts.length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    high: alerts.filter(a => a.severity === 'high').length,
    active: alerts.filter(a => a.status === 'active').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Security Alerts</h1>
        <p className="text-gray-400 mt-1">
          Monitor and manage security alerts across all services
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div 
          onClick={() => navigate('/client-admin/alerts/1')}
          className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white cursor-pointer hover:scale-105 transition-transform"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-100 text-sm">Critical Alerts</p>
              <p className="text-3xl font-bold mt-2">{stats.critical}</p>
            </div>
            <AlertTriangle className="w-12 h-12 text-red-200" />
          </div>
        </div>
        <div 
          onClick={() => navigate('/client-admin/alerts/high')}
          className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white cursor-pointer hover:scale-105 transition-transform"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">High Alerts</p>
              <p className="text-3xl font-bold mt-2">{stats.high}</p>
            </div>
            <Bell className="w-12 h-12 text-orange-200" />
          </div>
        </div>
        <div 
          onClick={() => navigate('/client-admin/alerts/active')}
          className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-6 text-white cursor-pointer hover:scale-105 transition-transform"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-100 text-sm">Active Alerts</p>
              <p className="text-3xl font-bold mt-2">{stats.active}</p>
            </div>
            <Clock className="w-12 h-12 text-yellow-200" />
          </div>
        </div>
        <div 
          onClick={() => navigate('/client-admin/alerts/all')}
          className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white cursor-pointer hover:scale-105 transition-transform"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Alerts</p>
              <p className="text-3xl font-bold mt-2">{stats.total}</p>
            </div>
            <Shield className="w-12 h-12 text-blue-200" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search alerts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-4">
        {filteredAlerts.map((alert) => (
          <div
            key={alert.id}
            onClick={() => navigate(`/client-admin/alerts/${alert.id}`)}
            className="bg-slate-900 rounded-xl p-6 border border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4 flex-1">
                {getStatusIcon(alert.status)}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-white">{alert.title}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm mb-3">{alert.description}</p>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Server className="w-4 h-4" />
                      <span>{alert.device}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400">
                      <Shield className="w-4 h-4" />
                      <span>{alert.service}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400">
                      <Clock className="w-4 h-4" />
                      <span>{alert.timestamp}</span>
                    </div>
                  </div>
                </div>
              </div>
              <button className="p-2 hover:bg-slate-800 rounded-lg text-gray-400 hover:text-white">
                <Eye className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
