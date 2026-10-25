"""
INFRAvx — Bundle All-in-One pricing engine (SINGLE SOURCE OF TRUTH).

Never hardcode prices in routers, UI or SQL. Import from here.
Currency is resolved per tenant country:
  - Morocco (ma)            -> MAD  (base currency of the catalogue)
  - France / EU / eurozone  -> EUR
  - everything else (US, CA, Asia...) -> USD

All catalogue prices are defined in MAD HT/month and converted with
configurable FX rates (env: PRICING_EUR_RATE / PRICING_USD_RATE).
"""
from __future__ import annotations

from enum import Enum
from dataclasses import dataclass

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


# --------------------------------------------------------------------------- #
# Tiers & billing cycles
# --------------------------------------------------------------------------- #
class PlanTier(str, Enum):
    STARTER = "STARTER"        # 450 MAD / endpoint / month
    PRO = "PRO"                # 450 MAD / endpoint / month
    SOUVERAIN = "SOUVERAIN"    # 350 MAD / endpoint / month


class BillingCycle(str, Enum):
    MONTHLY = "MONTHLY"
    ANNUAL = "ANNUAL"          # 12 % off -> multiplier 0.88


@dataclass(frozen=True)
class TierLimits:
    unit_price_mad: int          # price per managed endpoint / month (HT)
    seat_limit: int              # included technician seats (0 = unlimited)
    siem_limit_gb_day: int       # included SIEM ingestion (GB/day)
    extra_seat_mad: int          # overage per extra tech seat / month
    siem_overage_mad_per_gb: int # overage per extra GB/day / month


TIER_LIMITS: dict[PlanTier, TierLimits] = {
    PlanTier.STARTER:   TierLimits(450, 3,  10,  250, 15),
    PlanTier.PRO:       TierLimits(450, 20, 50,  250, 15),
    PlanTier.SOUVERAIN: TierLimits(350, 0, 150,   0, 10),  # seats unlimited, no seat overage
}

ANNUAL_DISCOUNT_MULTIPLIER = 0.88  # 12 % off, lissed monthly: 396 / 396 / 308 MAD


class PricingSettings(BaseSettings):
    """FX + discount configurable via env, never hardcoded elsewhere."""
    model_config = SettingsConfigDict(env_prefix="PRICING_", extra="ignore")

    eur_rate: float = 0.092     # 1 MAD = 0.092 EUR
    usd_rate: float = 0.100     # 1 MAD = 0.100 USD
    annual_multiplier: float = ANNUAL_DISCOUNT_MULTIPLIER


pricing_settings = PricingSettings()


# --------------------------------------------------------------------------- #
# Currency resolution
# --------------------------------------------------------------------------- #
EUROZONE = {
    "fr", "de", "es", "it", "be", "nl", "lu", "at", "pt", "ie", "fi",
    "gr", "cy", "mt", "si", "sk", "ee", "lv", "lt", "ad", "mc", "sm", "va", "xk",
}
MAD_COUNTRIES = {"ma", "mar", "morocco", "maroc"}


def resolve_currency(country: str | None) -> str:
    c = (country or "").strip().lower()
    if c in MAD_COUNTRIES:
        return "MAD"
    if c in EUROZONE:
        return "EUR"
    return "USD"


def convert(amount_mad: float, currency: str) -> float:
    if currency == "EUR":
        return round(amount_mad * pricing_settings.eur_rate, 2)
    if currency == "USD":
        return round(amount_mad * pricing_settings.usd_rate, 2)
    return round(float(amount_mad), 2)


def unit_price(tier: PlanTier, cycle: BillingCycle) -> int:
    """Effective per-endpoint monthly price in MAD (annual = lissed with -12%)."""
    base = TIER_LIMITS[tier].unit_price_mad
    if cycle == BillingCycle.ANNUAL:
        return int(round(base * pricing_settings.annual_multiplier))
    return base


# --------------------------------------------------------------------------- #
# Invoice calculation — exact formula required by the brief:
#   (Endpoints * Unit_Price * [0.88 if annual]) + (Extra_Seats * 250) + (SIEM_Overage * rate)
# --------------------------------------------------------------------------- #
class InvoiceRequest(BaseModel):
    plan_tier: PlanTier = PlanTier.PRO
    billing_cycle: BillingCycle = BillingCycle.MONTHLY
    endpoint_count: int
    seats_used: int = 0
    siem_gb_day_used: int = 0
    country: str | None = None  # resolves display currency only; calc stays in MAD


class InvoiceLine(BaseModel):
    label: str
    qty: float
    unit_mad: float
    total_mad: float


class Invoice(BaseModel):
    currency: str
    lines: list[InvoiceLine]
    total_mad: float
    total_display: float
    plan_tier: PlanTier
    billing_cycle: BillingCycle


def compute_invoice(req: InvoiceRequest) -> Invoice:
    limits = TIER_LIMITS[req.plan_tier]
    cycle = req.billing_cycle
    unit = unit_price(req.plan_tier, cycle)

    lines: list[InvoiceLine] = []

    # 1. Endpoints
    endpoints_total = req.endpoint_count * unit
    lines.append(InvoiceLine(
        label=f"Endpoints ({req.plan_tier.value})",
        qty=req.endpoint_count, unit_mad=unit, total_mad=endpoints_total,
    ))

    # 2. Extra tech seats (Starter/Pro only; Souverain = unlimited)
    extra_seats = max(0, req.seats_used - limits.seat_limit) if limits.seat_limit else 0
    seats_total = extra_seats * limits.extra_seat_mad
    if extra_seats:
        lines.append(InvoiceLine(
            label="Extra tech seats", qty=extra_seats,
            unit_mad=limits.extra_seat_mad, total_mad=seats_total,
        ))

    # 3. SIEM overage (per extra GB/day)
    siem_overage = max(0, req.siem_gb_day_used - limits.siem_limit_gb_day)
    siem_total = siem_overage * limits.siem_overage_mad_per_gb
    if siem_overage:
        lines.append(InvoiceLine(
            label="SIEM overage (GB/day)", qty=siem_overage,
            unit_mad=limits.siem_overage_mad_per_gb, total_mad=siem_total,
        ))

    total_mad = endpoints_total + seats_total + siem_total
    currency = resolve_currency(req.country)
    return Invoice(
        currency=currency,
        lines=lines,
        total_mad=round(total_mad, 2),
        total_display=convert(total_mad, currency),
        plan_tier=req.plan_tier,
        billing_cycle=cycle,
    )
