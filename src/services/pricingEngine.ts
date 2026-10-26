/**
 * INFRAvx — Pricing engine v2 (PURE function, identical logic to
 * backend/app/services/pricing_engine.py). Decimal-safe via integer cents.
 *
 * quote(config, inputs) -> { eligible, reason, lines[], totals, recommendedPack }
 *
 * Rules (see docs/pricing/README.md):
 *  - billable_units = Σ qty × weight (heavy 1.0 / light 0.5)
 *  - pack eligibility is strict; we NEVER bill a pack below its minimum
 *  - volume discount: direct clients only (partners use their tier discount)
 *  - partner: group discounts + total 40% cap, contract applied after partner
 *  - golden fixtures in tests/fixtures/pricing_golden.json must pass BOTH engines
 */
import { PRICING_CONFIG_V2, type PricingConfigV2, type PackId } from '../data/pricingConfig';

// ---------- decimal helpers (integer-cent arithmetic) ----------------------
const C = (v: number) => Math.round(v * 100);                       // MAD -> cents
const M = (cents: number) => Math.round(cents) / 100;               // cents -> MAD
const mulC = (cents: number, factor: number) => Math.round(cents * factor);

export interface AssetInput { class: string; qty: number }

export interface QuoteInputs {
  mode: 'pack' | 'custom';
  pack?: PackId;                                   // required for mode=pack
  assets: AssetInput[];                            // quantities by class
  siemGbDay?: number;                              // requested ingestion GB/day
  retentionDays?: number;                          // 30|90|180|365
  backupVolumeGb?: number;                         // only if backup in scope & entered
  contractMonths?: 0 | 12 | 24 | 36;
  support247?: boolean;                            // Pro/Custom add-on only
  customServices?: string[];                       // paid service ids (mode=custom)
  freePicks?: string[];                            // free-pool services the client wants
  partnerTier?: string;                            // present => wholesale partner quote
  dealRegisteredAt?: string | null;                // ISO date; within 12 months => bonus
}

export interface QuoteLine {
  key: string; label_fr: string; qty?: number; unit_mad?: number;
  amount_mad: number; kind: 'asset' | 'storage' | 'soc247' | 'discount' | 'onboarding' | 'vat' | 'info';
  note?: string;
}

export interface QuoteTotals {
  units: number; price_per_unit_mad: number;
  subtotal_mad: number; volume_discount_mad: number; contract_discount_mad: number;
  partner_discount_mad: number; cap_applied: boolean;
  monthly_excl_vat_mad: number; vat_mad: number; monthly_incl_vat_mad: number;
  annual_excl_vat_mad: number; onboarding_mad: number; first_year_incl_vat_mad: number;
  effective_per_unit_mad: number; effective_per_asset_mad: number;
}

export interface QuoteResult {
  eligible: boolean; reason?: string; config_version: string; mode: string; pack?: string;
  lines: QuoteLine[]; totals: QuoteTotals; recommended_pack?: PackId;
  upsell_notes: string[]; groups?: Record<'asset' | 'storage' | 'soc', { list: number; net: number }>;
}

// ---------- shared primitives ----------------------------------------------
export function billableUnits(cfg: PricingConfigV2, assets: AssetInput[]): number {
  return assets.reduce((s, a) => s + a.qty * (cfg.assetClasses[a.class] ?? 1), 0);
}

export function graduatedCost(cfg: PricingConfigV2, gb: number): number /* cents */ {
  let rem = gb, bandIdx = 0, total = 0;
  const bands = cfg.siem.graduatedRatesPerGbDay;
  while (rem > 0 && bandIdx < bands.length) {
    const [cap, rate] = bands[bandIdx];
    const prevCap = bandIdx === 0 ? 0 : (bands[bandIdx - 1][0] as number);
    const width = cap === null ? Infinity : cap - prevCap;
    const take = Math.min(rem, width);
    total += C(take * rate);
    rem -= take; bandIdx++;
  }
  return Math.round(total);
}

export function volumeRate(cfg: PricingConfigV2, units: number): number {
  for (const [min, r] of cfg.volumeDiscount) if (units >= min) return r;
  return 0;
}

export function includedSiem(cfg: PricingConfigV2, pack: PackId | 'custom', units: number): number {
  if (pack === 'custom') return 0;
  const q = cfg.packs[pack].siemQuota;
  return Math.max(q.min, units * q.perUnit);
}

export function partnerTierFor(cfg: PricingConfigV2, managedUnits: number) {
  let t = cfg.partner.tiers[0];
  for (const x of cfg.partner.tiers) if (managedUnits >= x.minManagedUnits) t = x;
  return t;
}

const EMPTY_TOTALS: QuoteTotals = {
  units: 0, price_per_unit_mad: 0, subtotal_mad: 0, volume_discount_mad: 0, contract_discount_mad: 0,
  partner_discount_mad: 0, cap_applied: false, monthly_excl_vat_mad: 0, vat_mad: 0, monthly_incl_vat_mad: 0,
  annual_excl_vat_mad: 0, onboarding_mad: 0, first_year_incl_vat_mad: 0, effective_per_unit_mad: 0, effective_per_asset_mad: 0,
};

// ---------- main entry -------------------------------------------------------
export function quote(inputs: QuoteInputs, cfg: PricingConfigV2 = PRICING_CONFIG_V2): QuoteResult {
  return quoteCore(inputs, cfg, true);
}

function quoteCore(inputs: QuoteInputs, cfg: PricingConfigV2, withRec: boolean): QuoteResult {
  const upsell: string[] = [];
  const units = billableUnits(cfg, inputs.assets);
  const physicalAssets = inputs.assets.reduce((s, a) => s + a.qty, 0);
  const contract = inputs.contractMonths ?? 0;
  const cRate = cfg.contractDiscount[String(contract)] ?? 0;
  const isPartner = !!inputs.partnerTier;
  const tierDef = isPartner ? (cfg.partner.tiers.find(t => t.id === inputs.partnerTier) ?? cfg.partner.tiers[0]) : null;

  // Deal-registration bonus (per-asset lines only, within 12 months)
  let dealBonus = 0;
  if (isPartner && inputs.dealRegisteredAt) {
    const age = Date.now() - new Date(inputs.dealRegisteredAt).getTime();
    if (age <= cfg.partner.dealRegistrationBonus.months * 30.44 * 864e5) dealBonus = cfg.partner.dealRegistrationBonus.points;
  }

  // ---- eligibility ----------------------------------------------------------
  let pricePerUnit = 0; let packName = ''; let included = 0; let baseSupportIncluded247 = false;
  let starterIntroActive = false;
  if (inputs.mode === 'pack') {
    const p = inputs.pack!; const def = cfg.packs[p]; packName = p;
    if (units < def.minUnits) return ineligible(cfg, units, `${label(p)} commence à ${def.minUnits} unités ; ce parc en fait ${fmtU(units)}.`, inputs, upsell);
    if (def.maxUnits !== null && units > def.maxUnits) {
      const nextHint = p === 'starter' ? `Choisissez Pro (à partir de ${cfg.packs.pro.minUnits} unités).` : '';
      return ineligible(cfg, units, `${label(p)} est limité à ${def.maxUnits} unités ; ce parc en fait ${fmtU(units)}. ${nextHint}`, inputs, upsell);
    }
    if (inputs.support247 && p === 'starter') {
      return ineligible(cfg, units, "Le support 24/7 n'est pas disponible avec Starter — choisissez Pro.", inputs, upsell);
    }
    baseSupportIncluded247 = p === 'souverain';
    let price = def.price;
    if (p === 'starter' && cfg.promotions.starterIntro.enabled && contract <= cfg.promotions.starterIntro.months) {
      price = cfg.promotions.starterIntro.price; starterIntroActive = true;
    }
    pricePerUnit = price;
    included = includedSiem(cfg, p, units);
  } else {
    // ---- CUSTOM (System B) --------------------------------------------------
    if (units < cfg.custom.minUnits) return ineligible(cfg, units, `Un plan sur mesure demande au moins ${cfg.custom.minUnits} unités.`, inputs, upsell);
    const svcIds = inputs.customServices ?? [];
    const paid = cfg.services.filter(s => svcIds.includes(s.id));
    const cumulative = cfg.custom.platformBase + paid.reduce((s, x) => s + x.price, 0); // evaluated on LIST prices
    const slots = cumulative >= cfg.custom.unlockThresholds[2] ? 3 : cumulative >= cfg.custom.unlockThresholds[1] ? 2 : cumulative >= cfg.custom.unlockThresholds[0] ? 1 : 0;
    // ticketing free only at top threshold (slot 3)
    const picks = (inputs.freePicks ?? []).filter(id => id !== 'ticketing' || slots >= 3);
    // Slot allocation follows the config tick order of freePool (dns, analytics,
    // threat_intel); ticketing is only ever free at the top threshold.
    const poolOrder = cfg.freePool.filter(f => !f.topTierOnly).map(f => f.id);
    // Best-for-client allocation: the most valuable requested gifts fill the
    // slots first; the rest are billed at list price. Ticketing is only ever
    // free at the top threshold (topTierOnly).
    const requested = poolOrder
      .filter(id => picks.includes(id))
      .sort((a, b) => (cfg.freePool.find(f => f.id === b)?.listPrice ?? 0) - (cfg.freePool.find(f => f.id === a)?.listPrice ?? 0));
    const billedFree = requested.slice(slots);
    const billedList = cfg.freePool.filter(f => billedFree.includes(f.id)).reduce((s, f) => s + f.listPrice, 0);
    pricePerUnit = Math.max(cfg.custom.floor, cumulative + billedList);
    included = 0;
    if (inputs.support247 && slots >= 0) { /* allowed on custom */ }
    upsell.push(...unlockNudges(cumulative, slots, cfg));
  }

  // ---- recurring lines (cents) ----------------------------------------------
  const lines: QuoteLine[] = [];
  const assetGroupC: number[] = [];   // per-asset lines (assets + 24/7 add-on + billed free-pool are inside price/unit for custom)
  const storageGroupC: number[] = [];
  const socGroupC: number[] = [];

  const assetsC = Math.round(C(units) * pricePerUnit / 100 * 100); // units*price in cents (units may be .5 → exact)
  lines.push({
    key: 'assets', label_fr: `Supervision de ${fmtU(units)} unité(s)-service${starterIntroActive ? ' (tarif de lancement, puis ' + cfg.packs.starter.price + ')' : ''}`,
    qty: units, unit_mad: pricePerUnit, amount_mad: M(assetsC), kind: 'asset',
  });
  assetGroupC.push(assetsC);

  // 24/7 support add-on (Pro & Custom only; Souverain includes it)
  if (inputs.support247) {
    const suppC = Math.round(C(units) * cfg.support247PerUnit / 100 * 100);
    if (baseSupportIncluded247) {
      lines.push({ key: 'support247', label_fr: 'Support 24/7 — inclus dans le pack', amount_mad: 0, kind: 'info', note: 'included' });
    } else if (inputs.mode === 'custom') {
      // Custom already prices every selected service per unit; the 24/7 on-call
      // is included at no extra charge (Souverain-equivalent rule).
      lines.push({ key: 'support247', label_fr: 'Astreinte 24/7 — incluse (plan sur mesure complet)', amount_mad: 0, kind: 'info', note: 'included' });
    } else {
      lines.push({ key: 'support247', label_fr: 'Astreinte 24/7 (SOC)', qty: units, unit_mad: cfg.support247PerUnit, amount_mad: M(suppC), kind: 'soc247' });
      socGroupC.push(suppC);
    }
  } else if (inputs.mode === 'pack' && !baseSupportIncluded247 && inputs.pack === 'pro') {
    lines.push({ key: 'support247_opt', label_fr: 'Astreinte 24/7 non souscrite (optionnelle)', amount_mad: 0, kind: 'info' });
  }

  // SIEM overage (graduated delta above included quota)
  const reqRaw = inputs.siemGbDay ?? 0;
  const reqGb = reqRaw > 0 ? Math.max(reqRaw, cfg.siem.minGbPerDay) : 0;
  if (reqGb > 0) {
    const chargeC = Math.max(0, graduatedCost(cfg, reqGb) - graduatedCost(cfg, Math.max(included, 0)));
    if (chargeC > 0) {
      lines.push({ key: 'siem', label_fr: `SIEM — ${fmtU(reqGb)} Go/jour (dont ${fmtU(Math.max(included, 0))} Go inclus)`, qty: reqGb, amount_mad: M(chargeC), kind: 'storage' });
      storageGroupC.push(chargeC);
    } else {
      lines.push({ key: 'siem', label_fr: `SIEM — ${fmtU(reqGb)} Go/jour : inclus (${fmtU(included)} Go)`, amount_mad: 0, kind: 'info', note: 'included' });
    }
  }

  // Retention uplift
  const retSel = inputs.retentionDays ?? 30;
  const baseRet = inputs.mode === 'pack' ? cfg.packs[inputs.pack!].retentionDays : 30;
  const mSel = cfg.siem.retentionMultiplier[String(retSel)] ?? 1;
  const mBase = cfg.siem.retentionMultiplier[String(baseRet)] ?? 1;
  if (mSel > mBase && reqGb > 0) {
    const effGb = Math.max(reqGb, included);
    const uplC = Math.round(graduatedCost(cfg, effGb) * (mSel - mBase));
    if (uplC > 0) {
      lines.push({ key: 'retention', label_fr: `Rétention ${retSel} jours (×${mSel})`, amount_mad: M(uplC), kind: 'storage' });
      storageGroupC.push(uplC);
    }
  } else if (mSel > mBase && reqGb === 0) {
    lines.push({ key: 'retention', label_fr: `Rétention ${retSel} jours — sans ingestion SIEM, incluse`, amount_mad: 0, kind: 'info' });
  }

  // Backup overage
  const backupInScope = inputs.mode === 'pack'
    ? true // every pack includes backup with a quota
    : (inputs.customServices ?? []).includes('backup');
  const quotaPerUnit = inputs.mode === 'pack' ? cfg.packs[inputs.pack!].backupQuotaGbPerUnit : cfg.custom.backupQuotaGbPerUnit;
  if (backupInScope && (inputs.backupVolumeGb ?? 0) > 0) {
    const quota = units * quotaPerUnit;
    const over = Math.max(0, inputs.backupVolumeGb! - quota);
    const blocks = Math.ceil(over / cfg.backup.overageBlockGb);
    const bkC = C(blocks * cfg.backup.overagePerBlock);
    if (blocks > 0) {
      lines.push({ key: 'backup_over', label_fr: `Sauvegarde — ${fmtU(over)} Go au-delà du quota (${fmtU(quota)} Go), ${blocks} bloc(s) de ${cfg.backup.overageBlockGb} Go`, qty: blocks, unit_mad: cfg.backup.overagePerBlock, amount_mad: M(bkC), kind: 'storage' });
      storageGroupC.push(bkC);
      const warn = cfg.upsell.backupQuotaWarnPct;
      if ((inputs.backupVolumeGb!) >= quota * warn) upsell.push(`Sauvegarde proche du quota (${Math.round((inputs.backupVolumeGb! / quota) * 100)} % utilisé).`);
    } else {
      lines.push({ key: 'backup_over', label_fr: `Sauvegarde — ${inputs.backupVolumeGb} Go dans le quota (${fmtU(quota)} Go)`, amount_mad: 0, kind: 'info', note: 'included' });
    }
  }

  // ---- discounts ------------------------------------------------------------
  const subtotalC = assetGroupC.reduce((a, b) => a + b, 0) + storageGroupC.reduce((a, b) => a + b, 0) + socGroupC.reduce((a, b) => a + b, 0);
  let volumeC = 0;
  if (!isPartner && inputs.mode === 'pack') {
    const vr = volumeRate(cfg, units);
    if (vr > 0) {
      volumeC = Math.round(subtotalC * vr);
      lines.push({ key: 'volume', label_fr: `Remise volume (${Math.round(vr * 100)} %) — ${fmtU(units)} unités`, amount_mad: -M(volumeC), kind: 'discount' });
    }
  }

  let partnerDiscC = 0; let capApplied = false;
  const groupsOut: Record<'asset' | 'storage' | 'soc', { list: number; net: number }> = {
    asset: { list: M(assetGroupC.reduce((a, b) => a + b, 0)), net: 0 },
    storage: { list: M(storageGroupC.reduce((a, b) => a + b, 0)), net: 0 },
    soc: { list: M(socGroupC.reduce((a, b) => a + b, 0)), net: 0 },
  };

  let recurringAfterPartnerC = subtotalC - volumeC;

  if (isPartner && tierDef) {
    // Partner wholesale: tier replaces volume discount; no onboarding.
    const dAsset = Math.min(1, tierDef.discount + dealBonus);
    const dStorage = Math.max(cfg.partner.storageLineMinDiscount, tierDef.discount - cfg.partner.storageLineDiscountOffset);
    const dSoc = cfg.partner.soc247Discount;
    const cap = cfg.partner.totalDiscountCap;
    const A = assetGroupC.reduce((a, b) => a + b, 0), S = storageGroupC.reduce((a, b) => a + b, 0), O = socGroupC.reduce((a, b) => a + b, 0);
    const netG = (list: number, p: number): number => {
      // contract applied AFTER partner discount, capped so total ≤ cap off list
      const rawNet = Math.round(list * (1 - p) * (1 - cRate));
      const floorNet = Math.round(list * (1 - cap));
      if (rawNet < floorNet) { capApplied = true; return floorNet; }
      return rawNet;
    };
    const netA = netG(A, dAsset), netS = netG(S, dStorage), netO = netG(O, dSoc);
    partnerDiscC = (A - Math.round(A * (1 - dAsset))) + (S - Math.round(S * (1 - dStorage))) + (O - Math.round(O * (1 - dSoc)));
    const partnerContractC = (Math.round(A * (1 - dAsset)) - netA) + (Math.round(S * (1 - dStorage)) - netS) + (Math.round(O * (1 - dSoc)) - netO);
    lines.push({ key: 'partner', label_fr: `Remise partenaire ${tierDef.id} (${Math.round(dAsset * 100)} % lignes par unité · ${Math.round(dStorage * 100)} % stockage · ${Math.round(dSoc * 100)} % SOC)` + (dealBonus ? ' + bonus affaire enregistrée' : ''), amount_mad: -M(partnerDiscC), kind: 'discount' });
    if (cRate > 0) lines.push({ key: 'contract', label_fr: `Remise contrat ${contract} mois (${Math.round(cRate * 100)} %)` + (capApplied ? ' — plafond de remise global appliqué' : ''), amount_mad: -M(partnerContractC), kind: 'discount' });
    recurringAfterPartnerC = netA + netS + netO;
    groupsOut.asset.net = M(netA); groupsOut.storage.net = M(netS); groupsOut.soc.net = M(netO);
  } else {
    let contractBaseC = subtotalC - volumeC;
    if (cRate > 0) {
      const cdC = Math.round(contractBaseC * cRate);
      lines.push({ key: 'contract', label_fr: `Remise contrat ${contract} mois (${Math.round(cRate * 100)} %)`, amount_mad: -M(cdC), kind: 'discount' });
      recurringAfterPartnerC = contractBaseC - cdC;
    }
    groupsOut.asset.net = groupsOut.asset.list; groupsOut.storage.net = groupsOut.storage.list; groupsOut.soc.net = groupsOut.soc.list;
  }

  // Onboarding (one-time)
  let onboardC = 0; let onboardNote: string | undefined;
  if (isPartner) { onboardNote = 'Onboarding réalisé par le partenaire — facturation plateforme annulée'; }
  else if (contract >= cfg.onboardingWaivedAtMonths) { onboardNote = `Frais d'onboarding offerts (contrat ${contract} mois)`; }
  else {
    onboardC = C(inputs.mode === 'pack' ? cfg.packs[inputs.pack!].onboarding
      : cfg.custom.onboardingBase + cfg.custom.onboardingPerPaidService * (inputs.customServices ?? []).length);
  }
  if (onboardC > 0) lines.push({ key: 'onboarding', label_fr: "Mise en service (une fois)", amount_mad: M(onboardC), kind: 'onboarding' });
  else if (onboardNote) lines.push({ key: 'onboarding', label_fr: onboardNote, amount_mad: 0, kind: 'info' });

  // Totals
  const monthlyExcl = M(recurringAfterPartnerC);
  const vatC = Math.round(recurringAfterPartnerC * cfg.vat);
  const monthlyIncl = M(recurringAfterPartnerC + vatC);
  lines.push({ key: 'vat', label_fr: `TVA ${Math.round(cfg.vat * 100)} %`, amount_mad: M(vatC), kind: 'vat' });
  const firstYear = M(recurringAfterPartnerC * 12 + vatC * 12 + onboardC);

  const totals: QuoteTotals = {
    units, price_per_unit_mad: pricePerUnit,
    subtotal_mad: M(subtotalC), volume_discount_mad: M(volumeC),
    contract_discount_mad: lines.filter(l => l.key === 'contract').reduce((s, l) => s - l.amount_mad, 0),
    partner_discount_mad: M(partnerDiscC), cap_applied: capApplied,
    monthly_excl_vat_mad: monthlyExcl, vat_mad: M(vatC), monthly_incl_vat_mad: monthlyIncl,
    annual_excl_vat_mad: M(recurringAfterPartnerC * 12), onboarding_mad: M(onboardC),
    first_year_incl_vat_mad: firstYear,
    effective_per_unit_mad: units > 0 ? +(monthlyExcl / units).toFixed(2) : 0,
    effective_per_asset_mad: physicalAssets > 0 ? +(monthlyExcl / physicalAssets).toFixed(2) : 0,
  };

  // Upsell trigger: Starter near cap
  if (inputs.mode === 'pack' && inputs.pack === 'starter' && units >= cfg.upsell.starterNearCapUnits) {
    upsell.push(`Pro démarre à ${cfg.packs.pro.minUnits} unités et inclut davantage de services et un quota SIEM.`);
  }
  // Estimator SIEM hint: Starter asking for SIEM while Pro-eligible
  if (inputs.mode === 'pack' && inputs.pack === 'starter' && reqGb > 0 && units >= cfg.packs.pro.minUnits) {
    upsell.push(`Pro inclut jusqu'à ${fmtU(includedSiem(cfg, 'pro', units))} Go/jour de SIEM.`);
  }

  return {
    eligible: true, config_version: cfg.version, mode: inputs.mode, pack: packName || 'custom',
    lines, totals, recommended_pack: withRec ? recommendPack(cfg, inputs) : undefined,
    upsell_notes: upsell, groups: isPartner ? groupsOut : undefined,
  };
}

// ---------- recommended pack (cheapest eligible, incl. extras) ---------------
function recommendPack(cfg: PricingConfigV2, inputs: QuoteInputs): PackId | undefined {
  if (inputs.mode !== 'pack') return undefined;
  let best: { p: PackId; cost: number } | undefined;
  for (const p of Object.keys(cfg.packs) as PackId[]) {
    const r = quoteCore({ ...inputs, pack: p, support247: inputs.support247 && p !== 'starter' }, cfg, false);
    if (r.eligible && (!best || r.totals.monthly_excl_vat_mad < best.cost)) best = { p, cost: r.totals.monthly_excl_vat_mad };
  }
  return best?.p;
}

function unlockNudges(cumulative: number, slots: number, cfg: PricingConfigV2): string[] {
  const out: string[] = []; const th = cfg.custom.unlockThresholds;
  const giftValue = (id: string) => (cfg.freePool.find(f => f.id === id)?.listPrice ?? 0);
  if (slots < 1) out.push(`Ajoutez ${th[0] - cumulative} MAD/actif de services pour débloquer 1 service offert.`);
  else if (slots < 2) out.push(`Encore ${Math.max(0, th[1] - cumulative)} MAD/actif pour débloquer un 2ᵉ service offert.`);
  else if (slots < 3) out.push(`Encore ${Math.max(0, th[2] - cumulative)} MAD/actif pour débloquer un 3ᵉ service offert (+ guichet de service).`);
  void giftValue;
  return out;
}

function label(p: PackId): string { return p === 'starter' ? 'Starter' : p === 'pro' ? 'Pro' : 'Souverain'; }
function fmtU(u: number): string { return Number.isInteger(u) ? String(u) : u.toFixed(1).replace('.', ','); }

function ineligible(cfg: PricingConfigV2, units: number, reason: string, inputs: QuoteInputs, upsell: string[]): QuoteResult {
  return {
    eligible: false, reason, config_version: cfg.version, mode: inputs.mode,
    pack: inputs.pack ?? 'custom', lines: [], totals: { ...EMPTY_TOTALS, units },
    recommended_pack: recommendPack(cfg, inputs), upsell_notes: upsell,
  };
}

// ---------- margin helper (§7) ------------------------------------------------
export function partnerMargin(resalePerUnit: number, wholesalePerUnit: number) {
  return {
    per_unit: +(resalePerUnit - wholesalePerUnit).toFixed(2),
    monthly: (units: number) => +((resalePerUnit - wholesalePerUnit) * units).toFixed(2),
  };
}
