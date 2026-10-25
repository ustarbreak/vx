// ---------------------------------------------------------------------------
// Partner Value & Loyalty — DIFFERENT system from the client one.
// Clients earn loyalty through tenure discounts + achievements
// (CustomerValueDashboard). PARTNERS are measured on a channel scorecard:
//   Revenue growth · Retention of their end-clients · Training adoption ·
//   White-label maturity · Support quality.
// The score drives Tier (Silver → Gold → Platinum) and the partner reward
// program (margin uplift, MDF, renewal commission, certifications…).
// Demo-only data; the real backend exposes the same shapes under
// /partners/{id}/value and /partners/programs.
// ---------------------------------------------------------------------------

export interface PartnerScoreComponents {
  revenue_growth: number;    // 0-100
  retention: number;         // 0-100
  training: number;          // 0-100
  whitelabel: number;        // 0-100
  support_quality: number;   // 0-100
}

export interface PartnerReward {
  id: string;
  name: string;
  description: string;
  min_tier: 'Silver' | 'Gold' | 'Platinum';
  min_score: number;
  earned: boolean;
  progress?: number; // 0-100 when not earned
}

export interface PartnerValueProfile {
  partner_id: string;
  score: number;                       // blended 0-100
  tier: 'Silver' | 'Gold' | 'Platinum';
  next_tier: 'Gold' | 'Platinum' | null;
  points_to_next_tier: number;
  components: PartnerScoreComponents;
  months_as_partner: number;
  churn_rate_pct: number;              // of their end clients
  nrr_pct: number;                     // net revenue retention (partner book)
  csat: number;                        // their end-client satisfaction
  rewards: PartnerReward[];
  history: { month: string; mrr_eur: number; clients: number }[];
}

const REWARD_CATALOG: Omit<PartnerReward, 'earned' | 'progress'>[] = [
  { id: 'r-margin', name: 'Uplift marge +5 %', description: 'Remise wholesale supplémentaire sur le renouvellement.', min_tier: 'Gold', min_score: 65 },
  { id: 'r-mdf', name: 'Market Development Fund', description: 'Budget co-marketing dédié aux campagnes locales de votre marque.', min_tier: 'Gold', min_score: 70 },
  { id: 'r-cert', name: 'Certifications offertes', description: '2 passages de certification équipe offerts par an.', min_tier: 'Gold', min_score: 72 },
  { id: 'r-priority', name: 'Support prioritaire N2', description: 'File d’escalade prioritaire chez Infracentra (réponse 2h).', min_tier: 'Silver', min_score: 50 },
  { id: 'r-renewal', name: 'Commission fidélité 3 %', description: 'Commission sur le renouvellement annuel de vos licences.', min_tier: 'Platinum', min_score: 80 },
  { id: 'r-roadmap', name: 'Accès roadmap anticipé', description: 'Bêta privée des nouvelles fonctionnalités (IA prédiction…).', min_tier: 'Platinum', min_score: 85 },
];

// Deterministic pseudo-random from a string seed (stable across reloads).
function seededRand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function partnerValueProfile(p: {
  id: string; tier: 'Silver' | 'Gold' | 'Platinum'; signed_on: string;
  license: { price_month_eur: number; client_seats_used: number };
  branding: { dns_status: string; hide_infracentra: boolean };
  training: { completed: string[]; pending: string[] };
  end_clients: { status: string; monthly_mrr_eur: number }[];
}): PartnerValueProfile {
  const rnd = seededRand(p.id);
  const total = p.training.completed.length + p.training.pending.length || 1;
  const components: PartnerScoreComponents = {
    revenue_growth: Math.round(45 + rnd() * 45),
    retention: Math.round(70 + rnd() * 28),
    training: Math.round((p.training.completed.length / total) * 100),
    whitelabel: (p.branding.dns_status === 'verified' ? 55 : p.branding.dns_status === 'pending_verification' ? 30 : 10) + (p.branding.hide_infracentra ? 40 : 0),
    support_quality: Math.round(60 + rnd() * 38),
  };
  const score = Math.round(
    components.revenue_growth * 0.3 + components.retention * 0.25 +
    components.training * 0.15 + components.whitelabel * 0.15 + components.support_quality * 0.15
  );
  const months = Math.max(1, Math.round((Date.now() - new Date(p.signed_on).getTime()) / (30.44 * 864e5)));
  const activeClients = p.end_clients.filter(c => c.status !== 'suspended').length;
  const churn = p.end_clients.length ? Math.round(((p.end_clients.length - activeClients) / p.end_clients.length) * 100 * 10) / 10 : 0;
  const nrr = Math.min(128, Math.round(95 + rnd() * 30));
  const csat = Math.round((4.1 + rnd() * 0.8) * 10) / 10;

  const nextTier = p.tier === 'Silver' ? 'Gold' : p.tier === 'Gold' ? 'Platinum' : null;
  const nextMin = p.tier === 'Silver' ? 65 : 78;
  const rewards: PartnerReward[] = REWARD_CATALOG.map(r => {
    const tierOk = ['Silver', 'Gold', 'Platinum'].indexOf(p.tier) >= ['Silver', 'Gold', 'Platinum'].indexOf(r.min_tier);
    const earned = tierOk && score >= r.min_score;
    return { ...r, earned, progress: earned ? undefined : Math.min(99, Math.round((score / r.min_score) * 100)) };
  });

  const history = Array.from({ length: Math.min(months, 8) }, (_, i) => ({
    month: `M-${Math.min(months, 8) - i}`,
    mrr_eur: Math.round(p.license.price_month_eur * (0.55 + 0.45 * ((i + 1) / Math.min(months, 8))) * (0.9 + rnd() * 0.2)),
    clients: Math.max(1, Math.round(p.license.client_seats_used * ((i + 1) / Math.min(months, 8)))),
  }));

  return {
    partner_id: p.id, score, tier: p.tier, next_tier: nextTier,
    points_to_next_tier: nextTier ? Math.max(0, nextMin - score) : 0,
    components, months_as_partner: months, churn_rate_pct: churn, nrr_pct: nrr, csat,
    rewards, history,
  };
}

// Program-wide reward catalog shown to partners (transparency page).
export const partnerProgramTiers = [
  { tier: 'Silver', min_score: 0, perks: ['Marge standard', 'Support 8h ouvrée', 'Portail white-label'] },
  { tier: 'Gold', min_score: 65, perks: ['Uplift marge +5 %', 'Support prioritaire N2', 'MDF co-marketing', 'Certifications offertes'] },
  { tier: 'Platinum', min_score: 78, perks: ['Commission fidélité 3 %', 'Accès bêta roadmap', 'Account manager dédié', 'Événements clients conjoints'] },
] as const;
