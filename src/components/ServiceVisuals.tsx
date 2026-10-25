import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ServiceVisualsProps {
  serviceId: string;
}

export default function ServiceVisuals({ serviceId }: ServiceVisualsProps) {
  // Images spécifiques pour chaque service
  const serviceImages: Record<string, { url: string; title: string; description: string }[]> = {
    'threat-intel': [
      {
        url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=500&fit=crop',
        title: 'Threat Intelligence Dashboard',
        description: 'Real-time monitoring of global threats and IoCs'
      },
      {
        url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&h=500&fit=crop',
        title: 'MITRE ATT&CK Mapping',
        description: 'Visual representation of attack techniques'
      },
      {
        url: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&h=500&fit=crop',
        title: 'IoC Correlation',
        description: 'Automated correlation of indicators across sources'
      }
    ],
    'compliance': [
      {
        url: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800&h=500&fit=crop',
        title: 'Compliance Dashboard',
        description: 'Track compliance status across frameworks'
      },
      {
        url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&h=500&fit=crop',
        title: 'Automated Evidence Collection',
        description: 'AI-powered evidence gathering for audits'
      },
      {
        url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=500&fit=crop',
        title: 'Gap Analysis',
        description: 'Identify and remediate compliance gaps'
      }
    ],
    'incident-response': [
      {
        url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=500&fit=crop',
        title: 'Incident Timeline',
        description: 'Visual reconstruction of security incidents'
      },
      {
        url: 'https://images.unsplash.com/photo-1510511459019-5dda7724fd87?w=800&h=500&fit=crop',
        title: 'Automated Playbooks',
        description: 'Pre-built response workflows'
      },
      {
        url: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=800&h=500&fit=crop',
        title: 'Team Collaboration',
        description: 'Real-time incident response coordination'
      }
    ],
    'network-monitoring': [
      {
        url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&h=500&fit=crop',
        title: 'Network Topology',
        description: 'Auto-discovered network map'
      },
      {
        url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&h=500&fit=crop',
        title: 'Traffic Analysis',
        description: 'Real-time network traffic monitoring'
      },
      {
        url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=500&fit=crop',
        title: 'Performance Metrics',
        description: 'Network performance dashboards'
      }
    ],
    'endpoint-protection': [
      {
        url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=500&fit=crop',
        title: 'Endpoint Dashboard',
        description: 'Monitor all endpoints in real-time'
      },
      {
        url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&h=500&fit=crop',
        title: 'Threat Detection',
        description: 'AI-powered endpoint threat detection'
      },
      {
        url: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&h=500&fit=crop',
        title: 'Isolation Control',
        description: 'Instant endpoint isolation capabilities'
      }
    ],
    'patch-management': [
      {
        url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&h=500&fit=crop',
        title: 'Patch Dashboard',
        description: 'Track patch status across all systems'
      },
      {
        url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&h=500&fit=crop',
        title: 'Automated Deployment',
        description: 'Zero-touch patch deployment'
      },
      {
        url: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=800&h=500&fit=crop',
        title: 'Compliance Reporting',
        description: 'Patch compliance across the organization'
      }
    ]
  };

  // Attack scenarios pour chaque service
  const attackScenarios: Record<string, { title: string; steps: string[]; code?: string }> = {
    'threat-intel': {
      title: 'Ransomware Attack Prevention',
      steps: [
        '1. Attacker sends phishing email with malicious attachment',
        '2. Infracentra detects IoC in email attachment',
        '3. Threat Intelligence correlates with known ransomware family',
        '4. Auto-block email and quarantine attachment',
        '5. Update firewall rules to block C2 communication',
        '6. Alert SOC team with full context'
      ],
      code: `// Threat Detection Example
const threat = await misp.search({
  type: 'sha256',
  value: attachmentHash
});

if (threat.confidence > 0.9) {
  await blockEmail(sender);
  await updateFirewall(threat.iocs);
  await alertSOC(threat);
}`
    },
    'compliance': {
      title: 'SOC 2 Compliance Automation',
      steps: [
        '1. Define SOC 2 control requirements',
        '2. Map controls to existing security tools',
        '3. Auto-collect evidence from Wazuh, Elastic, etc.',
        '4. Identify gaps in control coverage',
        '5. Generate remediation tasks',
        '6. Export audit-ready report'
      ],
      code: `// Compliance Check Example
const controls = await getControls('SOC2');
const evidence = await collectEvidence({
  sources: ['wazuh', 'elastic', 'zabbix'],
  period: 'last_90_days'
});

const gaps = identifyGaps(controls, evidence);
await generateReport(gaps);`
    },
    'incident-response': {
      title: 'Data Exfiltration Response',
      steps: [
        '1. DLP alert triggers on unusual data transfer',
        '2. Auto-triage: classify severity and impact',
        '3. Execute playbook: isolate affected systems',
        '4. Collect forensic evidence automatically',
        '5. Notify stakeholders via Slack/PagerDuty',
        '6. Generate post-incident report'
      ],
      code: `// Incident Response Example
const incident = await createIncident({
  type: 'data_exfiltration',
  severity: 'high',
  affectedSystems: ['FIN-DB-001']
});

await executePlaybook('IR-DataExfil-001', {
  isolate: true,
  collectForensics: true,
  notify: ['soc-team', 'management']
});`
    },
    'network-monitoring': {
      title: 'DDoS Attack Detection',
      steps: [
        '1. Traffic spike detected on web servers',
        '2. NetFlow analysis shows anomalous patterns',
        '3. Auto-classify as potential DDoS',
        '4. Trigger rate limiting on edge firewall',
        '5. Activate DDoS mitigation service',
        '6. Alert NOC with attack details'
      ],
      code: `// Network Monitoring Example
const traffic = await getNetFlow({
  period: 'last_5_minutes',
  threshold: '2x_baseline'
});

if (traffic.anomaly_score > 0.8) {
  await activateDDoSProtection();
  await rateLimit(sourceIPs);
  await alertNOC(traffic);
}`
    },
    'endpoint-protection': {
      title: 'Ransomware Rollback',
      steps: [
        '1. EDR detects suspicious file encryption',
        '2. Behavioral AI confirms ransomware activity',
        '3. Instantly isolate endpoint from network',
        '4. Kill malicious process',
        '5. Rollback encrypted files from snapshot',
        '6. Scan for lateral movement'
      ],
      code: `// Endpoint Protection Example
const threat = await edr.detect({
  behavior: 'file_encryption',
  process: 'unknown.exe'
});

if (threat.confidence > 0.95) {
  await isolateEndpoint(endpointId);
  await killProcess(threat.pid);
  await rollbackFiles(endpointId);
  await scanLateralMovement();
}`
    }
  };

  const images = serviceImages[serviceId] || serviceImages['threat-intel'];
  const scenario = attackScenarios[serviceId] || attackScenarios['threat-intel'];

  return (
    <div className="space-y-12">
      {/* Image Gallery */}
      <div>
        <h3 className="text-2xl font-bold text-[var(--ic-heading)] mb-6">Service in Action</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {images.map((image, i) => (
            <div key={i} className="group relative overflow-hidden rounded-2xl border border-[var(--ic-border)] hover:border-[var(--ic-primary)] transition-all">
              <img
                src={image.url}
                alt={image.title}
                className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h4 className="text-sm font-bold text-[var(--ic-heading)] mb-1">{image.title}</h4>
                <p className="text-xs text-[var(--ic-text)]">{image.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Attack Scenario */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[var(--ic-heading)]">Attack Scenario</h3>
            <p className="text-sm text-[var(--ic-muted)]">{scenario.title}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Steps */}
          <div>
            <h4 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Response Steps</h4>
            <div className="space-y-3">
              {scenario.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] hover:border-[var(--ic-border)] transition-all">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/10 border border-[var(--ic-border)] flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-cyan-400">{i + 1}</span>
                  </div>
                  <p className="text-sm text-[var(--ic-text)]">{step}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Code Example */}
          {scenario.code && (
            <div>
              <h4 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">Code Example</h4>
              <div className="ic-page border border-[var(--ic-border)] rounded-lg p-4 overflow-x-auto">
                <pre className="text-xs text-[var(--ic-text)] font-mono">
                  <code>{scenario.code}</code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
