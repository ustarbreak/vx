"""Platform subscription lifecycle API (PA-06).

This module records subscription terms and plan changes. It does not charge
payment methods or claim payment-provider settlement.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_rbac import has_permission
from app.database import get_db
from app.models import AuditLog, Organization, PlatformSubscription, PlanEntitlementV2, User
from app.core.security import get_current_user

router = APIRouter(prefix="/platform/subscriptions", tags=["Platform Subscriptions"])

PLAN_CODES = {"starter", "pro", "souverain", "custom", "trial"}
STATUSES = {"active", "trialing", "past_due", "paused"}


class SubscriptionCreate(BaseModel):
    org_id: int = Field(gt=0)
    plan_code: Literal["starter", "pro", "souverain", "custom", "trial"]
    status: Literal["active", "trialing", "past_due", "paused"] = "active"
    billing_interval: Literal["monthly", "annual"] = "monthly"
    currency: Literal["MAD", "EUR", "USD"] = "MAD"
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    starts_at: datetime
    current_period_start: datetime
    current_period_end: datetime
    trial_ends_at: datetime | None = None
    provider: str = Field(default="manual", min_length=1, max_length=32)
    provider_subscription_id: str | None = Field(default=None, max_length=160)
    change_reason: str | None = Field(default=None, max_length=300)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _serialize(row: PlatformSubscription) -> dict:
    return {
        "id": row.id, "org_id": row.org_id, "plan_code": row.plan_code,
        "status": row.status, "billing_interval": row.billing_interval,
        "currency": row.currency, "amount": str(row.amount),
        "starts_at": row.starts_at.isoformat(),
        "current_period_start": row.current_period_start.isoformat(),
        "current_period_end": row.current_period_end.isoformat(),
        "trial_ends_at": row.trial_ends_at.isoformat() if row.trial_ends_at else None,
        "cancelled_at": row.cancelled_at.isoformat() if row.cancelled_at else None,
        "is_current": row.is_current, "provider": row.provider,
        "provider_subscription_id": row.provider_subscription_id,
        "change_reason": row.change_reason, "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def _require_billing(user: User, org_id: int | None, permission: str, db: AsyncSession) -> None:
    if not await has_permission(user, permission, db, org_id=org_id):
        raise HTTPException(403, "Billing permission required for this scope")


@router.get("")
async def list_subscriptions(
    org_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_billing(user, org_id, "platform.billing.read", db)
    statement = select(PlatformSubscription).order_by(PlatformSubscription.created_at.desc())
    if org_id is not None:
        statement = statement.where(PlatformSubscription.org_id == org_id)
    rows = (await db.execute(statement.limit(500))).scalars().all()
    return [_serialize(row) for row in rows]


@router.get("/catalog")
async def subscription_catalog(
    org_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_billing(user, org_id, "platform.billing.read", db)
    rows = (await db.execute(
        select(PlanEntitlementV2).order_by(PlanEntitlementV2.plan, PlanEntitlementV2.service_id)
    )).scalars().all()
    catalog: dict[str, list[str]] = {}
    for row in rows:
        if row.included:
            catalog.setdefault(row.plan, []).append(row.service_id)
    return {"plans": [{"code": code, "services": services} for code, services in sorted(catalog.items())],
            "source": "plan_entitlements_v2"}


@router.post("", status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_billing(user, body.org_id, "platform.billing.manage", db)
    org = await db.get(Organization, body.org_id)
    if org is None:
        raise HTTPException(404, "Tenant not found")

    plan_rows = (await db.execute(
        select(PlanEntitlementV2).where(
            PlanEntitlementV2.plan == body.plan_code,
            PlanEntitlementV2.included.is_(True),
        )
    )).scalars().all()
    if not plan_rows:
        raise HTTPException(422, "The selected plan has no persisted service catalog entries")

    starts = _utc(body.starts_at)
    period_start = _utc(body.current_period_start)
    period_end = _utc(body.current_period_end)
    trial_end = _utc(body.trial_ends_at) if body.trial_ends_at else None
    if period_end <= period_start:
        raise HTTPException(422, "current_period_end must be after current_period_start")
    if body.status == "trialing" and trial_end is None:
        raise HTTPException(422, "trial_ends_at is required for a trialing subscription")
    if body.status != "trialing" and trial_end is not None:
        raise HTTPException(422, "trial_ends_at is only valid for a trialing subscription")

    previous = (await db.execute(
        select(PlatformSubscription).where(
            PlatformSubscription.org_id == body.org_id,
            PlatformSubscription.is_current.is_(True),
        )
    )).scalars().first()
    if previous:
        previous.is_current = False
        previous.status = "superseded"

    row = PlatformSubscription(
        org_id=body.org_id, plan_code=body.plan_code, status=body.status,
        billing_interval=body.billing_interval, currency=body.currency,
        amount=body.amount, starts_at=starts, current_period_start=period_start,
        current_period_end=period_end, trial_ends_at=trial_end, is_current=True,
        provider=body.provider, provider_subscription_id=body.provider_subscription_id,
        change_reason=body.change_reason, created_by=user.id,
    )
    db.add(row)

    # The tenant plan is the source read by the existing pricing/entitlement flow.
    org.plan_tier = "STARTER" if body.plan_code == "trial" else body.plan_code.upper()
    org.billing_cycle = "ANNUAL" if body.billing_interval == "annual" else "MONTHLY"
    org.trial = body.status == "trialing" or body.plan_code == "trial"
    org.trial_expires_at = trial_end if org.trial else None
    org.contract_start = period_start.replace(tzinfo=None)
    org.contract_end = period_end.replace(tzinfo=None)

    db.add(AuditLog(
        actor_id=user.id, actor_name=user.name, actor_role=user.role,
        org_id=org.id, action="subscription.created", resource="platform_subscription",
        resource_id="pending", details=f"plan={body.plan_code}; status={body.status}; interval={body.billing_interval}; currency={body.currency}",
        outcome="success",
    ))
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


@router.post("/{subscription_id}/cancel")
async def cancel_subscription(
    subscription_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = await db.get(PlatformSubscription, subscription_id)
    if row is None:
        raise HTTPException(404, "Subscription not found")
    await _require_billing(user, row.org_id, "platform.billing.manage", db)
    if row.status in {"cancelled", "expired", "superseded"}:
        raise HTTPException(409, "Subscription is already terminal")
    row.status = "cancelled"
    row.is_current = False
    row.cancelled_at = datetime.now(timezone.utc)
    org = await db.get(Organization, row.org_id)
    if org is not None:
        org.trial = False
        org.trial_expires_at = None
        org.plan_tier = "STARTER"
        org.billing_cycle = "MONTHLY"
    db.add(AuditLog(
        actor_id=user.id, actor_name=user.name, actor_role=user.role,
        org_id=row.org_id, action="subscription.cancelled", resource="platform_subscription",
        resource_id=str(row.id), details=f"subscription_id={row.id}; plan={row.plan_code}",
        outcome="success",
    ))
    await db.commit()
    await db.refresh(row)
    return _serialize(row)
