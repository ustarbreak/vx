// ---------------------------------------------------------------------------
// /find-a-partner — public directory-style entry point for the MSP channel.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowRight, Layers, Percent, ShieldCheck, Globe2, Building2 } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';
import { PRICING_CONFIG_V2 as CFG } from '../../data/pricingConfig';

export default function FindPartnerPage() {
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="ic-badge mb-4 inline-flex items-center gap-1"><Search className="w-3.5 h-3.5" /> Trouver un partenaire</span>
          <h1 className="text-4xl sm:text-5xl font-bold ic-heading max-w-3xl">
            Faites-vous accompagner par un partenaire Infracentra — ou devenez-en un
          </h1>
          <p className="mt-4 text-lg ic-muted max-w-2xl">
            Notre canal MSP travaille partout au Maroc et en Afrique francophone : intégration,
            onboarding et support de proximité sous la marque de votre partenaire, avec la
            plateforme Infracentra derrière.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo-request?intent=partner" className="ic-btn-primary px-6 py-3 inline-flex items-center gap-2">Être mis en relation <ArrowRight className="w-5 h-5" /></Link>
            <Link to="/mssp" className="ic-btn-outline px-6 py-3 inline-flex items-center gap-2">Devenir partenaire</Link>
          </div>
        </section>

        {/* how to get a partner */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 grid md:grid-cols-3 gap-5">
          {[
            { icon: Search, title: '1 · Dites-nous où vous êtes', text: 'Indiquez votre ville, votre secteur et la taille de votre parc dans le formulaire de mise en relation : nous sélectionnons le partenaire dont l’expertise correspond.' },
            { icon: Building2, title: '2 · Un partenaire certifié vous contacte', text: 'Les partenaires du programme sont formés (académie Infracentra) et accrédités sur les packs qu’ils revendent — Découverte, Croissance ou Maximale.' },
            { icon: ShieldCheck, title: '3 · Vous gardez votre contrat clair', text: 'Contrat de service avec votre partenaire, SLA hérités de la plateforme, escalade technique Infracentra incluse. Un seul interlocuteur pour vous.' },
          ].map((c, i) => (
            <div key={i} className="ic-card p-6">
              <c.icon className="w-7 h-7 mb-3" style={{ color: 'var(--ic-primary)' }} />
              <h3 className="font-bold ic-heading">{c.title}</h3>
              <p className="mt-2 text-sm ic-muted">{c.text}</p>
            </div>
          ))}
        </section>

        {/* partner tiers teaser */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <h2 className="text-2xl font-bold ic-heading mb-2">Vous êtes MSP&nbsp;? Voici vos paliers</h2>
          <p className="text-sm ic-muted mb-6">Remise de gros automatique sur les unités gérées, plafonnée à {Math.round(CFG.partner.totalDiscountCap * 100)} % toutes remises confondues.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {CFG.partner.tiers.map(t => (
              <div key={t.id} className="ic-card p-5 text-center">
                <Percent className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--ic-primary)' }} />
                <h4 className="font-bold ic-heading capitalize">{t.id}</h4>
                <p className="mt-1 text-2xl font-mono font-bold" style={{ color: 'var(--ic-primary)' }}>−{Math.round(t.discount * 100)} %</p>
                <p className="text-xs ic-muted mt-1">dès {t.minManagedUnits === 0 ? 'la première' : ` ${t.minManagedUnits}+`} unité{t.minManagedUnits === 0 ? '' : ' gérée'}{t.minManagedUnits === 0 ? ' gérée' : ''}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/pricing?view=partner" className="ic-btn-outline px-5 py-2.5 inline-flex items-center gap-2"><Layers className="w-4 h-4" /> Grille partenaire & compositeur de packs</Link>
            <Link to="/mssp" className="ic-btn-outline px-5 py-2.5 inline-flex items-center gap-2"><Globe2 className="w-4 h-4" /> Programme complet (deal registration, white-label)</Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
