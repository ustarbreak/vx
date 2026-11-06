"""Platform-wide subscription and metered-usage overview.

This endpoint intentionally distinguishes persisted commercial fields from
actual payment settlement. No invoice or cash-collection ledger is present in
the current schema, so it never reports collected revenue or paid invoices.
"""
from datetime import datetime, timezone
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_rbac import require_permission
from app.database import get_db
from app.models import Organization, UsageEvent, User

router = APIRouter(prefix="/platform/billing", tags=["Platform Billing"])


def _period_bounds(period: str):
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise HTTPException(422, "period must use YYYY-MM")
    year, month = map(int, period.split("-"))
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=timezone.utc)
    return start, end


@router.get("/overview")
async def platform_billing_overview(
    period: str | None = Query(None, description="YYYY-MM; defaults to current UTC month"),
    _owner: User = Depends(require_permission("platform.billing.read")),
    db: AsyncSession = Depends(get_db),
):
    """Return persisted subscription roster and metering evidence for all tenants."""
    selected_period = period or datetime.now(timezone.utc).strftime("%Y-%m")
    start, end = _period_bounds(selected_period)

    orgs = (await db.execute(
        select(Organization).order_by(Organization.name)
    )).scalars().all()

    usage_rows = (await db.execute(
        select(
            UsageEvent.org_id,
            UsageEvent.metric,
            func.sum(UsageEvent.quantity),
            func.max(UsageEvent.quantity),
            func.count(UsageEvent.id),
            func.max(UsageEvent.occurred_at),
        ).where(
            UsageEvent.occurred_at >= start,
            UsageEvent.occurred_at < end,
        ).group_by(UsageEvent.org_id, UsageEvent.metric)
    )).all()

    usage_by_org: dict[int, dict] = {}
    for org_id, metric, quantity_sum, peak, count, last_at in usage_rows:
        usage_by_org.setdefault(org_id, {})[metric] = {
            # Match the tenant usage API: SIEM is additive; point-in-time
            # endpoint/seat/backup measurements use the recorded peak.
            "quantity": float(quantity_sum if metric == "siem_gb" else peak or 0),
            "event_count": int(count),
            "last_recorded_at": last_at.isoformat() if last_at else None,
        }

    tenants = []
    total_usage_events = 0
    tenants_with_usage = 0
    for org in orgs:
        usage = usage_by_org.get(org.id, {})
        event_count = sum(v["event_count"] for v in usage.values())
        total_usage_events += event_count
        if event_count:
            tenants_with_usage += 1
        tenants.append({
            "id": org.id,
            "name": org.name,
            "status": org.status,
            "is_partner": bool(org.is_partner),
            "tier": org.tier,
            "plan_tier": org.plan_tier,
            "billing_cycle": org.billing_cycle,
            "monthly_revenue_recorded": float(org.monthly_revenue or 0),
            "currency": "MAD",
            "contract_start": org.contract_start.isoformat() if org.contract_start else None,
            "contract_end": org.contract_end.isoformat() if org.contract_end else None,
            "trial": bool(org.trial),
            "trial_expires_at": org.trial_expires_at.isoformat() if org.trial_expires_at else None,
            "seat_limit": org.seat_limit,
            "endpoint_limit": org.endpoint_count or org.asset_count,
            "siem_limit_gb_day": org.siem_limit_gb,
            "usage": usage,
            "usage_event_count": event_count,
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": selected_period,
        "currency": "MAD",
        "data_mode": "live",
        "scope": "global_platform",
        "counts": {
            "organizations": len(orgs),
            "active": sum(1 for o in orgs if o.status == "active" and not o.is_partner),
            "suspended": sum(1 for o in orgs if o.status == "suspended"),
            "partners": sum(1 for o in orgs if o.is_partner),
            "tenants_with_usage": tenants_with_usage,
            "usage_events": total_usage_events,
        },
        "commercial_integrity": {
            "monthly_revenue_recorded": "Persisted organization field only; not proof of invoicing, collection or recognized revenue.",
            "invoices": "unavailable: no invoice ledger is implemented in the current schema.",
            "payments": "unavailable: no payment/settlement ledger is implemented in the current schema.",
            "usage": "Only recorded UsageEvent facts are included. Missing metric rows are unavailable, not zero.",
        },
        "tenants": tenants,
    }
