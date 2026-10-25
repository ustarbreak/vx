import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function PricingSection() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  // Pay-per-seat : chaque siège = un utilisateur supervisé (technicien / analyste).
  // Les prix sont compétitifs vs. suites SIEM/SOAR classiques (souvent >150 $/utilisateur/mois).
  const plans = [
    {
      tier: 'SME',
      seatPrice: 19,
      minSeats: 5,
      desc: 'Pay only what you get — per supervised user, per month',
      features: ['Threat Intelligence', 'Compliance Mapper', 'Vulnerability Scanning', 'Patch Management', 'Endpoint Protection', 'Email Security', 'DNS Filtering', 'VPN Gateway'],
      popular: false
    },
    {
      tier: 'Mid-Market',
      seatPrice: 29,
      minSeats: 15,
      desc: 'Everything in SME + operations, for growing security teams',
      features: ['Everything in SME', 'Incident Response', 'Backup & DR', 'Network Monitoring', 'Security Analytics', 'Priority Support', 'Custom Playbooks', 'API Access'],
      popular: true
    },
    {
      tier: 'Enterprise',
      seatPrice: null, // Custom pricing
      minSeats: 50,
      desc: 'Full platform + automation, volume pricing per seat',
      features: ['Everything in Mid-Market', 'SOAR Automation', 'Cloud Security (CSPM)', 'Firewall Management', 'SD-WAN', 'Dedicated CSM', 'Custom Integrations', 'SLA Guarantee'],
      popular: false
    },
  ];

  const formatSeatPrice = (price: number | null) => {
    if (price === null) return 'Custom';
    const p = billingCycle === 'annual' ? Math.round(price * 0.8) : price;
    return `$${p}`;
  };

  return (
    <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">Pay Only What You Get</h2>
          <p className="text-lg ic-muted max-w-3xl mx-auto mb-8">
            True per-seat pricing: you pay for supervised users, not for modules you never activate. No hidden fees, no lock-in.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-4 ic-card rounded-full p-1 border border">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'monthly'
                  ? 'ic-btn-primary shadow-sm'
                  : 'ic-muted hover:ic-heading'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'annual'
                  ? 'ic-btn-primary shadow-sm'
                  : 'ic-muted hover:ic-heading'
              }`}
            >
              Annual <span className="text-xs text-cyber-green ml-1">Save 20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, i) => {
            const displayPrice = formatSeatPrice(plan.seatPrice);
            
            const priceLabel = plan.seatPrice !== null ? `/seat/mo · from ${plan.minSeats} seats` : '';

            return (
              <div key={i} className={`relative ic-card border-2 rounded-3xl p-8 transition-all hover:scale-105 ${
                plan.popular ? ' ' : 'border'
              }`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full ic-btn-primary text-xs font-bold">
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-2xl font-bold ic-heading mb-2">{plan.tier}</h3>
                <div className="mb-2">
                  <span className="text-4xl font-black ic-hero-title">
                    {displayPrice}
                  </span>
                  {plan.seatPrice !== null && (
                    <span className="text-sm ic-muted ml-2">{priceLabel}</span>
                  )}
                </div>
                {billingCycle === 'annual' && plan.seatPrice !== null && (
                  <p className="text-xs text-cyber-green mb-4">
                    Billed annually — save 20% vs $${plan.seatPrice}/seat/mo monthly
                  </p>
                )}
                <p className="text-sm ic-muted mb-6">{plan.desc}</p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm ic-text">
                      <CheckCircle2 className="w-4 h-4 ic-link flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button className={`w-full px-4 py-3 rounded-xl font-semibold transition-all ${
                  plan.popular
                    ? 'ic-btn-primary'
                    : 'ic-chip-warn ic-text hover:ic-chip-warn'
                }`}>
                  {plan.seatPrice === null ? 'Contact Sales' : 'Start per-seat trial'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
