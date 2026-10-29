// ---------------------------------------------------------------------------
// Partner (wholesale) pricing tier — reached from "Simuler ma marge" on the
// MSSP program page via /pricing?view=partner. Shows:
//   1. the three standard packs at wholesale price for each partner tier,
//   2. predefined partner bundles ("compositeur de packs"), and
//   3. an interactive bundle composer with the partner application form
//      (submits as a V2 sales lead, intent=partner).
// All numbers are derived from PRICING_CONFIG_V2.partner + pricingEngine —
// nothing is hardcoded here.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Layers, Percent } from 'lucide-react';
import {
  PRICING_CONFIG_V2 as CFG, fmtMad, SERVICE_LABELS_FR,
  partnerPackPrice, partnerDiscountFor, composePartnerBundle, defaultPartnerBundles,
  type PackId,
} from '../../data/pricingConfig';
import { quote, partnerTierFor, type AssetInput } from '../../services/pricingEngine';
import { api } from '../../services/api';

const PACK_IDS: PackId[] = ['starter', 'pro', 'souverain'];
const packLabel = (id: PackId) => (id === 'souverain' ? 'Souverain' : id.charAt(0).toUpperCase() + id.slice(1));

export default function PartnerPricingView() {
  const [units, setUnits] = useState(120);
  const [dealReg, setDealReg] = useState(false);
  const autoTier = partnerTierFor(CFG, units);
  const [tierOverride, setTierOverride] = useState<string | null>(null);
  const tierId = tierOverride ?? autoTier.id;
  const discount = partnerDiscountFor(CFG, tierId, dealReg);

  return (
    <div className="space-y-10">
      {/* header */}
      <section className="text-center">
        <span className="ic-badge mb-3 inline-flex items-center gap-1"><Percent className="w-3.5 h-3.5" /> Grille partenaire — prix de gros</span>
        <h2 className="text-3xl font-bold ic-heading">Vos packs partenaire et votre marge</h2>
        <p className="mt-2 ic-muted max-w-2xl mx-auto text-sm">
          Prix de gros automatiques selon votre palier ({CFG.partner.tiers.map(t => `${t.id} −${Math.round(t.discount * 100)} %`).join(' · ')}),
          bonus deal registration +{Math.round(CFG.partner.dealRegistrationBonus.points * 100)} pts, remise totale plafonnée à {Math.round(CFG.partner.totalDiscountCap * 100)} %,
          onboarding facturé 0&nbsp;: vous le réalisez et le facturez à votre tarif.
        </p>
        <div className="mt-4 text-sm ic-muted">
          Vous vendez en direct&nbsp;? <Link to="/pricing" className="underline" style={{ color: 'var(--ic-primary)' }}>Voir la grille publique →</Link>
        </div>
      </section>

      {/* controls */}
      <section className="max-w-7xl mx-auto grid sm:grid-cols-3 gap-4">
        <label className="ic-card p-4 text-sm block">
          <span className="block mb-1 ic-heading font-medium">Unités gérées chez vos clients</span>
          <input type="number" min={0} value={units}
            onChange={(e) => { const u = Math.max(0, Number(e.target.value) || 0); setUnits(u); setTierOverride(null); }}
            className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }} />
          <span className="mt-1 block text-xs ic-muted">Palier automatique&nbsp;: {autoTier.id} (−{Math.round(autoTier.discount * 100)} %)</span>
        </label>
        <label className="ic-card p-4 text-sm block">
          <span className="block mb-1 ic-heading font-medium">Palier appliqué</span>
          <select value={tierId} onChange={(e) => setTierOverride(e.target.value)}
            className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }}>
            {CFG.partner.tiers.map(t => <option key={t.id} value={t.id}>{t.id} — dès {t.minManagedUnits} unités (−{Math.round(t.discount * 100)} %)</option>)}
          </select>
        </label>
        <label className="ic-card p-4 text-sm flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={dealReg} onChange={(e) => setDealReg(e.target.checked)} className="mt-1" />
          <span>
            <span className="block ic-heading font-medium">Deal registration active</span>
            <span className="text-xs ic-muted">+{Math.round(CFG.partner.dealRegistrationBonus.points * 100)} pts pendant {CFG.partner.dealRegistrationBonus.months} mois — remise totale plafonnée à {Math.round(CFG.partner.totalDiscountCap * 100)} %</span>
          </span>
        </label>
      </section>

      {/* standard packs at wholesale */}
      <section className="max-w-7xl mx-auto">
        <h3 className="text-xl font-bold ic-heading mb-4">Packs standard en prix de gros</h3>
        <div className="grid md:grid-cols-3 gap-5">
          {PACK_IDS.map(p => {
            const pub = CFG.packs[p];
            const whole = partnerPackPrice(CFG, p, tierId, dealReg);
            const margin = pub.price - whole;
            return (
              <div key={p} className="ic-card p-5">
                <div className="flex items-baseline justify-between">
                  <h4 className="font-bold ic-heading">{packLabel(p)}</h4>
                  <span className="text-xs ic-muted line-through">{fmtMad(pub.price)}</span>
                </div>
                <p className="mt-2 font-mono text-2xl font-bold" style={{ color: 'var(--ic-primary)' }}>{fmtMad(whole)}<span className="text-sm font-normal ic-muted"> /unité/mois HT</span></p>
                <p className="text-xs ic-muted mt-1">Marge brute {fmtMad(margin)}/unité si revendu au prix public</p>
                <ul className="mt-3 space-y-1 text-sm ic-muted">
                  <li>Dès {pub.minUnits} unités{pub.maxUnits ? ` · plafond ${pub.maxUnits}` : ''}</li>
                  <li>Rétention {pub.retentionDays} j · sauvegarde {pub.backupQuotaGbPerUnit} Go/unité</li>
                  <li>Support {pub.support}</li>
                  <li>Onboarding&nbsp;: <b className="ic-heading">offert</b> (réalisé par vous)</li>
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* predefined bundles */}
      <PredefinedBundles tierId={tierId} dealReg={dealReg} units={units} />

      {/* composer + form */}
      <Composer tierId={tierId} dealReg={dealReg} units={units} />
    </div>
  );
}

// ---------- predefined bundles ---------------------------------------------
function PredefinedBundles({ tierId, dealReg, units }: { tierId: string; dealReg: boolean; units: number }) {
  const bundles = defaultPartnerBundles(CFG);
  return (
    <section className="max-w-7xl mx-auto">
      <h3 className="text-xl font-bold ic-heading mb-1">Packs prédéfinis partenaires</h3>
      <p className="text-sm ic-muted mb-4">Trois offres blanchisées prêtes à revendre — cliquez pour les charger dans le compositeur.</p>
      <div className="grid md:grid-cols-3 gap-5">
        {Object.values(bundles).map(b => {
          const c = composePartnerBundle(CFG, b.services, b.freePicks);
          const whole = Math.round(c.listPerUnit * (1 - partnerDiscountFor(CFG, tierId, dealReg)));
          return (
            <div key={b.id} className="ic-card p-5">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5" style={{ color: 'var(--ic-primary)' }} />
                <h4 className="font-bold ic-heading">{b.name}</h4>
              </div>
              <p className="text-xs ic-muted mt-1">{b.tagline}</p>
              <p className="mt-2 font-mono text-lg font-bold ic-heading">{fmtMad(whole)} <span className="text-xs font-normal ic-muted">/unité/mois HT (gros)</span></p>
              <p className="text-xs ic-muted">Prix public équivalent {fmtMad(c.listPerUnit)} · marge {fmtMad(c.listPerUnit - whole)}/unité · parc exemple {units} unités</p>
              <ul className="mt-3 space-y-1 text-xs ic-muted max-h-40 overflow-auto pr-1">
                {c.paidServices.map(s => <li key={s.id} className="flex gap-1"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ic-primary)' }} />{SERVICE_LABELS_FR[s.id]}</li>)}
                {c.grantedFreeIds.map(id => <li key={id} className="flex gap-1"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ic-primary)' }} />{SERVICE_LABELS_FR[id]} <em>(offert)</em></li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- composer + application form -------------------------------------
function Composer({ tierId, dealReg, units }: { tierId: string; dealReg: boolean; units: number }) {
  const bundles = defaultPartnerBundles(CFG);
  const [sel, setSel] = useState<string[]>(bundles['partner-growth'].services);
  const [freeSel, setFreeSel] = useState<string[]>(bundles['partner-growth'].freePicks);
  const [form, setForm] = useState({ company: '', email: '', name: '', phone: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const composed = composePartnerBundle(CFG, sel, freeSel);
  const disc = partnerDiscountFor(CFG, tierId, dealReg);
  const wholePerUnit = Math.round(composed.listPerUnit * (1 - disc) * 100) / 100;

  // Real engine quote (wholesale) for the selected park — proves the numbers.
  const assets: AssetInput[] = [{ class: 'workstation', qty: units }];
  const q = useMemo(() => quote({
    mode: 'custom', assets, customServices: sel, freePicks: freeSel,
    partnerTier: tierId, dealRegisteredAt: dealReg ? new Date().toISOString() : null,
  }, CFG), [sel, freeSel, units, tierId, dealReg]);

  const toggle = (arr: string[], id: string) => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];

  const submit = async () => {
    if (!form.company || !form.email) { setStatus('error'); return; }
    setStatus('sending');
    try {
      // Same V2 lead endpoint as the demo-request form (kind/intent = partner).
      await api.post<{ ok: boolean; id?: number }>('/pricing/leads', {
        company: form.company, name: form.name, email: form.email, phone: form.phone,
        country: 'MA', lang: 'fr',
        message: `[Candidature partenaire] Bundle: ${composed.paidServices.map(s => SERVICE_LABELS_FR[s.id]).join(', ')} — ${units} unités, palier ${tierId}${dealReg ? ', deal registered' : ''}.`,
        interests: ['partner'], contact_prefs: ['email'], consent: true, website: '',
      });
      setStatus('sent');
    } catch { setStatus('error'); }
  };

  return (
    <section id="compositeur" className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-6">
      <div className="ic-card p-5 space-y-4">
        <h3 className="text-xl font-bold ic-heading">Compositeur de pack partenaire</h3>
        <p className="text-sm ic-muted">Sélectionnez les services facturables&nbsp;; les bonus du pool gratuit se débloquent aux mêmes seuils que le plan sur mesure (cumul ≥ {CFG.custom.unlockThresholds.join(' / ')} MAD).</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.values(bundles).map(b => (
            <button key={b.id} onClick={() => { setSel(b.services); setFreeSel(b.freePicks); }}
              className="ic-btn-outline px-3 py-1.5">{b.name.replace('Pack Partenaire ', '')}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {CFG.services.map(s => (
            <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={sel.includes(s.id)} onChange={() => setSel(a => toggle(a, s.id))} />
              <span className="ic-muted">{SERVICE_LABELS_FR[s.id]}</span>
              <span className="ml-auto font-mono text-xs ic-heading">{s.price}</span>
            </label>
          ))}
        </div>
        <div className="border-t pt-3" style={{ borderColor: 'var(--ic-border)' }}>
          <p className="text-sm ic-heading font-medium mb-2">Bonus (pool gratuit)</p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {CFG.freePool.map(f => {
              const granted = composed.grantedFreeIds.includes(f.id);
              return (
                <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={freeSel.includes(f.id)} onChange={() => setFreeSel(a => toggle(a, f.id))} />
                  <span className="ic-muted">{SERVICE_LABELS_FR[f.id]}</span>
                  <span className="ml-auto text-xs" style={{ color: granted ? 'var(--ic-primary)' : 'var(--ic-muted)' }}>{granted ? 'offert' : `${f.listPrice} MAD`}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--ic-primary) 8%, transparent)' }}>
          <div className="flex justify-between"><span className="ic-muted">Prix catalogue /unité</span><span className="font-mono">{fmtMad(composed.listPerUnit)}</span></div>
          <div className="flex justify-between"><span className="ic-muted">Remise partenaire ({tierId}{dealReg ? ' + deal reg.' : ''})</span><span className="font-mono">−{Math.round(disc * 100)} %</span></div>
          <div className="flex justify-between font-bold ic-heading border-t mt-1 pt-1" style={{ borderColor: 'var(--ic-border)' }}>
            <span>Prix de gros /unité/mois HT</span><span className="font-mono">{fmtMad(q.eligible ? q.totals.price_per_unit_mad : wholePerUnit)}</span>
          </div>
          {q.eligible && <div className="flex justify-between text-xs ic-muted mt-1"><span>Marge mensuelle estimée ({units} unités, revente au prix public)</span><span className="font-mono">{fmtMad((composed.listPerUnit - q.totals.price_per_unit_mad) * units)}</span></div>}
          {!q.eligible && <p className="text-xs mt-1" style={{ color: 'var(--ic-danger, #b91c1c)' }}>{q.reason}</p>}
        </div>
      </div>

      {/* application form */}
      <div className="ic-card p-5">
        <h3 className="text-xl font-bold ic-heading">Demander l'accès partenaire</h3>
        <p className="text-sm ic-muted mt-1">Le bundle sélectionné est joint à votre candidature — un responsable canal vous recontacte sous 48 h ouvrées.</p>
        {status === 'sent' ? (
          <div className="mt-6 rounded-lg p-4 text-sm" style={{ background: 'color-mix(in srgb, var(--ic-primary) 10%, transparent)' }}>
            <Check className="w-5 h-5 inline mr-2" style={{ color: 'var(--ic-primary)' }} />
            Candidature enregistrée — dossier créé, notre équipe canal revient vers vous.
            <div className="mt-3"><Link to="/mssp" className="ic-btn-outline px-4 py-2 inline-flex items-center gap-2 text-sm">Retour au programme <ArrowRight className="w-4 h-4" /></Link></div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Field label="Société *" value={form.company} onChange={(v) => setForm(f => ({ ...f, company: v }))} />
            <Field label="Nom du contact" value={form.name} onChange={(v) => setForm(f => ({ ...f, name: v }))} />
            <Field label="E-mail professionnel *" type="email" value={form.email} onChange={(v) => setForm(f => ({ ...f, email: v }))} />
            <Field label="Téléphone" value={form.phone} onChange={(v) => setForm(f => ({ ...f, phone: v }))} />
            {status === 'error' && <p className="text-sm" style={{ color: 'var(--ic-danger, #b91c1c)' }}>Merci de renseigner au minimum société et e-mail.</p>}
            <button onClick={submit} disabled={status === 'sending'} className="ic-btn-primary px-5 py-2.5 w-full inline-flex items-center justify-center gap-2">
              {status === 'sending' ? 'Envoi…' : 'Envoyer ma candidature'} <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs ic-muted">Ou passez par le <Link to="/demo-request?intent=partner" className="underline" style={{ color: 'var(--ic-primary)' }}>formulaire complet de demande partenaire</Link>.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="text-sm block">
      <span className="block mb-1 ic-heading font-medium">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }} />
    </label>
  );
}
