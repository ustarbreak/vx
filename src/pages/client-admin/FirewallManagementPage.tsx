import React, { useState, useEffect } from 'react';
import { Lock, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';

const FW_VENDORS = ['fortinet', 'cisco', 'paloalto', 'checkpoint', 'opnsense'];

const FW_GROUPS: ActionGroup[] = [
  {
    title: 'Critical rules supervision', icon: 'Eye',
    fields: [{ name: 'window', label: 'Review window', options: ['Last 24h', 'Last 7 days', 'Last 30 days'] }],
    actions: [
      { id: 'fw-critical-shadow', label: 'Audit Shadowed / Redundant Rules' },
      { id: 'fw-critical-anyany', label: 'Report: ANY→ANY & Overly Permissive Rules' },
      { id: 'fw-critical-hitcount', label: 'Zero-Hit Rules Review (cleanup candidates)' },
      { id: 'fw-critical-expiring', label: 'Expiring Temporary / Break-Glass Rules' },
      { id: 'fw-critical-risk-score', label: 'Score Rulebase Risk Posture' },
    ],
  },
  {
    title: 'Investigate without touching the device', icon: 'Search',
    fields: [
      { name: 'ip', label: 'Host / IP to investigate', placeholder: 'e.g. 203.0.113.44 or 10.1.2.30' },
      { name: 'window', label: 'Time window', options: ['Last hour', 'Last 24h', 'Last 7 days'] },
    ],
    actions: [
      { id: 'fw-trace-host', label: 'Trace All Sessions for a Host' },
      { id: 'fw-denied-report', label: 'Top Denied Traffic Report' },
      { id: 'fw-threat-match', label: 'Match Traffic Against Threat Feeds' },
      { id: 'fw-config-backup-check', label: 'Verify Last Config Backup / Diff Running-Config' },
    ],
  },
  {
    title: 'Log extraction — Syslog / SNMP / OID (platform-side)', icon: 'Download',
    fields: [
      { name: 'device', label: 'Firewall device', placeholder: 'e.g. FG-PARIS-01' },
      { name: 'vendor', label: 'Vendor editor', options: FW_VENDORS },
    ],
    actions: [
      { id: 'fw-extract-syslog', label: 'Extract Syslog Stream (last 1h)' },
      { id: 'fw-extract-traffic-log', label: 'Pull Traffic Logs via API' },
      { id: 'fw-snmp-poll', label: 'SNMP Poll: CPU / Memory / Session Counters' },
      { id: 'fw-oid-walk', label: 'Walk Vendor OID Tree (ifMIB + private MIB)' },
      { id: 'fw-netflow', label: 'Export NetFlow/IPFIX Records for Host' },
      { id: 'fw-support-log', label: 'Fetch Support / Diagnostic Log Bundle' },
    ],
  },
  {
    title: 'Push configuration (vendor-specific CLI)', icon: 'Upload', danger: true,
    fields: [
      { name: 'device', label: 'Target firewall', placeholder: 'e.g. ASA-HQ-01' },
      { name: 'vendor', label: 'Vendor editor', options: FW_VENDORS },
      { name: 'template', label: 'Change template', options: ['Block attacker IP + log', 'Disable risky rule', 'Harden VPN/IPsec', 'Enable scan detection', 'Custom CLI snippet'] },
    ],
    actions: [
      { id: 'fw-push-block-ip', label: 'Push: Block Source IP (deny + log)' },
      { id: 'fw-push-disable-rule', label: 'Push: Disable Selected Rule' },
      { id: 'fw-push-harden-vpn', label: 'Push: IPsec / VPN Hardening Pack' },
      { id: 'fw-push-full-config', label: 'Push Full Configuration Snapshot' },
      { id: 'fw-rollback', label: 'Rollback to Previous Config Revision' },
    ],
  },
  {
    title: 'Automation playbooks (SOAR-ready)', icon: 'Zap',
    actions: [
      { id: 'fw-pb-auto-block', label: 'Arm Playbook: Auto-Block Repeat Offender IPs' },
      { id: 'fw-pb-ticket-on-deny-burst', label: 'Arm Playbook: Ticket on Deny Burst / Scan' },
      { id: 'fw-pb-nightly-audit', label: 'Schedule: Nightly Rulebase Audit' },
    ],
  },
];

interface FirewallRule {
  id: string;
  name: string;
  source: string;
  destination: string;
  port: string;
  action: 'allow' | 'deny' | 'log';
  hits: number;
  status: 'active' | 'inactive';
}

export default function FirewallManagementPage() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('firewall-mgmt');
      if (live) { setRules(live as any); setLoading(false); return; }
      setRules([
        { id: 'FW-001', name: 'Allow HTTP/HTTPS', source: 'Any', destination: 'Web Servers', port: '80,443', action: 'allow', hits: 125678, status: 'active' },
        { id: 'FW-002', name: 'Block Malicious IPs', source: 'Threat List', destination: 'Any', port: 'Any', action: 'deny', hits: 4523, status: 'active' },
        { id: 'FW-003', name: 'Allow SSH Internal', source: '10.0.0.0/8', destination: 'Servers', port: '22', action: 'allow', hits: 8934, status: 'active' },
        { id: 'FW-004', name: 'Log Suspicious Traffic', source: 'External', destination: 'DMZ', port: 'Any', action: 'log', hits: 23456, status: 'active' },
        { id: 'FW-005', name: 'Legacy Rule', source: '192.168.1.0/24', destination: 'Any', port: '8080', action: 'allow', hits: 0, status: 'inactive' },
      ]);
      setLoading(false);
    };
    fetchRules();
  }, []);

  const stats = {
    total: rules.length,
    active: rules.filter(r => r.status === 'active').length,
    allow: rules.filter(r => r.action === 'allow').length,
    deny: rules.filter(r => r.action === 'deny').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Firewall Management</h1>
        <p className="text-gray-400 mt-1">Manage firewall rules and monitor traffic</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Lock className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Rules</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.active}</span>
          </div>
          <p className="text-gray-400 text-sm">Active</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.allow}</span>
          </div>
          <p className="text-gray-400 text-sm">Allow Rules</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.deny}</span>
          </div>
          <p className="text-gray-400 text-sm">Deny Rules</p>
        </div>
      </div>

      {/* Firewall supervision & response console — critical-rule audits,
          syslog/SNMP/OID extraction and vendor-specific config push */}
      <OpsConsole service="firewall-mgmt" title="Firewall Supervision & Response Console" groups={FW_GROUPS} />

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Rule Name</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Source</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Destination</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Port</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Action</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Hits</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="py-3 px-4 text-[var(--ic-heading)] font-medium">{rule.name}</td>
                <td className="py-3 px-4 text-gray-300 font-mono text-sm">{rule.source}</td>
                <td className="py-3 px-4 text-gray-300 font-mono text-sm">{rule.destination}</td>
                <td className="py-3 px-4 text-gray-300 font-mono">{rule.port}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    rule.action === 'allow' ? 'bg-green-500/20 text-green-400' :
                    rule.action === 'deny' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>{rule.action}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{rule.hits.toLocaleString()}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    rule.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{rule.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
