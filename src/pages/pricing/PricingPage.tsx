// ---------------------------------------------------------------------------
// Public pricing page (#/pricing) — V2 engine ONLY.
// Three packs + pack estimator (asset classes, SIEM, retention, backup,
// contract, 24/7). No per-service prices are ever shown here (§4).
// Souverain price is hidden → "Contact sales". In the estimator, a Custom
// selection equivalent to Souverain also hides every price → Contact sales.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ShieldCheck, Star, ArrowRight, Lock, Info, Gift } from 'lucide-react';
import Navigation from '../landing/Navigation';
import Footer from '../landing/Footer';
import PartnerPricingView from './PartnerPricingView';
import {
  PRICING_CONFIG_V2, PACK_SERVICES, ASSET_CLASS_LABELS_FR, SERVICE_LABELS_FR,
  fmtMad, type PackId,
} from '../../data/pricingConfig';
import { quote, billableUnits, customSlotsInfo, isSouverainEquivalent, type AssetInput } from '../../services/pricingEngine';

const CFG = PRICING_CONFIG_V2;
const HEAVY = Object.entries(CFG.assetClasses).filter(([, w]) => w === 1);
const LIGHT = Object.entries(CFG.assetClasses).filter(([, w]) => w === 0.5);
const PACK_IDS: PackId[] = ['starter', 'pro', 'souverain'];

export default function PricingPage() {
  // /pricing?view=partner → wholesale tier page (reached from "Simuler ma
  // marge" on the MSSP program page). Everything else keeps the public grid.
  const [params] = useSearchParams();
  const isPartner = params.get('view') === 'partner';
  return (
    <div className="min-h-screen ic-page ic-heading">
      <Navigation />
      <main className="pt-16">
        {isPartner ? (
          <div className="px-4 sm:px-6 lg:px-8 py-12"><PartnerPricingView /></div>
        ) : (
          <>
            <Hero />
            <PackCards />
            <AssetExplainer />
            <Estimator />
            <CustomCard />
          </>
        )}
        <Footer />
      </main>
    </div>
  );
}

// ---------- hero -------------------------------------------------------------
function Hero() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
      <h1 className="text-4xl sm:text-5xl font-bold ic-heading">
        Une tarification simple, par actif supervisé
      </h1>
      <p className="mt-4 text-lg ic-muted max-w-2xl mx-auto">
        Trois packs tout-inclus, un prix unique par unité-service, hors taxes.
        Pas de surprise sur le volume de logs&nbsp;: les quotas sont dans le pack.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/health-check" className="ic-btn-primary px-6 py-3 text-base inline-flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" /> Démarrer le Diagnostic de sécurité gratuit
        </Link>
        <a href="#packs" className="ic-btn-outline px-6 py-3 text-base inline-flex items-center gap-2">
          Voir les packs et l'estimateur <ArrowRight className="w-5 h-5" />
        </a>
      </div>
      <p className="mt-4 text-xs ic-muted">Prix en MAD, hors taxes (TVA 20 % appliquée sur la facture).</p>
    </section>
  );
}

// ---------- pack cards --------------------------------------------------------
function PackCards() {
  return (
    <section id="packs" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="grid md:grid-cols-3 gap-6">
        {PACK_IDS.map((id) => {
          const p = CFG.packs[id];
          const isEnterprise = id === 'souverain';
          const isPro = id === 'pro';
          return (
            <div key={id} className={`ic-card p-6 relative flex flex-col ${isPro ? 'ring-2' : ''}`} style={isPro ? { boxShadow: 'var(--ic-shadow-lg)' } : undefined}>
              {isPro && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 ic-btn-primary px-3 py-1 text-xs rounded-full inline-flex items-center gap-1">
                  <Star className="w-3 h-3" /> Le plus choisi
                </span>
              )}
              <h3 className="text-xl font-bold ic-heading">{labelPack(id)}</h3>
              {isEnterprise && <span className="mt-1 text-xs font-semibold uppercase tracking-wide ic-muted">Enterprise</span>}
              <div className="mt-4">
                {isEnterprise ? (
                  <div className="flex items-center gap-2 text-2xl font-bold ic-heading"><Lock className="w-6 h-6" /> Sur devis</div>
                ) : (
                  <div><span className="text-4xl font-extrabold ic-heading">{fmtMad(p.price)}</span><span className="ic-muted text-sm"> /unité-service/mois HT</span></div>
                )}
                <p className="mt-1 text-sm ic-muted">
                  {isEnterprise
                    ? 'À partir de 100 unités-service · périmètre souverain complet'
                    : p.maxUnits === null ? `À partir de ${p.minUnits} unités-service` : `De ${p.minUnits} à ${p.maxUnits} unités-service`}
                </p>
              </div>
              <ul className="mt-5 space-y-2 text-sm flex-1">
                <li className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />{PACK_SERVICES[id].length} services inclus</li>
                <li className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />SIEM&nbsp;: {siemQuotaLabel(id)}</li>
                <li className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />Rétention des logs&nbsp;: {p.retentionDays} jours</li>
                <li className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />Sauvegarde&nbsp;: {p.backupQuotaGbPerUnit} Go/unité incluse</li>
                <li className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />Support&nbsp;: {supportLabel(p.support)}</li>
                <li className="flex gap-2"><Check className="w-4 h-4 shrink-0" style={{ color: 'var(--ic-primary)' }} />Mise en service&nbsp;: {isEnterprise ? 'accompagnée par notre équipe' : fmtMad(p.onboarding) + ' (offerte à 36 mois)'}</li>
              </ul>
              {isEnterprise ? (
                <Link to="/demo-request?intent=souverain" className="ic-btn-primary mt-6 px-4 py-2 text-sm block text-center">Contacter sales</Link>
              ) : (
                <a href="#estimateur" className="ic-btn-outline mt-6 px-4 py-2 text-sm inline-block text-center w-full">Estimer ce pack</a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function labelPack(id: PackId) { return id === 'souverain' ? 'Souverain' : id.charAt(0).toUpperCase() + id.slice(1); }
function siemQuotaLabel(id: PackId) {
  const q = CFG.packs[id].siemQuota;
  if (q.perUnit === 0 && q.min === 0) return 'facturé à l’usage (bandes dégressives)';
  return `${q.min} Go/jour inclus + ${String(q.perUnit).replace('.', ',')} Go/jour par unité`;
}
function supportLabel(s: string) {
  return s === '8x5' ? '8h–17h, 5 j/5' : s.startsWith('8x5') ? '8h–17h, 5 j/5 (24/7 en option)' : '24/7 inclus';
}

// ---------- asset counting explainer -----------------------------------------
function AssetExplainer() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="ic-card p-6">
        <h2 className="text-2xl font-bold ic-heading">Comment comptons-nous vos actifs&nbsp;?</h2>
        <p className="mt-2 text-sm ic-muted max-w-3xl" title="Les équipements qui consomment beaucoup de services et génèrent beaucoup de données comptent 1 ; les équipements légers comptent 0,5.">
          Un prix juste reflète la charge réelle de chaque équipement. Les appareils lourds comptent pour{' '}
          <strong className="ic-heading">1 unité-service</strong>, les appareils légers pour <strong className="ic-heading">0,5 unité</strong>.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
          <WeightTable title="×1 — équipements principaux" classes={HEAVY} />
          <WeightTable title="×0,5 — équipements réseau légers" classes={LIGHT} />
        </div>
      </div>
    </section>
  );
}
function WeightTable({ title, classes }: { title: string; classes: [string, number][] }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--ic-border)' }}>
      <p className="font-semibold ic-heading mb-2">{title}</p>
      <ul className="space-y-1 ic-muted">
        {classes.map(([c, w]) => (<li key={c} className="flex justify-between"><span>{ASSET_CLASS_LABELS_FR[c]}</span><span className="font-mono text-xs">×{w === 1 ? '1' : '0,5'}</span></li>))}
      </ul>
    </div>
  );
}

// ---------- pack estimator ----------------------------------------------------
function Estimator() {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [siem, setSiem] = useState(0);
  const [retention, setRetention] = useState(30);
  const [backup, setBackup] = useState<number | ''>('');
  const [contract, setContract] = useState<0 | 12 | 24 | 36>(0);
  const [support247, setSupport247] = useState(false);
  // Custom (plan sur mesure) selection — services + bonus offerts. The price
  // ladder follows PRICING_CONFIG_V2.custom.unlockThresholds: cumulative list
  // price ≥ 369 MAD → 1 bonus offert, ≥ 479 → 2, ≥ 589 → 3 (+ ticketing).
  const [customServices, setCustomServices] = useState<string[]>([]);
  const [freePicks, setFreePicks] = useState<string[]>([]);

  const toggleIn = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  const assets: AssetInput[] = useMemo(
    () => Object.entries(qty).filter(([, q]) => q > 0).map(([c, q]) => ({ class: c, qty: q })),
    [qty],
  );
  const units = billableUnits(CFG, assets);

  const quotes = useMemo(() => {
    if (units === 0) return null;
    return PACK_IDS.map((pack) => {
      const q = quote({ mode: 'pack', pack, assets, siemGbDay: siem, retentionDays: retention, backupVolumeGb: backup === '' ? undefined : Number(backup), contractMonths: contract, support247 });
      return { pack, q };
    });
  }, [assets, units, siem, retention, backup, contract, support247]);

  // Custom plan quote — only when at least one paid service is selected.
  const customQ = useMemo(() => {
    if (units === 0 || customServices.length === 0) return null;
    return quote({ mode: 'custom', assets, customServices, freePicks, siemGbDay: siem, retentionDays: retention, backupVolumeGb: backup === '' ? undefined : Number(backup), contractMonths: contract, support247 });
  }, [assets, units, customServices, freePicks, siem, retention, backup, contract, support247]);
  const slotsInfo = useMemo(
    () => (units > 0 && customServices.length > 0 ? customSlotsInfo({ mode: 'custom', assets, customServices, freePicks }) : null),
    [assets, units, customServices, freePicks],
  );
  const customEquivalent = isSouverainEquivalent(customServices);

  const best = quotes ? [...quotes].filter(x => x.q.eligible).sort((a, b) => a.q.totals.monthly_excl_vat_mad - b.q.totals.monthly_excl_vat_mad)[0] : undefined;

  return (
    <section id="estimateur" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <h2 className="text-2xl font-bold ic-heading">Estimateur — votre facture en 30 secondes</h2>
      <p className="mt-1 text-sm ic-muted">Indicatif, hors taxes. Le pack recommandé est calculé automatiquement.</p>
      <div className="mt-6 grid lg:grid-cols-5 gap-6">
        {/* inputs */}
        <div className="lg:col-span-2 space-y-5 ic-card p-5">
          <fieldset>
            <legend className="text-sm font-semibold ic-heading mb-2">Vos équipements</legend>
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {Object.keys(CFG.assetClasses).map((c) => {
                const w = CFG.assetClasses[c];
                return (
                  <div key={c} className="flex items-center justify-between gap-2 text-sm">
                    <span className="ic-muted flex items-center gap-1">{ASSET_CLASS_LABELS_FR[c]}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--ic-border)' }} title="Les équipements qui consomment beaucoup de services comptent 1 ; les légers 0,5.">×{w === 1 ? '1' : '0,5'}</span>
                    </span>
                    <input type="number" min={0} value={qty[c] ?? 0} onChange={(e) => setQty({ ...qty, [c]: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-20 rounded-md border px-2 py-1 text-right bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }} aria-label={ASSET_CLASS_LABELS_FR[c]} />
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-sm font-semibold ic-heading">Total&nbsp;: {units.toFixed(1)} unité{units >= 2 ? 's' : ''}-service</p>
          </fieldset>
          <NumField label="Logs SIEM (Go/jour)" value={siem} onChange={setSiem} hint="Minimum facturable : 10 Go/jour ; au-delà du quota du pack, bandes dégressives." />
          <div>
            <label className="text-sm font-medium ic-heading block mb-1">Rétention des logs</label>
            <select value={retention} onChange={(e) => setRetention(Number(e.target.value))} className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }}>
              {[30, 90, 180, 365].map(d => <option key={d} value={d}>{d} jours</option>)}
            </select>
          </div>
          <NumField label="Volume sauvegardé (Go)" value={backup === '' ? 0 : Number(backup)} onChange={(v) => setBackup(v === 0 ? '' : v)} hint="Optionnel. Au-delà du quota inclus : blocs de 100 Go facturés 45 MAD." />
          <div>
            <label className="text-sm font-medium ic-heading block mb-1">Durée du contrat</label>
            <div className="flex gap-2 flex-wrap">
              {([0, 12, 24, 36] as const).map(m => (
                <button key={m} onClick={() => setContract(m)} className={`px-3 py-1.5 rounded-md text-sm border ${contract === m ? 'ic-btn-primary' : ''}`} style={contract === m ? undefined : { borderColor: 'var(--ic-border)' }}>
                  {m === 0 ? 'Mensuel' : `${m} mois${CFG.contractDiscount[String(m)] > 0 ? ` (−${Math.round(CFG.contractDiscount[String(m)] * 100)} %)` : ''}`}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm ic-heading cursor-pointer">
            <input type="checkbox" checked={support247} onChange={(e) => setSupport247(e.target.checked)} /> Astreinte 24/7 (option Pro uniquement)
          </label>

          {/* ---- plan sur mesure : services payants --------------------- */}
          <fieldset>
            <legend className="text-sm font-semibold ic-heading mb-1">Plan sur mesure — vos services</legend>
            <p className="text-xs ic-muted mb-2">Optionnel&nbsp;: composez un plan personnalisé. Le socle plateforme (99&nbsp;MAD) s’ajoute au cumul des prix liste.</p>
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {CFG.services.map((s) => (
                <label key={s.id} className="flex items-center justify-between gap-2 text-sm cursor-pointer ic-heading">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={customServices.includes(s.id)}
                      onChange={() => setCustomServices(toggleIn(customServices, s.id))} />
                    <span className="ic-muted">{SERVICE_LABELS_FR[s.id] ?? s.id}</span>
                  </span>
                  <span className="font-mono text-xs ic-muted shrink-0">{s.price} MAD</span>
                </label>
              ))}
            </div>
            {slotsInfo && (
              <p className="mt-2 text-xs ic-heading">
                Cumul&nbsp;: <strong>{fmtMad(Math.round(slotsInfo.cumulative))}</strong> / actif →{' '}
                <strong style={{ color: 'var(--ic-primary)' }}>
                  {slotsInfo.slots === 0 ? 'aucun bonus débloqué' : `${slotsInfo.slots} service${slotsInfo.slots > 1 ? 's' : ''} offert${slotsInfo.slots > 1 ? 's' : ''}`}
                </strong>
                {' '}
                <span className="ic-muted">
                  (paliers&nbsp;: ≥{CFG.custom.unlockThresholds[0]} → 1&nbsp;· ≥{CFG.custom.unlockThresholds[1]} → 2&nbsp;· ≥{CFG.custom.unlockThresholds[2]} → 3 + ticketing)
                </span>
              </p>
            )}
          </fieldset>

          {/* ---- bonus (pool offert) ----------------------------------- */}
          {customServices.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold ic-heading mb-1 flex items-center gap-1.5"><Gift className="w-4 h-4" style={{ color: 'var(--ic-primary)' }} /> Bonus — services offerts</legend>
              <p className="text-xs ic-muted mb-2">Les plus valorisés remplissent les emplacements débloqués&nbsp;; les autres restent facturés au prix liste.</p>
              <div className="space-y-1">
                {CFG.freePool.map((f) => {
                  const locked = !!f.topTierOnly && (slotsInfo?.slots ?? 0) < 3;
                  const billed = slotsInfo?.billedFree.includes(f.id) ?? false;
                  return (
                    <label key={f.id} className={`flex items-center justify-between gap-2 text-sm ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer ic-heading'}`}>
                      <span className="flex items-center gap-2">
                        <input type="checkbox" disabled={locked} checked={freePicks.includes(f.id)}
                          onChange={() => setFreePicks(toggleIn(freePicks, f.id))} />
                        <span className="ic-muted">{SERVICE_LABELS_FR[f.id] ?? f.id}</span>
                      </span>
                      <span className="text-xs font-mono shrink-0" style={{ color: locked ? undefined : billed ? 'var(--ic-muted, inherit)' : 'var(--ic-primary)' }}>
                        {locked ? `offert dès ${fmtMad(CFG.custom.unlockThresholds[2])}` : billed ? `${f.listPrice} MAD` : 'offert'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>

        {/* results */}
        <div className="lg:col-span-3 space-y-4">
          {units === 0 && <div className="ic-card p-6 text-sm ic-muted">Saisissez au moins un équipement pour voir les estimations.</div>}
          {quotes && quotes.map(({ pack, q }) => {
            const enterpriseHidden = pack === 'souverain';   // Souverain price hidden publicly
            const eligible = q.eligible;
            return (
              <div key={pack} className={`ic-card p-5 transition-opacity ${eligible ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-bold ic-heading flex items-center gap-2">{labelPack(pack)}{enterpriseHidden && <span className="text-[10px] uppercase tracking-wide ic-muted">Enterprise</span>}
                    {best?.pack === pack && <span className="text-xs px-2 py-0.5 rounded-full ic-btn-primary">Recommandé</span>}
                  </h3>
                  {!eligible && <span className="text-xs ic-muted flex items-center gap-1"><Info className="w-3.5 h-3.5" /> non éligible</span>}
                </div>
                {!eligible ? (
                  <p className="mt-2 text-sm" style={{ color: 'var(--ic-danger, #b91c1c)' }}>{q.reason}</p>
                ) : enterpriseHidden ? (
                  <div className="mt-3 text-sm ic-muted">
                    Périmètre Enterprise&nbsp;: tarif communiqué par notre équipe commerciale après qualification du besoin.
                    <div className="mt-3"><Link to="/demo-request?intent=souverain" className="ic-btn-primary px-4 py-2 text-sm inline-block">Contacter sales</Link></div>
                  </div>
                ) : (
                  <>
                    <table className="mt-3 w-full text-sm">
                      <tbody>
                        {q.lines.filter(l => l.kind !== 'vat' && l.kind !== 'info').map(l => (
                          <tr key={l.key} className="border-b" style={{ borderColor: 'var(--ic-border)' }}>
                            <td className="py-1.5 ic-muted">{l.label_fr}{l.note ? ` (${l.note})` : ''}</td>
                            <td className="py-1.5 text-right font-mono ic-heading">{l.amount_mad < 0 ? '−' : ''}{fmtMad(Math.abs(l.amount_mad))}</td>
                          </tr>
                        ))}
                        <tr><td className="py-1.5 font-semibold ic-heading">Mensuel HT</td><td className="py-1.5 text-right font-mono font-semibold ic-heading">{fmtMad(q.totals.monthly_excl_vat_mad)}</td></tr>
                        <tr><td className="py-1.5 ic-muted">TVA 20 %</td><td className="py-1.5 text-right font-mono ic-muted">{fmtMad(q.totals.vat_mad)}</td></tr>
                        <tr><td className="py-1.5 font-semibold ic-heading">Mensuel TTC</td><td className="py-1.5 text-right font-mono font-semibold ic-heading">{fmtMad(q.totals.monthly_incl_vat_mad)}</td></tr>
                        {q.totals.onboarding_mad > 0 && <tr><td className="py-1.5 ic-muted">Mise en service (unique)</td><td className="py-1.5 text-right font-mono ic-muted">{fmtMad(q.totals.onboarding_mad)}</td></tr>}
                      </tbody>
                    </table>
                    {q.upsell_notes.length > 0 && <p className="mt-2 text-xs ic-muted">{q.upsell_notes[0]}</p>}
                  </>
                )}
              </div>
            );
          })}

          {/* ---- custom plan result ------------------------------------ */}
          {customQ && (
            <div className="ic-card p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-bold ic-heading flex items-center gap-2">Plan sur mesure
                  {slotsInfo && <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--ic-border)' }}>{slotsInfo.slots} bonus offert{slotsInfo.slots > 1 ? 's' : ''}</span>}
                </h3>
                {!customQ.eligible && <span className="text-xs ic-muted flex items-center gap-1"><Info className="w-3.5 h-3.5" /> non éligible</span>}
              </div>
              {!customQ.eligible ? (
                <p className="mt-2 text-sm" style={{ color: 'var(--ic-danger, #b91c1c)' }}>{customQ.reason}</p>
              ) : customEquivalent ? (
                <div className="mt-3 text-sm ic-muted">
                  Périmètre équivalent au plan Souverain&nbsp;: tarif communiqué par notre équipe commerciale après qualification du besoin.
                  <div className="mt-3"><Link to="/demo-request?intent=custom" className="ic-btn-primary px-4 py-2 text-sm inline-block">Contacter sales</Link></div>
                </div>
              ) : (
                <>
                  <table className="mt-3 w-full text-sm">
                    <tbody>
                      {customQ.lines.filter(l => l.kind !== 'vat' && l.kind !== 'info').map(l => (
                        <tr key={l.key} className="border-b" style={{ borderColor: 'var(--ic-border)' }}>
                          <td className="py-1.5 ic-muted">{l.label_fr}{l.note ? ` (${l.note})` : ''}</td>
                          <td className="py-1.5 text-right font-mono ic-heading">{l.amount_mad < 0 ? '−' : ''}{fmtMad(Math.abs(l.amount_mad))}</td>
                        </tr>
                      ))}
                      <tr><td className="py-1.5 font-semibold ic-heading">Mensuel HT</td><td className="py-1.5 text-right font-mono font-semibold ic-heading">{fmtMad(customQ.totals.monthly_excl_vat_mad)}</td></tr>
                      <tr><td className="py-1.5 ic-muted">TVA 20 %</td><td className="py-1.5 text-right font-mono ic-muted">{fmtMad(customQ.totals.vat_mad)}</td></tr>
                      <tr><td className="py-1.5 font-semibold ic-heading">Mensuel TTC</td><td className="py-1.5 text-right font-mono font-semibold ic-heading">{fmtMad(customQ.totals.monthly_incl_vat_mad)}</td></tr>
                      {customQ.totals.onboarding_mad > 0 && <tr><td className="py-1.5 ic-muted">Mise en service (unique)</td><td className="py-1.5 text-right font-mono ic-muted">{fmtMad(customQ.totals.onboarding_mad)}</td></tr>}
                    </tbody>
                  </table>
                  {customQ.upsell_notes.length > 0 && <p className="mt-2 text-xs ic-muted">{customQ.upsell_notes[0]}</p>}
                  <div className="mt-3"><Link to="/demo-request?intent=custom" className="ic-btn-outline px-4 py-2 text-sm inline-block">Finaliser ce plan avec un conseiller</Link></div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function NumField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label className="text-sm font-medium ic-heading block mb-1">{label}</label>
      <input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full rounded-md border px-2 py-1.5 bg-transparent ic-heading" style={{ borderColor: 'var(--ic-border)' }} />
      {hint && <p className="mt-1 text-xs ic-muted">{hint}</p>}
    </div>
  );
}

// ---------- custom card (sales-gated) ----------------------------------------
function CustomCard() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="ic-card p-8 text-center">
        <h2 className="text-2xl font-bold ic-heading">Besoin d’un plan sur mesure&nbsp;?</h2>
        <p className="mt-2 text-sm ic-muted max-w-xl mx-auto">
          À partir de {fmtMad(CFG.custom.floor)} MAD par actif et par mois, construit avec notre équipe.
          La composition détaillée et le calculateur personnalisé sont réservés à nos conseillers commerciaux.
        </p>
        <Link to="/demo-request?intent=custom" className="ic-btn-primary mt-5 px-6 py-3 inline-block">Contacter sales</Link>
      </div>
    </section>
  );
}
