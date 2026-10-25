import React, { useState } from 'react';
import { 
  Shield, AlertTriangle, CheckCircle, Clock, 
  TrendingUp, Calendar, Filter
} from 'lucide-react';

interface SecurityEvent {
  id: string;
  date: string;
  type: 'threat' | 'incident' | 'compliance' | 'achievement';
  title: string;
  description: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  status?: 'blocked' | 'resolved' | 'detected';
  icon: string;
}

export default function SecurityHistoryTimeline() {
  const [filter, setFilter] = useState<string>('all');

  const events: SecurityEvent[] = [
    {
      id: '1',
      date: '2027-01-15T09:30:00Z',
      type: 'threat',
      title: 'Ransomware Attempt Blocked',
      description: 'LockBit 4.0 variant detected and blocked on workstation-042',
      severity: 'critical',
      status: 'blocked',
      icon: '🛡️',
    },
    {
      id: '2',
      date: '2027-01-14T14:20:00Z',
      type: 'incident',
      title: 'Phishing Campaign Detected',
      description: 'AI-generated phishing emails targeting finance department',
      severity: 'high',
      status: 'resolved',
      icon: '🎣',
    },
    {
      id: '3',
      date: '2027-01-13T11:45:00Z',
      type: 'compliance',
      title: 'SOC 2 Audit Passed',
      description: 'Annual SOC 2 Type II audit completed successfully',
      icon: '✅',
    },
    {
      id: '4',
      date: '2027-01-12T16:00:00Z',
      type: 'achievement',
      title: '90 Days Zero Breach',
      description: 'Achieved 90 consecutive days without security incidents',
      icon: '🏆',
    },
    {
      id: '5',
      date: '2027-01-10T08:15:00Z',
      type: 'threat',
      title: 'DDoS Attack Mitigated',
      description: '2.4 Gbps DDoS attack automatically mitigated',
      severity: 'high',
      status: 'blocked',
      icon: '🌊',
    },
    {
      id: '6',
      date: '2027-01-08T13:30:00Z',
      type: 'incident',
      title: 'Insider Threat Detected',
      description: 'Unusual data access pattern from user account',
      severity: 'medium',
      status: 'resolved',
      icon: '🔍',
    },
    {
      id: '7',
      date: '2027-01-05T10:00:00Z',
      type: 'compliance',
      title: 'NIST CSF Score Improved',
      description: 'Compliance score increased from 85% to 94%',
      icon: '📈',
    },
    {
      id: '8',
      date: '2027-01-03T15:45:00Z',
      type: 'threat',
      title: 'Zero-Day Exploit Blocked',
      description: 'CVE-2027-0142 exploit attempt blocked by AI detection',
      severity: 'critical',
      status: 'blocked',
      icon: '🎯',
    },
  ];

  const filteredEvents = filter === 'all' 
    ? events 
    : events.filter(e => e.type === filter);

  const stats = {
    totalEvents: events.length,
    threatsBlocked: events.filter(e => e.type === 'threat' && e.status === 'blocked').length,
    incidentsResolved: events.filter(e => e.type === 'incident' && e.status === 'resolved').length,
    complianceAchievements: events.filter(e => e.type === 'compliance').length,
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'blocked': return 'bg-red-500/20 text-red-400';
      case 'resolved': return 'bg-green-500/20 text-green-400';
      case 'detected': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Security History Timeline</h1>
        <p className="text-gray-400 mt-1">
          Complete record of your security journey with Infracentra
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.totalEvents}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Events</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.threatsBlocked}</span>
          </div>
          <p className="text-gray-400 text-sm">Threats Blocked</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.incidentsResolved}</span>
          </div>
          <p className="text-gray-400 text-sm">Incidents Resolved</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-white">{stats.complianceAchievements}</span>
          </div>
          <p className="text-gray-400 text-sm">Compliance Achievements</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Events</option>
            <option value="threat">Threats</option>
            <option value="incident">Incidents</option>
            <option value="compliance">Compliance</option>
            <option value="achievement">Achievements</option>
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-700"></div>

          {/* Events */}
          <div className="space-y-6">
            {filteredEvents.map((event) => (
              <div key={event.id} className="relative flex items-start gap-6">
                {/* Timeline dot */}
                <div className="relative z-10 flex-shrink-0">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl ${
                    event.type === 'threat' ? 'bg-red-500/20 border-2 border-red-500/50' :
                    event.type === 'incident' ? 'bg-orange-500/20 border-2 border-orange-500/50' :
                    event.type === 'compliance' ? 'bg-green-500/20 border-2 border-green-500/50' :
                    'bg-purple-500/20 border-2 border-purple-500/50'
                  }`}>
                    {event.icon}
                  </div>
                </div>

                {/* Event card */}
                <div className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="text-white font-semibold mb-1">{event.title}</h3>
                      <p className="text-gray-400 text-sm">{event.description}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {event.severity && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityColor(event.severity)}`}>
                          {event.severity}
                        </span>
                      )}
                      {event.status && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(event.status)}`}>
                          {event.status}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-3">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(event.date).toLocaleString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Export Options */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-bold text-white mb-4">Export Security History</h2>
        <p className="text-gray-400 text-sm mb-4">
          Export your complete security history for audits, compliance, or internal reporting
        </p>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Export PDF Report
          </button>
          <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Export for Audit
          </button>
        </div>
      </div>
    </div>
  );
}
