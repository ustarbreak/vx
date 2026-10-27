// ---------------------------------------------------------------------------
// /recognition — "Industry Recognition" page (Why Infracentra menu).
// Ecosystem alliances already claimed on the landing/partner sections
// (Fortinet, Microsoft, CrowdStrike alliances + open-standards stack) plus
// how those alliances translate into delivered value. No fabricated awards.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Award, BadgeCheck, ArrowRight, HeartHandshake } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';

const ALLIANCES = [
  { name: 'Fortinet', desc: 'Intégration pare-feu et gestion multi-vendeur : la plateforme supervise, corrèle les événements et pilote les politiques FortiGate au quotidien.' },
  { name: 'Microsoft', desc: 'Connecteurs identité et messagerie (Entra ID / M365) : journalisation des tenantes, sécurité des boîtes aux lettres et réponse aux incidents de compte.' },
  { name: 'CrowdStrike', desc: 'Approche « bring-your-own-EDR » : nous n’imposons pas un agent, nous orchestrons celui que vous avez — enrichissement, triage IA et containment pilotés depuis Infracentra.' },
];

const STANDARDS = [
  { icon: BadgeCheck, title: 'Cartes de conformité intégrées', text: 'Les rapports couvrent les référentiels attendus par les auditeurs marocains et européens : ISO 27001, NIST, SOC 2 et RGPD — evidences générées en continu, pas la veille de l’audit.' },
  { icon: ShieldCheck, title: 'Pile ouverte maîtrisée', text: 'Le pack Souverain s’appuie sur des composants ouverts auditables, hébergés au Maroc et exploités par nos équipes — la reconnaissance du marché vient de ce que le client peut vérifier.' },
  { icon: HeartHandshake, title: 'Écosystème partenaire vivant', text: 'Programme MSP white-label, alliances éditeurs et partenariats cyber-assurance : notre reconnaissance se mesure aussi au nombre de canaux qui revendent la plateforme.' },
];

export default function RecognitionPage() {
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="ic-badge mb-4 inline-flex items-center gap-1"><Award className="w-3.5 h-3.5" /> Reconnaissance sectorielle</span>
          <h1 className="text-4xl sm:text-5xl font-bold ic-heading max-w-3xl">
            Des alliances d’éditeurs majeurs, transformées en services livrés
          </h1>
          <p className="mt-4 text-lg ic-muted max-w-2xl">
            Nous ne collectons pas des logos pour une page marketing : chaque alliance se traduit
            par un connecteur, un playbook ou une carte de conformité réellement utilisés par nos
            clients et nos partenaires.
          </p>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="grid md:grid-cols-3 gap-5">
            {ALLIANCES.map(a => (
              <div key={a.name} className="ic-card p-6">
                <BadgeCheck className="w-7 h-7 mb-3" style={{ color: 'var(--ic-primary)' }} />
                <h3 className="font-bold ic-heading text-lg">{a.name}</h3>
                <p className="mt-2 text-sm ic-muted">{a.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <h2 className="text-2xl font-bold ic-heading mb-6">Ce que le marché reconnaît</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {STANDARDS.map(s => (
              <div key={s.title} className="ic-card p-6">
                <s.icon className="w-7 h-7 mb-3" style={{ color: 'var(--ic-primary)' }} />
                <h3 className="font-bold ic-heading">{s.title}</h3>
                <p className="mt-2 text-sm ic-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <div className="ic-card p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold ic-heading flex items-center gap-2"><HeartHandshake className="w-5 h-5" style={{ color: 'var(--ic-primary)' }} /> Vous êtes éditeur, intégrateur ou assureur&nbsp;?</h3>
              <p className="mt-1 text-sm ic-muted">Discutons d’un partenariat technologique ou canal — les alliances Infracentra commencent toutes par un pilote client.</p>
            </div>
            <Link to="/demo-request?intent=partner" className="ic-btn-primary px-6 py-3 shrink-0 inline-flex items-center gap-2">Proposer un partenariat <ArrowRight className="w-5 h-5" /></Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
