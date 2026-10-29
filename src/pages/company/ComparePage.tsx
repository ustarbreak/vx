// ---------------------------------------------------------------------------
// /compare/:rival — "vs <competitor>" comparison pages (Why Infracentra >
// Compare menu). One page, data-driven: Splunk Enterprise, Microsoft Sentinel,
// CrowdStrike Falcon, IBM QRadar. Claims stay aligned with the landing-page
// comparison section (cost of ingest, built-in SOAR/ticketing, BYO-EDR,
// deployment time) and the V2 pricing model. Category names only for our own
// stack (white-label rule); rivals are named because that is the point.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Check, X, Scale, Zap, ShieldCheck, Coins } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';

interface Rival {
  name: string; headline: string; intro: string;
  rows: { area: string; theirs: string; ours: string }[];
  strengths: string; // honest note on what the rival does well
}

export const RIVALS: Record<string, Rival> = {
  splunk: {
    name: 'vs Splunk Enterprise',
    headline: 'La même valeur SIEM, à environ un cinquième du coût d’ingestion',
    intro: 'Splunk est un excellent moteur de recherche sur logs — mais la facture suit le volume ingéré, licence comprise, et tout le reste (SOAR, ticketing, sauvegarde, conformité) s’achète et s’intègre séparément.',
    rows: [
      { area: 'Modèle de prix', theirs: 'Par volume de données ingérées + licences par composant', ours: 'Par unité supervisée, quotas de logs inclus dans le pack' },
      { area: 'Corrélation & IA de triage', theirs: 'Modules add-on à licencier', ours: 'Intégrés nativement (triage IA, dédup, enrichissement)' },
      { area: 'SOAR & ticketing', theirs: 'Produits séparés à assembler', ours: 'Playbooks et tickets SLA inclus dans la plateforme' },
      { area: 'Conformité', theirs: 'App(s) communautaire(s), maintenance à votre charge', ours: 'Cartes ISO 27001 / NIST / SOC 2 / RGPD générées en continu' },
      { area: 'Exploitation', theirs: 'Équipe interne ou intégrateur dédié', ours: 'Managé par Infracentra (ou par votre MSP partenaire)' },
      { area: 'Souveraineté des données', theirs: 'Hébergement à négocier', ours: 'Datacenter au Maroc, pile ouverte maîtrisée (pack Souverain)' },
    ],
    strengths: 'Si vous avez déjà une équipe Splunk certifiée et des volumes maîtrisés, nous savons cohabiter : connecteurs d’export et lecture de vos index existants sont possibles pendant la transition.',
  },
  sentinel: {
    name: 'vs Microsoft Sentinel',
    headline: 'Le SIEM cloud de Microsoft, sans l’usine à composants autour',
    intro: 'Sentinel s’appuie sur Log Analytics, des règles écrites à la main, un graphe de menace facturé en plus et un SOAR limité sans licence complémentaire. La note finale dépend surtout de votre volume et de votre temps d’ingénierie.',
    rows: [
      { area: 'Facturation', theirs: 'GB ingérés + rétention Log Analytics + graph add-on', ours: 'Un prix par unité, rétention et quotas inclus' },
      { area: 'Règles & contenu', theirs: 'À écrire et maintenir vous-même', ours: 'Pack de corrélations livré, triage IA par défaut' },
      { area: 'Automatisation', theirs: 'Playbooks logiques + licence supplémentaire', ours: 'SOAR intégré : containment terminal, blocage DNS/firewall' },
      { area: 'Ticketing SLA', theirs: 'Hors produit (DevOps/ITSM externes)', ours: 'Tickets, SLA et escalades natifs' },
      { area: 'Multi-tenant MSP', theirs: 'Workbook LTA à monter soi-même', ours: 'Portail white-label multi-clients inclus (programme partenaire)' },
    ],
    strengths: 'Vous êtes déjà tout en Microsoft 365 E5 ? Gardez vos licences : Infracentra ingère les journaux M365/Entra et orchestre la réponse — y compris sur Defender — sans vous forcer à déménager.',
  },
  crowdstrike: {
    name: 'vs CrowdStrike Falcon',
    headline: 'Nous n’imposons pas un agent de plus — nous orchestrons celui que vous avez',
    intro: 'Falcon est un leader de l’endpoint. Mais un agent ne voit que l’endpoint : le SIEM, le réseau, la messagerie, les sauvegardes, la conformité et le ticketing restent à financer et à exploiter ailleurs.',
    rows: [
      { area: 'Périmètre', theirs: 'Endpoint avant tout (modules server/identity cloud payants)', ours: 'Endpoint + réseau + messagerie + cloud + sauvegarde + conformité' },
      { area: 'Votre agent actuel', theirs: 'À remplacer pour bénéficier du plein SOC', ours: 'Bring-your-own-EDR : Falcon, Defender ou autre, piloté depuis la plateforme' },
      { area: 'Corrélation multi-sources', theirs: 'Dans Falcon LogScale, facturé au volume', ours: 'SIEM unifié inclus au prix de l’unité supervisée' },
      { area: 'Support local', theirs: 'Canal global, anglais dominant', ours: 'Équipes marocaines, français/arabe, SLA contractuels' },
      { area: 'Preuve client', theirs: 'Dashboards produit', ours: 'Rapports d’activité, MTTR mesurés et audit trail exportable' },
    ],
    strengths: 'Falcon reste un excellent choix d’agent : notre supervision terminale se branche dessus (isolation, remédiation pilotée) plutôt que de vous faire payer un agent redondant.',
  },
  qradar: {
    name: 'vs IBM QRadar',
    headline: 'Déployé en jours, pas en mois — et sans projet d’intégration',
    intro: 'QRadar est puissant mais historiquement lourd : appliances ou offres managées coûteuses, règles à paramétrer par intégrateur, cycles de mise à niveau longs. Le TCO réel est dominé par le projet, pas par le logiciel.',
    rows: [
      { area: 'Mise en service', theirs: 'Projet intégrateur de plusieurs semaines/mois', ours: 'Onboarding standard en quelques jours (par nous ou votre MSP)' },
      { area: 'Licences', theirs: 'EPS / flows à dimensionner, dépassements fréquents', ours: 'Quotas de logs par unité dans le pack, tarification prévisible' },
      { area: 'Extensions', theirs: 'Apps marketplace à maintenir', ours: 'Services natifs : SOAR, ticketing, sauvegarde, conformité' },
      { area: 'Équipe requise', theirs: 'Administrateurs dédiés QRadar', ours: 'Console unique, triage IA ; nos analystes en back-office' },
      { area: 'Évolutivité PME', theirs: 'Dimensionnement enterprise', ours: 'Dès 10 unités supervisées (pack Starter), montée linéaire' },
    ],
    strengths: 'Parc déjà couvert par QRadar ? Nous coexistons le temps du contrat : ingestion de vos flux EPS en parallèle, puis bascule progressive pack par pack.',
  },
};

const SLUGS = Object.keys(RIVALS);

export default function ComparePage() {
  const { rival = '' } = useParams();
  const r = RIVALS[rival];
  if (!r) {
    return (
      <div className="min-h-screen ic-page ic-heading">
        <Navigation />
        <main className="pt-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <h1 className="text-3xl font-bold ic-heading">Comparaison inconnue</h1>
          <p className="mt-2 ic-muted">Choisissez un comparatif disponible :</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {SLUGS.map(s => <Link key={s} to={`/compare/${s}`} className="ic-btn-outline px-5 py-2.5">{RIVALS[s].name}</Link>)}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="ic-badge mb-4 inline-flex items-center gap-1"><Scale className="w-3.5 h-3.5" /> Comparatif</span>
          <h1 className="text-4xl sm:text-5xl font-bold ic-heading max-w-3xl">Infracentra {r.name.replace('vs ', 'vs ')}</h1>
          <p className="mt-3 text-xl ic-heading max-w-2xl">{r.headline}</p>
          <p className="mt-4 text-base ic-muted max-w-2xl">{r.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo-request?intent=demo" className="ic-btn-primary px-6 py-3 inline-flex items-center gap-2">Essayer sur mon parc <ArrowRight className="w-5 h-5" /></Link>
            <Link to="/health-check" className="ic-btn-outline px-6 py-3 inline-flex items-center gap-2"><Zap className="w-5 h-5" /> Diagnostic gratuit</Link>
          </div>
        </section>

        {/* comparison table */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="ic-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: 'var(--ic-border)' }}>
                  <th className="p-4 ic-muted font-medium">Domaine</th>
                  <th className="p-4 ic-heading font-semibold">{r.name.replace('vs ', '')}</th>
                  <th className="p-4 font-semibold" style={{ color: 'var(--ic-primary)' }}>Infracentra</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--ic-border)' }}>
                    <td className="p-4 ic-muted whitespace-nowrap">{row.area}</td>
                    <td className="p-4 ic-muted"><span className="inline-flex gap-2"><X className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />{row.theirs}</span></td>
                    <td className="p-4 ic-heading"><span className="inline-flex gap-2"><Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--ic-primary)' }} />{row.ours}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* honest strengths + cost angle */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 grid md:grid-cols-2 gap-5">
          <div className="ic-card p-6">
            <ShieldCheck className="w-7 h-7 mb-3" style={{ color: 'var(--ic-primary)' }} />
            <h3 className="font-bold ic-heading">Ce que {r.name.replace('vs ', '')} fait bien</h3>
            <p className="mt-2 text-sm ic-muted">{r.strengths}</p>
          </div>
          <div className="ic-card p-6">
            <Coins className="w-7 h-7 mb-3" style={{ color: 'var(--ic-primary)' }} />
            <h3 className="font-bold ic-heading">Comparer le coût réel</h3>
            <p className="mt-2 text-sm ic-muted">Le prix public Infracentra est une simple soustraction&nbsp;: packs par unité supervisée, quotas inclus, TVA 20 %. Estimez votre scénario dans l’estimateur, puis comparez-le à votre facture actuelle (licences + infrastructure + temps d’équipe).</p>
            <Link to="/pricing" className="ic-btn-outline px-5 py-2.5 mt-4 inline-flex items-center gap-2">Ouvrir l’estimateur <ArrowRight className="w-4 h-4" /></Link>
          </div>
        </section>

        {/* other comparisons */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <h2 className="text-xl font-bold ic-heading mb-4">Autres comparatifs</h2>
          <div className="flex flex-wrap gap-3">
            {SLUGS.filter(s => s !== rival).map(s => (
              <Link key={s} to={`/compare/${s}`} className="ic-card px-5 py-3 text-sm ic-heading hover:opacity-80">{RIVALS[s].name}</Link>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
