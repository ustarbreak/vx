import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Shield, AlertTriangle, CheckCircle, XCircle, 
  Filter, Search, Clock, Server, Activity, ArrowLeft, ExternalLink
} from 'lucide-react';
import { fetchServiceLive } from '../../services/serviceData';
import { useAuth } from '../../context/AuthContext';
import { demoEndpointAlerts } from '../../data/demoWorld';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';
import { isDemoMode } from '../../services/demoMode';

const EP_GROUPS: ActionGroup[] = [
  {
    title: 'Response actions (contain & eradicate)', icon: 'Ban', danger: true,
    fields: [
      { name: 'device', label: 'Target device / hostname', placeholder: 'e.g. WS-FIN-012' },
      { name: 'reason', label: 'Reason (added to ticket & audit trail)', placeholder: 'Suspected ransomware encryption' },
    ],
    actions: [
      { id: 'ep-isolate', label: 'Network Isolate Host' },
      { id: 'ep-release', label: 'Release Isolation' },
      { id: 'ep-agent-live-response', label: 'Run Live Response Shell' },
      { id: 'ep-kill-process', label: 'Kill Process Tree' },
      { id: 'ep-quarantine-file', label: 'Quarantine File / Hash' },
      { id: 'ep-snapshot', label: 'Capture Forensic Snapshot' },
    ],
  },
  {
    title: 'Hunt & investigate', icon: 'Search',
    fields: [{ name: 'ioc', label: 'IOC (hash / IP / domain / process)', placeholder: 'sha256 or 185.x.x.x' }],
    actions: [
      { id: 'ep-ioc-sweep', label: 'Cross-Fleet IOC Hunt' },
      { id: 'ep-full-scan', label: 'On-Demand Full Scan' },
      { id: 'ep-memory-scan', label: 'Memory / Fileless Scan' },
      { id: 'ep-timeline', label: 'Build Attack Timeline (process tree)' },
      { id: 'ep-xdr-correlate', label: 'XDR Cross-Correlation (email+net+endpoint)' },
      { id: 'ep-threat-intel', label: 'Enrich with Threat Intel' },
    ],
  },
  {
    title: 'Push configuration (policy as code)', icon: 'Upload',
    fields: [
      { name: 'policy', label: 'Policy template', options: ['Default Workstations', 'High-Security (locked USB)', 'Server Tier', 'Ransomware Hardening Pack'] },
      { name: 'scope', label: 'Scope', options: ['All endpoints', 'Selected device', 'Site / group'] },
    ],
    actions: [
      { id: 'ep-push-policy', label: 'Push Policy Now' },
      { id: 'ep-enable-arm', label: 'Enable Ransomware Rollback (ARM)' },
      { id: 'ep-disable-macro', label: 'Block Office Macros Policy' },
      { id: 'ep-usb-control', label: 'Set USB Storage Control' },
      { id: 'ep-update-agents', label: 'Force Agent Update & Reconnect' },
    ],
  },
  {
    title: 'Automation playbooks (SOAR-ready)', icon: 'Zap',
    actions: [
      { id: 'ep-pb-ransomware', label: 'Arm Playbook: Ransomware Containment' },
      { id: 'ep-pb-phish-host', label: 'Arm Playbook: Phishing → Host Compromise' },
      { id: 'ep-pb-auto-ticket', label: 'Auto-Create Ticket + Assign Tier-2' },
      { id: 'ep-pb-reset-creds', label: 'Force Credential Reset for User' },
    ],
  },
];

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
  const { alertId } = useParams<{ alertId: string }>();
  const { user } = useAuth();
  const demo = isDemoMode();
  const [alerts, setAlerts] = useState<EndpointAlert[]>([]);
  const [feedState, setFeedState] = useState<'demo' | 'live' | 'unavailable'>('unavailable');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (demo) {
          // Demo fixtures are only used when Demo Mode is explicitly enabled.
          const n = Number(String(user?.orgId ?? '').replace(/^org-dw-/, ''));
          const orgId = Number.isFinite(n) && n > 0 ? n : null;
          setAlerts(orgId != null
            ? demoEndpointAlerts.filter(a => a.orgId === orgId)
            : demoEndpointAlerts);
          setFeedState('demo');
        } else {
          const result = await fetchServiceLive<EndpointAlert>('endpoint-protection');
          if (result.source === 'live' && Array.isArray(result.records)) {
            setAlerts(result.records);
            setFeedState('live');
          } else {
            setAlerts([]);
            setFeedState('unavailable');
          }
        }
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch endpoint alerts:', error);
        setLoading(false);
      }
    };

    fetchAlerts();
  }, [user?.orgId, demo]);

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

  const selectedAlert = alertId ? alerts.find((alert) => alert.id === alertId) : undefined;

  if (alertId) {
    if (!selectedAlert) {
      return (
        <div className="p-6 space-y-4">
          <button onClick={() => navigate('/client-admin/endpoint-protection')} className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
            <ArrowLeft className="w-4 h-4" /> Back to Endpoint Protection
          </button>
          <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-8">
            <h1 className="text-xl font-semibold text-[var(--ic-heading)]">Alert not found</h1>
            <p className="mt-2 text-sm text-gray-400">
              {feedState === 'unavailable'
                ? 'The live endpoint feed is unavailable, so this alert cannot be loaded.'
                : 'This alert is not present in the current tenant feed or may have been removed.'}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-6 space-y-6">
        <button onClick={() => navigate('/client-admin/endpoint-protection')} className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
          <ArrowLeft className="w-4 h-4" /> Back to Endpoint Protection
        </button>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
          <div className="p-6 border-b border-[var(--ic-border)] flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">Endpoint alert · {selectedAlert.id}</p>
              <h1 className="mt-2 text-2xl font-bold text-[var(--ic-heading)]">{selectedAlert.threat}</h1>
              <p className="mt-1 text-sm text-gray-400">{selectedAlert.type} detection on {selectedAlert.device}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(selectedAlert.severity)}`}>{selectedAlert.severity.toUpperCase()}</span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getActionColor(selectedAlert.action)}`}>{selectedAlert.action}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
            <div className="rounded-lg border border-[var(--ic-border)] p-4">
              <p className="text-xs text-gray-500">Affected endpoint</p>
              <p className="mt-1 font-semibold text-[var(--ic-heading)]">{selectedAlert.device}</p>
              <p className="text-sm font-mono text-gray-400">{selectedAlert.deviceIp}</p>
              <button onClick={() => navigate(`/client-admin/infrastructure/device/${encodeURIComponent(selectedAlert.device)}`)} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">Open asset record <ExternalLink className="inline w-3 h-3" /></button>
            </div>
            <div className="rounded-lg border border-[var(--ic-border)] p-4">
              <p className="text-xs text-gray-500">Detection time</p>
              <p className="mt-1 font-semibold text-[var(--ic-heading)]">{new Date(selectedAlert.timestamp).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-2">Source: {feedState === 'demo' ? 'Demo fixture' : feedState === 'live' ? 'Connected endpoint feed' : 'Unavailable'}</p>
            </div>
            <div className="rounded-lg border border-[var(--ic-border)] p-4">
              <p className="text-xs text-gray-500">Case linkage</p>
              <p className="mt-1 font-semibold text-[var(--ic-heading)]">{selectedAlert.ticketCreated ? 'Ticket linked' : 'No ticket linked'}</p>
              <button onClick={() => navigate('/client-admin/tickets')} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">Open service desk <ExternalLink className="inline w-3 h-3" /></button>
            </div>
          </div>
          <div className="px-6 pb-6 space-y-4">
            <section>
              <h2 className="text-sm font-semibold text-[var(--ic-heading)]">Analyst notes / detection details</h2>
              <p className="mt-2 rounded-lg bg-black/20 border border-[var(--ic-border)] p-4 text-sm text-gray-300 whitespace-pre-wrap">{selectedAlert.details || 'No additional detection details were supplied by the endpoint feed.'}</p>
            </section>
            <section>
              <h2 className="text-sm font-semibold text-[var(--ic-heading)]">Recommended investigation sequence</h2>
              <ol className="mt-2 list-decimal list-inside space-y-2 text-sm text-gray-300">
                <li>Validate the endpoint identity and confirm the detection timestamp with the asset owner.</li>
                <li>Review process ancestry, persistence, network connections and any related user activity in the EDR/XDR source.</li>
                <li>Search the indicator across the tenant and correlate endpoint, DNS, firewall and email telemetry.</li>
                <li>Preserve forensic evidence before containment where operationally safe.</li>
                <li>Document the decision and obtain approval before disruptive containment or credential actions.</li>
              </ol>
            </section>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigate(`/client-admin/vulnerability-scanning?device=${encodeURIComponent(selectedAlert.device)}`)} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-xs text-gray-200 hover:border-cyan-500/50">Check asset vulnerabilities</button>
              <button onClick={() => navigate('/client-admin/alerts')} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-xs text-gray-200 hover:border-cyan-500/50">Review related alerts</button>
              <button onClick={() => navigate('/client-admin/soar')} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-xs text-gray-200 hover:border-cyan-500/50">Open SOAR playbooks</button>
            </div>
          </div>
        </div>
        <OpsConsole
          service="endpoint-protection"
          title="Response actions for this alert"
          groups={EP_GROUPS}
          contextParams={{ device: selectedAlert.device, ip: selectedAlert.deviceIp, reason: `Response to ${selectedAlert.type} alert ${selectedAlert.id}: ${selectedAlert.threat}` }}
          logHeader={`Alert ${selectedAlert.id} · ${selectedAlert.device} · ${selectedAlert.threat}`}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Endpoint Protection (EDR/XDR)</h1>
        <p className="text-gray-400 mt-1">
          Monitor and manage endpoint threats, malware, and suspicious activities
        </p>
        <p className={`mt-2 text-xs ${feedState === 'live' ? 'text-emerald-400' : feedState === 'demo' ? 'text-fuchsia-300' : 'text-amber-300'}`}>
          {feedState === 'live' ? 'LIVE DATA · Connected endpoint protection feed' : feedState === 'demo' ? 'DEMO DATA · Simulated alerts; not customer telemetry' : 'UNAVAILABLE · No live endpoint feed is configured or reachable. No sample alerts are shown.'}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Alerts</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.blocked}</span>
          </div>
          <p className="text-gray-400 text-sm">Blocked</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.critical}</span>
          </div>
          <p className="text-gray-400 text-sm">Critical</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Server className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.devices}</span>
          </div>
          <p className="text-gray-400 text-sm">Affected Devices</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by device or threat..."
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
            <option value="ransomware">Ransomware</option>
            <option value="malware">Malware</option>
            <option value="fileless">Fileless</option>
            <option value="exploit">Exploit</option>
            <option value="suspicious">Suspicious</option>
          </select>
        </div>
      </div>

      {/* Response & Operations console — EDR/XDR containment, hunting,
          policy push and playbook arming for the SOC analyst */}
      <OpsConsole service="endpoint-protection" title="EDR / XDR Response Console" groups={EP_GROUPS} />

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] p-10 text-center text-sm text-gray-400">
          {feedState === 'unavailable' ? 'Endpoint alerts are unavailable until an endpoint protection integration is configured and returns records.' : 'No endpoint alerts match the current filters.'}
        </div>
      ) : <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Threat</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Action</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Ticket</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Quick Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr 
                  key={alert.id} 
                  className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer transition-colors"
                  onClick={() => navigate(`/client-admin/endpoint-protection/${alert.id}`)}
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
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate('/client-admin/alerts'); }}
                        title="Related alerts for this device"
                        className="text-yellow-400 hover:text-yellow-300"
                      >
                        <AlertTriangle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/client-admin/vulnerability-scanning?device=${encodeURIComponent(alert.device)}`); }}
                        title="Vulns on this asset"
                        className="text-orange-400 hover:text-orange-300"
                      >
                        <Search className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate('/client-admin/soar'); }}
                        title="Open containment playbook in SOAR"
                        className="text-cyan-400 hover:text-cyan-300"
                      >
                        <Activity className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}
