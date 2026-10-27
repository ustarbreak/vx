// ---------------------------------------------------------------------------
// TRUST & METRICS — restrained band under the hero.
// IMPORTANT: every figure here traces to real product data already approved
// in this repository (servicesData.ts / existing ClientsSection copy). No
// fabricated customer counts, uptime claims or certifications are introduced.
// The engine row lists ONLY the open-source engines actually integrated and
// shipped with logo assets in public/logos/.
// ---------------------------------------------------------------------------
import React from 'react';
import { Reveal } from './lxPrimitives';

const ENGINES = [
  { name: 'Wazuh', logo: '/logos/wazuh.svg', role: 'SIEM & XDR' },
  { name: 'TheHive', logo: '/logos/thehive.svg', role: 'Case management' },
  { name: 'MISP', logo: '/logos/misp.svg', role: 'Threat intelligence' },
  { name: 'Elastic', logo: '/logos/elastic.svg', role: 'Log analytics' },
  { name: 'pfSense', logo: '/logos/pfsense.svg', role: 'Firewall' },
  { name: 'Shuffle', logo: '/logos/shuffle.svg', role: 'SOAR' },
  { name: 'Zabbix', logo: '/logos/zabbix.svg', role: 'Monitoring' },
  { name: 'OpenVAS', logo: '/logos/openvas.svg', role: 'Vulnerability scan' },
  { name: 'BorgBackup', logo: '/logos/borgbackup.svg', role: 'Backup' },
];

export default function TrustSection() {
  return (
    <section id="trust" className="ic-lx-grid border-y" style={{ borderColor: 'var(--lx-border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <Reveal className="text-center mb-10">
          <p className="text-xs uppercase tracking-[0.25em] ic-lx-muted mb-6">
            Powered by battle-tested open security engines — unified in one platform
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 list-none">
            {ENGINES.map((e) => (
              <li key={e.name} className="flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
                <img src={e.logo} alt={`${e.name} logo`} width={40} height={40} loading="lazy"
                  style={{ height: 34, width: 'auto', objectFit: 'contain' }} />
                <span className="text-[10px] uppercase tracking-wider ic-lx-muted">{e.role}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        {/* Verified figures only (source: servicesData.ts + existing landing copy) */}
        <Reveal delay={120} className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {[
            { value: '16', label: 'Integrated services on one platform' },
            { value: '94%', label: 'AI prediction accuracy (Analytics engine)' },
            { value: '24/7', label: 'Continuous monitoring coverage' },
            { value: '9', label: 'Open-source engines integrated' },
          ].map((s, i) => (
            <div key={i} className="ic-lx-card p-6 text-center">
              <p className="text-3xl font-extrabold ic-lx-h mb-1" style={{ color: 'var(--lx-cyan)' }}>{s.value}</p>
              <p className="text-xs ic-lx-muted leading-snug">{s.label}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
