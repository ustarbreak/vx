import React, { useState, useEffect } from 'react';
import { Database, CheckCircle, AlertTriangle, Clock, HardDrive } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';

const BACKUP_GROUPS: ActionGroup[] = [
  {
    title: 'Backup server connection & inventory', icon: 'Link2',
    fields: [{ name: 'server', label: 'Backup server', placeholder: 'e.g. bkr-vault01.corp / Veeam / NAS endpoint' }],
    actions: [
      { id: 'bk-connect-server', label: 'Connect / Test Backup Server Link' },
      { id: 'bk-list-repos', label: 'List Repositories & Retention Policies' },
      { id: 'bk-agent-status', label: 'Check Backup Agent Status per Device' },
      { id: 'bk-capacity-report', label: 'Storage Capacity & Growth Report' },
    ],
  },
  {
    title: 'Configure schedules (daily / weekly / monthly / yearly)', icon: 'Calendar',
    fields: [
      { name: 'frequency', label: 'Frequency', options: ['Daily (quotidian)', 'Weekly', 'Monthly', 'Yearly', 'Custom window'] },
      { name: 'window', label: 'Backup window', placeholder: 'e.g. 22:00-02:00' },
      { name: 'retention', label: 'Retention', options: ['7 daily', '30 daily + 12 monthly', 'GFS 1W/1M/1Y', 'Custom'] },
    ],
    actions: [
      { id: 'bk-sched-daily', label: 'Set Daily Job' },
      { id: 'bk-sched-weekly', label: 'Set Weekly Full + Daily Incremental' },
      { id: 'bk-sched-monthly', label: 'Set Monthly Archive' },
      { id: 'bk-sched-yearly', label: 'Set Yearly Long-Term Retention' },
    ],
  },
  {
    title: 'Run & verify jobs', icon: 'Play',
    fields: [{ name: 'job', label: 'Job / device', placeholder: 'e.g. SQL-PROD-01 full backup' }],
    actions: [
      { id: 'bk-run-now', label: 'Run Backup Job Now' },
      { id: 'bk-retry-failed', label: 'Retry Failed Jobs' },
      { id: 'bk-verify', label: 'Verify Restore Points (checksum)' },
      { id: 'bk-drill', label: 'Launch DR Recovery Drill' },
      { id: 'bk-log-export', label: 'Export Backup Job Logs' },
    ],
  },
  {
    title: 'Recovery actions', icon: 'Download', danger: true,
    fields: [
      { name: 'device', label: 'Source device', placeholder: 'e.g. SRV-FILE-02' },
      { name: 'point', label: 'Restore point', placeholder: 'e.g. 2026-10-30 22:00 full' },
    ],
    actions: [
      { id: 'bk-restore-file', label: 'Granular File/Folder Restore' },
      { id: 'bk-restore-vm', label: 'Full VM / Image Restore' },
      { id: 'bk-instant-recovery', label: 'Instant VM Recovery (run from backup)' },
      { id: 'bk-failover', label: 'Trigger Site Failover (DR plan)' },
    ],
  },
];

interface BackupJob {
  id: string;
  name: string;
  device: string;
  type: 'full' | 'incremental' | 'differential';
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  size: string;
  lastRun?: string;
  nextRun: string;
}

export default function BackupDRPage() {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchJobs = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('backup-dr');
      if (live) { setJobs(live as any); setLoading(false); return; }
      setJobs([
        { id: 'BACKUP-001', name: 'Daily Full Backup', device: 'server-db-01', type: 'full', status: 'completed', size: '2.4 TB', lastRun: '2027-01-15T02:00:00Z', nextRun: '2027-01-16T02:00:00Z' },
        { id: 'BACKUP-002', name: 'Hourly Incremental', device: 'server-web-01', type: 'incremental', status: 'running', size: '450 GB', nextRun: '2027-01-15T11:00:00Z' },
        { id: 'BACKUP-003', name: 'Weekly Differential', device: 'server-app-01', type: 'differential', status: 'scheduled', size: '1.2 TB', nextRun: '2027-01-21T03:00:00Z' },
        { id: 'BACKUP-004', name: 'Daily Backup', device: 'workstation-01', type: 'full', status: 'failed', size: '150 GB', lastRun: '2027-01-14T22:00:00Z', nextRun: '2027-01-15T22:00:00Z' },
      ]);
      setLoading(false);
    };
    fetchJobs();
  }, []);

  const stats = {
    total: jobs.length,
    completed: jobs.filter(j => j.status === 'completed').length,
    running: jobs.filter(j => j.status === 'running').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Backup & Disaster Recovery</h1>
        <p className="text-gray-400 mt-1">Manage backup jobs and disaster recovery plans</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Database className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Jobs</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.completed}</span>
          </div>
          <p className="text-gray-400 text-sm">Completed</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.running}</span>
          </div>
          <p className="text-gray-400 text-sm">Running</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.failed}</span>
          </div>
          <p className="text-gray-400 text-sm">Failed</p>
        </div>
      </div>

      {/* Backup & DR console — server link, schedules, job verification and recovery */}
      <OpsConsole service="backup-dr" title="Backup & Disaster Recovery Console" groups={BACKUP_GROUPS} />

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Job Name</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Size</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Run</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Next Run</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="py-3 px-4 text-[var(--ic-heading)]">{job.name}</td>
                <td className="py-3 px-4 text-blue-400 cursor-pointer hover:text-blue-300">{job.device}</td>
                <td className="py-3 px-4 text-gray-300 capitalize">{job.type}</td>
                <td className="py-3 px-4 text-gray-300">{job.size}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    job.status === 'scheduled' ? 'bg-blue-500/20 text-blue-400' :
                    job.status === 'running' ? 'bg-yellow-500/20 text-yellow-400' :
                    job.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>{job.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{job.lastRun ? new Date(job.lastRun).toLocaleString() : '-'}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{new Date(job.nextRun).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
