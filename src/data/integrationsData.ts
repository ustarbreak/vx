import { ServiceId } from '../types';

export interface Integration {
  id: string;
  serviceId: ServiceId | 'coming-soon';
  name: string;
  type: 'api' | 'webhook' | 'agent' | 'native';
  status: 'active' | 'inactive' | 'pending';
  licenseType: 'open-source' | 'commercial' | 'freemium';
  pricing: 'free' | 'paid' | 'custom';
  apiKey?: string;
  apiEndpoint?: string;
  documentationUrl?: string;
  lastSync?: string;
  notes?: string;
}

export const integrationsData: Integration[] = [
  // Threat Intelligence
  {
    id: 'int-001',
    serviceId: 'threat-intel',
    name: 'MISP',
    type: 'api',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'https://misp.local',
    documentationUrl: 'https://www.misp-project.org/',
    lastSync: '2027-01-15T09:00:00Z',
  },
  {
    id: 'int-002',
    serviceId: 'threat-intel',
    name: 'AlienVault OTX',
    type: 'api',
    status: 'active',
    licenseType: 'freemium',
    pricing: 'free',
    apiEndpoint: 'https://otx.alienvault.com/api',
    documentationUrl: 'https://otx.alienvault.com/api',
    lastSync: '2027-01-15T08:30:00Z',
  },
  {
    id: 'int-003',
    serviceId: 'threat-intel',
    name: 'VirusTotal',
    type: 'api',
    status: 'active',
    licenseType: 'freemium',
    pricing: 'paid',
    apiEndpoint: 'https://www.virustotal.com/api/v3',
    documentationUrl: 'https://developers.virustotal.com/reference',
    lastSync: '2027-01-15T09:15:00Z',
  },

  // Endpoint Protection
  {
    id: 'int-004',
    serviceId: 'endpoint-protection',
    name: 'Wazuh',
    type: 'agent',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'https://wazuh.local:55000',
    documentationUrl: 'https://documentation.wazuh.com/',
    lastSync: '2027-01-15T09:20:00Z',
  },
  {
    id: 'int-005',
    serviceId: 'endpoint-protection',
    name: 'CrowdStrike',
    type: 'api',
    status: 'inactive',
    licenseType: 'commercial',
    pricing: 'paid',
    apiEndpoint: 'https://api.crowdstrike.com',
    documentationUrl: 'https://falcon.crowdstrike.com/documentation',
  },

  // SIEM
  {
    id: 'int-006',
    serviceId: 'threat-intel',
    name: 'Elastic Security',
    type: 'native',
    status: 'active',
    licenseType: 'freemium',
    pricing: 'paid',
    apiEndpoint: 'https://elastic.local:9200',
    documentationUrl: 'https://www.elastic.co/guide/en/security/current/index.html',
    lastSync: '2027-01-15T09:10:00Z',
  },

  // SOAR
  {
    id: 'int-007',
    serviceId: 'soar',
    name: 'Shuffle',
    type: 'api',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'http://shuffle.local:3001',
    documentationUrl: 'https://shuffler.io/docs',
    lastSync: '2027-01-15T09:05:00Z',
  },

  // Incident Management
  {
    id: 'int-008',
    serviceId: 'incident-response',
    name: 'TheHive',
    type: 'api',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'https://thehive.local:9000',
    documentationUrl: 'https://docs.thehive-project.org/',
    lastSync: '2027-01-15T08:45:00Z',
  },

  // Vulnerability Scanning
  {
    id: 'int-009',
    serviceId: 'vuln-scanning',
    name: 'OpenVAS',
    type: 'native',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'https://openvas.local:9392',
    documentationUrl: 'https://www.openvas.org/',
    lastSync: '2027-01-15T06:00:00Z',
  },

  // Network Monitoring
  {
    id: 'int-010',
    serviceId: 'network-monitoring',
    name: 'Zabbix',
    type: 'api',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'https://zabbix.local',
    documentationUrl: 'https://www.zabbix.com/documentation',
    lastSync: '2027-01-15T09:20:00Z',
  },

  // Backup & DR
  {
    id: 'int-011',
    serviceId: 'backup-dr',
    name: 'BorgBackup',
    type: 'native',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    documentationUrl: 'https://borgbackup.readthedocs.io/',
    lastSync: '2027-01-15T03:00:00Z',
  },

  // Firewall Management
  {
    id: 'int-012',
    serviceId: 'firewall-mgmt',
    name: 'pfSense',
    type: 'api',
    status: 'active',
    licenseType: 'open-source',
    pricing: 'free',
    apiEndpoint: 'https://pfsense.local',
    documentationUrl: 'https://docs.netgate.com/pfsense/en/latest/',
    lastSync: '2027-01-15T09:00:00Z',
  },

  // Coming Soon - ITDR
  {
    id: 'int-013',
    serviceId: 'coming-soon',
    name: 'Active Directory Integration',
    type: 'native',
    status: 'pending',
    licenseType: 'commercial',
    pricing: 'custom',
    notes: 'Planned for ITDR service launch Q2 2027',
  },

  // Coming Soon - AI Investigator
  {
    id: 'int-014',
    serviceId: 'coming-soon',
    name: 'OpenAI GPT-4',
    type: 'api',
    status: 'pending',
    licenseType: 'commercial',
    pricing: 'paid',
    apiEndpoint: 'https://api.openai.com/v1',
    documentationUrl: 'https://platform.openai.com/docs',
    notes: 'For AI Investigator service - Q3 2027',
  },
];

export const getIntegrationStats = () => {
  const total = integrationsData.length;
  const active = integrationsData.filter(i => i.status === 'active').length;
  const openSource = integrationsData.filter(i => i.licenseType === 'open-source').length;
  const commercial = integrationsData.filter(i => i.licenseType === 'commercial').length;
  const freemium = integrationsData.filter(i => i.licenseType === 'freemium').length;

  return {
    total,
    active,
    openSource,
    commercial,
    freemium,
  };
};
