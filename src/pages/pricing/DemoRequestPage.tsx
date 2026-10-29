// ---------------------------------------------------------------------------
// Public "Request a demo" page (#/demo-request) — big brand panel on the left,
// company form on the right. Submits as a V2 sales lead (POST /pricing/leads,
// kind=demo) — rate-limited + honeypot server-side; demo mode simulates it.
// Success screen: ticket created, standby for review.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldCheck, CheckCircle2, Zap, ArrowRight } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';
import { api } from '../../services/api';

const INTENTS = ['demo', 'souverain', 'custom', 'partner', 'health-check'] as const;
type Intent = typeof INTENTS[number];
const INTENT_LABEL: Record<Intent, string> = {
  demo: 'Démonstration de la plateforme',
  souverain: 'Pack Souverain (Enterprise) — contact sales',
  custom: 'Plan sur mesure — contact sales',
  partner: 'Candidature au programme partenaire',
  'health-check': 'Diagnostic de sécurité gratuit',
};

export default function DemoRequestPage() {
  const [params] = useSearchParams();
  const rawIntent = (params.get('intent') ?? 'demo') as Intent;
  const intent: Intent = (INTENTS as readonly string[]).includes(rawIntent) ? rawIntent : 'demo';

  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16 min-h-[calc(100vh-4rem)] flex flex-col">
        <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full grid lg:grid-cols-2 gap-10 items-start">
          <BrandPanel intent={intent} />
          <RequestForm intent={intent} />
        </div>
        <Footer />
      </main>
    </div>
  );
}

function BrandPanel({ intent }: { intent: Intent }) {
  return (
    <div className="lg:sticky lg:top-24">
      {/* Big Infracentra logo */}
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'var(--ic-primary)' }}>
          <Zap className="w-12 h-12 ic-heading" />
        </div>
        <div>
          <p className="text-4xl font-extrabold tracking-tight ic-heading">Infracentra</p>
          <p className="text-sm ic-muted uppercase tracking-widest mt-1">INFRAvx SecOps Platform</p>
        </div>
      </div>
      <h1 className="mt-8 text-3xl font-bold ic-heading">{INTENT_LABEL[intent]}</h1>
      <p className="mt-4 text-base ic-muted leading-relaxed">
        Plateforme unifiée de cybersécurité et d’infrastructure, hébergée et opérée depuis le Maroc&nbsp;:
        supervision des terminaux, gestion des vulnérabilités et correctifs, sauvegarde, SIEM géré,
        réponse aux incidents et automatisation — un seul portail, multi-tenant, white-label pour nos partenaires.
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        {[
          'Tarification simple par unité-service, packs tout-inclus',
          'Diagnostic de sécurité gratuit de 30 jours, sans engagement',
          'Conformité loi 09-08 (CNDP) et standards internationaux',
          'Programme partenaire MSSP : remise de gros jusqu’à 35 %',
        ].map((t, i) => (
          <li key={i} className="flex gap-2 ic-muted"><CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />{t}</li>
        ))}
      </ul>
      <p className="mt-6 text-xs ic-muted">
        Déjà client&nbsp;? <Link to="/login" className="underline">Portails de connexion</Link> ·
        {' '}Prix publics&nbsp;: <Link to="/pricing" className="underline">page tarification</Link>
      </p>
    </div>
  );
}

function RequestForm({ intent }: { intent: Intent }) {
  const [f, setF] = useState({ company: '', name: '', email: '', phone: '', country: 'Maroc', size: '', message: '', website: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<number | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const valid = useMemo(() => f.company.trim() && f.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.email) && consent, [f, consent]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ ok: boolean; id?: number; message?: string }>('/pricing/leads', {
        company: f.company, name: f.name, email: f.email, phone: f.phone,
        country: f.country, lang: 'fr', message: `[${INTENT_LABEL[intent]}] ${f.message}`.trim(),
        interests: [intent], contact_prefs: ['email'], consent, website: f.website, // honeypot (empty for humans)
      });
      setTicketId(res.id ?? null);
    } catch (err: any) {
      setError(err?.message ?? 'Envoi impossible — réessayez ou contactez-nous par téléphone.');
    } finally {
      setBusy(false);
    }
  }

  if (ticketId !== null) {
    return (
      <div className="ic-card p-8 text-center" role="status">
        <CheckCircle2 className="w-16 h-16 mx-auto" style={{ color: 'var(--ic-primary)' }} />
        <h2 className="mt-4 text-2xl font-bold ic-heading">Félicitations — votre demande est enregistrée&nbsp;!</h2>
        <p className="mt-3 text-sm ic-muted max-w-md mx-auto">
          Votre ticket <span className="font-mono ic-heading">#{String(ticketId).padStart(5, '0')}</span> a bien été créé.
          Un conseiller Infracentra l’examine actuellement et vous répondra très prochainement
          — restez à l’écoute de votre boîte mail et de votre téléphone.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/pricing" className="ic-btn-outline px-4 py-2 text-sm inline-flex items-center gap-2">Parcourir les packs <ArrowRight className="w-4 h-4" /></Link>
          <Link to="/" className="ic-btn-primary px-4 py-2 text-sm">Retour à l’accueil</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ic-card p-6 space-y-4" noValidate>
      <h2 className="text-xl font-bold ic-heading">Parlez-nous de votre entreprise</h2>
      {/* honeypot */}
      <input type="text" name="website" value={f.website} onChange={set('website')} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <Field label="Société *" required><input className="ic-input" value={f.company} onChange={set('company')} required autoComplete="organization" /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nom complet *" required><input className="ic-input" value={f.name} onChange={set('name')} required autoComplete="name" /></Field>
        <Field label="E-mail professionnel *" required><input type="email" className="ic-input" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
        <Field label="Téléphone"><input type="tel" className="ic-input" value={f.phone} onChange={set('phone')} autoComplete="tel" /></Field>
        <Field label="Pays"><input className="ic-input" value={f.country} onChange={set('country')} autoComplete="country-name" /></Field>
      </div>
      <Field label="Taille du parc (approx.)">
        <select className="ic-input" value={f.size} onChange={set('size')}>
          <option value="">— choisir —</option>
          <option value="<50">moins de 50 équipements</option>
          <option value="50-200">50 à 200</option>
          <option value="200-1000">200 à 1 000</option>
          <option value=">1000">plus de 1 000</option>
        </select>
      </Field>
      <Field label="Message / contexte"><textarea rows={4} className="ic-input" value={f.message} onChange={set('message')} placeholder="Contexte, échéance, enjeux particuliers…" /></Field>
      <label className="flex items-start gap-2 text-xs ic-muted cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" required />
        <span>J’autorise Infracentra à traiter ces informations pour ma demande, conformément à la loi 09-08 relative à la protection des données personnelles (CNDP).</span>
      </label>
      {error && <p className="text-sm" style={{ color: 'var(--ic-danger, #b91c1c)' }}>{error}</p>}
      <button type="submit" disabled={!valid || busy} className="ic-btn-primary w-full py-3 text-sm disabled:opacity-50">
        {busy ? 'Envoi en cours…' : 'Envoyer ma demande'}
      </button>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block mb-1 ic-heading font-medium">{label}{required && <span aria-hidden="true"> *</span>}</span>
      {children}
    </label>
  );
}
