import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
// Single source of truth for prices — NEVER hardcode numbers here.
// Mirrors backend/app/core/pricing.py (STARTER 450 DH · PRO 450 DH · SOUVERAIN 350 DH per asset/month HT)
import { TIER_LIMITS, unitPrice, ANNUAL_MULTIPLIER, type PlanTier } from '../../config/pricing';

interface BundlePlan {
  tier: PlanTier;
  name: string;
  tagline: string;
  features: string[];
  popular?: boolean;
}

const PLANS: BundlePlan[] = [
  {
    tier: 'STARTER',
    name: 'Starter',
    tagline: 'All 16 security modules, billed per managed asset — perfect for small estates.',
    features: [
      'Bundle All-in-One : les 16 modules inclus',
      'Monitoring agents goinfra (Linux & Windows)',
      'Auto-discovery réseau + SNMP',
      'Alerting & ticketing automatiques',
      'SIEM : 10 Go/jour d\'ingestion inclus',
      '3 sièges techniciens inclus (+250 DH/siège extra)',
      'Support standard',
    ],
  },
  {
    tier: 'PRO',
    name: 'Pro',
    popular: true,
    tagline: 'Everything in Starter with more SIEM headroom and a bigger tech team.',
    features: [
      'Everything in Starter',
      'SIEM : 50 Go/jour d\'ingestion inclus',
      '20 sièges techniciens inclus (+250 DH/siège extra)',
      'Dashboards multi-sites & rapports illimités',
      'Playbooks d\'automatisation',
      'Accès API complet',
      'Support prioritaire',
    ],
  },
  {
    tier: 'SOUVERAIN',
    name: 'Souverain',
    tagline: 'Sovereign on-premise deployment at the best rate — unlimited seats.',
    features: [
      'Everything in Pro',
      'Déploiement on-premise / souverain chez vous',
      'SIEM : 150 Go/jour d\'ingestion inclus',
      'Sièges techniciens illimités (0 supplément)',
      'Export des données & conformité réglementaire',
      'CSM dédié + SLA garanti',
      'Maintenance et mises à jour incluses',
    ],
  },
];

export default function PricingSection() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const cycle: 'MONTHLY' | 'ANNUAL' = billingCycle === 'annual' ? 'ANNUAL' : 'MONTHLY';

  return (
    <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">One Price Per Asset. Everything Included.</h2>
          <p className="text-lg ic-muted max-w-3xl mx-auto mb-8">
            True per-asset pricing: every server, workstation, firewall or switch under management costs a
            flat monthly rate — all 16 security modules included. No hidden fees, no module lock-in.
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
              Annual <span className="text-xs text-cyber-green ml-1">Save 12%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {PLANS.map((plan, i) => {
            const limits = TIER_LIMITS[plan.tier];
            const price = unitPrice(plan.tier, cycle);           // MAD HT / asset / month
            const base = limits.unitPriceMad;                    // monthly catalogue price

            return (
              <div key={i} className={`relative ic-card border-2 rounded-3xl p-8 transition-all hover:scale-105 ${
                plan.popular ? ' ' : 'border'
              }`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full ic-btn-primary text-xs font-bold">
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-2xl font-bold ic-heading mb-2">{plan.name}</h3>
                <div className="mb-2">
                  <span className="text-4xl font-black ic-hero-title">
                    {price} DH
                  </span>
                  <span className="text-sm ic-muted ml-2">/asset/mo · HT</span>
                </div>
                {billingCycle === 'annual' && (
                  <p className="text-xs text-cyber-green mb-4">
                    Billed annually — save 12% vs {base} DH/asset/mo monthly
                  </p>
                )}
                {billingCycle === 'monthly' && (
                  <p className="text-xs ic-muted mb-4">
                    Annual commitment: {Math.round(base * ANNUAL_MULTIPLIER)} DH/asset/mo (−12%)
                  </p>
                )}
                <p className="text-sm ic-muted mb-6">{plan.tagline}</p>
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
                  Start per-asset trial
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs ic-muted mt-10 max-w-3xl mx-auto">
          Example: 50 assets on Pro = 50 × {unitPrice('PRO', cycle)} DH/month HT. Extra technician seats
          (Starter/Pro): 250 DH/month each. SIEM overage: 15 DH/GB/day (Pro) · 10 DH/GB/day (Souverain).
          Prices shown in Moroccan Dirham (HT); EUR/USD conversion is applied automatically per account country.
        </p>
      </div>
    </section>
  );
}
