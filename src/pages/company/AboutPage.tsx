// ---------------------------------------------------------------------------
// /about — "About Us" page for the Why Infracentra menu. Company story,
// mission, values and facts. Facts stay consistent with the landing page
// (Moroccan cybersecurity expert, unified SecOps platform, Moroccan data
// sovereignty). No invented certifications or figures beyond what the rest
// of the site already claims.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { Globe2, ShieldCheck, Users, Zap, MapPin, Eye, HeartHandshake, ArrowRight, Building2 } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';

export default function AboutPage() {
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        {/* hero */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="ic-badge mb-4 inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> À propos</span>
          <h1 className="text-4xl sm:text-5xl font-bold ic-heading max-w-3xl">
            L’expertise marocaine de la cybersécurité, réunie dans une seule plateforme
          </h1>
          <p className="mt-4 text-lg ic-muted max-w-2xl">
            Infracentra est un éditeur et opérateur marocain de services SecOps. Nous concevons
            et exploitons une plateforme unifiée — supervision, détection, réponse, conformité —
            hébergée au Maroc, pensée pour les entreprises et les MSP qui veulent une sécurité
            sérieuse sans usine à gaz.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo-request" className="ic-btn-primary px-6 py-3 inline-flex items-center gap-2">Discuter avec nous <ArrowRight className="w-5 h-5" /></Link>
            <Link to="/mssp" className="ic-btn-outline px-6 py-3 inline-flex items-center gap-2">Espace partenaire</Link>
          </div>
        </section>

        {/* mission / vision / facts */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 grid md:grid-cols-3 gap-5">
          {[
            { icon: Eye, title: 'Notre mission', text: 'Rendre la sécurité opérationnelle accessible : un prix par actif supervisé, des SLA mesurés, des preuves auditables — pas un catalogue de vingt produits à intégrer soi-même.' },
            { icon: MapPin, title: 'Souveraineté des données', text: 'Plateforme et données hébergées au Maroc, exploitation par des équipes locales. Le pack Souverain pousse l’exigence jusqu’à la pile logicielle ouverte maîtrisée.' },
            { icon: Zap, title: 'Une plateforme, pas sept', text: 'SIEM, corrélation IA, SOAR, ticketing, sauvegarde, conformité : tout est nativement intégré, donc un seul agent, un seul tableau de bord, une seule facture.' },
          ].map((c, i) => (
            <div key={i} className="ic-card p-6">
              <c.icon className="w-7 h-7 mb-3" style={{ color: 'var(--ic-primary)' }} />
              <h3 className="font-bold ic-heading">{c.title}</h3>
              <p className="mt-2 text-sm ic-muted">{c.text}</p>
            </div>
          ))}
        </section>

        {/* who we serve */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <h2 className="text-2xl font-bold ic-heading mb-6">Qui nous accompagnons</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: Building2, label: 'Fintech & paiement', text: 'Tolérance au risque zéro, supervision temps réel et SLA contractuels (ex. Damanecash).' },
              { icon: ShieldCheck, label: 'Santé & pharma', text: 'Traçabilité et rapports de conformité pour données sensibles (ex. Galenica).' },
              { icon: Globe2, label: 'Industrie & utilities', text: 'Supervision IT/OT-safe des environnements de production (ex. HydroPlus).' },
              { icon: Users, label: 'MSP & revendeurs', text: 'Programme white-label MSSP : votre marque, notre plateforme, votre marge.' },
            ].map((c, i) => (
              <div key={i} className="ic-card p-5">
                <c.icon className="w-6 h-6 mb-2" style={{ color: 'var(--ic-primary)' }} />
                <h4 className="font-semibold ic-heading">{c.label}</h4>
                <p className="mt-1 text-sm ic-muted">{c.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* values */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <h2 className="text-2xl font-bold ic-heading mb-6">Nos engagements</h2>
          <ul className="grid sm:grid-cols-2 gap-4 text-sm">
            {[
              'Transparence tarifaire : les règles de prix sont publiées, les remises partenaires sont automatiques et plafonnées.',
              'Preuve avant discours : chaque service livré génère des rapports et un audit trail consultables par le client.',
              'Canal partenaire d’abord : deal registration protégée, onboarding laissé au MSP, aucune vente directe concurrente sur un dossier enregistré.',
              'Nommage white-label : au client final, seules des catégories de service apparaissent — jamais les technologies sous-jacentes.',
            ].map((v, i) => (
              <li key={i} className="ic-card p-4 flex gap-3">
                <HeartHandshake className="w-5 h-5 shrink-0" style={{ color: 'var(--ic-primary)' }} />
                <span className="ic-muted">{v}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* CTA */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 text-center">
          <div className="ic-card p-8">
            <h3 className="text-xl font-bold ic-heading">Envie d’en savoir plus sur l’équipe et les références&nbsp;?</h3>
            <p className="mt-2 text-sm ic-muted">Parlez-en avec un ingénieur — 30 minutes, sans slides génériques.</p>
            <Link to="/demo-request?intent=demo" className="ic-btn-primary px-6 py-3 mt-4 inline-flex items-center gap-2">Prendre rendez-vous <ArrowRight className="w-5 h-5" /></Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
