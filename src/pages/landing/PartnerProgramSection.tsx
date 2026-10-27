// ---------------------------------------------------------------------------
// ONLINE VS ONSITE SERVICES + PARTNER PROGRAM (replaces the old broken
// PartnersSection, which referenced non-existent vendor SVGs like
// /logos/fortinet.svg — those unverified vendor claims are removed).
//  • Service comparison uses the real catalog split from servicesData.ts.
//  • Partner tiers come from PRICING_CONFIG_V2.partner.tiers (single source
//    of truth — discounts are actual configured values, not invented).
//  • /partners.png (1672×941 ecosystem artwork) framed with contain-safe
//    cover crop preserving the central connection cluster.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, HardDrive, ArrowRight, Users, TrendingUp, Network, ShieldCheck } from 'lucide-react';
import { Reveal, SectionHeading } from './lxPrimitives';
import { PRICING_CONFIG_V2 } from '../../data/pricingConfig';

const ONLINE = [
  'Supervision & protection des terminaux',
  'Scan de vulnérabilités continu',
  'Sécurité des messageries',
  'Rapports de conformité',
  'Threat intelligence & analytics',
  'SIEM & journalisation centralisée',
];
const ONSITE = [
  'Déploiement sur site / air-gapped',
  'Gestion firewall & réseau (pfSense)',
  'Sauvegarde et plan de reprise (on-prem)',
  'Gestion des correctifs en environnement local',
  'Audit & pentest sur place',
  'Ingénieur dédié & support terrain',
];

const TIER_LABEL: Record<string, string> = {
  registered: 'Registered', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};

export default function PartnerProgramSection() {
  const tiers = PRICING_CONFIG_V2.partner.tiers;
  return (
    <>
      {/* ---------------- Online vs Onsite ---------------- */}
      <section id="services-delivery" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <SectionHeading
            eyebrow="Delivery Models"
            title={<>Online services &amp; <span style={{ color: 'var(--lx-cyan)' }}>on-site operations</span></>}
            subtitle="Monitor and secure from the platform — or deploy Infracentra engineers and on-premise components where your environment requires it."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              { icon: Globe, title: 'Online / SaaS-delivered', items: ONLINE, featured: false },
              { icon: HardDrive, title: 'Offline / On-site', items: ONSITE, featured: true },
            ].map((col, i) => (
              <Reveal key={col.title} delay={i * 100}>
                <div className={`ic-lx-card p-8 h-full ${col.featured ? 'ic-lx-plan-featured' : ''}`}>
                  <div className="flex items-center gap-3 mb-6">
                    <span className="p-2.5 rounded-xl" style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid var(--lx-border)' }}>
                      <col.icon className="w-5 h-5" style={{ color: 'var(--lx-cyan)' }} />
                    </span>
                    <h3 className="text-lg font-bold ic-lx-h">{col.title}</h3>
                  </div>
                  <ul className="space-y-3 list-none">
                    {col.items.map((s) => (
                      <li key={s} className="flex items-start gap-3 text-sm ic-lx-text2">
                        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--lx-cyan)' }} />{s}
                      </li>
                    ))}
                  </ul>
                  <Link to="/pricing" className="inline-flex items-center gap-2 mt-6 text-sm font-semibold hover:underline" style={{ color: 'var(--lx-cyan)' }}>
                    Compare plans <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Partner program ---------------- */}
      <section id="partners" className="ic-lx-textured py-24 px-4 sm:px-6 lg:px-8" style={{ background: 'var(--lx-bg-2)' }}>
        <div className="max-w-7xl mx-auto">
          <SectionHeading
            eyebrow="Partner Program"
            title={<>Build a security business on <span style={{ color: 'var(--lx-cyan)' }}>Infracentra</span></>}
            subtitle="MSSPs and MDR providers deliver white-label SOC-as-a-Service from one multi-tenant platform. Tier benefits follow the published partner configuration."
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center mb-14">
            <Reveal>
              <figure className="ic-lx-frame">
                <div style={{ aspectRatio: '1672 / 941', overflow: 'hidden' }}>
                  <img src="/partners.png" alt="Connected partner ecosystem artwork" width={1672} height={941}
                    loading="lazy" decoding="async" className="w-full h-full"
                    style={{ objectFit: 'cover', objectPosition: 'center' }} />
                </div>
                <figcaption className="px-5 py-3 text-xs ic-lx-muted border-t" style={{ borderColor: 'var(--lx-border)' }}>
                  Illustrative ecosystem artwork — partner relationships shown individually upon verification.
                </figcaption>
              </figure>
            </Reveal>
            <Reveal delay={100}>
              <ul className="space-y-4 list-none">
                {[
                  { icon: Users, t: 'White-label portals', d: 'Partner-branded client portals, licensing and margin management.' },
                  { icon: TrendingUp, t: 'Deal registration', d: `Bonus points on registered deals (${Math.round(PRICING_CONFIG_V2.partner.dealRegistrationBonus.points * 100)}% over ${PRICING_CONFIG_V2.partner.dealRegistrationBonus.months} months).` },
                  { icon: Network, t: 'Onboarding waived', d: 'Partner contracts include waived onboarding fees per program rules.' },
                ].map((b, i) => (
                  <li key={i} className="ic-lx-card p-5 flex items-start gap-4">
                    <b.icon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--lx-cyan)' }} />
                    <div><p className="font-semibold ic-lx-h text-sm">{b.t}</p><p className="text-sm ic-lx-muted mt-1">{b.d}</p></div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Real tier configuration from PRICING_CONFIG_V2 */}
          <Reveal delay={150}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {tiers.map((t) => (
                <div key={t.id} className={`ic-lx-card p-6 text-center ${t.id === 'gold' ? 'ic-lx-plan-featured' : ''}`}>
                  <p className="text-xs uppercase tracking-widest ic-lx-muted mb-2">{TIER_LABEL[t.id] || t.id}</p>
                  <p className="text-4xl font-extrabold mb-1" style={{ color: 'var(--lx-cyan)' }}>{Math.round(t.discount * 100)}%</p>
                  <p className="text-xs ic-lx-text2 mb-2">partner discount</p>
                  <p className="text-[11px] ic-lx-muted">{t.minManagedUnits > 0 ? `from ${t.minManagedUnits.toLocaleString()} managed units` : 'entry level'}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-xs ic-lx-muted mt-5">
              Discounts capped at {Math.round(PRICING_CONFIG_V2.partner.totalDiscountCap * 100)}% total per program terms. Volume discounts do not apply to partner pricing.
            </p>
            <div className="text-center mt-8">
              <Link to="/mssp" className="ic-lx-btn-primary px-8 py-3.5 text-sm">
                Join the partner program <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
