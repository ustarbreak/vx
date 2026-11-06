"""Tenant usage metering API. Usage facts are append-only and idempotent.

Only platform administrators may ingest billing usage facts; tenant admins can
read their own monthly usage. All prices/quotes remain in pricing_engine.py.
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import AuditLog, Organization, UsageEvent, User
from app.services.pricing_engine import PRICING_CONFIG

router = APIRouter(prefix="/usage", tags=["Usage Metering"])
METRICS = {
    "endpoints": "endpoint",
    "seats": "seat",
    "siem_gb": "GB",
    "backup_gb": "GB",
}


def _scope(user: User, requested_org: int | None) -> int:
    if user.role == "platform_admin":
        if requested_org is None:
            raise HTTPException(400, "org_id is required for platform administrators")
        return requested_org
    if user.org_id is None:
        raise HTTPException(400, "User has no organization")
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return user.org_id


def _period(month: str):
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(400, "period must be YYYY-MM")
    year, mon = map(int, month.split("-"))
    start = datetime(year, mon, 1, tzinfo=timezone.utc)
    end = datetime(year + (mon == 12), 1 if mon == 12 else mon + 1, 1, tzinfo=timezone.utc)
    return start, end


class UsageEventIn(BaseModel):
    org_id: int = Field(gt=0)
    metric: str
    quantity: Decimal = Field(gt=0, le=Decimal("1000000000"))
    unit: str | None = None
    source: str = Field(min_length=2, max_length=80)
    idempotency_key: str = Field(min_length=8, max_length=128)
    occurred_at: datetime | None = None


@router.post("/events", status_code=201)
async def ingest_usage_event(body: UsageEventIn, user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    if user.role != "platform_admin":
        raise HTTPException(403, "Usage ingestion is restricted to trusted platform operators")
    if body.metric not in METRICS:
        raise HTTPException(422, f"Unsupported usage metric; allowed: {', '.join(METRICS)}")
    expected_unit = METRICS[body.metric]
    if body.unit is not None and body.unit != expected_unit:
        raise HTTPException(422, f"{body.metric} must use unit {expected_unit!r}")
    if await db.get(Organization, body.org_id) is None:
        raise HTTPException(404, "Organization not found")
    existing = (await db.execute(select(UsageEvent).where(
        UsageEvent.org_id == body.org_id,
        UsageEvent.idempotency_key == body.idempotency_key))).scalars().first()
    if existing:
        return {"created": False, "duplicate": True, "event_id": existing.id}
    event = UsageEvent(org_id=body.org_id, metric=body.metric, quantity=body.quantity,
        unit=expected_unit, source=body.source, idempotency_key=body.idempotency_key,
        occurred_at=body.occurred_at or datetime.now(timezone.utc))
    db.add(event)
    db.add(AuditLog(actor_id=user.id, actor_name=user.name or user.email,
        actor_role=user.role, org_id=body.org_id, action="usage.event.recorded",
        resource="usage_event", resource_id=body.idempotency_key,
        details=f"{body.metric}={body.quantity} {expected_unit} source={body.source}",
        outcome="success"))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(UsageEvent).where(
            UsageEvent.org_id == body.org_id,
            UsageEvent.idempotency_key == body.idempotency_key))).scalars().first()
        if existing:
            return {"created": False, "duplicate": True, "event_id": existing.id}
        raise
    await db.refresh(event)
    return {"created": True, "duplicate": False, "event_id": event.id}


@router.get("/summary")
async def usage_summary(period: str = Query(..., description="YYYY-MM"),
                        org_id: int | None = Query(None),
                        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = _scope(user, org_id)
    start, end = _period(period)
    organization = await db.get(Organization, org)
    if organization is None:
        raise HTTPException(404, "Organization not found")
    rows = (await db.execute(
        select(UsageEvent.metric, func.sum(UsageEvent.quantity), func.max(UsageEvent.occurred_at))
        .where(UsageEvent.org_id == org, UsageEvent.occurred_at >= start,
               UsageEvent.occurred_at < end)
        .group_by(UsageEvent.metric)
    )).all()
    totals = {metric: {"quantity": float(quantity or 0), "unit": METRICS.get(metric, ""),
                       "last_recorded_at": last.isoformat() if last else None}
              for metric, quantity, last in rows}
    # Contractual ceilings are read from the existing organization/plan model;
    # missing usage events are reported as unavailable, never fabricated as zero.
    quotas = {
        "endpoints": organization.endpoint_count or organization.asset_count or None,
        "seats": organization.seat_limit or None,
        "siem_gb": organization.siem_limit_gb or None,
        "backup_gb": None,
    }
    plan = (organization.plan_tier or "STARTER").lower()
    pack = PRICING_CONFIG.get("packs", {}).get(plan, PRICING_CONFIG.get("packs", {}).get("starter", {}))
    units = max(int(organization.asset_count or 0), 0)
    backup_per_unit = Decimal(str(pack.get("backupQuotaGbPerUnit", 0)))
    quotas["backup_gb"] = float(backup_per_unit * units) if backup_per_unit else None
    metrics = {}
    for metric, unit in METRICS.items():
        current = totals.get(metric)
        metrics[metric] = {
            "used": current["quantity"] if current else None,
            "unit": unit,
            "limit": quotas[metric],
            "available": current is not None,
            "last_recorded_at": current["last_recorded_at"] if current else None,
        }
    return {"org_id": org, "period": period, "currency": PRICING_CONFIG["currency"],
            "plan": plan, "metrics": metrics,
            "note": "Usage values are sourced only from recorded metering events. Missing events are unavailable, not zero."}
