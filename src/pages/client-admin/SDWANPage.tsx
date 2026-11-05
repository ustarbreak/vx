import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Network, Activity, CheckCircle, AlertTriangle } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import OpsConsole from '../../components/OpsConsole';
import SecurityRecordDetail from '../../components/SecurityRecordDetail';
import type { ActionGroup } from '../../services/securityOps';

const SDWAN_VENDORS = ['fortinet', 'cisco', 'paloalto', 'velocloud', 'watchguard'];

const SDWAN_GROUPS: ActionGroup[] = [
  {
    title: 'Troubleshoot by vendor & problem (exact CLI for that editor)', icon: 'Wrench',
    fields: [
      { name: 'vendor', label: 'Vendor / editor', options: SDWAN_VENDORS },
      { name: 'problem', label: 'Problem scenario', options: ['packet_loss', 'tunnel_down', 'failover', 'app_routing'] },
      { name: 'site', label: 'Site / edge device', placeholder: 'e.g. BR-MADRID-01' },
    ],
    actions: [
      { id: 'sdwan-ts-packet-loss', label: 'Run Packets Loss / Jitter Checks' },
      { id: 'sdwan-ts-tunnel-down', label: 'Run Tunnel-Down Diagnostics' },
      { id: 'sdwan-ts-failover', label: 'Run Failover / Path-Selection Checks' },
      { id: 'sdwan-ts-app-routing', label: 'Run Application Steering Checks' },
      { id: 'sdwan-ts-zbfw', label: 'Run Zone-Firewall Drop Checks (Cisco)' },
    ],
  },
  {
    title: 'Overlay health investigation', icon: 'Search',
    fields: [{ name: 'site', label: 'Site to inspect', placeholder: 'e.g. BR-LISBON-02' }],
    actions: [
      { id: 'sdwan-health-checks', label: 'Dump SLA Health-Check Results' },
      { id: 'sdwan-member-stats', label: 'Per-Member RTT / Loss / Jitter Stats' },
      { id: 'sdwan-tunnel-table', label: 'Show Overlay Tunnel Table' },
      { id: 'sdwan-route-table', label: 'Verify Route Preference & Steering' },
      { id: 'sdwan-neighbor-cache', label: 'Check Peer / Neighbour Reachability' },
      { id: 'sdwan-support-bundle', label: 'Generate Support Report Bundle' },
    ],
  },
  {
    title: 'Push configuration', icon: 'Upload', danger: true,
    fields: [
      { name: 'vendor', label: 'Vendor / editor', options: SDWAN_VENDORS },
      { name: 'template', label: 'Change template', options: ['Adjust SLA thresholds (loss<1% jitter<30ms)', 'Re-prioritise business-critical app rule', 'Enable per-packet load balancing', 'Add backup colour to policy'] },
    ],
    actions: [
      { id: 'sdwan-push-sla', label: 'Push SLA Profile Update' },
      { id: 'sdwan-push-steering', label: 'Push Traffic-Steering Policy' },
      { id: 'sdwan-force-rebalance', label: 'Force Path Rebalance Now' },
      { id: 'sdwan-clear-tunnels', label: 'Reset Overlay Tunnels at Site' },
    ],
  },
  {
    title: 'Automation playbooks (SOAR-ready)', icon: 'Zap',
    actions: [
      { id: 'sdwan-pb-degrade', label: 'Arm Playbook: Link Degradation → Ticket + Notify' },
      { id: 'sdwan-pb-down', label: 'Arm Playbook: Site Down → Failover Verify + Escalate' },
      { id: 'sdwan-pb-nightly-quality', label: 'Schedule: Nightly Overlay Quality Report' },
    ],
  },
];

interface SDWANAlert {
  id: string;
  type: 'link-down' | 'performance' | 'security' | 'configuration';
  severity: 'critical' | 'high' | 'medium' | 'low';
  site: string;
  link: string;
  status: 'active' | 'resolved' | 'investigating';
  timestamp: string;
  ticketCreated: boolean;
}

export default function SDWANPage() {
  const navigate = useNavigate();
  const { alertId } = useParams<{ alertId: string }>();
  const [alerts, setAlerts] = useState<SDWANAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('sd-wan');
      if (live) { setAlerts(live as any); setLoading(false); return; }
      setAlerts([
        { id: 'SDWAN-001', type: 'link-down', severity: 'critical', site: 'Branch-Office-NYC', link: 'Primary ISP', status: 'active', timestamp: '2027-01-15T09:30:00Z', ticketCreated: true },
        { id: 'SDWAN-002', type: 'performance', severity: 'high', site: 'Branch-Office-LA', link: 'Secondary ISP', status: 'investigating', timestamp: '2027-01-15T08:45:00Z', ticketCreated: false },
        { id: 'SDWAN-003', type: 'configuration', severity: 'medium', site: 'Branch-Office-CHI', link: 'VPN Tunnel', status: 'resolved', timestamp: '2027-01-15T07:20:00Z', ticketCreated: true },
      ]);
      setLoading(false);
    };
    fetchAlerts();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }


  const selectedAlert = alertId ? alerts.find((alert) => alert.id === alertId) : undefined;
  if (alertId) return (
    <SecurityRecordDetail
      backPath="/client-admin/sd-wan" service="sd-wan" serviceTitle="SD-WAN"
      recordId={alertId} recordType="Network event" subtitle={selectedAlert ? selectedAlert.type : "SD-WAN event"}
      severity={selectedAlert?.severity} status={selectedAlert?.status}
      sourceLabel="Tenant SD-WAN feed"
      fields={selectedAlert ? [
        { label: "Site", value: selectedAlert.site }, { label: "Link / tunnel", value: selectedAlert.link },
        { label: "Event type", value: selectedAlert.type }, { label: "Detected", value: new Date(selectedAlert.timestamp).toLocaleString() },
        { label: "Ticket linked", value: selectedAlert.ticketCreated ? "Yes" : "No" },
      ] : []}
      groups={SDWAN_GROUPS}
      contextParams={selectedAlert ? { site: selectedAlert.site, reason: "SD-WAN " + selectedAlert.type + " on " + selectedAlert.site + " / " + selectedAlert.link } : {}}
      recommendations={["Verify whether the event affects one circuit, one site or the wider overlay.","Compare packet loss, latency and jitter against the configured SLA.","Inspect tunnel health, routing preference and recent edge configuration changes.","Validate failover path and application steering before changing routes.","Record the impact and obtain change approval before disruptive tunnel or rebalance actions."]}
      notFound={!selectedAlert}
    />
  );

  return (
    <div className="p-6 space-y-6">
      {/* T7.3 honest-labeling pass: SD-WAN is a scaffold — vendor APIs not wired. */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
        Scaffold UI — live data requires a vendor SD-WAN connector (status: roadmap).
        When no live feed is available the tables below show demo sample rows only.
      </div>
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">SD-WAN Management</h1>
        <p className="text-gray-400 mt-1">Monitor and manage software-defined WAN connections</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Network className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{new Set(alerts.map((a) => a.site)).size}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Sites</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{alerts.filter((a) => a.status === 'resolved').length}</span>
          </div>
          <p className="text-gray-400 text-sm">Healthy</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{alerts.filter((a) => a.status === 'investigating').length}</span>
          </div>
          <p className="text-gray-400 text-sm">Degraded</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{alerts.filter((a) => a.status === 'active').length}</span>
          </div>
          <p className="text-gray-400 text-sm">Down</p>
        </div>
      </div>

      {/* SD-WAN troubleshooting console — vendor-specific commands
          (Fortinet / Cisco Viptela / Palo Alto / VeloCloud / Watchguard) */}
      <OpsConsole service="sd-wan" title="SD-WAN Troubleshooting & Response Console" groups={SDWAN_GROUPS} />

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Site</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Link</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer" onClick={() => navigate(`/client-admin/sd-wan/${alert.id}`)}>
                <td className="py-3 px-4 text-[var(--ic-heading)] capitalize">{alert.type}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    alert.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    alert.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>{alert.severity}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{alert.site}</td>
                <td className="py-3 px-4 text-gray-300">{alert.link}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    alert.status === 'active' ? 'bg-red-500/20 text-red-400' :
                    alert.status === 'investigating' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                  }`}>{alert.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{new Date(alert.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
