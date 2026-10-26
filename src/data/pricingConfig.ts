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

export interface PricingConfigV2 {
  version: string; currency: string; vat: number;
  assetClasses: Record<string, number>;
  packs: Record<'starter' | 'pro' | 'souverain', PackDef>;
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

/** Services included in each pack (mapping section §2). */
export const PACK_SERVICES: Record<PackId, string[]> = (() => {
  const starter = ['endpoint', 'vuln', 'patch', 'backup', 'compliance'];
  const pro = [...starter, 'email', 'incident', 'network', 'dns', 'analytics', 'threat_intel', 'ticketing'];
  const souverain = [...pro, 'soar', 'cloud', 'firewall_mgmt', 'vpn', 'sdwan'];
  return { starter, pro, souverain };
})();

export function fmtMad(n: number): string {
  // French spacing: "12 345,50 MAD" (narrow no-break space before units)
  const s = n.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${s}\u202fMAD`;
}
