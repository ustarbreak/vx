// ---------------------------------------------------------------------------
// Public partner-program page (#/mssp) — MSP/MSSP pitch built on the V2
// wholesale model: tier discounts from PRICING_CONFIG_V2.partner, live margin
// simulator (quote() + partnerMargin), deal-registration bonus, white-label.
// Category names only — never OSS product names (§10).
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, ShieldCheck, Percent, HeartHandshake, Layers, BadgeCheck, ArrowRight, Check } from 'lucide-react';

// `Handshake` does not exist in this lucide-react version; use HeartHandshake.
const Handshake = HeartHandshake;
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';
import { PRICING_CONFIG_V2, ASSET_CLASS_LABELS_FR, fmtMad, type PackId } from '../../data/pricingConfig';
import { quote, partnerTierFor, type AssetInput } from '../../services/pricingEngine';

const CFG = PRICING_CONFIG_V2;
const PACK_IDS: PackId[] = ['starter', 'pro', 'souverain'];
const packLabel = (id: PackId) => (id === 'souverain' ? 'Souverain' : id.charAt(0).toUpperCase() + id.slice(1));

export default function PartnerProgramPage() {
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        <Hero />
        <WhyWin />
        <TierTable />
        <MarginSimulator />
        <DealRegistration />
        <ApplyCTA />
        <Footer />
      </main>
    </div>
  );
}

// ---------- hero --------------------------------------------------------------
function Hero() {
  const best = CFG.partner.tiers[CFG.partner.tiers.length - 1];
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
      <h1 className="text-4xl sm:text-5xl font-bold ic-heading">
        Votre marque. Notre plateforme. Jusqu’à {Math.round(best.discount * 100)} % de remise partenaire.
      </h1>
      <p className="mt-4 text-lg ic-muted max-w-2xl mx-auto">
        Le programme MSSP/MDR Infracentra transforme votre parc client en revenu récurrent&nbsp;:
        prix de gros dégressifs par palier, marge 100 % conservée sur vos tarifs de revente,
        onboarding réalisé par vous — donc offert.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/demo-request?intent=partner" className="ic-btn-primary px-6 py-3 text-base inline-flex items-center gap-2">
          Devenir partenaire <ArrowRight className="w-5 h-5" />
        </Link>
        <Link to="/pricing?view=partner" className="ic-btn-outline px-6 py-3 text-base inline-flex items-center gap-2">
          <TrendingUp className="w-5 h-5" /> Simuler ma marge
        </Link>
      </div>
    </section>
  );
}

// ---------- why you win --------------------------------------------------------
function WhyWin() {
  const items = [
    { icon: Percent, title: 'Remise de gros jusqu’à 35 %', text: `Quatre paliers automatiques (${CFG.partner.tiers.map(t => `${Math.round(t.discount * 100)} %`).join(' · ')}), calculés sur vos unités gérées et recalillés chaque mois. La montée est immédiate.` },
    { icon: Handshake, title: 'Bonus deal registration +5 points', text: `Un prospect enregistré avant le closing bénéficie de ${Math.round(CFG.partner.dealRegistrationBonus.points * 100)} points de remise supplémentaires pendant ${CFG.partner.dealRegistrationBonus.months} mois — et la protection exclusive du dossier.` },
    { icon: Layers, title: 'Onboarding facturé 0', text: 'Vous réalisez la mise en service et la facturez à votre tarif. La ligne onboarding Infracentra est systématiquement offerte.' },
    { icon: ShieldCheck, title: 'White-label complet', text: 'Portail, rapports et alertes à votre marque. Les technologies sous-jacentes ne sont jamais nommées au client final.' },
    { icon: BadgeCheck, title: 'Diagnostic de sécurité gratuit pour vos prospects', text: 'Lancez un Health Check 30 jours pour chaque prospect depuis votre portail — il crée automatiquement une deal registration.' },
    { icon: TrendingUp, title: 'Plafond de remise totale transparent', text: `Remise partenaire + remise contrat cumulées dans la limite de ${Math.round(CFG.partner.totalDiscountCap * 100)} % — une règle claire, aucune négociation au cas par cas.` },
  ];
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <h2 className="text-2xl font-bold ic-heading mb-6">Un programme pensé pour votre marge</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((it, i) => (
          <div key={i} className="ic-card p-5">
            <it.icon className="w-7 h-7" style={{ color: 'var(--ic-primary)' }} />
            <h3 className="mt-3 font-semibold ic-heading">{it.title}</h3>
            <p className="mt-1 text-sm ic-muted">{it.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- tiers table ---------------------------------------------------------
function TierTable() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <h2 className="text-2xl font-bold ic-heading mb-6">Les paliers partenaires</h2>
      <div className="ic-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: 'var(--ic-border)' }}>
              <th className="px-4 py-3 ic-heading">Palier</th>
              <th className="px-4 py-3 ic-heading">Unités gérées</th>
              <th className="px-4 py-3 ic-heading">Remise sur lignes par actif</th>
              <th className="px-4 py-3 ic-heading">Stockage (SIEM, rétention, sauvegarde)</th>
              <th className="px-4 py-3 ic-heading">Astreinte SOC 24/7</th>
              <th className="px-4 py-3 ic-heading">Onboarding</th>
            </tr>
          </thead>
          <tbody>
            {CFG.partner.tiers.map((t, i) => {
              const storageDisc = Math.max(CFG.partner.storageLineMinDiscount, t.discount - CFG.partner.storageLineDiscountOffset);
              return (
                <tr key={t.id} className="border-b last:border-0" style={{ borderColor: 'var(--ic-border)' }}>
                  <td className="px-4 py-3 font-semibold ic-heading capitalize">{t.id}{i === CFG.partner.tiers.length - 1 && <span className="ml-2 text-[10px] uppercase px-2 py-0.5 rounded-full ic-btn-primary">Top</span>}</td>
                  <td className="px-4 py-3 ic-muted">{t.minManagedUnits.toLocaleString('fr-FR')}+</td>
                  <td className="px-4 py-3 font-mono ic-heading">−{Math.round(t.discount * 100)} %</td>
                  <td className="px-4 py-3 font-mono ic-heading">−{Math.round(storageDisc * 100)} %</td>
                  <td className="px-4 py-3 font-mono ic-heading">−{Math.round(CFG.partner.soc247Discount * 100)} %</td>
                  <td className="px-4 py-3 ic-muted">Offert (réalisé par le partenaire)</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs ic-muted">Cumul remise partenaire + contrat plafonné à {Math.round(CFG.partner.totalDiscountCap * 100)} %. Le palier se calcule sur les unités-service facturables de tous vos clients actifs ; descente de palier après un délai de grâce de {CFG.partner.downgradeGraceDays} jours.</p>
    </section>
  );
}

// ---------- margin simulator ------------------------------------------------------
function MarginSimulator() {
  const [pack, setPack] = useState<PackId>('pro');
  const [units, setUnits] = useState(120);
  const [tierIdx, setTierIdx] = useState(2);
  const [resale, setResale] = useState<number>(CFG.packs.pro.price);

  const assets: AssetInput[] = useMemo(() => [{ class: 'workstation', qty: units }], [units]);
  const def = CFG.packs[pack];
  const listQ = useMemo(() => quote({ mode: 'pack', pack, assets }), [pack, assets]);
  const tier = CFG.partner.tiers[tierIdx];
  const wholesaleQ = useMemo(
    () => quote({ mode: 'pack', pack, assets, partnerTier: tier.id }),
    [pack, assets, tier.id],
  );

  // Eligibility of the sample park for this pack (heavy-only simplification)
  const eligible = listQ.eligible;
  const wholesalePerUnit = wholesaleQ.totals.price_per_unit_mad;   // after tier discount, pre-contract
  const marginPerUnit = resale - wholesalePerUnit;
  const monthly = marginPerUnit * units;

  return (
    <section id="simulateur" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <h2 className="text-2xl font-bold ic-heading">Simulateur de marge</h2>
      <p className="mt-1 text-sm ic-muted">Entrez votre tarif de revente — la marge est la vôtre, Infracentra n’impose que le prix de gros.</p>
      <div className="mt-6 grid lg:grid-cols-2 gap-6">
        <div className="ic-card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block mb-1 ic-heading font-medium">Pack revendu</span>
              <select value={pack} onChange={(e) => { const p = e.target.value as PackId; setPack(p); setResale(CFG.packs[p].price); }}
                className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }}>
                {PACK_IDS.map(p => <option key={p} value={p}>{packLabel(p)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block mb-1 ic-heading font-medium">Palier partenaire</span>
              <select value={tierIdx} onChange={(e) => setTierIdx(Number(e.target.value))}
                className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }}>
                {CFG.partner.tiers.map((t, i) => <option key={t.id} value={i}>{t.id.charAt(0).toUpperCase() + t.id.slice(1)} (−{Math.round(t.discount * 100)} %)</option>)}
              </select>
            </label>
            <NumIn label={`Unités gérées (${ASSET_CLASS_LABELS_FR.workstation.toLowerCase()} ×1)`} value={units} onChange={setUnits} min={def.minUnits} />
            <NumIn label="Votre prix de revente (MAD/unité/mois HT)" value={resale} onChange={setResale} min={0} />
          </div>
          {!eligible && <p className="text-sm" style={{ color: 'var(--ic-danger, #b91c1c)' }}>{listQ.reason}</p>}
        </div>
        {eligible && (
          <div className="ic-card p-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Stat label="Prix public /unité" value={`${fmtMad(def.price)} MAD`} />
              <Stat label="Prix de gros /unité" value={`${fmtMad(wholesalePerUnit)} MAD`} sub={`remise −${Math.round(tier.discount * 100)} %`} />
              <Stat label="Marge /unité" value={`${fmtMad(marginPerUnit)} MAD`} />
              <Stat label="Marge mensuelle" value={`${fmtMad(monthly)} MAD`} sub={`${units.toLocaleString('fr-FR')} unités × ${packLabel(pack)}`} strong />
            </div>
            <div className="mt-4 rounded-lg p-3 text-sm ic-muted" style={{ background: 'color-mix(in srgb, var(--ic-primary) 8%, transparent)' }}>
              Astuce&nbsp;: enregistrez le deal du prospect (+{Math.round(CFG.partner.dealRegistrationBonus.points * 100)} points de remise pendant {CFG.partner.dealRegistrationBonus.months} mois) et alignez votre palier sur {new Intl.NumberFormat('fr-FR').format(partnerTierFor(CFG, units + 0).minManagedUnits || 0)}+ unités pour la projection annuelle.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
function NumIn({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="text-sm block col-span-2 sm:col-span-1">
      <span className="block mb-1 ic-heading font-medium">{label}</span>
      <input type="number" min={min ?? 0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }} />
    </label>
  );
}
function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="ic-muted text-xs uppercase tracking-wide">{label}</p>
      <p className={`font-mono ${strong ? 'text-xl font-bold' : 'text-lg'} ic-heading`}>{value}</p>
      {sub && <p className="text-xs ic-muted">{sub}</p>}
    </div>
  );
}

// ---------- deal registration ---------------------------------------------------
function DealRegistration() {
  const pts = [
    'Enregistrez le prospect avant tout devis : dossier protégé et exclusive 12 mois.',
    `+${Math.round(CFG.partner.dealRegistrationBonus.points * 100)} points de remise sur les lignes par actif, automatiquement.`,
    'Vérification anti-conflit automatique avec nos leads directs — si le prospect est déjà enregistré chez vous, la vente directe vous est cédée.',
    'Le Diagnostic de sécurité gratuit lancé depuis votre portail crée la deal registration tout seul.',
  ];
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="ic-card p-6">
        <h2 className="text-2xl font-bold ic-heading flex items-center gap-2"><Handshake className="w-6 h-6" style={{ color: 'var(--ic-primary)' }} /> Deal registration</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {pts.map((p, i) => (<li key={i} className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} /><span className="ic-muted">{p}</span></li>))}
        </ul>
      </div>
    </section>
  );
}

// ---------- apply CTA -------------------------------------------------------------
function ApplyCTA() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="ic-card p-8 text-center">
        <h2 className="text-2xl font-bold ic-heading">Prêt à vendre du SOC sous votre marque&nbsp;?</h2>
        <p className="mt-2 text-sm ic-muted max-w-xl mx-auto">
          Candidature au programme partenaire&nbsp;: nous évaluons votre parc, fixons votre palier de départ et ouvrons votre portail white-label.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link to="/demo-request?intent=partner" className="ic-btn-primary px-6 py-3 inline-block">Candidater au programme</Link>
          <Link to="/pricing" className="ic-btn-outline px-6 py-3 inline-block">Voir les packs revendus</Link>
        </div>
      </div>
    </section>
  );
}
