import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, AlertTriangle, CheckCircle, XCircle, 
  Filter, Search, Clock, Server, Activity
} from 'lucide-react';

interface EndpointAlert {
  id: string;
  type: 'malware' | 'ransomware' | 'exploit' | 'suspicious' | 'fileless';
  severity: 'critical' | 'high' | 'medium' | 'low';
  device: string;
  deviceIp: string;
  threat: string;
  action: 'blocked' | 'quarantined' | 'detected' | 'cleaned';
  timestamp: string;
  ticketCreated: boolean;
  details: string;
}

export default function EndpointProtectionPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<EndpointAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const mockAlerts: EndpointAlert[] = [
          {
            id: 'EDR-001',
            type: 'ransomware',
            severity: 'critical',
            device: 'workstation-01',
            deviceIp: '10.0.10.20',
            threat: 'LockBit 4.0',
            action: 'blocked',
            timestamp: '2027-01-15T09:45:00Z',
            ticketCreated: true,
            details: 'Ransomware attempt detected and blocked. Process killed, files restored.',
          },
          {
            id: 'EDR-002',
            type: 'malware',
            severity: 'high',
            device: 'server-web-01',
            deviceIp: '10.0.10.10',
            threat: 'Trojan.GenericKD',
            action: 'quarantined',
            timestamp: '2027-01-15T08:30:00Z',
            ticketCreated: true,
            details: 'Malware quarantined. System scanned and cleaned.',
          },
          {
            id: 'EDR-003',
            type: 'fileless',
            severity: 'critical',
            device: 'workstation-05',
            deviceIp: '10.0.10.25',
            threat: 'PowerShell Empire',
            action: 'blocked',
            timestamp: '2027-01-15T07:15:00Z',
            ticketCreated: false,
            details: 'Fileless attack detected in memory. PowerShell execution blocked.',
          },
          {
            id: 'EDR-004',
            type: 'exploit',
            severity: 'high',
            device: 'server-db-01',
            deviceIp: '10.0.10.11',
            threat: 'CVE-2027-0142',
            action: 'blocked',
            timestamp: '2027-01-15T06:00:00Z',
            ticketCreated: true,
            details: 'Exploit attempt blocked. Vulnerability patched.',
          },
          {
            id: 'EDR-005',
            type: 'suspicious',
            severity: 'medium',
            device: 'workstation-12',
            deviceIp: '10.0.10.32',
            threat: 'Suspicious Process',
            action: 'detected',
            timestamp: '2027-01-15T05:30:00Z',
            ticketCreated: false,
            details: 'Unusual process behavior detected. Monitoring in progress.',
          },
        ];
        
        setAlerts(mockAlerts);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch endpoint alerts:', error);
        setLoading(false);
      }
    };

    fetchAlerts();
  }, []);

  const filteredAlerts = alerts.filter(alert => {
    const matchesFilter = filter === 'all' || alert.type === filter;
    const matchesSearch = alert.device.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         alert.threat.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: alerts.length,
    blocked: alerts.filter(a => a.action === 'blocked').length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    devices: new Set(alerts.map(a => a.device)).size,
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'ransomware': return '🔒';
      case 'malware': return '🦠';
      case 'fileless': return '👻';
      case 'exploit': return '💥';
      case 'suspicious': return '🔍';
      default: return '🛡️';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'blocked': return 'bg-red-500/20 text-red-400';
      case 'quarantined': return 'bg-yellow-500/20 text-yellow-400';
      case 'detected': return 'bg-blue-500/20 text-blue-400';
      case 'cleaned': return 'bg-green-500/20 text-green-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading endpoint protection data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Endpoint Protection (EDR/XDR)</h1>
        <p className="text-gray-400 mt-1">
          Monitor and manage endpoint threats, malware, and suspicious activities
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Alerts</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.blocked}</span>
          </div>
          <p className="text-gray-400 text-sm">Blocked</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.critical}</span>
          </div>
          <p className="text-gray-400 text-sm">Critical</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Server className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-white">{stats.devices}</span>
          </div>
          <p className="text-gray-400 text-sm">Affected Devices</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by device or threat..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="ransomware">Ransomware</option>
            <option value="malware">Malware</option>
            <option value="fileless">Fileless</option>
            <option value="exploit">Exploit</option>
            <option value="suspicious">Suspicious</option>
          </select>
        </div>
      </div>

      {/* Alerts List */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Threat</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Action</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr 
                  key={alert.id} 
                  className="border-b border-slate-800 hover:bg-slate-800 cursor-pointer transition-colors"
                  onClick={() => navigate(`/client-admin/endpoint-protection/${alert.id}`)}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{getTypeIcon(alert.type)}</span>
                      <span className="text-white font-medium capitalize">{alert.type}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/client-admin/infrastructure/device/${alert.device}`);
                      }}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                    >
                      {alert.device}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-gray-300 font-mono text-sm">{alert.deviceIp}</td>
                  <td className="py-3 px-4 text-gray-300 text-sm">{alert.threat}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(alert.action)}`}>
                      {alert.action}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {new Date(alert.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4">
                    {alert.ticketCreated ? (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('/client-admin/tickets');
                        }}
                        className="text-green-400 hover:text-green-300 text-sm flex items-center gap-1"
                      >
                        <CheckCircle className="w-4 h-4" />
                        View
                      </button>
                    ) : (
                      <span className="text-gray-500 text-sm">No ticket</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
