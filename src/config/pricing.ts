/**
 * INFRAvx — Bundle All-in-One pricing (mirror of backend/app/core/pricing.py).
 * SINGLE SOURCE OF TRUTH for the UI. Never hardcode prices in components.
 * Base catalogue currency = MAD HT/month; display currency resolved per country.
 */

export type PlanTier = 'STARTER' | 'PRO' | 'SOUVERAIN';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export type Currency = 'MAD' | 'EUR' | 'USD';

export interface TierLimits {
  unitPriceMad: number;        // per managed endpoint / month (HT)
  seatLimit: number;           // included tech seats (0 = unlimited)
  siemLimitGbDay: number;      // included SIEM ingestion GB/day
  extraSeatMad: number;        // overage per extra tech seat / month
  siemOverageMadPerGb: number; // overage per extra GB/day / month
}

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  STARTER:   { unitPriceMad: 450, seatLimit: 3,  siemLimitGbDay: 10,  extraSeatMad: 250, siemOverageMadPerGb: 15 },
  PRO:       { unitPriceMad: 450, seatLimit: 20, siemLimitGbDay: 50,  extraSeatMad: 250, siemOverageMadPerGb: 15 },
  SOUVERAIN: { unitPriceMad: 350, seatLimit: 0,  siemLimitGbDay: 150, extraSeatMad: 0,   siemOverageMadPerGb: 10 },
};

export const ANNUAL_MULTIPLIER = 0.88; // 12 % off -> lissed: 396 / 396 / 308 MAD

// FX rates configurable via env (VITE_PRICING_EUR_RATE / VITE_PRICING_USD_RATE)
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const EUR_RATE = Number(viteEnv.VITE_PRICING_EUR_RATE ?? 0.092);
const USD_RATE = Number(viteEnv.VITE_PRICING_USD_RATE ?? 0.1);

const EUROZONE = new Set([
  'fr', 'de', 'es', 'it', 'be', 'nl', 'lu', 'at', 'pt', 'ie', 'fi',
  'gr', 'cy', 'mt', 'si', 'sk', 'ee', 'lv', 'lt', 'ad', 'mc', 'sm', 'va', 'xk',
]);
const MAD_COUNTRIES = new Set(['ma', 'mar', 'morocco', 'maroc']);

export function resolveCurrency(country?: string | null): Currency {
  const c = (country || '').trim().toLowerCase();
  if (MAD_COUNTRIES.has(c)) return 'MAD';
  if (EUROZONE.has(c)) return 'EUR';
  return 'USD';
}

export function convert(amountMad: number, currency: Currency): number {
  if (currency === 'EUR') return Math.round(amountMad * EUR_RATE * 100) / 100;
  if (currency === 'USD') return Math.round(amountMad * USD_RATE * 100) / 100;
  return Math.round(amountMad * 100) / 100;
}

export function unitPrice(tier: PlanTier, cycle: BillingCycle): number {
  const base = TIER_LIMITS[tier].unitPriceMad;
  return cycle === 'ANNUAL' ? Math.round(base * ANNUAL_MULTIPLIER) : base;
}

export interface InvoiceRequest {
  planTier: PlanTier;
  billingCycle: BillingCycle;
  endpointCount: number;
  seatsUsed?: number;
  siemGbDayUsed?: number;
  country?: string | null;
}

export interface InvoiceLine { label: string; qty: number; unitMad: number; totalMad: number }
export interface Invoice {
  currency: Currency; lines: InvoiceLine[];
  totalMad: number; totalDisplay: number;
  planTier: PlanTier; billingCycle: BillingCycle;
}

/**
 * Exact formula required by the brief:
 * (Endpoints * Unit_Price * [0.88 if annual]) + (Extra_Seats * 250) + (SIEM_Overage * rate)
 */
export function computeInvoice(req: InvoiceRequest): Invoice {
  const limits = TIER_LIMITS[req.planTier];
  const unit = unitPrice(req.planTier, req.billingCycle);
  const seatsUsed = req.seatsUsed ?? 0;
  const siemUsed = req.siemGbDayUsed ?? 0;

  const lines: InvoiceLine[] = [];

  const endpointsTotal = req.endpointCount * unit;
  lines.push({ label: `Endpoints (${req.planTier})`, qty: req.endpointCount, unitMad: unit, totalMad: endpointsTotal });

  const extraSeats = limits.seatLimit > 0 ? Math.max(0, seatsUsed - limits.seatLimit) : 0;
  const seatsTotal = extraSeats * limits.extraSeatMad;
  if (extraSeats > 0) {
    lines.push({ label: 'Extra tech seats', qty: extraSeats, unitMad: limits.extraSeatMad, totalMad: seatsTotal });
  }

  const siemOverage = Math.max(0, siemUsed - limits.siemLimitGbDay);
  const siemTotal = siemOverage * limits.siemOverageMadPerGb;
  if (siemOverage > 0) {
    lines.push({ label: 'SIEM overage (GB/day)', qty: siemOverage, unitMad: limits.siemOverageMadPerGb, totalMad: siemTotal });
  }

  const totalMad = endpointsTotal + seatsTotal + siemTotal;
  const currency = resolveCurrency(req.country);
  return {
    currency, lines,
    totalMad: Math.round(totalMad * 100) / 100,
    totalDisplay: convert(totalMad, currency),
    planTier: req.planTier, billingCycle: req.billingCycle,
  };
}

export function formatMoney(amount: number, currency: Currency): string {
  const locale = currency === 'MAD' ? 'fr-MA' : currency === 'EUR' ? 'fr-FR' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}
