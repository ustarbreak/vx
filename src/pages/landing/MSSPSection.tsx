import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import ImageSlider from '../../components/ImageSlider';

export default function MSSPSection() {
  const benefits = [
    'AI-driven SecOps for MSSP/MDR',
    'Unified open platform with simple pricing',
    'Multi-tier, multi-tenant, multi-site architecture',
    'MITRE ATT&CK Coverage Analyzer',
    'Increase revenue and margin',
    'Sell SOC-as-a-Service & MDR-as-a-Service',
  ];

  const stats = [
    { value: '250+', label: 'Partners Worldwide' },
    { value: '40%', label: 'Average Margin Increase' },
    { value: '3x', label: 'Faster Deployment' },
    { value: '99.9%', label: 'Platform Uptime' },
  ];

  const msspImages = [
    {
      url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=500&fit=crop',
      title: 'Partner Ecosystem',
      description: 'Join 250+ partners worldwide delivering managed security services'
    },
    {
      url: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&h=500&fit=crop',
      title: 'Multi-Tenant Architecture',
      description: 'Serve multiple clients from a single unified platform'
    },
    {
      url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=500&fit=crop',
      title: 'Revenue Growth',
      description: 'Increase margins by 40% with our partner program'
    }
  ];

  return (
    <section id="mssp" className="py-24 px-4 sm:px-6 lg:px-8 ic-page">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">For Partners</p>
            <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">MSSP/MDR Program</h2>
            <p className="text-lg ic-text mb-8 leading-relaxed">
              Join the Infracentra partner ecosystem and deliver world-class security services to your clients. 
              Our unified platform enables MSSPs and MDRs to scale operations, increase margins, and provide 
              comprehensive security coverage.
            </p>
            <div className="space-y-4 mb-8">
              {benefits.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 ic-link flex-shrink-0" />
                  <span className="ic-text">{item}</span>
                </div>
              ))}
            </div>
            <button className="px-8 py-3 rounded-xl ic-btn-primary inline-flex items-center gap-2 flex items-center gap-2">
              Become a Partner <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-6">
            <ImageSlider images={msspImages} autoPlay={true} interval={4500} />
            <div className="ic-chip-ok border  rounded-3xl p-8">
              <div className="grid grid-cols-2 gap-6">
                {stats.map((stat, i) => (
                  <div key={i} className="text-center">
                    <p className="text-3xl font-bold ic-link mb-1">{stat.value}</p>
                    <p className="text-xs ic-muted">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
