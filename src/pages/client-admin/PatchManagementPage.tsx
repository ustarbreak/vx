import React, { useState, useEffect } from 'react';
import { Wrench, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';

const PATCH_GROUPS: ActionGroup[] = [
  {
    title: 'Software inventory collection (collector)', icon: 'Database',
    fields: [{ name: 'device', label: 'Target device', placeholder: 'e.g. WS-FIN-012 or All endpoints' }],
    actions: [
      { id: 'patch-collect-now', label: 'Collect Software Inventory Now' },
      { id: 'patch-collect-schedule', label: 'Schedule Collector Re-Poll' },
      { id: 'patch-outdated-report', label: 'Report: Outdated Software + Suggested Patches' },
      { id: 'patch-eol-detect', label: 'Detect End-of-Life / Unsupported Versions' },
      { id: 'patch-thirdparty', label: 'Third-App Patch Catalog Sync' },
    ],
  },
  {
    title: 'Scan schedules (daily / weekly / monthly / custom)', icon: 'Calendar',
    fields: [
      { name: 'frequency', label: 'Frequency', options: ['Daily (quotidian)', 'Weekly', 'Monthly', 'Yearly', 'Custom poll interval'] },
      { name: 'window', label: 'Maintenance window', placeholder: 'e.g. Tue 03:00' },
    ],
    actions: [
      { id: 'patch-sched-daily', label: 'Set Daily Compliance Scan' },
      { id: 'patch-sched-weekly', label: 'Set Weekly Scan' },
      { id: 'patch-sched-monthly', label: 'Set Monthly Scan' },
      { id: 'patch-sched-custom', label: 'Set Custom Poll-Time Scan' },
    ],
  },
  {
    title: 'Deploy patches', icon: 'Upload', danger: true,
    fields: [
      { name: 'scope', label: 'Deployment scope', options: ['Selected device', 'Site / group', 'All endpoints'] },
      { name: 'severity', label: 'Auto-approve severity', options: ['Critical only', 'Critical + High', 'All missing patches'] },
    ],
    actions: [
      { id: 'patch-deploy-critical', label: 'Deploy Critical Patches Now' },
      { id: 'patch-deploy-selected', label: 'Deploy Selected Patch Batch' },
      { id: 'patch-test-ring', label: 'Push to Pilot Ring First (canary)' },
      { id: 'patch-retry-failed', label: 'Retry Failed Installations' },
      { id: 'patch-uninstall', label: 'Uninstall Last Patch (rollback)' },
      { id: 'patch-reboot', label: 'Schedule Required Reboots' },
    ],
  },
  {
    title: 'Automation playbooks (SOAR-ready)', icon: 'Zap',
    actions: [
      { id: 'patch-pb-auto', label: 'Arm Playbook: Auto-Patch Critical CVEs' },
      { id: 'patch-pb-report', label: 'Schedule: Weekly Patch Compliance Report' },
      { id: 'patch-pb-ticket', label: 'Arm Playbook: Failed Patch → Ticket Tier-1' },
    ],
  },
];

interface Patch {
  id: string;
  name: string;
  device: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'available' | 'installing' | 'installed' | 'failed';
  releasedAt: string;
  installedAt?: string;
}

export default function PatchManagementPage() {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPatches = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('patch-management');
      if (live) { setPatches(live as any); setLoading(false); return; }
      setPatches([
        { id: 'PATCH-001', name: 'Windows Security Update KB5034441', device: 'workstation-01', severity: 'critical', status: 'installed', releasedAt: '2027-01-10T00:00:00Z', installedAt: '2027-01-12T14:30:00Z' },
        { id: 'PATCH-002', name: 'Ubuntu Security Patch USN-6543-1', device: 'server-web-01', severity: 'high', status: 'available', releasedAt: '2027-01-14T00:00:00Z' },
        { id: 'PATCH-003', name: 'VMware ESXi Security Update', device: 'esxi-host-01', severity: 'critical', status: 'installing', releasedAt: '2027-01-13T00:00:00Z' },
        { id: 'PATCH-004', name: 'Chrome Security Update', device: 'workstation-02', severity: 'medium', status: 'failed', releasedAt: '2027-01-11T00:00:00Z' },
      ]);
      setLoading(false);
    };
    fetchPatches();
  }, []);

  const stats = {
    total: patches.length,
    available: patches.filter(p => p.status === 'available').length,
    installed: patches.filter(p => p.status === 'installed').length,
    failed: patches.filter(p => p.status === 'failed').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Patch Management</h1>
        <p className="text-gray-400 mt-1">Manage and deploy security patches across your infrastructure</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Wrench className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Patches</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.available}</span>
          </div>
          <p className="text-gray-400 text-sm">Available</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.installed}</span>
          </div>
          <p className="text-gray-400 text-sm">Installed</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.failed}</span>
          </div>
          <p className="text-gray-400 text-sm">Failed</p>
        </div>
      </div>

      {/* Patch operations console — collector, schedules and deployment */}
      <OpsConsole service="patch-management" title="Patch Management Operations Console" groups={PATCH_GROUPS} />

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Patch Name</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Released</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Installed</th>
            </tr>
          </thead>
          <tbody>
            {patches.map((patch) => (
              <tr key={patch.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="py-3 px-4 text-[var(--ic-heading)]">{patch.name}</td>
                <td className="py-3 px-4 text-blue-400 cursor-pointer hover:text-blue-300">{patch.device}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    patch.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    patch.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    patch.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>{patch.severity}</span>
                </td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    patch.status === 'available' ? 'bg-yellow-500/20 text-yellow-400' :
                    patch.status === 'installing' ? 'bg-blue-500/20 text-blue-400' :
                    patch.status === 'installed' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>{patch.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{new Date(patch.releasedAt).toLocaleDateString()}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{patch.installedAt ? new Date(patch.installedAt).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
