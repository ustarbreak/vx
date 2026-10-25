import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Mail, Shield, AlertTriangle, CheckCircle, XCircle, 
  Filter, Search, Clock, User, Server
} from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';

interface EmailAlert {
  id: string;
  type: 'phishing' | 'malware' | 'spam' | 'spoofing';
  severity: 'critical' | 'high' | 'medium' | 'low';
  sender: string;
  recipient: string;
  subject: string;
  timestamp: string;
  status: 'blocked' | 'quarantined' | 'delivered' | 'investigating';
  device?: string;
  ticketCreated: boolean;
}

export default function EmailSecurityPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<EmailAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    // Simulate API call
    const fetchAlerts = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // REAL DATA: same structure, fed by the service's open-source engine
        const live = await tryLiveFeed('email-security');
        if (live) { setAlerts(live as any); setLoading(false); return; }
        const mockAlerts: EmailAlert[] = [
          {
            id: 'EMAIL-001',
            type: 'phishing',
            severity: 'critical',
            sender: 'attacker@fake-bank.com',
            recipient: 'john.doe@company.com',
            subject: 'Urgent: Verify Your Account',
            timestamp: '2027-01-15T09:30:00Z',
            status: 'blocked',
            device: 'mail-server-01',
            ticketCreated: true,
          },
          {
            id: 'EMAIL-002',
            type: 'malware',
            severity: 'high',
            sender: 'newsletter@unknown.com',
            recipient: 'jane.smith@company.com',
            subject: 'Your Invoice Attached',
            timestamp: '2027-01-15T08:45:00Z',
            status: 'quarantined',
            device: 'mail-server-01',
            ticketCreated: false,
          },
          {
            id: 'EMAIL-003',
            type: 'spoofing',
            severity: 'medium',
            sender: 'ceo@company.com',
            recipient: 'finance@company.com',
            subject: 'Wire Transfer Request',
            timestamp: '2027-01-15T07:20:00Z',
            status: 'investigating',
            device: 'mail-server-02',
            ticketCreated: true,
          },
          {
            id: 'EMAIL-004',
            type: 'spam',
            severity: 'low',
            sender: 'promo@marketing.com',
            recipient: 'all@company.com',
            subject: 'Special Offer Just for You!',
            timestamp: '2027-01-15T06:10:00Z',
            status: 'blocked',
            device: 'mail-server-01',
            ticketCreated: false,
          },
        ];
        
        setAlerts(mockAlerts);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch email alerts:', error);
        setLoading(false);
      }
    };

    fetchAlerts();
  }, []);

  const filteredAlerts = alerts.filter(alert => {
    const matchesFilter = filter === 'all' || alert.type === filter;
    const matchesSearch = alert.sender.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         alert.recipient.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         alert.subject.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: alerts.length,
    blocked: alerts.filter(a => a.status === 'blocked').length,
    quarantined: alerts.filter(a => a.status === 'quarantined').length,
    critical: alerts.filter(a => a.severity === 'critical').length,
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'phishing': return '🎣';
      case 'malware': return '🦠';
      case 'spoofing': return '🎭';
      case 'spam': return '📧';
      default: return '📧';
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'blocked': return 'bg-red-500/20 text-red-400';
      case 'quarantined': return 'bg-yellow-500/20 text-yellow-400';
      case 'delivered': return 'bg-green-500/20 text-green-400';
      case 'investigating': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading email security data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Email Security</h1>
        <p className="text-gray-400 mt-1">
          Monitor and manage email threats, phishing attempts, and spam
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Mail className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Alerts</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.blocked}</span>
          </div>
          <p className="text-gray-400 text-sm">Blocked</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.quarantined}</span>
          </div>
          <p className="text-gray-400 text-sm">Quarantined</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.critical}</span>
          </div>
          <p className="text-gray-400 text-sm">Critical</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by sender, recipient, or subject..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="phishing">Phishing</option>
            <option value="malware">Malware</option>
            <option value="spoofing">Spoofing</option>
            <option value="spam">Spam</option>
          </select>
        </div>
      </div>

      {/* Alerts List */}
      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">From</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">To</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Subject</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr 
                  key={alert.id} 
                  className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer transition-colors"
                  onClick={() => navigate(`/client-admin/email-security/${alert.id}`)}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{getTypeIcon(alert.type)}</span>
                      <span className="text-[var(--ic-heading)] font-medium capitalize">{alert.type}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300 text-sm">{alert.sender}</td>
                  <td className="py-3 px-4 text-gray-300 text-sm">{alert.recipient}</td>
                  <td className="py-3 px-4 text-gray-300 text-sm max-w-xs truncate">{alert.subject}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(alert.status)}`}>
                      {alert.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {alert.device ? (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/client-admin/infrastructure/device/${alert.device}`);
                        }}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        {alert.device}
                      </button>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
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
