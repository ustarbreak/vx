// ---------------------------------------------------------------------------
// /customer-stories — "Customer Stories" page (Why Infracentra menu).
// Full-length stories built from the testimonials & client list already on
// the landing page (Damanecash, Valoris System, Vivalis Salaf, Galenica) —
// same people, same claims, expanded into context / approach / results.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { Quote, ArrowRight, Landmark, Server, HeartPulse, Banknote } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';

const STORIES = [
  {
    id: 'damanecash', icon: Landmark, sector: 'Fintech / Paiement', company: 'Damanecash',
    person: 'Y. El Amrani — Directeur des Systèmes d’Information',
    context: 'Acteur du paiement en ligne : tolérance au risque nulle, obligations de disponibilité et de traçabilité envers les banques partenaires.',
    approach: 'Supervision temps réel de tout le SI, corrélation SIEM des flux applicatifs et ticketing avec SLA contractualisés ; incidents de production escaladés avec audit trail complet.',
    results: ['MTTR divisé par trois depuis le déploiement', 'Visibilité temps réel sur l’ensemble du SI', 'SLA de réponse mesurés et facturés'],
    quote: 'Infracentra nous donne une visibilité temps réel sur tout notre SI et un ticketing avec SLA qui tient vraiment ses engagements.',
  },
  {
    id: 'valoris', icon: Server, sector: 'Éditeur de logiciels', company: 'Valoris System',
    person: 'K. Chraibi — Responsable Infrastructure',
    context: 'Éditeur hébergeant les données de ses propres clients : la conformité de Valoris est jugée par ses clients à chaque audit.',
    approach: 'Rapports de conformité automatisés (ISO 27001, RGPD) générés nativement par la plateforme ; auto-découverte pour cartographier les datacenters ; SOC externalisé sans recruter d’équipe interne.',
    results: ['Cartographie des datacenters en une journée', 'Preuves de conformité livrées en continu', 'Aucun recrutement de SOC interne nécessaire'],
    quote: 'La plateforme nous permet de prouver notre conformité avec des rapports automatisés, sans recruter un SOC interne.',
  },
  {
    id: 'vivalis', icon: Banknote, sector: 'Finance participative', company: 'Vivalis Salaf',
    person: 'H. Tazi — DSI',
    context: 'PME de la finance participative : exigences bancaires, moyens d’une PME — le modèle « usine à gaz » était exclu.',
    approach: 'Modèle pay-per-seat : la plateforme grandit avec le parc. Sécurité des messageries anti-phishing et playbooks SOAR automatiques en service managé.',
    results: ['Coût aligné sur les sièges réellement supervisés', 'Phishing détecté et traité automatiquement', 'Triage IA : moins de bruit, plus d’incidents réels traités'],
    quote: 'Le modèle pay-per-seat change tout : on ne paie que pour ce qu’on utilise. Les playbooks automatiques font le travail d’une équipe complète.',
  },
  {
    id: 'galenica', icon: HeartPulse, sector: 'Santé / Pharmacie', company: 'Galenica',
    person: 'N. Benali — RSSI',
    context: 'Données de santé sensibles : trajectoire de preuves irréprochable exigée par les auditeurs et les autorités.',
    approach: 'Moteur de notifications, audit trail inaltérable et rapports de conformité continus ; IA de triage pour filtrer le bruit avant qu’il n’atteigne l’équipe sécurité.',
    results: ['Des mois d’audit gagnés sur la préparation', 'Traçabilité complète des événements et réponses', 'Alertes triées par IA avant escalade humaine'],
    quote: 'L’audit trail et les rapports de conformité nous ont fait gagner des mois d’audit. L’IA de triage réduit efficacement le bruit des alertes.',
  },
];

export default function CustomerStoriesPage() {
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="ic-badge mb-4 inline-flex items-center gap-1"><Quote className="w-3.5 h-3.5" /> Histoires clients</span>
          <h1 className="text-4xl sm:text-5xl font-bold ic-heading max-w-3xl">Ce que la plateforme change, raconté par ceux qui la pilotent</h1>
          <p className="mt-4 text-lg ic-muted max-w-2xl">Quatre secteurs exigeants, quatre DSI/RSSI, une même méthode : superviser, détecter, répondre — avec la preuve à chaque étape.</p>
        </section>

        {STORIES.map((s, i) => (
          <section key={s.id} id={s.id} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${i % 2 ? '' : ''} pb-14`}>
            <div className="ic-card p-6 md:p-8 grid lg:grid-cols-2 gap-8">
              <div>
                <div className="flex items-center gap-3">
                  <s.icon className="w-8 h-8" style={{ color: 'var(--ic-primary)' }} />
                  <div>
                    <h2 className="text-xl font-bold ic-heading">{s.company}</h2>
                    <p className="text-xs ic-muted">{s.sector} · {s.person}</p>
                  </div>
                </div>
                <h3 className="mt-5 text-sm font-semibold ic-heading uppercase tracking-wide">Contexte</h3>
                <p className="mt-1 text-sm ic-muted">{s.context}</p>
                <h3 className="mt-4 text-sm font-semibold ic-heading uppercase tracking-wide">Notre approche</h3>
                <p className="mt-1 text-sm ic-muted">{s.approach}</p>
              </div>
              <div className="flex flex-col">
                <h3 className="text-sm font-semibold ic-heading uppercase tracking-wide">Résultats</h3>
                <ul className="mt-2 space-y-2">
                  {s.results.map((r, j) => (
                    <li key={j} className="text-sm ic-muted flex gap-2"><ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />{r}</li>
                  ))}
                </ul>
                <blockquote className="mt-auto pt-5 border-t text-sm italic ic-heading" style={{ borderColor: 'var(--ic-border)' }}>
                  «&nbsp;{s.quote}&nbsp;»
                </blockquote>
              </div>
            </div>
          </section>
        ))}

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 text-center">
          <div className="ic-card p-8">
            <h3 className="text-xl font-bold ic-heading">Votre secteur ressemble à l’un de ceux-ci&nbsp;?</h3>
            <p className="mt-2 text-sm ic-muted">Le Diagnostic de sécurité gratuit montre, sur votre propre parc, ce que ces clients ont vu en production.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link to="/health-check" className="ic-btn-primary px-6 py-3 inline-flex items-center gap-2">Démarrer le diagnostic gratuit <ArrowRight className="w-5 h-5" /></Link>
              <a href="#/#clients" className="ic-btn-outline px-6 py-3">Tous les clients</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
