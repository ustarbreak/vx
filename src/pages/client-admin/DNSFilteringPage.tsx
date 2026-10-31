import React, { useState, useEffect } from 'react';
import { Globe, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';
import OpsConsole from '../../components/OpsConsole';
import type { ActionGroup } from '../../services/securityOps';

const DNS_GROUPS: ActionGroup[] = [
  {
    title: 'DNS server scans & resolution analysis', icon: 'Scan',
    fields: [{ name: 'server', label: 'DNS server / resolver to test', placeholder: 'e.g. 8.8.8.8 or ns1.tenant.local', default: '10.0.0.53' }],
    actions: [
      { id: 'dns-scan-open-resolvers', label: 'Scan Fleet for Open Resolvers (port 53/UDP)' },
      { id: 'dns-scan-amplification', label: 'Check DNS Amplification Exposure (TXT/ANY)' },
      { id: 'dns-test-resolution', label: 'Test Name Resolution Against Server' },
      { id: 'dns-trace-dnssec', label: 'Validate DNSSEC Chain (dig +dnssec)' },
      { id: 'dns-zone-transfer', label: 'Probe Zone Transfer Allowed (AXFR test)' },
      { id: 'dns-recursive-check', label: 'Detect Unauthorised Recursive Service' },
    ],
  },
  {
    title: 'Investigate blocked / suspicious domains', icon: 'Search',
    fields: [{ name: 'domain', label: 'Domain under investigation', placeholder: 'e.g. phishing-bank.com' }],
    actions: [
      { id: 'dns-lookup-history', label: 'Pull Query History for Domain' },
      { id: 'dns-whois-enrich', label: 'WHOIS / Registration Age Enrichment' },
      { id: 'dns-threatintel-enrich', label: 'Threat Intel Lookup (multi-source)' },
      { id: 'dns-resolve-all', label: 'Resolve All Records (A/AAAA/MX/TXT/CNAME)' },
      { id: 'dns-similar-domains', label: 'Hunt Typosquat / Lookalike Domains' },
      { id: 'dns-top-blocked', label: 'Report: Top Blocked Domains (24h)' },
      { id: 'dns-query-log-export', label: 'Export DNS Query Logs (syslog)' },
    ],
  },
  {
    title: 'Policy & configuration push', icon: 'Upload',
    fields: [
      { name: 'profile', label: 'Filtering profile', options: ['Strict Workstations', 'Server Tier (allow-list)', 'Guest Wi-Fi', 'Blocklists + RPZ Update'] },
      { name: 'scope', label: 'Scope', options: ['All resolvers', 'Selected site', 'Selected device'] },
    ],
    actions: [
      { id: 'dns-push-policy', label: 'Push Filtering Policy Now' },
      { id: 'dns-add-blocklist', label: 'Add Domain to Blocklist (RPZ)' },
      { id: 'dns-remove-block', label: 'Remove / Un-block Domain' },
      { id: 'dns-switch-upstream', label: 'Switch Upstream Resolver (DoH/DoT)' },
      { id: 'dns-enable-cache-locking', label: 'Enable Cache Locking & QPS Limits' },
    ],
  },
  {
    title: 'Automation playbooks (SOAR-ready)', icon: 'Zap',
    actions: [
      { id: 'dns-pb-auto-block', label: 'Arm Playbook: Auto-Block New C2 Domains' },
      { id: 'dns-pb-ticket-on-hit', label: 'Arm Playbook: Ticket on High-Severity Hit' },
      { id: 'dns-pb-sinkhole', label: 'Arm Playbook: Sinkhole Confirmed Malware Domain' },
    ],
  },
];

interface DNSRule {
  id: string;
  domain: string;
  category: string;
  action: 'block' | 'allow' | 'monitor';
  hits: number;
  lastHit?: string;
}

export default function DNSFilteringPage() {
  const [rules, setRules] = useState<DNSRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('dns-filtering');
      if (live) { setRules(live as any); setLoading(false); return; }
      setRules([
        { id: 'DNS-001', domain: '*.malware-site.com', category: 'Malware', action: 'block', hits: 1247, lastHit: '2027-01-15T09:30:00Z' },
        { id: 'DNS-002', domain: 'phishing-bank.com', category: 'Phishing', action: 'block', hits: 89, lastHit: '2027-01-15T08:15:00Z' },
        { id: 'DNS-003', domain: '*.social-media.com', category: 'Social Media', action: 'monitor', hits: 45678, lastHit: '2027-01-15T09:45:00Z' },
        { id: 'DNS-004', domain: 'trusted-partner.com', category: 'Business', action: 'allow', hits: 234, lastHit: '2027-01-15T09:00:00Z' },
      ]);
      setLoading(false);
    };
    fetchRules();
  }, []);

  const stats = {
    total: rules.length,
    blocked: rules.filter(r => r.action === 'block').length,
    monitored: rules.filter(r => r.action === 'monitor').length,
    totalHits: rules.reduce((sum, r) => sum + r.hits, 0),
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">DNS Filtering</h1>
        <p className="text-gray-400 mt-1">Manage DNS filtering rules and monitor blocked domains</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Globe className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Rules</p>
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
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.monitored}</span>
          </div>
          <p className="text-gray-400 text-sm">Monitored</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.totalHits.toLocaleString()}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Hits</p>
        </div>
      </div>

      {/* DNS analysis & operations console — resolver scans, domain hunting,
          policy push and playbook arming */}
      <OpsConsole service="dns-filtering" title="DNS Filtering Analysis & Response Console" groups={DNS_GROUPS} />

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Domain</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Category</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Action</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Hits</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Hit</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="py-3 px-4 text-[var(--ic-heading)] font-mono">{rule.domain}</td>
                <td className="py-3 px-4 text-gray-300">{rule.category}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    rule.action === 'block' ? 'bg-red-500/20 text-red-400' :
                    rule.action === 'monitor' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                  }`}>{rule.action}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{rule.hits.toLocaleString()}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{rule.lastHit ? new Date(rule.lastHit).toLocaleString() : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
