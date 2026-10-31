import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Mail, Shield, AlertTriangle, CheckCircle, XCircle, 
  Filter, Search, Clock, User, Server
} from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import { useAuth } from '../../context/AuthContext';
import { demoEmailAlerts } from '../../data/demoWorld';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';

const EMAIL_GROUPS: ActionGroup[] = [
  {
    title: 'Investigation & scope (how far did it spread?)', icon: 'Search',
    fields: [
      { name: 'message_id', label: 'Message-ID / subject / sender to trace', placeholder: 'invoice_final@… or <abc123@mailer>' },
      { name: 'hours', label: 'Lookback window', options: ['24h', '72h', '7 days', '30 days'] },
    ],
    actions: [
      { id: 'em-tenant-search', label: 'Tenant-Wide Search (same mail)' },
      { id: 'em-trace-clicks', label: 'Trace URL Clicks & Detonations' },
      { id: 'em-mailbox-audit', label: 'Mailbox Audit Log (read/forwarded)' },
      { id: 'em-header-analysis', label: 'Full Header / SPF-DKIM-DMARC Analysis' },
      { id: 'em-sandbox', label: 'Re-Detonate Attachment in Sandbox' },
      { id: 'em-user-impact', label: 'Who Reported / Who Interacted?' },
    ],
  },
  {
    title: 'Containment & remediation', icon: 'Ban', danger: true,
    fields: [{ name: 'ioc', label: 'Sender / URL / attachment hash', placeholder: 'sha256 of attachment or URL' }],
    actions: [
      { id: 'em-purge', label: 'Hard Purge from All Mailboxes' },
      { id: 'em-quarantine-release-review', label: 'Review Quarantine & Release w/ Approval' },
      { id: 'em-blocklist', label: 'Add Sender/Domain to Tenant Blocklist' },
      { id: 'em-revoke-links', label: 'Revoke Rewritten URLs / Session Tokens' },
      { id: 'em-force-oauth-revoke', label: 'Revoke OAuth App Grants for User' },
      { id: 'em-reset-creds', label: 'Force Password + MFA Re-enrolment' },
    ],
  },
  {
    title: 'Correlated evidence (alerts · tickets · infected assets)', icon: 'AlertTriangle',
    actions: [
      { id: 'em-correlate-endpoints', label: 'Find Infected Endpoints (opened payload)' },
      { id: 'em-correlate-dns', label: 'Check DNS Hits on Payload Domain' },
      { id: 'em-correlate-fw', label: 'Check Firewall C2 Attempts' },
      { id: 'em-open-tickets', label: 'Open Linked Tickets & Alerts' },
    ],
  },
  {
    title: 'Automation playbooks (one click to arm)', icon: 'Zap',
    fields: [{ name: 'mode', label: 'Execution mode', options: ['Auto-remediate', 'Suggest only (manual approval)'] }],
    actions: [
      { id: 'em-pb-phishing', label: 'Playbook: Phish → Purge → Reset → Ticket' },
      { id: 'em-pb-bec', label: 'Playbook: BEC / Spoofed Executive Domain' },
      { id: 'em-pb-malware-mail', label: 'Playbook: Malicious Attachment Outbreak' },
      { id: 'em-pb-awareness', label: 'Auto-Send Awareness Notice to Recipients' },
    ],
  },
  {
    title: 'Push email-security configuration', icon: 'Upload',
    fields: [
      { name: 'profile', label: 'Policy profile', options: ['Strict inbound (deny SPF fail)', 'Anti-BEC (impersonation protection)', 'Advanced malware detonation', 'Default balanced'] },
      { name: 'scope', label: 'Scope', options: ['All domains', 'Selected domain', 'Executives only'] },
    ],
    actions: [
      { id: 'em-push-policy', label: 'Push Policy Now' },
      { id: 'em-enable-dmarc-enforce', label: 'Set DMARC to p=reject (enforced)' },
      { id: 'em-enable-timeofclick', label: 'Enable Time-of-Click Protection' },
      { id: 'em-authenticity-check', label: 'Run Domain Authenticity Check' },
    ],
  },
];

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

/** Numeric demo-org id from `org-dw-<n>` / backend numeric org ids. */
const numericOrgId = (raw?: string | number | null): number | null => {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/^org-dw-/, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function EmailSecurityPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
        // Unified demo world fallback — every record references a real
        // demoWorld device (fw-edge-01 / VLS-FW-EDGE / VVS-FW-01) and is
        // scoped to the logged-in tenant, exactly like the backend feed.
        const orgId = numericOrgId(user?.orgId as any);
        setAlerts(orgId != null
          ? demoEmailAlerts.filter(a => a.orgId === orgId)
          : demoEmailAlerts);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch email alerts:', error);
        setLoading(false);
      }
    };

    fetchAlerts();
  }, [user?.orgId]);

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

      {/* Analyst investigation, containment and playbook console */}
      <OpsConsole service="email-security" title="Email Investigation & Response Console" groups={EMAIL_GROUPS} />

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
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Investigate</th>
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
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate('/client-admin/alerts'); }}
                        title="Related alerts (same sender / recipient / IOC)"
                        className="text-yellow-400 hover:text-yellow-300"
                      >
                        <AlertTriangle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/client-admin/endpoint-protection?search=${encodeURIComponent(alert.recipient)}`); }}
                        title="Infected endpoints tied to this recipient"
                        className="text-red-400 hover:text-red-300"
                      >
                        <Server className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate('/client-admin/soar'); }}
                        title="Arm the phishing response playbook"
                        className="text-cyan-400 hover:text-cyan-300"
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                    </div>
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
