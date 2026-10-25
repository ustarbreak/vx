import React from 'react';
import { Shield, Network, Server, CheckCircle2 } from 'lucide-react';

export default function PlatformPillars() {
  const pillars = [
    {
      icon: Shield,
      title: 'Security Orchestration',
      desc: 'AI-focused SIEM, XDR, and automated response with multi-layer AI™ technology.',
      gradient: 'ic-chip-ok',
      border: '',
      services: ['AI-Focused SIEM', 'Open XDR', 'ITDR', 'UEBA', 'Multi-Layer AI™'],
    },
    {
      icon: Network,
      title: 'Network Management',
      desc: 'Full-stack network visibility from edge to core with intelligent monitoring.',
      gradient: 'from-purple-500/20 to-pink-500/20',
      border: 'border-purple-500/20',
      services: ['Network Monitoring', 'DNS Filtering', 'Firewall Management', 'VPN Gateway', 'SD-WAN'],
    },
    {
      icon: Server,
      title: 'PSA Services',
      desc: 'Professional services automation for patch, backup, endpoint, and cloud security.',
      gradient: 'from-green-500/20 to-emerald-500/20',
      border: 'border-green-500/20',
      services: ['Vulnerability Scanning', 'Patch Management', 'Backup & DR', 'Endpoint Protection', 'Email Security'],
    },
  ];

  return (
    <section id="about" className="py-24 px-4 sm:px-6 lg:px-8 ic-page">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">The Platform</p>
          <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">Three Pillars. One Platform.</h2>
          <p className="text-lg ic-muted max-w-3xl mx-auto">
            Infracentra combines security orchestration, network management, and professional services automation
            into a unified platform with predictive AI at its core.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {pillars.map((pillar, i) => (
            <div key={i} className={`relative bg-gradient-to-br ${pillar.gradient} border ${pillar.border} rounded-3xl p-8 hover:scale-[1.02] transition-all overflow-hidden group`}>
              <pillar.icon className="w-12 h-12 ic-heading/80 mb-4" />
              <h3 className="text-2xl font-bold ic-heading mb-3">{pillar.title}</h3>
              <p className="ic-text mb-6">{pillar.desc}</p>

              <ul className="space-y-2">
                {pillar.services.map((service, j) => (
                  <li key={j} className="flex items-center gap-2 text-sm ic-heading">
                    <CheckCircle2 className="w-4 h-4 ic-link flex-shrink-0" />
                    {service}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
