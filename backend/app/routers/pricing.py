"""Bundle All-in-One pricing endpoints.

All prices come from app.core.pricing — never hardcoded here.
tenant_id is NEVER taken from body/URL for isolation: it comes from the JWT.
A read-only public quote endpoint allows prospects to simulate an invoice.
"""
from fastapi import APIRouter, Depends
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Organization, User
from app.core.security import get_current_user, require_role
from app.core.pricing import (
    PlanTier, BillingCycle, TierLimits, TIER_LIMITS, InvoiceRequest, Invoice, compute_invoice, unit_price,
)

router = APIRouter(prefix="/pricing", tags=["Pricing"])


@router.get("/tiers")
async def list_tiers() -> List[dict]:
    """Catalogue of the 3 bundles (base currency MAD HT/month)."""
    return [
        {
            "tier": t.value,
            "unit_price_mad_monthly": l.unit_price_mad,
            "unit_price_mad_annual": unit_price(t, BillingCycle.ANNUAL),
            "seat_limit": l.seat_limit,
            "siem_limit_gb_day": l.siem_limit_gb_day,
            "extra_seat_mad": l.extra_seat_mad,
            "siem_overage_mad_per_gb": l.siem_overage_mad_per_gb,
        }
        for t, l in TIER_LIMITS.items()
    ]


@router.post("/quote", response_model=Invoice)
async def quote(req: InvoiceRequest) -> Invoice:
    """Public simulator: no tenant data, pure catalogue math."""
    return compute_invoice(req)


@router.get("/invoice", response_model=Invoice)
async def my_invoice(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Current tenant's live invoice. org comes from the JWT only."""
    if not current_user.org_id:
        from fastapi import HTTPException, status
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User has no organization")
    org = (await db.execute(select(Organization).where(Organization.id == current_user.org_id))).scalar_one_or_none()
    if not org:
        from fastapi import HTTPException, status
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    req = InvoiceRequest(
        plan_tier=PlanTier(org.plan_tier or "STARTER"),
        billing_cycle=BillingCycle(org.billing_cycle or "MONTHLY"),
        endpoint_count=org.endpoint_count or 0,
        seats_used=org.member_count or 0,
        siem_gb_day_used=getattr(org, "siem_gb_day_used", 0) or 0,
        country=org.country,
    )
    return compute_invoice(req)
