// ---------------------------------------------------------------------------
// DIAGNOSTIC DE SÉCURITÉ GRATUIT — /health-check
// Public landing page for the free security health check. All rules come from
// PRICING_CONFIG_V2.healthCheck (single source of truth — never hardcoded
// here): duration, max supervised units, read-only grace period after the
// trial, and the one-active-diagnostic-per-e-mail-domain rule.
// CTA routes to the demo-request form pre-tagged with intent=health-check.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Clock, Server, Eye, Mail, ArrowRight, CheckCircle2, Search, FileSearch,
} from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';
import { PRICING_CONFIG_V2, fmtMad } from '../../data/pricingConfig';

const HC = PRICING_CONFIG_V2.healthCheck;

const RULES = [
  {
    icon: Clock,
    title: `${HC.days} jours gratuits`,
    text: `Le diagnostic tourne pendant ${HC.days} jours, sans carte bancaire et sans engagement.`,
  },
  {
    icon: Server,
    title: `Jusqu'à ${HC.maxUnits} unités-service`,
    text: `Vos serveurs, postes et équipements réseau légers sont inventoriés et analysés dans la limite de ${HC.maxUnits} unités.`,
  },
  {
    icon: Eye,
    title: 'Accès en lecture seule',
    text: `À l'issue des ${HC.days} jours, vos données restent consultables ${HC.graceReadOnlyDays} jours en lecture seule — rien n'est supprimé immédiatement.`,
  },
  {
    icon: Mail,
    title: 'Un diagnostic par domaine e-mail',
    text: `Un seul diagnostic actif à la fois par domaine e-mail ; un nouveau diagnostic est possible après ${HC.oneActivePerEmailDomainDays} jours.`,
  },
];

const STEPS = [
  {
    icon: FileSearch,
    title: '1. Demande de diagnostic',
    text: 'Vous remplissez le formulaire ci-dessous : périmètre approximatif, secteur, contact technique.',
  },
  {
    icon: Search,
    title: '2. Collect non intrusive',
    text: 'Nos agents légers et connecteurs lisent l’existant (inventaire, journaux, configurations) sans modifier votre infrastructure.',
  },
  {
    icon: ShieldCheck,
    title: '3. Rapport priorisé',
    text: 'Vous recevez une cartographie des risques classés par criticité, avec les corrections recommandées et une estimation sur nos packs.',
  },
];

export default function HealthCheckPage() {
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        {/* hero */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full border" style={{ borderColor: 'var(--ic-border)', color: 'var(--ic-primary)' }}>
            <ShieldCheck className="w-3.5 h-3.5" /> Diagnostic gratuit — {HC.days} jours
          </span>
          <h1 className="mt-5 text-4xl sm:text-5xl font-bold ic-heading max-w-3xl mx-auto">
            Votre diagnostic de sécurité, offert et sans engagement
          </h1>
          <p className="mt-4 text-lg ic-muted max-w-2xl mx-auto">
            En {HC.days} jours, Infracentra cartographie vos actifs, détecte vos vulnérabilités
            exposées et hiérarchise les risques réels de votre infrastructure — avant tout achat.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/demo-request?intent=health-check" className="ic-btn-primary px-6 py-3 text-base inline-flex items-center gap-2">
              Demander mon diagnostic <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/pricing#estimateur" className="ic-btn-outline px-6 py-3 text-base inline-flex items-center gap-2">
              Estimer après le diagnostic
            </Link>
          </div>
          <p className="mt-4 text-xs ic-muted">Aucune carte bancaire requise. Prix indicatifs en MAD hors taxes.</p>
        </section>

        {/* rules */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <h2 className="text-2xl font-bold ic-heading">Comment fonctionne le diagnostic&nbsp;?</h2>
          <p className="mt-1 text-sm ic-muted max-w-2xl">Des règles simples et transparentes, les mêmes pour tous nos clients.</p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {RULES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="ic-card p-5">
                <Icon className="w-6 h-6" style={{ color: 'var(--ic-primary)' }} />
                <h3 className="mt-3 font-bold ic-heading">{title}</h3>
                <p className="mt-1.5 text-sm ic-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* steps */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="ic-card p-6 sm:p-8">
            <h2 className="text-2xl font-bold ic-heading">Trois étapes, une semaine tout au plus</h2>
            <div className="mt-6 grid md:grid-cols-3 gap-6">
              {STEPS.map(({ icon: Icon, title, text }) => (
                <div key={title}>
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 shrink-0" style={{ color: 'var(--ic-primary)' }} />
                    <h3 className="font-semibold ic-heading text-sm">{title}</h3>
                  </div>
                  <p className="mt-2 text-sm ic-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* what you get */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div>
              <h2 className="text-2xl font-bold ic-heading">Ce que vous recevez</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {[
                  'Inventaire complet et pondéré de vos actifs (unités-service)',
                  'Scan de vulnérabilités continu sur le périmètre autorisé',
                  'Analyse des journaux SIEM pendant toute la période du diagnostic',
                  'Cartographie des risques classés par criticité (critique / élevé / moyen)',
                  'Rapport de conformité initial (état des lieux, écarts détectés)',
                  `Estimation tarifaire sur nos packs — Starter dès ${fmtMad(PRICING_CONFIG_V2.packs.starter.price)} MAD HT/unité`,
                ].map((t) => (
                  <li key={t} className="flex gap-2 items-start">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--ic-primary)' }} />
                    <span className="ic-muted">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ic-card p-6">
              <h3 className="font-bold ic-heading text-lg">Et après le diagnostic&nbsp;?</h3>
              <p className="mt-2 text-sm ic-muted">
                Vous gardez la main&nbsp;: aucune reconduction automatique. Vos données restent
                accessibles {HC.graceReadOnlyDays} jours en lecture seule le temps de décider, puis
                sont archivées ou supprimées sur votre demande.
              </p>
              <div className="mt-5 space-y-2">
                <Link to="/demo-request?intent=health-check" className="ic-btn-primary px-5 py-2.5 text-sm block text-center">
                  Démarrer le diagnostic gratuit
                </Link>
                <Link to="/pricing" className="ic-btn-outline px-5 py-2.5 text-sm block text-center">
                  Comparer les packs
                </Link>
              </div>
              <p className="mt-4 text-xs ic-muted">
                Un seul diagnostic actif par domaine e-mail ({HC.oneActivePerEmailDomainDays} jours de carence entre deux diagnostics).
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
