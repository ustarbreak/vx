import React, { useState } from 'react';
import { Link2, ExternalLink, CheckCircle2, Settings, Globe, Database, Shield, Network, Server, Zap } from 'lucide-react';

interface Integration {
  id: string;
  name: string;
  category: string;
  status: 'connected' | 'disconnected' | 'error';
  description: string;
  url?: string;
  icon: any;
}

export default function IntegrationsSection() {
  const [filter, setFilter] = useState<string>('all');

  const integrations: Integration[] = [
    // Security Tools
    { id: 'wazuh', name: 'Wazuh', category: 'EDR/XDR', status: 'connected', description: 'Open-source security platform for threat detection, integrity monitoring, and incident response', url: 'https://wazuh.com', icon: Shield },
    { id: 'elastic', name: 'Elastic Security', category: 'SIEM', status: 'connected', description: 'Search-driven SIEM with AI-powered security analytics', url: 'https://elastic.co', icon: Database },
    { id: 'misp', name: 'MISP', category: 'Threat Intelligence', status: 'connected', description: 'Open-source threat intelligence platform for sharing and correlating IoCs', url: 'https://misp-project.org', icon: Globe },
    { id: 'shuffle', name: 'Shuffle', category: 'SOAR', status: 'connected', description: 'Open-source automation platform for security operations', url: 'https://shuffler.io', icon: Zap },
    { id: 'thehive', name: 'TheHive', category: 'Incident Management', status: 'connected', description: 'Security incident response platform', url: 'https://thehive-project.org', icon: Shield },
    
    // Network Tools
    { id: 'zabbix', name: 'Zabbix', category: 'Network Monitoring', status: 'connected', description: 'Enterprise-level monitoring solution for networks and applications', url: 'https://zabbix.com', icon: Network },
    { id: 'pfsense', name: 'pfSense', category: 'Firewall', status: 'disconnected', description: 'Open-source firewall and router platform', url: 'https://pfsense.org', icon: Shield },
    { id: 'suricata', name: 'Suricata', category: 'IDS/IPS', status: 'connected', description: 'High-performance network threat detection engine', url: 'https://suricata.io', icon: Network },
    
    // PSA Tools
    { id: 'openvas', name: 'OpenVAS', category: 'Vulnerability Scanner', status: 'connected', description: 'Full-featured vulnerability scanner and manager', url: 'https://openvas.org', icon: Shield },
    { id: 'borgbackup', name: 'BorgBackup', category: 'Backup', status: 'connected', description: 'Deduplicating backup program with compression and encryption', url: 'https://borgbackup.readthedocs.io', icon: Server },
    { id: 'graylog', name: 'Graylog', category: 'Log Management', status: 'disconnected', description: 'Powerful log management and analysis platform', url: 'https://graylog.org', icon: Database },
    
    // Cloud Tools
    { id: 'aws', name: 'AWS Security Hub', category: 'Cloud Security', status: 'connected', description: 'Unified security and compliance center for AWS workloads', url: 'https://aws.amazon.com/security-hub', icon: Shield },
    { id: 'azure', name: 'Microsoft Defender', category: 'Cloud Security', status: 'disconnected', description: 'Cloud-native application protection platform', url: 'https://azure.microsoft.com', icon: Shield },
  ];

  const categories = ['all', ...Array.from(new Set(integrations.map(i => i.category)))];
  
  const filteredIntegrations = filter === 'all' 
    ? integrations 
    : integrations.filter(i => i.category === filter);

  const connectedCount = integrations.filter(i => i.status === 'connected').length;
  const disconnectedCount = integrations.filter(i => i.status === 'disconnected').length;

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <Link2 className="w-6 h-6 text-cyan-400" />
            Third-Party Integrations
          </h2>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Manage connections with open-source security tools</p>
        </div>
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-cyber-green">{connectedCount}</p>
            <p className="text-xs text-[var(--ic-muted)]">Connected</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-[var(--ic-muted)]">{disconnectedCount}</p>
            <p className="text-xs text-[var(--ic-muted)]">Available</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === cat
                ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]'
                : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] bg-[var(--ic-surface)] border border-[var(--ic-border)]'
            }`}
          >
            {cat === 'all' ? 'All' : cat}
          </button>
        ))}
      </div>

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredIntegrations.map(integration => {
          const Icon = integration.icon;
          return (
            <div
              key={integration.id}
              className={`bg-[var(--ic-surface)] border rounded-xl p-4 transition-all hover:border-[var(--ic-primary)] ${
                integration.status === 'connected' ? 'border-[var(--ic-border)]' : 'border-[var(--ic-border)]'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    integration.status === 'connected' ? 'bg-cyan-500/10' : 'bg-[var(--ic-surface-2)]'
                  }`}>
                    <Icon className={`w-5 h-5 ${
                      integration.status === 'connected' ? 'text-cyan-400' : 'text-[var(--ic-muted)]'
                    }`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)]">{integration.name}</h3>
                    <p className="text-xs text-[var(--ic-muted)]">{integration.category}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {integration.status === 'connected' ? (
                    <CheckCircle2 className="w-4 h-4 text-cyber-green" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-[var(--ic-border)]" />
                  )}
                  {integration.url && (
                    <a href={integration.url} target="_blank" rel="noopener noreferrer" className="text-[var(--ic-muted)] hover:text-cyan-400">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
              <p className="text-xs text-[var(--ic-muted)] mb-3">{integration.description}</p>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${
                  integration.status === 'connected' ? 'text-cyber-green' : 'text-[var(--ic-muted)]'
                }`}>
                  {integration.status === 'connected' ? 'Connected' : 'Available'}
                </span>
                <button className={`text-xs px-3 py-1 rounded-lg transition-all ${
                  integration.status === 'connected'
                    ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                    : 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-[var(--ic-border)]'
                }`}>
                  {integration.status === 'connected' ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
