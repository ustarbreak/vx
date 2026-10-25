import React from 'react';
import { Star, Quote, Award, Link2 } from 'lucide-react';

export default function PartnersSection() {
  const partners = [
    { name: 'Fortinet', logo: '/logos/fortinet.svg', type: 'Technology Alliance', category: 'Firewall / SD-WAN' },
    { name: 'Microsoft', logo: '/logos/microsoft.svg', type: 'Technology Alliance', category: 'Cloud & Identity' },
    { name: 'CrowdStrike', logo: '/logos/crowdstrike.svg', type: 'Technology Alliance', category: 'EDR / XDR' },
    { name: 'Palo Alto Networks', logo: '/logos/paloalto.svg', type: 'Technology Alliance', category: 'Network Security' },
    { name: 'Splunk', logo: '/logos/splunk.svg', type: 'Technology Alliance', category: 'SIEM' },
    { name: 'Tenable', logo: '/logos/tenable.svg', type: 'Technology Alliance', category: 'Vulnerability Mgmt' },
    { name: 'Veeam', logo: '/logos/veeam.svg', type: 'Technology Alliance', category: 'Backup & Recovery' },
    { name: 'Cisco', logo: '/logos/cisco.svg', type: 'Technology Alliance', category: 'Networking' },
  ];

  const onlineServices = [
    {
      name: 'Cloud Security Platform',
      rating: 4.9,
      reviews: 234,
      description: '24/7 cloud-based security operations with 99.9% uptime',
      features: ['Real-time monitoring', 'Auto-scaling', 'Global CDN']
    },
    {
      name: 'Threat Intelligence Feed',
      rating: 4.8,
      reviews: 189,
      description: 'Curated IoCs from 40+ sources updated every minute',
      features: ['40+ sources', 'ML deduplication', 'MITRE mapping']
    },
    {
      name: 'Compliance Automation',
      rating: 5.0,
      reviews: 156,
      description: 'Automated evidence collection for NIST, SOC 2, ISO 27001',
      features: ['5 frameworks', 'Auto-evidence', 'Audit-ready']
    },
  ];

  const offlineServices = [
    {
      name: 'On-Premise Deployment',
      rating: 4.9,
      reviews: 145,
      description: 'Full platform deployment in your data center with dedicated support',
      features: ['Air-gapped support', 'Custom integrations', 'Dedicated engineer']
    },
    {
      name: 'Professional Services',
      rating: 5.0,
      reviews: 98,
      description: 'Expert consultation and implementation by certified engineers',
      features: ['Architecture design', 'Migration support', 'Training']
    },
    {
      name: 'Training & Certification',
      rating: 4.8,
      reviews: 125,
      description: 'Comprehensive training programs for security teams',
      features: ['Online courses', 'Certifications', 'Workshops']
    },
  ];

  return (
    <section id="partners" className="py-24 px-4 sm:px-6 lg:px-8 ic-page">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">Our Ecosystem</p>
          <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">Partners & Services</h2>
          <p className="text-lg ic-muted max-w-3xl mx-auto">
            Certified integrations with the world's leading security vendors, backed by our professional services
          </p>
        </div>

        {/* Partners Grid */}
        <div className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <Link2 className="w-8 h-8 ic-link" />
            <h3 className="text-2xl font-bold ic-heading">Technology Partners</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {partners.map((partner, i) => (
              <div key={i} className="ic-card border border rounded-xl p-6 hover: transition-all group text-center">
                <div className="w-16 h-16 mx-auto mb-3 group-hover:scale-110 transition-transform">
                  <img src={partner.logo} alt={partner.name} className="w-full h-full object-contain" />
                </div>
                <p className="text-sm font-semibold ic-heading mb-1">{partner.name}</p>
                <p className="text-xs ic-link mb-1">{partner.category}</p>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  partner.type === 'Open Source' 
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                    : 'bg-purple-500/10 ic-link border border-purple-500/20'
                }`}>
                  {partner.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Online Services */}
        <div className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <Award className="w-8 h-8 ic-link" />
            <h3 className="text-2xl font-bold ic-heading">Online Services</h3>
            <span className="px-3 py-1 rounded-full ic-btn-primary border  text-xs ic-link font-medium">
              Cloud-Based
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {onlineServices.map((service, i) => (
              <div key={i} className="ic-card border border rounded-2xl p-6 hover: transition-all">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold ic-heading">{service.name}</h4>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-green-400 fill-green-400" />
                    <span className="text-sm font-bold ic-heading">{service.rating}</span>
                  </div>
                </div>
                <p className="text-sm ic-muted mb-4">{service.description}</p>
                <div className="space-y-2 mb-4">
                  {service.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs ic-text">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--ic-primary)]" />
                      {feature}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-4 border-t border">
                  <span className="text-xs ic-muted">{service.reviews} reviews</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`w-3 h-3 ${
                        star <= Math.floor(service.rating) 
                          ? 'text-green-400 fill-green-400' 
                          : 'ic-muted'
                      }`} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Trustpilot Widget - Online */}
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-4xl">⭐</div>
                <div>
                  <p className="text-xl font-bold ic-heading">4.9/5</p>
                  <p className="text-sm ic-muted">Online Services Rating</p>
                  <p className="text-xs text-green-400 font-semibold">Based on 579 reviews</p>
                </div>
              </div>
              <a href="#" className="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-medium hover:bg-green-500/20 transition-all">
                View on Trustpilot →
              </a>
            </div>
          </div>
        </div>

        {/* Offline Services */}
        <div>
          <div className="flex items-center gap-3 mb-8">
            <Award className="w-8 h-8 ic-link" />
            <h3 className="text-2xl font-bold ic-heading">Offline Services</h3>
            <span className="px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs ic-link font-medium">
              On-Premise
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {offlineServices.map((service, i) => (
              <div key={i} className="ic-card border border rounded-2xl p-6 hover:border-purple-500/30 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold ic-heading">{service.name}</h4>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-green-400 fill-green-400" />
                    <span className="text-sm font-bold ic-heading">{service.rating}</span>
                  </div>
                </div>
                <p className="text-sm ic-muted mb-4">{service.description}</p>
                <div className="space-y-2 mb-4">
                  {service.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs ic-text">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      {feature}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-4 border-t border">
                  <span className="text-xs ic-muted">{service.reviews} reviews</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`w-3 h-3 ${
                        star <= Math.floor(service.rating) 
                          ? 'text-green-400 fill-green-400' 
                          : 'ic-muted'
                      }`} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Trustpilot Widget - Offline */}
          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-4xl">⭐</div>
                <div>
                  <p className="text-xl font-bold ic-heading">4.9/5</p>
                  <p className="text-sm ic-muted">Offline Services Rating</p>
                  <p className="text-xs text-green-400 font-semibold">Based on 368 reviews</p>
                </div>
              </div>
              <a href="#" className="px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 ic-link text-sm font-medium hover:bg-purple-500/20 transition-all">
                View on Trustpilot →
              </a>
            </div>
          </div>
        </div>

        {/* Partner CTA */}
        <div className="mt-16 text-center">
          <div className="ic-chip-ok border  rounded-2xl p-8">
            <h3 className="text-2xl font-bold ic-heading mb-4">Become a Partner</h3>
            <p className="ic-muted mb-6 max-w-2xl mx-auto">
              Join our ecosystem of technology partners and deliver world-class security services to your clients
            </p>
            <button className="px-8 py-3 rounded-xl ic-btn-primary inline-flex items-center gap-2">
              Apply for Partnership
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
