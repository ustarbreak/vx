import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
// Pricing V2 — the v1 card grid is DELETED. The full public pricing page
// (packs + estimator) lives at route /pricing. NOTE: the app uses HashRouter,
// so raw `href="#/pricing"` anchors are invisible to the router (they only
// move the hash and leave the home page rendered — this was the "click does
// nothing" bug). All links below use <Link>, which updates the hash correctly.
// This landing section is only a teaser; it NEVER hardcodes prices — every
// figure comes from PRICING_CONFIG_V2 (src/data/pricingConfig.ts), the single
// source of truth mirrored by backend/app/services/pricing_engine.py.
import { PRICING_CONFIG_V2, fmtMad } from '../../data/pricingConfig';

export default function PricingSection() {
  const packs = PRICING_CONFIG_V2.packs;
  return (
    <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto text-center">
        <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">Tarifs</p>
        <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">
          Un prix par unité-service. Tout inclus.
        </h2>
        <p className="text-lg ic-muted max-w-3xl mx-auto mb-10">
          Trois packs simples, facturés par unité-service (actif lourd = 1, actif léger = 0,5) :{' '}
          Starter dès {fmtMad(packs.starter.price)}, Pro dès {fmtMad(packs.pro.price)} et Souverain dès{' '}
          {fmtMad(packs.souverain.price)} MAD HT/mois. Besoin d’un plan sur mesure ? Construisez-le avec notre
          équipe — à partir de {fmtMad(PRICING_CONFIG_V2.custom.floor)} MAD par actif et par mois.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold ic-btn-primary transition-all"
          >
            <ShieldCheck className="w-5 h-5" />
            Voir les packs et l’estimateur
            <ArrowRight className="w-5 h-5" />
          </Link>
          <a
            href="#/health-check"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border ic-text hover:ic-heading transition-all"
            style={{ borderColor: 'var(--ic-border)' }}
          >
            Bilan de sécurité gratuit — 30 jours
          </a>
        </div>
        <p className="text-xs ic-muted mt-8 max-w-2xl mx-auto">
          Prix en dirhams marocains (MAD), hors TVA ({Math.round(PRICING_CONFIG_V2.vat * 100)} % appliquée sur le total).
          Grille tarifaire version {PRICING_CONFIG_V2.version}.
        </p>
      </div>
    </section>
  );
}
