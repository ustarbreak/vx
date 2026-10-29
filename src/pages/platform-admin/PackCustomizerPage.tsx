// ---------------------------------------------------------------------------
// PackCustomizerPage — platform-admin wizard to customize the pricing packs.
// Route: /admin/packs (sidebar "Pack Customizer", platform_admin only).
//
// Everything the admin needs is ALREADY DISPLAYED: each step shows the full
// service catalog with the current pack contents pre-checked, so building a
// pack offer = checking/unchecking boxes step by step, then saving.
//
// Steps per pack:
//   1. Positionnement   — prix/unité, palier d'unités, rétention, sauvegarde, support, onboarding
//   2. Services payants — les 13 services du catalogue (cases pré-cochées selon le pack)
//   3. Options incluses — le free-pool (DNS, analytique, threat intel, ticketing)
//   4. Récapitulatif    — ce que le pack accorde réellement (dérivé, identique au backend)
//
// Real mode  : PUT /api/v1/pricing/packs/{id} (pricing_v2.py — persists
//              PlanEntitlementV2 rows + audit log; GET /pricing/config serves
//              the live `packDetails` everywhere: pricing page, tenant portal,
//              locked cards, seed entitlements).
// Demo mode  : same shapes served in-memory by demoMode.ts.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Package, Check, X, RotateCcw, Save, ChevronLeft, ChevronRight,
  ShieldCheck, Sparkles, Info, Boxes,
} from 'lucide-react';
import { pricingPacksApi, type PackEffectiveInfo } from '../../services/api';
import {
  PRICING_CONFIG_V2, DEFAULT_PACK_DETAILS, SERVICE_LABELS_FR, ASSET_CLASS_LABELS_FR,
  fmtMad, packServicesFrom, type PackCustomizerDef, type PricingConfigV2,
} from '../../data/pricingConfig';

const PACK_META: Record<string, { label: string; blurb: string }> = {
  starter:   { label: 'Starter',   blurb: 'PME ≤ 49 unités — socle de supervision managée' },
  pro:       { label: 'Pro',       blurb: '50+ unités — SOC étendu + messageries + réseau' },
  souverain: { label: 'Souverain', blurb: '100+ unités — plateforme dédiée, SOAR & cloud' },
};

const STEPS = [
  { id: 0, title: 'Positionnement', icon: Boxes },
  { id: 1, title: 'Services payants', icon: ShieldCheck },
  { id: 2, title: 'Options incluses', icon: Sparkles },
  { id: 3, title: 'Récapitulatif', icon: Check },
];

export default function PackCustomizerPage() {
  const [cfg, setCfg] = useState<PricingConfigV2>(PRICING_CONFIG_V2);
  const [packs, setPacks] = useState<Record<string, PackCustomizerDef>>(
    JSON.parse(JSON.stringify(DEFAULT_PACK_DETAILS)));
  const [effective, setEffective] = useState<Record<string, PackEffectiveInfo>>({});
  const [selPack, setSelPack] = useState('starter');
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const [c, p] = await Promise.all([pricingPacksApi.config(), pricingPacksApi.packs()]);
      setCfg(c);
      setPacks(JSON.parse(JSON.stringify(p.packs)));
      setEffective(p.effective ?? {});
    } catch (e: any) {
      setErr(e?.message || 'Impossible de charger la configuration des packs.');
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const packIds = Object.keys(PACK_META);
  const def = packs[selPack];
  const derivedAll = useMemo(() => packServicesFrom(cfg), [cfg]);

  const toggle = (kind: 'services' | 'freePicks', id: string) => {
    setPacks(prev => {
      const d = { ...prev[selPack] };
      const list = [...(d as any)[kind]] as string[];
      (d as any)[kind] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
      return { ...prev, [selPack]: d };
    });
    setDirty(true);
  };
  const setNum = (key: keyof PackCustomizerDef, v: number | string | null) => {
    setPacks(prev => ({ ...prev, [selPack]: { ...prev[selPack], [key]: v } as PackCustomizerDef }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await pricingPacksApi.savePack(selPack, def);
      setDirty(false);
      setMsg(`Pack « ${PACK_META[selPack].label} » enregistré — la page Tarifs, le portail client et les droits (entitlements) reflètent désormais cette composition.`);
      await load();
    } catch (e: any) { setErr(e?.message || 'Échec de l\'enregistrement.'); }
    finally { setBusy(false); }
  };
  const resetOne = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await pricingPacksApi.savePack(selPack, JSON.parse(JSON.stringify(DEFAULT_PACK_DETAILS[selPack])));
      setMsg('Pack restauré dans sa composition par défaut.');
      await load(); setDirty(false);
    } catch (e: any) { setErr(e?.message || 'Échec de la restauration.'); }
    finally { setBusy(false); }
  };

  // ---- derived preview of what this pack grants ----------------------------
  const paidList = cfg.services;                    // 13 paid services
  const freeList = cfg.freePool;                    // 4 free-pool options
  const includedSet = new Set([...def.services, ...def.freePicks]);
  const baseIncluded = new Set([...(DEFAULT_PACK_DETAILS[selPack]?.services ?? []), ...(DEFAULT_PACK_DETAILS[selPack]?.freePicks ?? [])]);
  const added = [...includedSet].filter(x => !baseIncluded.has(x));
  const removed = [...baseIncluded].filter(x => !includedSet.has(x));

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--ic-primary)]/15"><Package className="w-6 h-6 text-[var(--ic-primary)]" /></div>
          <div>
            <h1 className="text-xl font-bold text-[var(--ic-heading)]">Pack Customizer</h1>
            <p className="text-sm text-[var(--ic-muted)]">
              Composition des offres · config version {cfg.version} — tout est affiché, il suffit de cocher/décocher.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={resetOne} disabled={busy}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)] flex items-center gap-2">
            <RotateCcw className="w-4 h-4" /> Défaut
          </button>
          <button onClick={save} disabled={busy || !dirty}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--ic-primary)] text-white hover:opacity-90 disabled:opacity-40 flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer le pack
          </button>
        </div>
      </div>

      {msg && <div className="rounded-lg border border-emerald-700 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-300 flex gap-2"><Check className="w-4 h-4 shrink-0 mt-0.5" />{msg}</div>}
      {err && <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300 flex gap-2"><X className="w-4 h-4 shrink-0 mt-0.5" />{err}</div>}

      {/* Pack selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {packIds.map(pid => {
          const eff = effective[pid];
          const d = packs[pid];
          const n = d ? d.services.length + d.freePicks.length : 0;
          return (
            <button key={pid} onClick={() => { setSelPack(pid); setStep(0); }}
              className={`text-left rounded-xl border p-4 transition ${selPack === pid
                ? 'border-[var(--ic-primary)] bg-[var(--ic-primary)]/10'
                : 'border-[var(--ic-border)] bg-[var(--ic-surface)] hover:border-[var(--ic-primary)]/50'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--ic-heading)]">{PACK_META[pid].label}</span>
                {eff?.configured && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">personnalisé</span>}
              </div>
              <p className="text-xs text-[var(--ic-muted)] mt-1">{PACK_META[pid].blurb}</p>
              <p className="text-sm mt-2 text-[var(--ic-heading)]">
                {fmtMad((cfg.packs as any)[pid]?.price ?? 0)} <span className="text-xs text-[var(--ic-muted)]">/ unité / mois · {n} services</span>
              </p>
            </button>
          );
        })}
      </div>

      {/* Step tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map(s => (
          <button key={s.id} onClick={() => setStep(s.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${step === s.id
              ? 'bg-[var(--ic-primary)] text-white border-transparent'
              : 'border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
            <s.icon className="w-4 h-4" /> Étape {s.id + 1} · {s.title}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button onClick={() => setStep(v => Math.max(0, v - 1))} disabled={step === 0}
            className="p-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setStep(v => Math.min(3, v + 1))} disabled={step === 3}
            className="p-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* STEP 1 — Positionnement */}
      {step === 0 && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-[var(--ic-heading)]">1 · Positionnement du pack {PACK_META[selPack].label}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <NumField label="Prix / unité / mois (MAD HT)" value={(def as any).price} onChange={v => setNum('price' as any, v)} />
            <NumField label="Unités minimum" value={(def as any).minUnits} onChange={v => setNum('minUnits' as any, v)} />
            <NumField label="Unités maximum (vide = illimité)" value={(def as any).maxUnits ?? null} onChange={v => setNum('maxUnits' as any, v)} allowEmpty />
            <NumField label="Rétention SIEM (jours)" value={(def as any).retentionDays} onChange={v => setNum('retentionDays' as any, v)} />
            <NumField label="Sauvegarde incluse (Go / unité)" value={(def as any).backupQuotaGbPerUnit} onChange={v => setNum('backupQuotaGbPerUnit' as any, v)} />
            <div>
              <label className="block text-xs text-[var(--ic-muted)] mb-1">Support</label>
              <input value={(def as any).support ?? ''} onChange={e => setNum('support' as any, e.target.value)}
                className="w-full rounded-lg bg-transparent border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)]" />
            </div>
            <NumField label="Onboarding (MAD HT, one-shot)" value={(def as any).onboarding} onChange={v => setNum('onboarding' as any, v)} />
            <div className="flex items-end">
              <p className="text-xs text-[var(--ic-muted)] leading-relaxed">
                Le quota SIEM inclus ({(def as any).siemQuota?.perUnit ?? 0} Go/jour × unités, min {(def as any).siemQuota?.min ?? 0}) provient du moteur de tarification — modifiez-le via la config JSON versionnée.
              </p>
            </div>
          </div>
          <div className="text-xs text-[var(--ic-muted)] flex gap-2 items-start"><Info className="w-4 h-4 shrink-0" />
            Ces valeurs alimentent le calculateur public (/pricing), les factures démo et les devis (POST /pricing/quote recalculé côté serveur).
          </div>
        </div>
      )}

      {/* STEP 2 — Paid services */}
      {step === 1 && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-[var(--ic-heading)]">2 · Services payants inclus ({def.services.length}/{paidList.length})</h2>
          <p className="text-sm text-[var(--ic-muted)]">Chaque case cochée = service accordé aux clients de ce pack (cartes déverrouillées dans leur portail, entitlements en base).</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {paidList.map(s => {
              const on = def.services.includes(s.id);
              return (
                <label key={s.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${on ? 'border-[var(--ic-primary)]/60 bg-[var(--ic-primary)]/10' : 'border-[var(--ic-border)]'}`}>
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={on} onChange={() => toggle('services', s.id)} className="accent-[var(--ic-primary)] w-4 h-4" />
                    <span className="text-sm text-[var(--ic-heading)]">{SERVICE_LABELS_FR[s.id] ?? s.id}</span>
                  </span>
                  <span className="text-xs text-[var(--ic-muted)] whitespace-nowrap">{fmtMad(s.price)} · T{s.tier}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 3 — Free pool */}
      {step === 2 && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-[var(--ic-heading)]">3 · Options offertes incluses ({def.freePicks.length}/{freeList.length})</h2>
          <p className="text-sm text-[var(--ic-muted)]">Services du « free pool » — valeur catalogue affichée, facturés 0 MAD quand le pack les inclut.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {freeList.map(f => {
              const on = def.freePicks.includes(f.id);
              return (
                <label key={f.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${on ? 'border-emerald-600/60 bg-emerald-600/10' : 'border-[var(--ic-border)]'}`}>
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={on} onChange={() => toggle('freePicks', f.id)} className="accent-emerald-500 w-4 h-4" />
                    <span className="text-sm text-[var(--ic-heading)]">{SERVICE_LABELS_FR[f.id] ?? f.id}</span>
                  </span>
                  <span className="text-xs text-[var(--ic-muted)] whitespace-nowrap">
                    valeur {fmtMad(f.listPrice)}{f.topTierOnly ? ' · réservé pack supérieur' : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 4 — Recap */}
      {step === 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 space-y-2">
            <h2 className="font-semibold text-[var(--ic-heading)]">4 · Ce que le pack {PACK_META[selPack].label} accorde</h2>
            <ul className="text-sm space-y-1.5 mt-2">
              {[...derivedAll[selPack] ?? []].map(sid => (
                <li key={sid} className="flex gap-2 text-[var(--ic-heading)]">
                  <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                  {SERVICE_LABELS_FR[sid] ?? sid}
                  <span className="ml-auto text-xs text-[var(--ic-muted)]">
                    {cfg.services.some(s => s.id === sid)
                      ? `${fmtMad(cfg.services.find(s => s.id === sid)!.price)}/unité`
                      : `offert (valeur ${fmtMad(cfg.freePool.find(f => f.id === sid)?.listPrice ?? 0)})`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--ic-muted)] pt-2 border-t border-[var(--ic-border)]">
              Valeur catalogue totale si acheté à l'unité :{' '}
              <strong className="text-[var(--ic-heading)]">
                {fmtMad(cfg.services.filter(s => def.services.includes(s.id)).reduce((a, s) => a + s.price, 0)
                  + cfg.freePool.filter(f => def.freePicks.includes(f.id)).reduce((a, f) => a + f.listPrice, 0))} /unité/mois
              </strong>{' '}
              contre {fmtMad((def as any).price ?? 0)} /unité avec le pack.
            </p>
          </div>
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-[var(--ic-heading)]">Différences vs composition par défaut</h3>
            {added.length === 0 && removed.length === 0 && (
              <p className="text-sm text-[var(--ic-muted)]">Identique à l'offre livrée — aucune modification non enregistrée sur les cases ? Utilisez « Précédent » pour revenir en arrière.</p>
            )}
            {added.map(a => (
              <div key={a} className="flex items-center gap-2 text-sm text-emerald-400"><Check className="w-4 h-4" /> + {SERVICE_LABELS_FR[a] ?? a}</div>
            ))}
            {removed.map(r => (
              <div key={r} className="flex items-center gap-2 text-sm text-red-400"><X className="w-4 h-4" /> − {SERVICE_LABELS_FR[r] ?? r}</div>
            ))}
            <div className="pt-3 border-t border-[var(--ic-border)] text-xs text-[var(--ic-muted)] space-y-1">
              <p>Impact à l'enregistrement (mode réel) :</p>
              <ul className="list-disc list-inside">
                <li>GET /pricing/config → `packDetails` mis à jour (page Tarifs publique)</li>
                <li>GET /pricing/entitlements → cartes verrouillées du portail client</li>
                <li>plan_entitlements_v2 → droits seedés des nouveaux tenants</li>
                <li>Journal d'audit plateforme → événement « pricing.pack.updated »</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Legend: asset classes (context for min/max units) */}
      <div className="text-xs text-[var(--ic-muted)] bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
        Rappel — classes d'actifs et pondération (1 unité facturée = …) :{' '}
        {Object.entries(cfg.assetClasses).map(([k, w]) => `${ASSET_CLASS_LABELS_FR[k] ?? k} ×${w}`).join(' · ')}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, allowEmpty }: {
  label: string; value: number | null | undefined; onChange: (v: number | null) => void; allowEmpty?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--ic-muted)] mb-1">{label}</label>
      <input type="number" value={value ?? (allowEmpty ? '' : 0)}
        onChange={e => {
          const raw = e.target.value;
          onChange(raw === '' && allowEmpty ? null : Number(raw));
        }}
        className="w-full rounded-lg bg-transparent border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)]" />
    </div>
  );
}
