/**
 * INFRAvx — Pricing configuration v2026.10-2 (SINGLE SOURCE OF TRUTH, versioned).
 * Mirror of backend/app/services/pricing_engine.py PRICING_CONFIG.
 * NEVER hardcode prices in components — read them from here (or from
 * GET /api/pricing/config in real mode; demo mode uses this bundled copy).
 *
 * To change prices: edit this file + the Python mirror, bump `version`,
 * run tests/fixtures/pricing_golden.json in BOTH engines (npm test + pytest).
 */

export interface PackDef {
  price: number;            // MAD HT / billable unit / month
  minUnits: number;
  maxUnits: number | null;
  tier: number;
  siemQuota: { perUnit: number; min: number };
  retentionDays: number;
  backupQuotaGbPerUnit: number;
  support: string;
  onboarding: number;       // one-time MAD HT
}

export interface ServiceDef { id: string; tier: number; price: number }
export interface FreePoolDef { id: string; tier: number; listPrice: number; topTierOnly?: boolean }

/** A pack as configured by the platform admin in the Pack Customizer
 *  (/admin/packs). `services`/`freePicks` fully describe what the pack grants —
 *  PACK_SERVICES is derived from them, never hardcoded per page. */
export interface PackCustomizerDef extends PackDef {
  id?: string;                    // starter | pro | souverain | custom…
  services: string[];             // paid service ids included in the pack
  freePicks: string[];            // free-pool ids included in the pack
}

export interface PricingConfigV2 {
  version: string; currency: string; vat: number;
  assetClasses: Record<string, number>;
  packs: Record<'starter' | 'pro' | 'souverain', PackDef>;
  /** Optional — written by the Pack Customizer (PUT /pricing/config).
   *  When present it is authoritative for pack composition everywhere. */
  packDetails?: Record<string, PackCustomizerDef>;
  custom: {
    platformBase: number; floor: number; minUnits: number; backupQuotaGbPerUnit: number;
    onboardingBase: number; onboardingPerPaidService: number; unlockThresholds: [number, number, number];
  };
  services: ServiceDef[];
  freePool: FreePoolDef[];
  backup: { overageBlockGb: number; overagePerBlock: number };
  siem: {
    minGbPerDay: number;
    graduatedRatesPerGbDay: [number | null, number][];
    retentionMultiplier: Record<string, number>;
  };
  support247PerUnit: number;
  volumeDiscount: [number, number][];
  contractDiscount: Record<string, number>;
  onboardingWaivedAtMonths: number;
  promotions: { starterIntro: { enabled: boolean; price: number; months: number } };
  healthCheck: { days: number; maxUnits: number; graceReadOnlyDays: number; oneActivePerEmailDomainDays: number };
  upsell: { starterNearCapUnits: number; backupQuotaWarnPct: number; siemOverageConsecutiveDays: number; trialCtaDay: number };
  partner: {
    tiers: { id: string; minManagedUnits: number; discount: number }[];
    dealRegistrationBonus: { points: number; months: number };
    storageLineDiscountOffset: number; storageLineMinDiscount: number;
    soc247Discount: number; totalDiscountCap: number;
    volumeDiscountApplies: boolean; onboardingWaived: boolean; downgradeGraceDays: number;
  };
}

export const PRICING_CONFIG_V2: PricingConfigV2 = {
  version: '2026.10-2', currency: 'MAD', vat: 0.20,
  assetClasses: {
    server: 1, virtual_machine: 1, workstation: 1, laptop: 1, firewall: 1,
    switch: 0.5, router: 0.5, access_point: 0.5, mailbox: 0.5, iot_printer: 0.5, other_network: 0.5,
  },
  packs: {
    starter:   { price: 269, minUnits: 10,  maxUnits: 49,  tier: 1, siemQuota: { perUnit: 0,   min: 0  }, retentionDays: 30,  backupQuotaGbPerUnit: 25,  support: '8x5',               onboarding: 4000 },
    pro:       { price: 469, minUnits: 50,  maxUnits: null, tier: 2, siemQuota: { perUnit: 0.2, min: 10 }, retentionDays: 30,  backupQuotaGbPerUnit: 50,  support: '8x5 (24/7 optional)', onboarding: 12000 },
    souverain: { price: 649, minUnits: 100, maxUnits: null, tier: 3, siemQuota: { perUnit: 0.5, min: 50 }, retentionDays: 180, backupQuotaGbPerUnit: 100, support: '24/7 included',      onboarding: 35000 },
  },
  custom: { platformBase: 99, floor: 269, minUnits: 10, backupQuotaGbPerUnit: 25, onboardingBase: 4000, onboardingPerPaidService: 400, unlockThresholds: [369, 479, 589] },
  services: [
    { id: 'endpoint', tier: 1, price: 76 }, { id: 'vuln', tier: 1, price: 43 }, { id: 'patch', tier: 1, price: 33 },
    { id: 'backup', tier: 1, price: 49 }, { id: 'compliance', tier: 1, price: 43 },
    { id: 'email', tier: 2, price: 33 }, { id: 'incident', tier: 2, price: 60 }, { id: 'network', tier: 2, price: 38 },
    { id: 'soar', tier: 3, price: 54 }, { id: 'cloud', tier: 3, price: 49 }, { id: 'firewall_mgmt', tier: 3, price: 49 },
    { id: 'vpn', tier: 3, price: 33 }, { id: 'sdwan', tier: 3, price: 49 },
  ],
  freePool: [
    { id: 'dns', tier: 2, listPrice: 15 }, { id: 'analytics', tier: 2, listPrice: 25 },
    { id: 'threat_intel', tier: 2, listPrice: 25 }, { id: 'ticketing', tier: 2, listPrice: 30, topTierOnly: true },
  ],
  backup: { overageBlockGb: 100, overagePerBlock: 45 },
  siem: {
    minGbPerDay: 10,
    graduatedRatesPerGbDay: [[10, 350], [50, 300], [200, 250], [null, 200]],
    retentionMultiplier: { '30': 1.0, '90': 1.25, '180': 1.5, '365': 1.9 },
  },
  support247PerUnit: 50,
  volumeDiscount: [[1000, 0.20], [500, 0.15], [300, 0.10], [200, 0.05], [0, 0]],
  contractDiscount: { '0': 0, '12': 0.08, '24': 0.12, '36': 0.15 },
  onboardingWaivedAtMonths: 36,
  promotions: { starterIntro: { enabled: false, price: 229, months: 6 } },
  healthCheck: { days: 30, maxUnits: 50, graceReadOnlyDays: 30, oneActivePerEmailDomainDays: 90 },
  upsell: { starterNearCapUnits: 45, backupQuotaWarnPct: 0.8, siemOverageConsecutiveDays: 3, trialCtaDay: 20 },
  partner: {
    tiers: [
      { id: 'registered', minManagedUnits: 0, discount: 0.20 },
      { id: 'silver', minManagedUnits: 100, discount: 0.25 },
      { id: 'gold', minManagedUnits: 500, discount: 0.30 },
      { id: 'platinum', minManagedUnits: 1500, discount: 0.35 },
    ],
    dealRegistrationBonus: { points: 0.05, months: 12 },
    storageLineDiscountOffset: 0.10, storageLineMinDiscount: 0.10,
    soc247Discount: 0.15, totalDiscountCap: 0.40,
    volumeDiscountApplies: false, onboardingWaived: true, downgradeGraceDays: 90,
  },
};

// ---------------------------------------------------------------------------
// Public French labels — category names ONLY (white-label rule: never OSS names,
// never "EDR"/"MDR"/"next-gen antivirus").
// ---------------------------------------------------------------------------
export const SERVICE_LABELS_FR: Record<string, string> = {
  endpoint: 'Supervision et protection des terminaux',
  vuln: 'Scan de vulnérabilités continu',
  patch: 'Gestion des correctifs',
  backup: 'Sauvegarde et plan de reprise',
  compliance: 'Rapports de conformité',
  email: 'Sécurité des messageries',
  incident: 'Réponse aux incidents',
  network: 'Supervision réseau',
  soar: 'Automatisation des réponses (SOAR)',
  cloud: 'Sécurité du cloud (CSPM)',
  firewall_mgmt: 'Gestion de pare-feu',
  vpn: 'VPN et accès zéro-confiance',
  sdwan: 'SD-WAN et inventaire réseau',
  dns: 'Filtrage DNS sécurisé',
  analytics: 'Analytique et tableaux de bord',
  threat_intel: 'Intelligence sur les menaces',
  ticketing: 'Guichet de services (ticketing)',
};

export const ASSET_CLASS_LABELS_FR: Record<string, string> = {
  server: 'Serveur physique', virtual_machine: 'Machine virtuelle', workstation: 'Poste de travail',
  laptop: 'Ordinateur portable', firewall: 'Pare-feu', switch: 'Commutateur (switch)',
  router: 'Routeur', access_point: "Point d'accès Wi-Fi", mailbox: 'Boîte aux lettres',
  iot_printer: 'Imprimante / caméra / IoT', other_network: 'Autre équipement réseau',
};

export type PackId = 'starter' | 'pro' | 'souverain';

/** Default pack composition (mapping section §2) expressed as PackCustomizerDef.
 *  This is the seed the Pack Customizer (/admin/packs) edits — NEVER hardcoded
 *  per page. PACK_SERVICES below is DERIVED from it (or from a live config). */
export const DEFAULT_PACK_DETAILS: Record<string, PackCustomizerDef> = {
  starter: {
    ...PRICING_CONFIG_V2.packs.starter, id: 'starter',
    services: ['endpoint', 'vuln', 'patch', 'backup', 'compliance'],
    freePicks: [],
  },
  pro: {
    ...PRICING_CONFIG_V2.packs.pro, id: 'pro',
    services: ['endpoint', 'vuln', 'patch', 'backup', 'compliance', 'email', 'incident', 'network'],
    freePicks: ['dns', 'analytics', 'threat_intel', 'ticketing'],
  },
  souverain: {
    ...PRICING_CONFIG_V2.packs.souverain, id: 'souverain',
    services: ['endpoint', 'vuln', 'patch', 'backup', 'compliance', 'email', 'incident', 'network', 'soar', 'cloud', 'firewall_mgmt', 'vpn', 'sdwan'],
    freePicks: ['dns', 'analytics', 'threat_intel', 'ticketing'],
  },
};

/** Derive the service list of every pack from its PackCustomizerDef
 *  (services + freePicks). Works with the bundled default OR a live config
 *  fetched from GET /api/pricing/config (which may carry admin-edited
 *  `packDetails`). Order follows the canonical catalog order in
 *  cfg.services / cfg.freePool — stable across engines and golden fixtures. */
export function packServicesFrom(cfg: PricingConfigV2): Record<string, string[]> {
  const details = cfg.packDetails ?? DEFAULT_PACK_DETAILS;
  const orderPaid = cfg.services.map(s => s.id);
  const orderFree = cfg.freePool.map(f => f.id);
  const byCatalog = (ids: string[], catalog: string[]) =>
    catalog.filter(id => ids.includes(id));
  // Anything not part of the canonical catalogs (e.g. a custom admin pick) is
  // appended in the order it was configured — nothing gets silently dropped.
  const extras = (ids: string[]) => ids.filter(id => !orderPaid.includes(id) && !orderFree.includes(id));
  const out: Record<string, string[]> = {};
  for (const [pid, d] of Object.entries(details)) {
    out[pid] = [...byCatalog(d.services, orderPaid), ...extras(d.services),
                ...byCatalog(d.freePicks, orderFree), ...extras(d.freePicks)];
  }
  return out;
}

/** Services included in each pack — derived from the canonical pack details.
 *  Pages must read this (or packServicesFrom(liveConfig)) and never hardcode.
 *  NOTE: sovereign's free picks are deduplicated because 'ticketing' etc. also
 *  appear in its paid list; consumers use Set membership anyway. */
export const PACK_SERVICES: Record<PackId, string[]> = (() => {
  const derived = packServicesFrom(PRICING_CONFIG_V2);
  const dedupe = (a: string[]) => [...new Set(a)];
  return { starter: dedupe(derived.starter), pro: dedupe(derived.pro), souverain: dedupe(derived.souverain) };
})();

export function fmtMad(n: number): string {
  // French spacing: "12 345,50 MAD" (narrow no-break space before units)
  const s = n.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${s}\u202fMAD`;
}

// ---------------------------------------------------------------------------
// Partner (wholesale) view of the catalog — used by the /pricing?view=partner
// tier page reached from "Simuler ma marge" on the MSSP program page.
// Rules come from cfg.partner only: automatic tier discount on every per-unit
// line, deal-registration bonus (+points for `months`), total-discount cap,
// volume discount NOT applied to partners, onboarding billed 0 (partner does
// it). No extra business rules are invented here.
// ---------------------------------------------------------------------------
export type PartnerMode = 'resell' | 'managed';

/** Effective wholesale discount for a tier id (+ optional deal registration),
 *  capped at cfg.partner.totalDiscountCap. */
export function partnerDiscountFor(cfg: PricingConfigV2, tierId: string, dealRegistered = false): number {
  const t = cfg.partner.tiers.find(x => x.id === tierId) ?? cfg.partner.tiers[0];
  const raw = t.discount + (dealRegistered ? cfg.partner.dealRegistrationBonus.points : 0);
  return Math.min(raw, cfg.partner.totalDiscountCap);
}

/** Wholesale price of a standard pack at a given partner tier. */
export function partnerPackPrice(cfg: PricingConfigV2, packId: PackId, tierId: string, dealRegistered = false): number {
  const d = partnerDiscountFor(cfg, tierId, dealRegistered);
  return Math.round(cfg.packs[packId].price * (1 - d));
}

/** Compose a predefined partner bundle ("compositeur de packs") from catalog
 *  service ids. Price = socle plateforme + sum of paid per-unit services
 *  (free-pool picks cost 0 list price), then the wholesale discount applies.
 *  floor/retention/backup quota follow the closest standard pack so the
 *  bundle stays consistent with the published rules. */
export interface PartnerBundleDef {
  id: string; name: string; tagline: string;
  services: string[]; freePicks: string[];
  minUnits: number; maxUnits: number | null;
  retentionDays: number; backupQuotaGbPerUnit: number; support: string;
}

export function composePartnerBundle(cfg: PricingConfigV2, services: string[], freePicks: string[]) {
  const paid = cfg.services.filter(s => services.includes(s.id));
  const free = cfg.freePool.filter(f => freePicks.includes(f.id));
  const listPerUnit = cfg.custom.platformBase + paid.reduce((a, s) => a + s.price, 0);
  const slots = cfg.custom.unlockThresholds.length;
  const grantedFree = free.slice(0, slots); // unlocked-slot logic mirrors customSlotsInfo()
  return {
    paidServices: paid,
    freeServices: free,
    grantedFreeIds: grantedFree.map(f => f.id),
    billedExtraFreeIds: free.filter(f => !grantedFree.includes(f)).map(f => f.id),
    listPerUnit,
  };
}

/** The three predefined partner bundles shipped with the program. */
export function defaultPartnerBundles(cfg: PricingConfigV2): Record<string, PartnerBundleDef> {
  const mk = (id: string, name: string, tagline: string, base: PackId, extraPaid: string[], extraFree: string[]): PartnerBundleDef => {
    const p = cfg.packs[base];
    const d = DEFAULT_PACK_DETAILS[base];
    return {
      id, name, tagline,
      services: [...d.services, ...extraPaid],
      freePicks: [...d.freePicks, ...extraFree],
      minUnits: p.minUnits, maxUnits: p.maxUnits,
      retentionDays: p.retentionDays, backupQuotaGbPerUnit: p.backupQuotaGbPerUnit,
      support: base === 'souverain' ? '24/7 inclus' : base === 'pro' ? '8x5 · 24/7 optionnel' : '8x5',
    };
  };
  return {
    'partner-starter': mk('partner-starter', 'Pack Partenaire Découverte', 'Le Starter en prix de gros — idéal premiers clients MSP', 'starter', [], []),
    'partner-growth':  mk('partner-growth', 'Pack Partenaire Croissance', 'Pro + messagerie et SOAR pour la revente différenciante', 'pro', ['soar'], []),
    'partner-max':     mk('partner-max', 'Pack Partenaire Maximale', 'Souverain complet — votre offre haut de gamme white-label', 'souverain', [], []),
  };
}
