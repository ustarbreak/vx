import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud, AlertTriangle, CheckCircle, Shield, Server } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';

const CLOUD_GROUPS: ActionGroup[] = [
  {
    title: 'Posture review & deep-dive', icon: 'Eye',
    fields: [
      { name: 'resource', label: 'Resource / workload (ARN, ID or FQDN)', placeholder: 'arn:aws:s3:::my-company-data' },
    ],
    actions: [
      { id: 'cloud-detail', label: 'Open Full Finding Detail' },
      { id: 'cloud-timeline', label: 'Build Resource Activity Timeline' },
      { id: 'cloud-iam-path', label: 'Trace IAM / Attack Path to Resource' },
      { id: 'cloud-network-map', label: 'Show Network Exposure Map' },
      { id: 'cloud-compliance', label: 'Map Finding to Compliance Control (CIS/ISO)' },
      { id: 'cloud-baseline', label: 'Re-evaluate Posture Baseline Now' },
    ],
  },
  {
    title: 'Configuration & guardrails push', icon: 'Upload',
    fields: [
      { name: 'policy', label: 'Guardrail template', options: ['Block Public Buckets', 'Enforce Encryption-at-Rest', 'Least-Privilege IAM Pack', 'CloudTrail/Activity Log Always-On'] },
      { name: 'scope', label: 'Scope', options: ['All accounts/subscriptions', 'Selected account', 'Production only'] },
    ],
    actions: [
      { id: 'cloud-push-guardrail', label: 'Push Guardrail / Policy Now' },
      { id: 'cloud-enable-drift', label: 'Enable Hourly Drift Detection' },
      { id: 'cloud-remediate', label: 'Attach Auto-Remediation Template' },
      { id: 'cloud-snapshot-protect', label: 'Force Deletion Protection on Resource' },
    ],
  },
  {
    title: 'Investigate related alerts, tickets & assets', icon: 'Search',
    fields: [{ name: 'query', label: 'Filter (provider, service or resource)', placeholder: 'AWS S3 public' }],
    actions: [
      { id: 'cloud-alerts-correlate', label: 'Correlate Alerts on Same Resource' },
      { id: 'cloud-open-ticket', label: 'Create Ticket with Evidence Pack' },
      { id: 'cloud-asset-inventory', label: 'Pull Affected Asset Inventory' },
      { id: 'cloud-anomalous-call', label: 'Hunt Anomalous API Calls (rootkit/cloudbleed)' },
    ],
  },
  {
    title: 'Containment playbooks (SOAR-ready)', icon: 'Zap', danger: true,
    fields: [{ name: 'resource', label: 'Resource to contain', placeholder: 'vm-web-01 / sg-0abc…' }],
    actions: [
      { id: 'cloud-quarantine-wl', label: 'Quarantine Workload (isolating SG)' },
      { id: 'cloud-revoke-keys', label: 'Revoke Compromised Access Keys' },
      { id: 'cloud-close-public', label: 'Remove Public Access Immediately' },
      { id: 'cloud-pb-breach', label: 'Arm Playbook: Cloud Account Breach' },
      { id: 'cloud-pb-miner', label: 'Arm Playbook: Crypto-Miner Outbreak' },
    ],
  },
];

interface CloudAlert {
  id: string;
  provider: 'AWS' | 'Azure' | 'GCP';
  service: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  resource: string;
  status: 'active' | 'resolved' | 'investigating';
  timestamp: string;
  ticketCreated: boolean;
}

export default function CloudSecurityPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<CloudAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('cloud-security');
      if (live) { setAlerts(live as any); setLoading(false); return; }
      setAlerts([
        { id: 'CLOUD-001', provider: 'AWS', service: 'S3', type: 'Public Bucket', severity: 'critical', resource: 'my-company-data', status: 'active', timestamp: '2027-01-15T09:00:00Z', ticketCreated: true },
        { id: 'CLOUD-002', provider: 'Azure', service: 'VM', type: 'Unpatched OS', severity: 'high', resource: 'web-server-01', status: 'investigating', timestamp: '2027-01-15T08:30:00Z', ticketCreated: false },
        { id: 'CLOUD-003', provider: 'GCP', service: 'IAM', type: 'Overprivileged Role', severity: 'medium', resource: 'service-account-prod', status: 'resolved', timestamp: '2027-01-15T07:00:00Z', ticketCreated: true },
      ]);
      setLoading(false);
    };
    fetchAlerts();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Cloud Security (CSPM)</h1>
        <p className="text-gray-400 mt-1">Monitor cloud security posture across AWS, Azure, and GCP</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Cloud className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{alerts.length}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Findings</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{alerts.filter(a => a.severity === 'critical').length}</span>
          </div>
          <p className="text-gray-400 text-sm">Critical Issues</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{alerts.filter(a => a.status === 'resolved').length}</span>
          </div>
          <p className="text-gray-400 text-sm">Resolved</p>
        </div>
      </div>

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Provider</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Service</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Resource</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer" onClick={() => navigate(`/client-admin/cloud-security/${alert.id}`)}>
                <td className="py-3 px-4 text-[var(--ic-heading)] font-medium">{alert.provider}</td>
                <td className="py-3 px-4 text-gray-300">{alert.service}</td>
                <td className="py-3 px-4 text-gray-300">{alert.type}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    alert.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    alert.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>{alert.severity}</span>
                </td>
                <td className="py-3 px-4 text-gray-300 font-mono text-sm">{alert.resource}</td>
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
